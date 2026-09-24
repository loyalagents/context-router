import type {
  IdentityStorage,
  IdentityTransaction,
  HumanIdentityKey,
} from "../../../domains/shared/storage/identity-storage";
import type { User } from "../../../domains/shared/storage/storage-types";
import {
  SqliteAccess,
  decode,
  insert,
  json,
  timestamped,
  placeholders,
} from "./sqlite-records";

export class SqliteIdentityStorage
  extends SqliteAccess
  implements IdentityStorage, IdentityTransaction
{
  findExact({
    provider,
    issuer,
    subject,
  }: HumanIdentityKey): Promise<User | null> {
    return this.call((c) =>
      decode<User>(
        c.get(
          "SELECT u.* FROM users u JOIN external_identities e ON e.user_id=u.user_id WHERE e.provider=? AND e.issuer=? AND e.provider_user_id=?",
          [provider, issuer, subject],
        ),
      ),
    );
  }
  createPrincipal(userId: string, email: string): Promise<User> {
    return this.call((c) =>
      insert<User>(
        c,
        "users",
        timestamped({ user_id: userId, email }, "user_id"),
      ),
    );
  }
  async createVerifiedBinding(
    userId: string,
    { provider, issuer, subject }: HumanIdentityKey,
  ): Promise<void> {
    await this.call((c) =>
      insert(
        c,
        "external_identities",
        timestamped({
          user_id: userId,
          provider,
          issuer,
          provider_user_id: subject,
          metadata: "null",
        }),
      ),
    );
  }
  upsertM2MPrincipal(userId: string, email: string): Promise<User> {
    return this.mutate((c) => {
      c.run(
        "INSERT INTO users(user_id,email,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO NOTHING",
        [userId, email, Date.now(), Date.now()],
      );
      return decode<User>(
        c.get("SELECT * FROM users WHERE user_id=?", [userId]),
      )!;
    });
  }
  countBindings(userId: string): Promise<number> {
    return this.call(
      (c) =>
        c.get("SELECT count(*) n FROM external_identities WHERE user_id=?", [
          userId,
        ]).n,
    );
  }
  findInitialProfileDefinitions(
    slugs: string[],
  ): Promise<Array<{ id: string; slug: string }>> {
    if (!slugs.length) return Promise.resolve([]);
    return this.call((c) =>
      c
        .all(
          `SELECT id,slug FROM preference_definitions WHERE namespace='GLOBAL' AND archived_at IS NULL AND slug IN (${placeholders(slugs)})`,
          slugs,
        )
        .map((row) => ({ id: String(row.id), slug: String(row.slug) })),
    );
  }
  hasInitialProfileValue(
    userId: string,
    definitionId: string,
  ): Promise<boolean> {
    return this.call((c) =>
      Boolean(
        c.get(
          "SELECT id FROM user_preferences WHERE user_id=? AND context_key='GLOBAL' AND definition_id=? AND status='ACTIVE'",
          [userId, definitionId],
        ),
      ),
    );
  }
  async createInitialProfileValue(
    userId: string,
    definitionId: string,
    value: string,
  ): Promise<void> {
    await this.call((c) =>
      insert(
        c,
        "user_preferences",
        timestamped({
          user_id: userId,
          location_id: null,
          context_key: "GLOBAL",
          definition_id: definitionId,
          value: json(value),
          status: "ACTIVE",
          source_type: "IMPORTED",
          confidence: null,
          evidence: json({ source: "verified_identity" }),
        }),
      ),
    );
  }
}
