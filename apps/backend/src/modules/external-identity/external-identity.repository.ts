import type {
  ExternalIdentity,
  JsonInput,
} from "@/domains/shared/storage/storage-types";
/** Application-owned persistence behavior, independent of database and transport types. */
export abstract class ExternalIdentityRepository {
  abstract findByProviderAndUserId(
    provider: string,
    issuer: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null>;
  abstract findByUserId(userId: string): Promise<ExternalIdentity[]>;
  abstract create(data: {
    userId: string;
    provider: string;
    issuer: string;
    providerUserId: string;
    metadata?: JsonInput;
  }): Promise<ExternalIdentity>;
  abstract update(
    id: string,
    data: {
      metadata?: JsonInput;
    },
  ): Promise<ExternalIdentity>;
  abstract delete(id: string): Promise<ExternalIdentity>;
  abstract linkIdentityToUser(
    userId: string,
    provider: string,
    issuer: string,
    providerUserId: string,
    metadata?: JsonInput,
  ): Promise<ExternalIdentity>;
}
