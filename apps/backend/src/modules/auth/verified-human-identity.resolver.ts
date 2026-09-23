import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { User } from "@/domains/shared/storage/storage-types";
import { StorageUnitOfWork } from '@/domains/shared/storage/storage-unit-of-work';
import { IdentityStorage, type IdentityTransaction } from '@/domains/shared/storage/identity-storage';
import { StorageConflictError } from '@/domains/shared/storage/storage-errors';
import type {
  VerifiedHumanIdentityAssertion,
  VerifiedHumanIdentityProfileHints,
} from '@/domains/shared/ports/verified-human-identity';
import { createSyntheticPrincipalEmail } from './principal-identity';
import { normalizeVerifiedHumanProfileHints } from './verified-human-profile-hints';

const SERIALIZABLE_ATTEMPTS = 5;
const MAX_PROVIDER_LENGTH = 32;
const MAX_ISSUER_BYTES = 2048;
const MAX_SUBJECT_BYTES = 1024;
const PROVIDER_PATTERN = /^[a-z][a-z0-9-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;



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
    profileHints: normalizeVerifiedHumanProfileHints(assertion.profileHints),
  };
}

@Injectable()
export class VerifiedHumanIdentityResolver {
  private readonly logger = new Logger(VerifiedHumanIdentityResolver.name);

  constructor(private readonly unitOfWork: StorageUnitOfWork, private readonly identity: IdentityStorage) {}

  async resolve(assertion: VerifiedHumanIdentityAssertion): Promise<User> {
    const verified = validateVerifiedHumanIdentityAssertion(assertion);

    for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        const resolution = await this.unitOfWork.serializable(
          ({ identity }) => this.resolveInTransaction(identity, verified),
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
    transaction: IdentityTransaction,
    assertion: VerifiedHumanIdentityAssertion,
  ): Promise<Resolution> {
    const existing = await transaction.findExact(assertion.key);
    if (existing) {
      this.logger.debug('Resolved an exact verified human identity');
      return { created: false, user: existing };
    }

    const userId = randomUUID();
    const user = await transaction.createPrincipal(userId, assertion.profileHints?.verifiedEmail ?? createSyntheticPrincipalEmail(userId));
    await transaction.createVerifiedBinding(userId, assertion.key);
    this.logger.log('Created a verified human principal');
    return { created: true, user };
  }

  private async findExact(
    assertion: VerifiedHumanIdentityAssertion,
  ): Promise<User | null> {
    return this.identity.findExact(assertion.key);
  }

  private isUniqueConflict(error: unknown): boolean {
    return error instanceof StorageConflictError && error.kind === 'unique';
  }

  private isRetryableConflict(error: unknown): boolean {
    return error instanceof StorageConflictError;
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
      const definitions = await this.identity.findInitialProfileDefinitions(values.map(({ slug }) => slug));
      const definitionBySlug = new Map(
        definitions.map((definition) => [definition.slug, definition.id]),
      );

      for (const { slug, value } of values) {
        const definitionId = definitionBySlug.get(slug);
        if (!definitionId || value === undefined) {
          continue;
        }
        const existing = await this.identity.hasInitialProfileValue(userId, definitionId);
        if (existing) {
          continue;
        }
        await this.identity.createInitialProfileValue(userId, definitionId, value);
      }
    } catch {
      this.logger.warn('Could not seed initial profile preferences');
    }
  }
}
