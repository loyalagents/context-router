import type { ExternalIdentityRepository } from "../../../modules/external-identity/external-identity.repository";
import type {
  ExternalIdentity,
  JsonInput,
} from "../../../domains/shared/storage/storage-types";
import {
  SqliteAccess,
  decode,
  insert,
  update,
  remove,
  timestamped,
  json,
} from "./sqlite-records";
export class SqliteExternalIdentityRepository
  extends SqliteAccess
  implements ExternalIdentityRepository
{
  findByProviderAndUserId(
    provider: string,
    issuer: string,
    providerUserId: string,
  ): Promise<ExternalIdentity | null> {
    return this.call((c) =>
      decode<ExternalIdentity>(
        c.get(
          "SELECT * FROM external_identities WHERE provider=? AND issuer=? AND provider_user_id=?",
          [provider, issuer, providerUserId],
        ),
      ),
    );
  }
  findByUserId(userId: string): Promise<ExternalIdentity[]> {
    return this.call((c) =>
      c
        .all(
          "SELECT * FROM external_identities WHERE user_id=? ORDER BY created_at DESC",
          [userId],
        )
        .map((row) => decode<ExternalIdentity>(row)!),
    );
  }
  create(data: {
    userId: string;
    provider: string;
    issuer: string;
    providerUserId: string;
    metadata?: JsonInput;
  }): Promise<ExternalIdentity> {
    return this.call((c) =>
      insert<ExternalIdentity>(
        c,
        "external_identities",
        timestamped({
          user_id: data.userId,
          provider: data.provider,
          issuer: data.issuer,
          provider_user_id: data.providerUserId,
          metadata: data.metadata === undefined ? null : json(data.metadata),
        }),
      ),
    );
  }
  update(
    id: string,
    data: { metadata?: JsonInput },
  ): Promise<ExternalIdentity> {
    return this.call((c) =>
      update<ExternalIdentity>(
        c,
        "external_identities",
        "id",
        id,
        data.metadata === undefined ? {} : { metadata: json(data.metadata) },
      ),
    );
  }
  delete(id: string): Promise<ExternalIdentity> {
    return this.call((c) =>
      remove<ExternalIdentity>(c, "external_identities", "id", id),
    );
  }
  linkIdentityToUser(
    userId: string,
    provider: string,
    issuer: string,
    providerUserId: string,
    metadata?: JsonInput,
  ): Promise<ExternalIdentity> {
    return this.create({ userId, provider, issuer, providerUserId, metadata });
  }
}
