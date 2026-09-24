import type { PermissionGrantRepository } from "../../../modules/permission-grant/permission-grant.repository";
import type {
  GrantAction,
  GrantEffect,
  PermissionGrant,
} from "../../../domains/shared/storage/storage-types";
import { randomUUID } from "node:crypto";
import { SqliteAccess, decode, placeholders } from "./sqlite-records";
const order =
  "CASE action WHEN 'READ' THEN 0 WHEN 'SUGGEST' THEN 1 WHEN 'WRITE' THEN 2 WHEN 'DEFINE' THEN 3 END";
const specificity = (target: string) =>
  target === "*"
    ? 0
    : target.split(".").length * 2 + (target.endsWith(".*") ? 0 : 1);
export class SqlitePermissionGrantRepository
  extends SqliteAccess
  implements PermissionGrantRepository
{
  upsert(
    userId: string,
    clientKey: string,
    target: string,
    action: GrantAction,
    effect: GrantEffect,
  ): Promise<PermissionGrant> {
    return this.call(
      (c) =>
        decode<PermissionGrant>(
          c.get(
            "INSERT INTO permission_grants(id,user_id,client_key,target,action,effect,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_key,target,action) DO UPDATE SET effect=excluded.effect,updated_at=excluded.updated_at RETURNING *",
            [
              randomUUID(),
              userId,
              clientKey,
              target,
              action,
              effect,
              Date.now(),
              Date.now(),
            ],
          ),
        )!,
    );
  }
  async remove(
    userId: string,
    clientKey: string,
    target: string,
    action: GrantAction,
  ): Promise<void> {
    await this.call((c) =>
      c.run(
        "DELETE FROM permission_grants WHERE user_id=? AND client_key=? AND target=? AND action=?",
        [userId, clientKey, target, action],
      ),
    );
  }
  findByUserAndClient(
    userId: string,
    clientKey: string,
  ): Promise<PermissionGrant[]> {
    return this.call((c) =>
      c
        .all(
          `SELECT * FROM permission_grants WHERE user_id=? AND client_key=? ORDER BY ${order},target ASC`,
          [userId, clientKey],
        )
        .map((row) => decode<PermissionGrant>(row)!),
    );
  }
  findByUserClientAction(
    userId: string,
    clientKey: string,
    action: GrantAction,
  ): Promise<PermissionGrant[]> {
    return this.call((c) =>
      c
        .all(
          "SELECT * FROM permission_grants WHERE user_id=? AND client_key=? AND action=? ORDER BY target ASC",
          [userId, clientKey, action],
        )
        .map((row) => decode<PermissionGrant>(row)!),
    );
  }
  findByUser(userId: string): Promise<PermissionGrant[]> {
    return this.call((c) =>
      c
        .all(
          `SELECT * FROM permission_grants WHERE user_id=? ORDER BY client_key ASC,${order},target ASC`,
          [userId],
        )
        .map((row) => decode<PermissionGrant>(row)!),
    );
  }
  findMatchingGrants(
    userId: string,
    clientKey: string,
    action: GrantAction,
    prefixChain: string[],
  ): Promise<PermissionGrant[]> {
    if (!prefixChain.length) return Promise.resolve([]);
    return this.call((c) =>
      c
        .all(
          `SELECT * FROM permission_grants WHERE user_id=? AND client_key=? AND action=? AND target IN (${placeholders(prefixChain)})`,
          [userId, clientKey, action, ...prefixChain],
        )
        .map((row) => decode<PermissionGrant>(row)!)
        .sort((a, b) => specificity(b.target) - specificity(a.target)),
    );
  }
}
