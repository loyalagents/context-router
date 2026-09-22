import { constants } from "fs";
import { lstat, open, realpath } from "fs/promises";
import { dirname, isAbsolute } from "path";
import { Injectable } from "@nestjs/common";
import {
  type HostedIssuerConfiguration,
  type IdentityLinkApprovalDisposition,
  type IdentityLinkDisposition,
  assertLegacyIssuerAdmission,
  canonicalizeIdentityLinkEmail,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  isReservedIdentityLinkEmail,
  parseIdentityLinkClaimMarker,
  parseIdentityLinkClaims,
} from "./hosted-identity-policy";
import {
  type HostedIdentityAdmissionMarker,
  type HostedIdentityAdmissionUser,
  HostedIdentityRepository,
} from "./hosted-identity.repository";

const AUDIT_INTENT_MAX_BYTES = 256 * 1024;
const AUDIT_INTENT_MAX_ENTRIES = 256;

export interface HostedIdentityAuditDenyIntent {
  userId: string;
  email: string;
  decision: "deny";
}

export interface HostedIdentityAuditLinkIntent {
  userId: string;
  email: string;
  decision: "link";
  issuer: string;
  subject: string;
}

export type HostedIdentityAuditIntent =
  | HostedIdentityAuditDenyIntent
  | HostedIdentityAuditLinkIntent;

export interface HostedIdentityAuditOutput {
  version: 1;
  identityLinkClaims: string;
  counts: {
    pending: number;
    consumed: number;
    link: number;
    deny: number;
    total: number;
  };
  digest: string;
}

interface EligibleAuditUser extends HostedIdentityAdmissionUser {
  canonicalEmail: string;
  rowDigest: string;
}

function invalidAuditIntent(): never {
  throw new Error("Invalid hosted identity audit intent");
}

function unsafeAuditIntentFile(): never {
  throw new Error("Unsafe hosted identity audit intent file");
}

function hasOnlyUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function parseHostedIdentityAuditIntent(
  value: string,
): HostedIdentityAuditIntent[] {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > AUDIT_INTENT_MAX_BYTES
  ) {
    return invalidAuditIntent();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidAuditIntent();
  }
  if (!Array.isArray(parsed) || parsed.length > AUDIT_INTENT_MAX_ENTRIES) {
    return invalidAuditIntent();
  }

  const canonical: HostedIdentityAuditIntent[] = [];
  let previousUserId: string | undefined;
  for (const candidate of parsed) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      return invalidAuditIntent();
    }
    const entry = candidate as Record<string, unknown>;
    if (
      typeof entry.userId !== "string" ||
      entry.userId.length === 0 ||
      !hasOnlyUnicodeScalars(entry.userId) ||
      typeof entry.email !== "string" ||
      !hasOnlyUnicodeScalars(entry.email) ||
      (entry.decision !== "deny" && entry.decision !== "link") ||
      (previousUserId !== undefined &&
        compareUtf8(previousUserId, entry.userId) >= 0)
    ) {
      return invalidAuditIntent();
    }
    try {
      canonicalizeIdentityLinkEmail(entry.email);
    } catch {
      return invalidAuditIntent();
    }
    previousUserId = entry.userId;

    if (entry.decision === "deny") {
      canonical.push({
        userId: entry.userId,
        email: entry.email,
        decision: "deny",
      });
      continue;
    }
    if (
      typeof entry.issuer !== "string" ||
      entry.issuer.length === 0 ||
      !hasOnlyUnicodeScalars(entry.issuer) ||
      typeof entry.subject !== "string" ||
      entry.subject.length === 0 ||
      !hasOnlyUnicodeScalars(entry.subject)
    ) {
      return invalidAuditIntent();
    }
    canonical.push({
      userId: entry.userId,
      email: entry.email,
      decision: "link",
      issuer: entry.issuer,
      subject: entry.subject,
    });
  }

  if (JSON.stringify(canonical) !== value) {
    return invalidAuditIntent();
  }
  return canonical;
}

function sameFileIdentity(
  left: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
  right: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size
  );
}

function sameDirectoryIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.mode === right.mode
  );
}

