import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type IdentityLinkClaims,
  assertLegacyIssuerAdmission,
  canonicalizeIdentityLinkEmail,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  isReservedIdentityLinkEmail,
  parseIdentityLinkClaimMarker,
} from "./hosted-identity-policy";
import { HostedIdentityRepository } from "./hosted-identity.repository";

const MAX_ADMISSION_ROWS = 256;

interface PendingAdmissionRow {
  rowDigest: string;
  canonicalEmail: string;
}

function countCanonicalEmails(
  users: Array<{ email: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const user of users) {
    let canonicalEmail: string;
    try {
      canonicalEmail = canonicalizeIdentityLinkEmail(user.email);
    } catch {
      continue;
    }
    if (isReservedIdentityLinkEmail(canonicalEmail)) {
      continue;
    }
    counts.set(canonicalEmail, (counts.get(canonicalEmail) ?? 0) + 1);
  }
  return counts;
}

@Injectable()
export class HostedIdentityAdmissionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HostedIdentityAdmissionService.name);

  constructor(
    private readonly repository: HostedIdentityRepository,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.verify();
  }

  async verify(): Promise<void> {
    const issuer = this.configService.getOrThrow<string>("auth.auth0.issuer");
    const legacyIssuer = this.configService.get<string>(
      "auth.auth0.legacyIssuer",
    );
    const claims = this.configService.getOrThrow<IdentityLinkClaims>(
      "auth.auth0.identityLinkClaims",
    );
    const snapshot = await this.repository.readAdmissionSnapshot(issuer);

    assertLegacyIssuerAdmission(
      { issuer, legacyIssuer, domain: new URL(issuer).host },
      snapshot.sentinelRowCount,
    );

    const dispositionByRow = new Map(
      claims.dispositions.map((disposition) => [
        disposition.rowDigest,
        disposition,
      ]),
    );
    const classifiedRows = new Set<string>();
    const pendingRows: PendingAdmissionRow[] = [];
    const occupiedIdentities = new Map<string, string[]>();

    for (const identity of snapshot.hostedIdentities) {
      const identityDigest = computeIdentityLinkIdentityDigest(
        issuer,
        identity.providerUserId,
      );
      const occupied = occupiedIdentities.get(identityDigest) ?? [];
      occupied.push(identity.id);
      occupiedIdentities.set(identityDigest, occupied);
    }
    if (
      Array.from(occupiedIdentities.values()).some(
        (identities) => identities.length > 1,
      )
    ) {
      throw new Error("Hosted identity admission subject conflict");
    }

    for (const user of snapshot.zeroIdentityUsers) {
      let canonicalEmail: string;
      try {
        canonicalEmail = canonicalizeIdentityLinkEmail(user.email);
      } catch {
        continue;
      }
      if (isReservedIdentityLinkEmail(canonicalEmail)) {
        continue;
      }
      pendingRows.push({
        rowDigest: computeIdentityLinkRowDigest(user.userId, canonicalEmail),
        canonicalEmail,
      });
    }
    if (
      pendingRows.length > MAX_ADMISSION_ROWS ||
      snapshot.markedIdentities.length > MAX_ADMISSION_ROWS
    ) {
      throw new Error("Hosted identity admission cohort exceeds limit");
    }

    const canonicalEmailCounts = countCanonicalEmails(snapshot.allUsers);
    for (const pending of pendingRows) {
      const disposition = dispositionByRow.get(pending.rowDigest);
      if (!disposition || classifiedRows.has(pending.rowDigest)) {
        throw new Error("Hosted identity admission cohort mismatch");
      }
      if (
        (canonicalEmailCounts.get(pending.canonicalEmail) ?? 0) > 1 &&
        disposition.decision !== "deny"
      ) {
        throw new Error("Ambiguous hosted identity email must be denied");
      }
      if (
        disposition.decision === "link" &&
        (occupiedIdentities.get(disposition.identityDigest)?.length ?? 0) > 0
      ) {
        throw new Error("Hosted identity admission subject conflict");
      }
      classifiedRows.add(pending.rowDigest);
    }

    for (const identity of snapshot.markedIdentities) {
      let marker;
      let canonicalEmail: string;
      try {
        marker = parseIdentityLinkClaimMarker(identity.metadata);
        canonicalEmail = canonicalizeIdentityLinkEmail(identity.email);
      } catch {
        throw new Error("Hosted identity marker drift");
      }
      const disposition = dispositionByRow.get(marker.rowDigest);
      if (
        identity.identityCount !== 1 ||
        identity.provider !== "auth0" ||
        identity.issuer !== issuer ||
        isReservedIdentityLinkEmail(canonicalEmail) ||
        marker.rowDigest !==
          computeIdentityLinkRowDigest(identity.userId, canonicalEmail) ||
        marker.identityDigest !==
          computeIdentityLinkIdentityDigest(issuer, identity.providerUserId) ||
        disposition?.decision !== "link" ||
        disposition.identityDigest !== marker.identityDigest ||
        occupiedIdentities.get(marker.identityDigest)?.length !== 1 ||
        occupiedIdentities.get(marker.identityDigest)?.[0] !== identity.id ||
        classifiedRows.has(marker.rowDigest)
      ) {
        throw new Error("Hosted identity marker drift");
      }
      classifiedRows.add(marker.rowDigest);
    }

    if (
      classifiedRows.size !== claims.dispositions.length ||
      claims.dispositions.some(
        (disposition) => !classifiedRows.has(disposition.rowDigest),
      )
    ) {
      throw new Error("Hosted identity admission cohort mismatch");
    }

    this.logger.log("Hosted identity admission preflight passed");
  }
}
