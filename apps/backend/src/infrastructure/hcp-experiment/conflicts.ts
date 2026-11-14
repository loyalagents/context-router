/** Declared structural experiment: one current scalar value per exact slot/setting.
 * This is not general semantic contradiction detection. */
import { authoritative } from "./entry-state";
import { object } from "./policy";

export const CONFLICT_DETECTION = "urn:context-router:exclusive-fact:v1";
function fact(entry: any): any | undefined {
  const value = entry.content?.value;
  return object(value) &&
    value.type === CONFLICT_DETECTION &&
    typeof value.slot === "string" &&
    value.slot.trim().length > 0 &&
    typeof value.setting === "string" &&
    value.setting.trim().length > 0 &&
    (["string", "boolean"].includes(typeof value.value) ||
      (typeof value.value === "number" && Number.isFinite(value.value)))
    ? value
    : undefined;
}
export function contradicts(a: any, b: any): boolean {
  const left = fact(a),
    right = fact(b);
  return (
    !!left &&
    !!right &&
    a.classification.categories.some((c: string) =>
      b.classification.categories.includes(c),
    ) &&
    left.slot === right.slot &&
    left.setting === right.setting &&
    left.value !== right.value
  );
}
export function conflictEffects(
  a: any,
  b: any,
  newestId: string,
): { quarantine: string[]; deprecate: string[] } {
  const result = { quarantine: [] as string[], deprecate: [] as string[] };
  if (![a, b].every((e) => ["active", "conflicted"].includes(e.record.status)))
    return result;
  const modelA = a.assertion.declarationType === "model-inferred",
    modelB = b.assertion.declarationType === "model-inferred";
  if (!modelA && !modelB) return result;
  const strongA =
    authoritative(a) || a.assertion.declarationType === "issuer-attested";
  const strongB =
    authoritative(b) || b.assertion.declarationType === "issuer-attested";
  if (
    modelA &&
    modelB &&
    !strongA &&
    !strongB &&
    a.record.provenance.assertedBy.id === b.record.provenance.assertedBy.id
  ) {
    result.deprecate.push(newestId === a.id ? b.id : a.id);
    return result;
  }
  if (!strongA) result.quarantine.push(a.id);
  if (!strongB) result.quarantine.push(b.id);
  return result;
}
export function conflictOutcome(
  a: any,
  b: any,
  newestId: string,
): Record<string, string> {
  const result = { [a.id]: a.record.status, [b.id]: b.record.status };
  const effects = conflictEffects(a, b, newestId);
  for (const id of effects.quarantine) result[id] = "conflicted";
  for (const id of effects.deprecate) result[id] = "deprecated";
  return result;
}