export async function readHostedIdentityAuditIntentFile(
  path: string,
): Promise<HostedIdentityAuditIntent[]> {
  if (typeof path !== "string" || !isAbsolute(path)) {
    return unsafeAuditIntentFile();
  }

  let bytes: Buffer;
  try {
    const uid = process.getuid?.();
    if (uid === undefined) {
      return unsafeAuditIntentFile();
    }
    const parent = dirname(path);
    const parentBefore = await lstat(parent);
    if (
      !parentBefore.isDirectory() ||
      parentBefore.uid !== uid ||
      (parentBefore.mode & 0o077) !== 0 ||
      (await realpath(parent)) !== parent
    ) {
      return unsafeAuditIntentFile();
    }
    const fileBefore = await lstat(path);
    if (
      !fileBefore.isFile() ||
      fileBefore.uid !== uid ||
      fileBefore.nlink !== 1 ||
      (fileBefore.mode & 0o7777) !== 0o600 ||
      fileBefore.size > AUDIT_INTENT_MAX_BYTES
    ) {
      return unsafeAuditIntentFile();
    }

    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (
        !before.isFile() ||
        before.uid !== uid ||
        before.nlink !== 1 ||
        (before.mode & 0o7777) !== 0o600 ||
        before.size > AUDIT_INTENT_MAX_BYTES
      ) {
        return unsafeAuditIntentFile();
      }
      if (!sameFileIdentity(fileBefore, before)) {
        return unsafeAuditIntentFile();
      }
      bytes = await handle.readFile();
      const after = await handle.stat();
      const parentAfter = await lstat(parent);
      if (
        bytes.length !== before.size ||
        !sameFileIdentity(before, after) ||
        !sameDirectoryIdentity(parentBefore, parentAfter) ||
        (await realpath(parent)) !== parent
      ) {
        return unsafeAuditIntentFile();
      }
    } finally {
      await handle.close();
    }
  } catch {
    return unsafeAuditIntentFile();
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return invalidAuditIntent();
  }
  return parseHostedIdentityAuditIntent(text);
}

function canonicalEmailCounts(
  users: HostedIdentityAdmissionUser[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const user of users) {
    let email: string;
    try {
      email = canonicalizeIdentityLinkEmail(user.email);
    } catch {
      continue;
    }
    if (!isReservedIdentityLinkEmail(email)) {
      counts.set(email, (counts.get(email) ?? 0) + 1);
    }
  }
  return counts;
}

function validateConsumedMarker(
  identity: HostedIdentityAdmissionMarker,
  issuer: string,
): IdentityLinkApprovalDisposition {
  try {
    const marker = parseIdentityLinkClaimMarker(identity.metadata);
    const canonicalEmail = canonicalizeIdentityLinkEmail(identity.email);
    if (
      identity.identityCount !== 1 ||
      identity.provider !== "auth0" ||
      identity.issuer !== issuer ||
      isReservedIdentityLinkEmail(canonicalEmail) ||
      marker.rowDigest !==
        computeIdentityLinkRowDigest(identity.userId, canonicalEmail) ||
      marker.identityDigest !==
        computeIdentityLinkIdentityDigest(issuer, identity.providerUserId)
    ) {
      throw new Error();
    }
    return {
      rowDigest: marker.rowDigest,
      decision: "link",
      identityDigest: marker.identityDigest,
    };
  } catch {
    throw new Error("Hosted identity marker drift");
  }
}

@Injectable()
export class HostedIdentityAuditService {
  constructor(private readonly repository: HostedIdentityRepository) {}

