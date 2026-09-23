import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  PreferenceStatus,
  Prisma,
  SourceType,
} from '@infrastructure/prisma/generated-client';
import type { User } from '@infrastructure/prisma/prisma-models';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import type {
  VerifiedHumanIdentityAssertion,
  VerifiedHumanIdentityProfileHints,
} from '@/domains/shared/ports/verified-human-identity';
import { createSyntheticPrincipalEmail } from './principal-identity';

const SERIALIZABLE_ATTEMPTS = 5;
const MAX_PROVIDER_LENGTH = 32;
const MAX_ISSUER_BYTES = 2048;
const MAX_SUBJECT_BYTES = 1024;
const MAX_EMAIL_BYTES = 320;
const MAX_PROFILE_VALUE_BYTES = 256;
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

type TransactionClient = Prisma.TransactionClient;

interface Resolution {
  created: boolean;
  user: User;
}

interface InitialProfileValue {
  slug: string;
  value?: string;
}

function fixedFailure(): never {
  throw new Error('Invalid verified human identity assertion');
}

function asBoundedCanonicalString(value: unknown, maxBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fixedFailure();
  }
  return value;
}

function validateProfileHints(
  value: unknown,
): VerifiedHumanIdentityProfileHints | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fixedFailure();
  }

  const hints = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'verifiedEmail',
    'displayName',
    'givenName',
    'familyName',
  ]);
  if (Object.keys(hints).some((key) => !allowedKeys.has(key))) {
    return fixedFailure();
  }

  const result: VerifiedHumanIdentityProfileHints = {};
  if (hints.verifiedEmail !== undefined) {
    const email = asBoundedCanonicalString(
      hints.verifiedEmail,
      MAX_EMAIL_BYTES,
    );
    if (/\s/.test(email) || !/^[^@]+@[^@]+$/.test(email)) {
      return fixedFailure();
    }
    result.verifiedEmail = email;
  }
  for (const key of ['displayName', 'givenName', 'familyName'] as const) {
    if (hints[key] !== undefined) {
      result[key] = asBoundedCanonicalString(
        hints[key],
        MAX_PROFILE_VALUE_BYTES,
      );
    }
  }
  return result;
}

export function validateVerifiedHumanIdentityAssertion(
  assertion: VerifiedHumanIdentityAssertion,
): VerifiedHumanIdentityAssertion {
  if (
    typeof assertion !== 'object' ||
    assertion === null ||
    Array.isArray(assertion) ||
    typeof assertion.key !== 'object' ||
    assertion.key === null ||
    Array.isArray(assertion.key)
  ) {
    return fixedFailure();
  }

  const assertionRecord = assertion as unknown as Record<string, unknown>;
  if (
    Object.keys(assertionRecord).some(
      (key) => key !== 'key' && key !== 'profileHints',
    )
  ) {
    return fixedFailure();
  }
  const keyRecord = assertion.key as unknown as Record<string, unknown>;
  if (
    Object.keys(keyRecord).some(
      (key) => key !== 'provider' && key !== 'issuer' && key !== 'subject',
    )
  ) {
    return fixedFailure();
  }

  const provider = asBoundedCanonicalString(
    assertion.key.provider,
    MAX_PROVIDER_LENGTH,
  );
  if (
    provider.length > MAX_PROVIDER_LENGTH ||
    !PROVIDER_PATTERN.test(provider)
  ) {
    return fixedFailure();
  }

  return {
    key: {
      provider,
      issuer: asBoundedCanonicalString(assertion.key.issuer, MAX_ISSUER_BYTES),
      subject: asBoundedCanonicalString(
        assertion.key.subject,
        MAX_SUBJECT_BYTES,
      ),
    },
    profileHints: validateProfileHints(assertion.profileHints),
  };
}

