/** Ephemeral user intent. Fresh reads never turn untouched dimensions into edits. */
export type DraftPolicy = {
  capabilities: string[];
  targets: string[];
  allowSensitive: boolean;
};
export type DraftRule = { target: string; action: string; effect: string };
export type DraftAuthority = { policy: DraftPolicy; grants: DraftRule[] };
type Value = string[] | boolean | string | null;
type Intent = {
  key: string;
  label: string;
  base: Value;
  value: Value;
  target?: string;
  action?: string;
};
export type PermissionDraft = { current: DraftAuthority; intents: Intent[] };
export type PermissionConflict = {
  key: string;
  label: string;
  current: string;
  proposed: string;
};
const define = "preferences:define";
const values = (policy: DraftPolicy) =>
  policy.capabilities.filter((cap) => cap !== define);
const same = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);
const ruleKey = (rule: Pick<DraftRule, "target" | "action">) =>
  `rule:${rule.target}:${rule.action}`;
const describe = (value: Value) =>
  Array.isArray(value)
    ? value.map((cap) => cap.replace("preferences:", "")).join(", ") ||
      "Blocked"
    : typeof value === "boolean"
      ? value
        ? "Allowed"
        : "Blocked"
      : (value ?? "Inherit");
function currentValue(current: DraftAuthority, intent: Intent): Value {
  if (intent.key === "values") return values(current.policy);
  if (intent.key === "define")
    return current.policy.capabilities.includes(define);
  if (intent.key === "sensitive") return current.policy.allowSensitive;
  if (intent.key.startsWith("target:"))
    return current.policy.targets.includes(intent.target!);
  return (
    current.grants.find(
      (row) => row.target === intent.target && row.action === intent.action,
    )?.effect ?? null
  );
}
export function createPermissionDraft(
  current: DraftAuthority,
): PermissionDraft {
  return { current, intents: [] };
}
export function rebasePermissionDraft(
  draft: PermissionDraft,
  current: DraftAuthority,
): PermissionDraft {
  return { ...draft, current };
}
export function projectPermissionDraft(draft: PermissionDraft) {
  let policy = {
    ...draft.current.policy,
    capabilities: [...draft.current.policy.capabilities],
    targets: [...draft.current.policy.targets],
  };
  const edits: DraftRule[] = [],
    conflicts: PermissionConflict[] = [];
  for (const intent of draft.intents) {
    const current = currentValue(draft.current, intent);
    if (!same(intent.base, current) && !same(intent.value, current))
      conflicts.push({
        key: intent.key,
        label: intent.label,
        current: describe(current),
        proposed: describe(intent.value),
      });
    if (intent.key === "values")
      policy.capabilities = [
        ...(intent.value as string[]),
        ...policy.capabilities.filter((cap) => cap === define),
      ];
    else if (intent.key === "define")
      policy.capabilities = intent.value
        ? policy.capabilities.includes(define)
          ? policy.capabilities
          : [...policy.capabilities, define]
        : policy.capabilities.filter((cap) => cap !== define);
    else if (intent.key === "sensitive")
      policy.allowSensitive = intent.value as boolean;
    else if (intent.key.startsWith("target:")) {
      if (!intent.value)
        policy.targets = policy.targets.filter(
          (target) => target !== intent.target,
        );
      else if (!policy.targets.includes(intent.target!))
        policy.targets.push(intent.target!);
    } else
      edits.push({
        target: intent.target!,
        action: intent.action!,
        effect: (intent.value as string) ?? "REMOVE",
      });
  }
  return { policy, edits, conflicts };
}
export function editPermissionDraft(
  draft: PermissionDraft,
  policy: DraftPolicy,
  edits: DraftRule[],
): PermissionDraft {
  const before = projectPermissionDraft(draft),
    intents = new Map(draft.intents.map((intent) => [intent.key, intent]));
  const put = (intent: Omit<Intent, "base">) => {
    const current = currentValue(draft.current, { ...intent, base: null });
    // Returning to the last-read value is still a deliberate edit: a pending
    // or uncertain request may have changed authority since that read.
    intents.set(intent.key, {
      ...intent,
      base: intents.has(intent.key) ? intents.get(intent.key)!.base : current,
    });
  };
  if (!same(values(before.policy), values(policy)))
    put({
      key: "values",
      label: "Maximum value access",
      value: values(policy),
    });
  if (
    before.policy.capabilities.includes(define) !==
    policy.capabilities.includes(define)
  )
    put({
      key: "define",
      label: "Definition management",
      value: policy.capabilities.includes(define),
    });
  if (before.policy.allowSensitive !== policy.allowSensitive)
    put({
      key: "sensitive",
      label: "Sensitive data",
      value: policy.allowSensitive,
    });
  for (const target of new Set([...before.policy.targets, ...policy.targets]))
    if (
      before.policy.targets.includes(target) !== policy.targets.includes(target)
    )
      put({
        key: `target:${target}`,
        label: `Scope ${target}`,
        target,
        value: policy.targets.includes(target),
      });
  const desired = new Map(edits.map((edit) => [ruleKey(edit), edit]));
  for (const previous of before.edits)
    if (!desired.has(ruleKey(previous))) intents.delete(ruleKey(previous));
  for (const edit of edits) {
    const previous = before.edits.find((row) => ruleKey(row) === ruleKey(edit));
    if (previous?.effect !== edit.effect)
      put({
        key: ruleKey(edit),
        label: `Rule ${edit.target} ${edit.action}`,
        target: edit.target,
        action: edit.action,
        value: edit.effect === "REMOVE" ? null : edit.effect,
      });
  }
  return { ...draft, intents: [...intents.values()] };
}
export function resolvePermissionConflict(
  draft: PermissionDraft,
  key: string,
  choice: "draft" | "current",
): PermissionDraft {
  return {
    ...draft,
    intents: draft.intents.flatMap((intent) =>
      intent.key !== key
        ? [intent]
        : choice === "current"
          ? []
          : [{ ...intent, base: currentValue(draft.current, intent) }],
    ),
  };
}
