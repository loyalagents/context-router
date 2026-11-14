import type { DatabaseSync } from "node:sqlite";
import { denied, invalid, object, strings } from "./policy";
import { canDiscloseMutation, storedEntry } from "./writes";

/** Resolve all caller names before mutating state. Context refs never accept IDs. */
export function relationships(
  db: DatabaseSync,
  grant: any,
  document: any,
  input: any,
  purpose: string,
  rules: any[],
  now: number,
  management: boolean,
): any[] {
  const items = input.record?.relationships ?? [];
  if (!Array.isArray(items) || items.length > 100) invalid();
  const resolve = (name: any) => {
    if (typeof name !== "string" || !name) invalid();
    const id = management
      ? name
      : db
          .prepare("SELECT entry_id FROM grant_refs WHERE grant_id=? AND ref=?")
          .get(grant.grantId, name)?.entry_id;
    const target = id && storedEntry(db, String(id));
    if (
      !target ||
      target.id === document.id ||
      (!management &&
        !canDiscloseMutation(grant, target, purpose, rules, now, "create"))
    )
      denied();
    return target;
  };
  const actor = {
    role: management ? "management-client" : "context-client",
    id: grant.client.id,
  };
  return items.map((item) => {
    if (
      !object(item) ||
      !["contradicts", "derivedFrom", "supersedes", "duplicates"].includes(
        item.type,
      ) ||
      ["assertedBy", "recordedAt"].some((k) =>
        Object.prototype.hasOwnProperty.call(item, k),
      )
    )
      invalid();
    const target = resolve(item.target);
    let proposal: any;
    if (item.proposal !== undefined) {
      const p = item.proposal;
      if (
        item.type !== "contradicts" ||
        !object(p) ||
        !["reject", "accept", "supersede"].includes(p.act) ||
        typeof p.rationale !== "string" ||
        !p.rationale.trim() ||
        p.rationale.length > 4096 ||
        !strings(p.weighed, 1) ||
        Object.prototype.hasOwnProperty.call(p, "proposedBy") ||
        Object.prototype.hasOwnProperty.call(p, "proposedAt")
      )
        invalid();
      // A create has no caller-visible self ref yet; a proposal can name the readable target.
      const proposed = resolve(p.entry);
      if (![target.id, document.id].includes(proposed.id)) denied();
      if (
        p.weighed.includes("confidence") &&
        target.record.provenance.assertedBy.id !==
          document.record.provenance.assertedBy.id
      )
        invalid();
      proposal = {
        ...p,
        entry: proposed.id,
        proposedBy: actor,
        proposedAt: new Date(now).toISOString(),
      };
    }
    return {
      ...structuredClone(item),
      target: target.id,
      assertedBy: actor,
      recordedAt: new Date(now).toISOString(),
      ...(proposal ? { proposal } : {}),
      // Never treat another client's claimed asserter name as that asserter's authority.
      maySupersede:
        management ||
        (target.record.provenance.submittedByClient.id === grant.client.id &&
          target.record.provenance.assertedBy.id ===
            document.record.provenance.assertedBy.id),
    };
  });
}