@Injectable()
export class VerifiedHumanIdentityResolver {
  private readonly logger = new Logger(VerifiedHumanIdentityResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(assertion: VerifiedHumanIdentityAssertion): Promise<User> {
    const verified = validateVerifiedHumanIdentityAssertion(assertion);

    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        const resolution = await this.prisma.$transaction(
          (transaction) => this.resolveInTransaction(transaction, verified),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        if (resolution.created) {
          await this.seedInitialProfileMemory(
            resolution.user.userId,
            verified.profileHints,
          );
        }
        return resolution.user;
      } catch (error) {
        if (!this.isRetryableConflict(error)) {
          throw new Error('Human identity resolution failed');
        }
        if (attempt === SERIALIZABLE_ATTEMPTS) {
          if (this.isUniqueConflict(error)) {
            try {
              const winner = await this.findExact(verified);
              if (winner) {
                return winner;
              }
            } catch {
              throw new Error('Human identity resolution conflict');
            }
          }
          throw new Error('Human identity resolution conflict');
        }
      }
    }

    throw new Error('Human identity resolution conflict');
  }

  private async resolveInTransaction(
    transaction: TransactionClient,
    assertion: VerifiedHumanIdentityAssertion,
  ): Promise<Resolution> {
    const { provider, issuer, subject } = assertion.key;
    const existing = await transaction.externalIdentity.findUnique({
      where: {
        provider_issuer_providerUserId: {
          provider,
          issuer,
          providerUserId: subject,
        },
      },
      include: { user: true },
    });
    if (existing) {
      this.logger.debug('Resolved an exact verified human identity');
      return { created: false, user: existing.user };
    }

    const userId = randomUUID();
    const user = await transaction.user.create({
      data: {
        userId,
        email:
          assertion.profileHints?.verifiedEmail ??
          createSyntheticPrincipalEmail(userId),
      },
    });
    await transaction.externalIdentity.create({
      data: {
        userId,
        provider,
        issuer,
        providerUserId: subject,
        metadata: Prisma.JsonNull,
      },
    });
    this.logger.log('Created a verified human principal');
    return { created: true, user };
  }

  private async findExact(
    assertion: VerifiedHumanIdentityAssertion,
  ): Promise<User | null> {
    const { provider, issuer, subject } = assertion.key;
    const identity = await this.prisma.externalIdentity.findUnique({
      where: {
        provider_issuer_providerUserId: {
          provider,
          issuer,
          providerUserId: subject,
        },
      },
      include: { user: true },
    });
    return identity?.user ?? null;
  }

  private isUniqueConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private isRetryableConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const candidate = error as {
      code?: string;
      cause?: { code?: string };
      meta?: { code?: string };
    };
    return (
      candidate.code === 'P2002' ||
      candidate.code === 'P2034' ||
      candidate.code === '40001' ||
      candidate.cause?.code === '40001' ||
      candidate.meta?.code === '40001'
    );
  }

  private async seedInitialProfileMemory(
    userId: string,
    hints: VerifiedHumanIdentityProfileHints | undefined,
  ): Promise<void> {
    const values: InitialProfileValue[] = [
      { slug: 'profile.full_name', value: hints?.displayName },
      { slug: 'profile.first_name', value: hints?.givenName },
      { slug: 'profile.last_name', value: hints?.familyName },
      { slug: 'profile.email', value: hints?.verifiedEmail },
    ].filter((entry) => entry.value !== undefined);
    if (values.length === 0) {
      return;
    }

    try {
      const definitions = await this.prisma.preferenceDefinition.findMany({
        where: {
          namespace: 'GLOBAL',
          slug: { in: values.map(({ slug }) => slug) },
          archivedAt: null,
        },
        select: { id: true, slug: true },
      });
      const definitionBySlug = new Map(
        definitions.map((definition) => [definition.slug, definition.id]),
      );

      for (const { slug, value } of values) {
        const definitionId = definitionBySlug.get(slug);
        if (!definitionId || value === undefined) {
          continue;
        }
        const existing = await this.prisma.preference.findFirst({
          where: {
            userId,
            contextKey: 'GLOBAL',
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
            contextKey: 'GLOBAL',
            definitionId,
            value,
            status: PreferenceStatus.ACTIVE,
            sourceType: SourceType.IMPORTED,
            confidence: null,
            evidence: { source: 'verified_identity' },
          },
        });
      }
    } catch {
      this.logger.warn('Could not seed initial profile preferences');
    }
  }
}