  async audit(
    intent: HostedIdentityAuditIntent[],
    configuration: Pick<HostedIssuerConfiguration, "issuer" | "legacyIssuer">,
  ): Promise<HostedIdentityAuditOutput> {
    if (!Array.isArray(intent) || intent.length > AUDIT_INTENT_MAX_ENTRIES) {
      return invalidAuditIntent();
    }

    const subjects: string[] = [];
    const proposedSubjects = new Set<string>();
    const proposedIdentityDigests = new Set<string>();
    for (const entry of intent) {
      if (entry.decision !== "link") {
        continue;
      }
      if (
        entry.issuer !== configuration.issuer ||
        entry.subject.length === 0 ||
        proposedSubjects.has(entry.subject)
      ) {
        return invalidAuditIntent();
      }
      const identityDigest = computeIdentityLinkIdentityDigest(
        configuration.issuer,
        entry.subject,
      );
      if (proposedIdentityDigests.has(identityDigest)) {
        return invalidAuditIntent();
      }
      proposedSubjects.add(entry.subject);
      proposedIdentityDigests.add(identityDigest);
      subjects.push(entry.subject);
    }

    const snapshot = await this.repository.readAuditSnapshot(
      configuration.issuer,
      subjects,
    );
    assertLegacyIssuerAdmission(
      {
        issuer: configuration.issuer,
        legacyIssuer: configuration.legacyIssuer,
        domain: new URL(configuration.issuer).host,
      },
      snapshot.sentinelRowCount,
    );
    if (snapshot.conflictingSubjects.length > 0) {
      throw new Error("Hosted identity audit subject conflict");
    }

    const allUsers = new Map<string, string>();
    for (const user of snapshot.allUsers) {
      if (allUsers.has(user.userId)) {
        throw new Error("Hosted identity audit cohort mismatch");
      }
      allUsers.set(user.userId, user.email);
    }
    const eligibleUsers = new Map<string, EligibleAuditUser>();
    for (const user of snapshot.zeroIdentityUsers) {
      if (allUsers.get(user.userId) !== user.email) {
        throw new Error("Hosted identity audit cohort mismatch");
      }
      let canonicalEmail: string;
      try {
        canonicalEmail = canonicalizeIdentityLinkEmail(user.email);
      } catch {
        continue;
      }
      if (isReservedIdentityLinkEmail(canonicalEmail)) {
        continue;
      }
      if (eligibleUsers.has(user.userId)) {
        throw new Error("Hosted identity audit cohort mismatch");
      }
      eligibleUsers.set(user.userId, {
        ...user,
        canonicalEmail,
        rowDigest: computeIdentityLinkRowDigest(user.userId, canonicalEmail),
      });
    }
    if (
      eligibleUsers.size !== intent.length ||
      eligibleUsers.size > AUDIT_INTENT_MAX_ENTRIES
    ) {
      throw new Error("Hosted identity audit cohort mismatch");
    }

    const emailCounts = canonicalEmailCounts(snapshot.allUsers);
    const occupiedIdentities = new Map<string, string[]>();
    for (const identity of snapshot.hostedIdentities) {
      const identityDigest = computeIdentityLinkIdentityDigest(
        configuration.issuer,
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
      throw new Error("Hosted identity audit subject conflict");
    }
    const classifiedRows = new Set<string>();
    const identityDigests = new Set<string>();
    const dispositions: IdentityLinkDisposition[] = [];
    for (const entry of intent) {
      const eligible = eligibleUsers.get(entry.userId);
      if (
        !eligible ||
        eligible.email !== entry.email ||
        classifiedRows.has(eligible.rowDigest)
      ) {
        throw new Error("Hosted identity audit cohort mismatch");
      }
      classifiedRows.add(eligible.rowDigest);
      if (entry.decision === "deny") {
        dispositions.push({ rowDigest: eligible.rowDigest, decision: "deny" });
        continue;
      }
      if ((emailCounts.get(eligible.canonicalEmail) ?? 0) > 1) {
        throw new Error("Ambiguous hosted identity email must be denied");
      }
      const identityDigest = computeIdentityLinkIdentityDigest(
        configuration.issuer,
        entry.subject,
      );
      if (identityDigests.has(identityDigest)) {
        return invalidAuditIntent();
      }
      identityDigests.add(identityDigest);
      dispositions.push({
        rowDigest: eligible.rowDigest,
        decision: "link",
        identityDigest,
      });
    }

    for (const identity of snapshot.markedIdentities) {
      const disposition = validateConsumedMarker(
        identity,
        configuration.issuer,
      );
      if (
        classifiedRows.has(disposition.rowDigest) ||
        identityDigests.has(disposition.identityDigest) ||
        occupiedIdentities.get(disposition.identityDigest)?.length !== 1 ||
        occupiedIdentities.get(disposition.identityDigest)?.[0] !== identity.id
      ) {
        throw new Error("Hosted identity marker drift");
      }
      classifiedRows.add(disposition.rowDigest);
      identityDigests.add(disposition.identityDigest);
      dispositions.push(disposition);
    }
    if (dispositions.length > AUDIT_INTENT_MAX_ENTRIES) {
      throw new Error("Hosted identity audit cohort exceeds limit");
    }

    dispositions.sort((left, right) =>
      compareUtf8(left.rowDigest, right.rowDigest),
    );
    const tuples = dispositions.map((disposition) =>
      disposition.decision === "deny"
        ? [disposition.rowDigest, "deny"]
        : [disposition.rowDigest, "link", disposition.identityDigest],
    );
    const claims = parseIdentityLinkClaims(
      JSON.stringify({ version: 1, dispositions: tuples }),
    );
    const linkCount = dispositions.filter(
      (disposition) => disposition.decision === "link",
    ).length;
    return {
      version: 1,
      identityLinkClaims: claims.canonical,
      counts: {
        pending: intent.length,
        consumed: snapshot.markedIdentities.length,
        link: linkCount,
        deny: dispositions.length - linkCount,
        total: dispositions.length,
      },
      digest: claims.digest,
    };
  }
}
