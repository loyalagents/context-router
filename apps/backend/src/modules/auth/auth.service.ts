import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PreferenceStatus,
  SourceType,
} from "@infrastructure/prisma/generated-client";
import { PrismaService } from "@infrastructure/prisma/prisma.service";
import { Auth0Service } from "@infrastructure/auth0/auth0.service";
import { UserService } from "@modules/user/user.service";
import {
  type IdentityLinkClaims,
  reconcileVerifiedEmailAssertions,
} from "./hosted-identity-policy";
import { HostedIdentityRepository } from "./hosted-identity.repository";

export interface JwtPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  iat?: number;
  exp?: number;
  azp?: string;
  scope?: string;
  [key: string]: any;
}

interface InitialProfileValues {
  email?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly auth0Service: Auth0Service,
    private readonly hostedIdentityRepository: HostedIdentityRepository,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async validateAndSyncUser(jwtPayload: JwtPayload) {
    if (typeof jwtPayload.sub !== "string" || jwtPayload.sub.length === 0) {
      throw new Error("Invalid hosted identity subject");
    }

    const issuer = this.configService.getOrThrow<string>("auth.auth0.issuer");
    const legacyIssuer = this.configService.get<string>(
      "auth.auth0.legacyIssuer",
    );
    const claims = this.configService.getOrThrow<IdentityLinkClaims>(
      "auth.auth0.identityLinkClaims",
    );

    const existing = await this.hostedIdentityRepository.resolveExactOrLegacy({
      issuer,
      legacyIssuer,
      subject: jwtPayload.sub,
    });
    if (existing) {
      return existing.user;
    }

    let managementProfile: Record<string, unknown> | undefined;
    try {
      const response = await this.auth0Service.getUserInfo(jwtPayload.sub);
      const profile = response?.data ?? response;
      if (typeof profile === "object" && profile !== null) {
        managementProfile = profile as Record<string, unknown>;
      }
    } catch {
      this.logger.warn(
        "Auth0 profile lookup unavailable; continuing with token evidence",
      );
    }

    const verifiedEmail = reconcileVerifiedEmailAssertions(
      {
        email: jwtPayload.email,
        emailVerified: jwtPayload.email_verified,
      },
      managementProfile
        ? {
            email: managementProfile.email,
            emailVerified: managementProfile.email_verified,
          }
        : undefined,
    );

    if (this.configService.get<string>("auth.syncStrategy") !== "ON_LOGIN") {
      throw new Error("User synchronization is disabled for new identities");
    }

    const resolution = await this.hostedIdentityRepository.linkOrCreate({
      issuer,
      subject: jwtPayload.sub,
      verifiedEmail,
      claims,
    });

    if (resolution.outcome === "created") {
      const firstName =
        jwtPayload.given_name ?? this.profileString(managementProfile, "given_name");
      const lastName =
        jwtPayload.family_name ??
        this.profileString(managementProfile, "family_name");
      const fullName =
        jwtPayload.name ??
        this.profileString(managementProfile, "name") ??
        [firstName, lastName].filter(Boolean).join(" ");
      await this.seedInitialProfileMemory(resolution.user.userId, {
        email: verifiedEmail,
        fullName,
        firstName,
        lastName,
      });
    }

    return resolution.user;
  }

  async getCurrentUser(userId: string) {
    return this.userService.findOne(userId);
  }

  async findOrCreateM2MUser(clientId: string) {
    this.logger.debug("Resolving hosted M2M compatibility principal");
    const email = `${clientId}@m2m.local`;
    let user = await this.userService.findByEmail(email);
    if (user) {
      return user;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        user = await this.userService.create({ email });
        return user;
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
        this.logger.warn("Hosted M2M principal creation conflict");
        if (attempt === maxRetries) {
          user = await this.userService.findByEmail(email);
          if (user) {
            return user;
          }
          throw new Error("Failed to create hosted M2M principal");
        }
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * Math.pow(2, attempt - 1)),
        );
      }
    }

    throw new Error("Failed to create hosted M2M principal");
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "P2002"
    );
  }

  private profileString(
    profile: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const value = profile?.[key];
    return typeof value === "string" ? value : undefined;
  }

  private async seedInitialProfileMemory(
    userId: string,
    values: InitialProfileValues,
  ): Promise<void> {
    const profileEntries = [
      { slug: "profile.full_name", value: values.fullName },
      { slug: "profile.first_name", value: values.firstName },
      { slug: "profile.last_name", value: values.lastName },
      { slug: "profile.email", value: values.email },
    ];

    const normalizedEntries = profileEntries.flatMap(({ slug, value }) => {
      const normalizedValue = value?.trim();
      return normalizedValue ? [{ slug, value: normalizedValue }] : [];
    });
    if (normalizedEntries.length === 0) {
      return;
    }

    try {
      const definitions = await this.prisma.preferenceDefinition.findMany({
        where: {
          namespace: "GLOBAL",
          slug: { in: normalizedEntries.map(({ slug }) => slug) },
          archivedAt: null,
        },
        select: { id: true, slug: true },
      });
      const definitionBySlug = new Map(
        definitions.map((definition) => [definition.slug, definition.id]),
      );

      for (const { slug, value } of normalizedEntries) {
        const definitionId = definitionBySlug.get(slug);
        if (!definitionId) {
          continue;
        }
        const existing = await this.prisma.preference.findFirst({
          where: {
            userId,
            contextKey: "GLOBAL",
            definitionId,
            status: PreferenceStatus.ACTIVE,
          },
          select: { id: true },
        });
        if (existing) {
          continue;
        }
        await this.prisma.preference.create({
          data: {
            userId,
            locationId: null,
            contextKey: "GLOBAL",
            definitionId,
            value,
            status: PreferenceStatus.ACTIVE,
            sourceType: SourceType.IMPORTED,
            confidence: null,
            evidence: { source: "auth_sync" },
          },
        });
      }
    } catch {
      this.logger.warn("Could not seed initial profile preferences");
    }
  }
}
