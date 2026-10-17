import { setImmediate as yieldToRequests } from "node:timers/promises";
import { createHash } from "node:crypto";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type {
  LocalMcpEditorSnapshot,
  LocalMcpGrantEdit,
  LocalMcpGrantSnapshot,
  LocalMcpPolicy,
} from "../mcp/local/local-mcp-credentials";
import { McpAuthorizationService } from "../mcp/auth/mcp-authorization.service";
import { LocalMcpAuthGuard } from "../mcp/local/local-mcp-auth.guard";
import { PermissionGrantService } from "../modules/permission-grant/permission-grant.service";
import type { SqliteMcpCredentials } from "../infrastructure/storage/sqlite/sqlite-mcp-credentials";

export type EditableAuthority = Extract<
  LocalMcpEditorSnapshot,
  { status: "AVAILABLE"; catalogStatus: "AVAILABLE" }
>;
const actions = ["read", "suggest", "write", "define"] as const;
export const targetContains = (range: string, target: string) =>
  range === "*" ||
  range === target ||
  (range.endsWith(".*") && target.startsWith(range.slice(0, -1)));
export function requireEditable(
  snapshot: LocalMcpEditorSnapshot,
): asserts snapshot is EditableAuthority {
  if (snapshot.status !== "AVAILABLE" || snapshot.catalogStatus !== "AVAILABLE")
    throw new BadRequestException("Permissions unavailable");
  if (snapshot.client.revoked)
    throw new ConflictException("Authority changed. Reload before editing.");
}

