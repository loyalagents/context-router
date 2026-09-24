import type { LocalDatabasePaths } from "./sqlite-files";

/** Private, fixed operations on one owned connection; no SQL or credential crosses this channel. */
export type CoordinationCommand =
  | "acquire"
  | "begin"
  | "snapshot"
  | "inspect"
  | "insert-principal"
  | "commit"
  | "rollback"
  | "close";
export interface CoordinationRequest {
  id: number;
  command: CoordinationCommand;
  principalId?: string;
}
export interface IdentityRows {
  users: Array<{ user_id: string }>;
  identities: Array<{ user_id: string }>;
  digest?: string;
}
export interface CoordinationReply {
  id: number;
  ok: boolean;
  value?: IdentityRows;
  failure?: "busy" | "unavailable";
}
export interface CoordinationWorkerData {
  paths: LocalDatabasePaths;
}

const exactKeys = (value: unknown, keys: string[]): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
function owners(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length > 2 ||
    Object.keys(value).length !== value.length
  )
    return false;
  for (const row of value) {
    if (
      !exactKeys(row, ["user_id"]) ||
      typeof row.user_id !== "string" ||
      row.user_id.length > 43
    )
      return false;
  }
  return true;
}
/** Closed messages prevent malformed native/provider data from becoming a reusable callback failure. */
export function validReply(
  reply: unknown,
  id: number,
  command: CoordinationCommand,
): reply is CoordinationReply {
  const item = reply as CoordinationReply;
  if (item?.id !== id || typeof item.ok !== "boolean") return false;
  if (!item.ok)
    return (
      exactKeys(item, ["id", "ok", "failure"]) &&
      (item.failure === "unavailable" ||
        (command === "acquire" && item.failure === "busy"))
    );
  if (command !== "snapshot" && command !== "inspect")
    return exactKeys(item, ["id", "ok"]);
  if (
    !exactKeys(item, ["id", "ok", "value"]) ||
    !exactKeys(
      item.value,
      command === "inspect"
        ? ["users", "identities", "digest"]
        : ["users", "identities"],
    )
  )
    return false;
  if (!owners(item.value.users) || !owners(item.value.identities)) return false;
  return (
    command !== "inspect" ||
    (typeof item.value.digest === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(item.value.digest))
  );
}
export function validRequest(value: unknown): value is CoordinationRequest {
  const request = value as CoordinationRequest;
  if (!Number.isSafeInteger(request?.id) || request.id < 1) return false;
  if (request.command === "insert-principal")
    return (
      exactKeys(request, ["id", "command", "principalId"]) &&
      typeof request.principalId === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(request.principalId) &&
      Buffer.from(request.principalId, "base64url").toString("base64url") ===
        request.principalId
    );
  return (
    [
      "acquire",
      "begin",
      "snapshot",
      "inspect",
      "commit",
      "rollback",
      "close",
    ].includes(request.command) && exactKeys(request, ["id", "command"])
  );
}