/** A detached reader over complete metadata. No evaluator await holds a SQLite transaction. */
export function permissionEvaluator(
  snapshot: EditableAuthority,
  credentials: SqliteMcpCredentials,
  principal: string,
) {
  const byAction = new Map<string, LocalMcpGrantSnapshot[]>();
  for (const grant of snapshot.grants) {
    const rows = byAction.get(grant.action) ?? [];
    rows.push(grant);
    byAction.set(grant.action, rows);
  }
  const byTarget = new Map(
    [...byAction].map(([action, rows]) => {
      const targets = new Map<string, LocalMcpGrantSnapshot[]>();
      for (const row of rows)
        targets.set(row.target, [...(targets.get(row.target) ?? []), row]);
      return [action, targets] as const;
    }),
  );
  const matching = (action: string, slug: string) => {
    const targets = byTarget.get(action);
    if (!targets) return [];
    const found = [...(targets.get(slug) ?? []), ...(targets.get("*") ?? [])];
    // All editable stored grant selectors are at most 128 characters. The
    // full slug stays exact; only possible legal prefix keys are constructed.
    for (
      let at = slug.indexOf(".");
      at >= 0 && at + 2 <= 128;
      at = slug.indexOf(".", at + 1)
    )
      found.push(...(targets.get(slug.slice(0, at) + ".*") ?? []));
    return found;
  };
  const grants = new PermissionGrantService({
    findMatchingGrants: async (_user, _client, action, prefixes) =>
      (byAction.get(action) ?? []).filter((grant) =>
        prefixes.includes(grant.target),
      ),
    findMatchingGrantsForSlug: async (_user, _client, action, slug) =>
      matching(action, slug),
    findByUserClientAction: async (_user, _client, action) =>
      byAction.get(action) ?? [],
  });
  const active = snapshot.catalog.filter((row) => row.archivedAt === null);
  const sensitive = new Set(
    active.filter((row) => row.isSensitive).map((row) => row.slug),
  );
  const byId = new Map(snapshot.catalog.map((row) => [row.id, row]));
  const authorization = new McpAuthorizationService(grants, {
    getAll: async () => active,
    isSensitiveSlug: async (_user, slug) => sensitive.has(slug),
    getDefinitionById: async (id) => byId.get(id) ?? null,
  });
  const context = new LocalMcpAuthGuard(credentials).context({
    ...snapshot.client,
    principalId: principal,
  });
  const cache = new Map<
    string,
    Promise<{
      read: boolean;
      suggest: boolean;
      write: boolean;
      define: boolean;
    }>
  >();
  return (slug: string) => {
    if (!cache.has(slug))
      cache.set(
        slug,
        (async () => {
          const decisions = await Promise.all(
            actions.map(
              (action) =>
                !snapshot.client.revoked &&
                authorization.canAccessTarget(
                  context.client,
                  { resource: "preferences", action },
                  context.grants,
                  principal,
                  { slug },
                ),
            ),
          );
          return {
            read: decisions[0],
            suggest: decisions[1],
            write: decisions[2],
            define: decisions[3],
          };
        })(),
      );
    return cache.get(slug)!;
  };
}
export async function summarizePermissions(
  snapshot: EditableAuthority,
  credentials: SqliteMcpCredentials,
  principal: string,
  evaluate = permissionEvaluator(snapshot, credentials, principal),
) {
  const fields = snapshot.catalog.filter(
    (row) =>
      row.archivedAt === null &&
      snapshot.client.policy.targets.some((target) =>
        targetContains(target, row.slug),
      ),
  );
  const counts = { blocked: 0, read: 0, suggest: 0, write: 0, define: 0 };
  for (const [index, field] of fields.entries()) {
    if (index % 32 === 0) await yieldToRequests();
    const access = await evaluate(field.slug);
    counts[
      access.write
        ? "write"
        : access.suggest
          ? "suggest"
          : access.read
            ? "read"
            : "blocked"
    ]++;
    if (access.define) counts.define++;
  }
  const levels = ["blocked", "read", "suggest", "write"].filter(
    (level) => counts[level] > 0,
  );
  return {
    scope: [...snapshot.client.policy.targets],
    total: fields.length,
    counts,
    level:
      fields.length === 0
        ? "No current fields"
        : levels.length === 1
          ? {
              blocked: "Blocked",
              read: "Read",
              suggest: "Suggest changes",
              write: "Write",
            }[levels[0]]
          : "Mixed",
    ruleCount: snapshot.grants.length,
  };
}
export function applyGrantEdits(
  grants: LocalMcpGrantSnapshot[],
  edits: LocalMcpGrantEdit[],
): LocalMcpGrantSnapshot[] {
  const result = grants.map((grant) => ({ ...grant }));
  for (const edit of edits) {
    const index = result.findIndex(
      (grant) => grant.target === edit.target && grant.action === edit.action,
    );
    if (edit.effect === "REMOVE") {
      if (index >= 0) result.splice(index, 1);
    } else if (index >= 0) result[index].effect = edit.effect;
    else
      result.push({
        id: "",
        target: edit.target,
        action: edit.action,
        effect: edit.effect,
        createdAt: 0,
        updatedAt: 0,
      });
  }
  if (result.length > 512)
    throw new BadRequestException("Too many permission rules");
  return result;
}
export async function previewPermissions(
  snapshot: EditableAuthority,
  policy: LocalMcpPolicy,
  edits: LocalMcpGrantEdit[],
  credentials: SqliteMcpCredentials,
  principal: string,
) {
  const after: EditableAuthority = {
    ...snapshot,
    client: { ...snapshot.client, policy },
    grants: applyGrantEdits(snapshot.grants, edits),
  };
  const oldEvaluate = permissionEvaluator(snapshot, credentials, principal),
    newEvaluate = permissionEvaluator(after, credentials, principal);
  const beforeSummary = await summarizePermissions(
      snapshot,
      credentials,
      principal,
      oldEvaluate,
    ),
    afterSummary = await summarizePermissions(
      after,
      credentials,
      principal,
      newEvaluate,
    );
  let expandedFields = 0;
  let narrowedFields = 0;
  const examples: {
    target: string;
    targetTruncated: boolean;
    name: string;
    nameTruncated: boolean;
    before: Awaited<ReturnType<typeof oldEvaluate>>;
    after: Awaited<ReturnType<typeof newEvaluate>>;
  }[] = [];
  let fieldIndex = 0;
  for (const field of snapshot.catalog.filter(
    (row) => row.archivedAt === null,
  )) {
    if (fieldIndex++ % 32 === 0) await yieldToRequests();
    const before = await oldEvaluate(field.slug),
      next = await newEvaluate(field.slug);
    if (actions.some((action) => !before[action] && next[action]))
      expandedFields++;
    if (actions.some((action) => before[action] && !next[action]))
      narrowedFields++;
    if (JSON.stringify(before) !== JSON.stringify(next) && examples.length < 32)
      examples.push({
        target: field.slug.slice(0, 128),
        targetTruncated: field.slug.length > 128,
        name: field.displayName ?? field.slug.slice(0, 128),
        nameTruncated:
          field.displayName === null
            ? field.slug.length > 128
            : field.displayNameTruncated,
        before,
        after: next,
      });
  }
  const widening: string[] = [];
  if (
    edits.some((edit) => {
      const previous = snapshot.grants.find(
        (grant) => grant.target === edit.target && grant.action === edit.action,
      );
      return (
        (edit.effect === "ALLOW" && previous?.effect !== "ALLOW") ||
        (edit.effect === "REMOVE" && previous?.effect === "DENY")
      );
    })
  )
    widening.push(
      "Rule changes may increase access to future fields or values with archived definitions matching those targets, subject to the proposed maximum and remaining exceptions.",
    );
  if (expandedFields)
    widening.push(
      `Access increases for ${expandedFields} current field definitions.`,
    );
  const old = snapshot.client.policy;
  const level = (p: LocalMcpPolicy) =>
    p.capabilities.includes("preferences:write")
      ? 3
      : p.capabilities.includes("preferences:suggest")
        ? 2
        : p.capabilities.includes("preferences:read")
          ? 1
          : 0;
  if (level(policy) > level(old))
    widening.push(
      "The maximum value access increases, including future fields in the allowed scope.",
    );
  if (
    policy.capabilities.includes("preferences:define") &&
    !old.capabilities.includes("preferences:define")
  )
    widening.push(
      "Definition management is enabled within the allowed scope and rules.",
    );
  if (
    policy.targets.some(
      (target) => !old.targets.some((range) => targetContains(range, target)),
    )
  )
    widening.push(
      "The allowed scope expands to new target ranges, including future fields matching prefixes.",
    );
  if (policy.allowSensitive && !old.allowSensitive)
    widening.push(
      "Sensitive data becomes eligible, including values with archived sensitive definitions.",
    );
  if (
    widening.length &&
    snapshot.grants.some((grant) => grant.effect === "ALLOW")
  )
    widening.push(
      "Retained ALLOW rules may reactivate under the expanded maximum.",
    );
  const narrowing: string[] = [];
  if (narrowedFields)
    narrowing.push(
      `Access decreases for ${narrowedFields} current field definitions.`,
    );
  if (level(policy) < level(old))
    narrowing.push(
      "The maximum value access decreases, including future fields and values with archived definitions in the allowed scope.",
    );
  if (
    old.capabilities.includes("preferences:define") &&
    !policy.capabilities.includes("preferences:define")
  )
    narrowing.push(
      "Definition management is disabled by the proposed maximum.",
    );
  if (
    old.targets.some(
      (target) =>
        !policy.targets.some((range) => targetContains(range, target)),
    )
  )
    narrowing.push(
      "The allowed scope loses target ranges, including future fields and values with archived definitions.",
    );
  if (old.allowSensitive && !policy.allowSensitive)
    narrowing.push(
      "Sensitive data is excluded, including values with archived sensitive definitions.",
    );
  if (
    edits.some((edit) => {
      const previous = snapshot.grants.find(
        (grant) => grant.target === edit.target && grant.action === edit.action,
      );
      return (
        (edit.effect === "DENY" && previous?.effect !== "DENY") ||
        (edit.effect === "REMOVE" && previous?.effect === "ALLOW")
      );
    })
  )
    narrowing.push(
      "Rule changes may decrease access to current or future fields and values with archived definitions matching those targets, subject to the maximum and remaining exceptions.",
    );
  const previewKey = createHash("sha256")
    .update(
      JSON.stringify([
        "local-mcp-preview-v1",
        principal,
        snapshot.client.id,
        snapshot.revision,
        snapshot.catalogRevision,
        policy,
        [...edits].sort((a, b) =>
          a.target + ":" + a.action < b.target + ":" + b.action
            ? -1
            : a.target + ":" + a.action > b.target + ":" + b.action
              ? 1
              : 0,
        ),
      ]),
    )
    .digest("hex");
  return {
    previewKey,
    revision: snapshot.revision,
    catalogRevision: snapshot.catalogRevision,
    before: beforeSummary,
    after: afterSummary,
    widening,
    narrowing,
    examples,
    changedFields: examples.length < 32 ? examples.length : undefined,
  };
}
