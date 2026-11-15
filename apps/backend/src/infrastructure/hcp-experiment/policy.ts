/** Bounded experiment policy vocabulary; authority is never inferred from login. */
export const ACCESS_TYPE =
  "https://hcp.example/spec/authorization/context-access";
export const CATEGORIES = {
  general_preferences: "Communication style, formatting, language preferences",
  work_context: "Role, tools, professional preferences",
};
export const PURPOSES = [
  {
    code: "https://example.test/purpose/synthetic-review",
    description: "Review the synthetic person's preferences",
  },
  {
    code: "https://example.test/purpose/work-planning",
    description: "Plan the synthetic person's work",
  },
];
export const CONTEXT_SCOPES = Object.keys(CATEGORIES).flatMap((category) =>
  ["read", "write"].map((action) => `hcp:${category}:${action}`),
);
export class AuthorityError extends Error {
  constructor(
    readonly kind: "invalid" | "unauthenticated" | "denied" = "denied",
  ) {
    super(
      kind === "invalid"
        ? "Invalid experiment request"
        : kind === "unauthenticated"
          ? "Authentication required"
          : "Not authorized",
    );
  }
}
export const invalid = (): never => {
  throw new AuthorityError("invalid");
};
export const denied = (): never => {
  throw new AuthorityError("denied");
};
export const object = (v: any): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function keys(value: any, allowed: string[]): void {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid();
}
export function strings(value: any, min = 1, max = 100): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every(
      (v) => typeof v === "string" && v.length > 0 && v.length <= 512,
    ) &&
    new Set(value).size === value.length
  );
}
export function uri(v: any): boolean {
  if (typeof v !== "string" || v.length > 512 || /%(?![\da-f]{2})/i.test(v))
    return false;
  // Validate original RFC 3986 components before URL can repair/normalize them.
  // The bounded experiment accepts Node-supported URI hosts (not IPvFuture).
  const parts =
    /^([A-Za-z][A-Za-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#([^#]*))?$/.exec(
      v,
    );
  if (!parts) return false;
  const [, scheme, authority, path, query = "", fragment = ""] = parts;
  if (
    !/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(path) ||
    !/^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/.test(query) ||
    !/^[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/.test(fragment) ||
    (authority !== undefined &&
      !/^(?:[A-Za-z0-9._~!$&'()*+,;=:%-]*@)?(?:[A-Za-z0-9._~!$&'()*+,;=%-]*|\[[A-Fa-f0-9:.]+\])(?::[0-9]*)?$/.test(
        authority,
      )) ||
    (/^https?$/i.test(scheme) && !authority)
  )
    return false;
  try {
    new URL(v); // Check host/address/port syntax, retaining the original identifier.
    return true;
  } catch {
    return false;
  }
}
export const privateId = (v: any): boolean =>
  typeof v === "string" &&
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    v,
  );
export function categories(input: any, min = 1): void {
  if (
    !strings(input, min) ||
    input.some((v) => !Object.prototype.hasOwnProperty.call(CATEGORIES, v))
  )
    invalid();
}
export function validateAccess(
  input: any,
  allowMissingPurposes = false,
): any[] {
  if (!Array.isArray(input) || !input.length || input.length > 20) invalid();
  const writePurposes = new Set<string>();
  for (const d of input) {
    keys(d, ["type", "actions", "categories", "purposes", "narrowedTo"]);
    if (
      d.type !== ACCESS_TYPE ||
      !strings(d.actions) ||
      !d.actions.includes("read") ||
      d.actions.some((action: string) => !["read", "write"].includes(action))
    )
      invalid();
    categories(d.categories);
    if (!(allowMissingPurposes && d.purposes === undefined)) {
      if (
        !Array.isArray(d.purposes) ||
        !d.purposes.length ||
        d.purposes.length > 20
      )
        invalid();
      for (const p of d.purposes) {
        keys(p, ["code", "description"]);
        if (
          !uri(p.code) ||
          typeof p.description !== "string" ||
          !p.description.trim() ||
          p.description.length > 512
        )
          invalid();
      }
      if (new Set(d.purposes.map((p) => p.code)).size !== d.purposes.length)
        invalid();
      if (d.actions.includes("write")) {
        if (d.purposes.length !== 1) invalid();
        writePurposes.add(d.purposes[0].code);
      }
    }
    if (d.narrowedTo !== undefined) {
      keys(d.narrowedTo, ["entryIds"]);
      if (
        !strings(d.narrowedTo.entryIds, 0) ||
        !d.narrowedTo.entryIds.every(privateId)
      )
        invalid();
    }
  }
  if (writePurposes.size > 1) invalid();
  return structuredClone(input);
}
export function scopeAccess(scope: any): any[] {
  if (typeof scope !== "string" || !scope.trim() || scope.length > 2048)
    invalid();
  const values = scope.split(" ");
  if (!strings(values)) invalid();
  const byCategory = new Map<string, Set<string>>();
  for (const s of values) {
    const match = /^hcp:([^:]+):(read|write)$/.exec(s);
    if (!match) invalid();
    categories([match[1]]);
    const actions = byCategory.get(match[1]) ?? new Set<string>();
    actions.add(match[2]);
    byCategory.set(match[1], actions);
  }
  return validateAccess(
    [...byCategory].map(([category, actions]) => ({
      type: ACCESS_TYPE,
      actions: ["read", "write"].filter((action) => actions.has(action)),
      categories: [category],
    })),
    true,
  );
}
export function matchesOperator(id: string, operators?: string[]): boolean {
  if (operators === undefined) return true;
  return operators.some((value) => {
    if (value.includes(":")) return id === value;
    let host: string;
    try {
      host = new URL(id).hostname.toLowerCase();
    } catch {
      return false;
    }
    const domain = value.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  });
}
export function ruleDenies(rule: any, client: any, category: string): boolean {
  return (
    rule.effect === "deny" &&
    matchesOperator(client.operator.id, rule.operators) &&
    (!rule.categories || rule.categories.includes(category)) &&
    (!rule.requires ||
      !rule.requires.every((claim: string) =>
        (client.claims ?? []).includes(claim),
      ))
  );
}
export function deniedCategories(
  client: any,
  list: string[],
  rules: any[],
): string[] {
  return list.filter((category) =>
    rules.some((r) => ruleDenies(r, client, category)),
  );
}
export function evaluateEntry(
  grant: any,
  entry: any,
  purpose: string,
  rules: any[],
  now: number,
): boolean {
  if (
    entry.record?.status !== "active" ||
    (entry.assertion?.validUntil != null &&
      (!Number.isFinite(Date.parse(entry.assertion.validUntil)) ||
        Date.parse(entry.assertion.validUntil) <= now))
  )
    return false;
  const entryCategories = entry.classification?.categories;
  if (
    !strings(entryCategories) ||
    deniedCategories(grant.client, entryCategories, rules).length
  )
    return false;
  for (const restriction of [
    entry.assertion?.permittedPurposes,
    entry.classification?.permittedPurposes,
  ]) {
    if (
      restriction !== undefined &&
      (!strings(restriction, 0) || !restriction.includes(purpose))
    )
      return false;
  }
  return grant.access.some((d: any) => {
    // Persisted unsupported or malformed restrictions reach nothing, including future keys.
    try {
      validateAccess([d]);
    } catch {
      return false;
    }
    return (
      d.actions.includes("read") &&
      d.purposes.some((p: any) => p.code === purpose) &&
      d.categories.some((c: string) => entryCategories.includes(c)) &&
      (d.narrowedTo === undefined || d.narrowedTo.entryIds.includes(entry.id))
    );
  });
}
export function matchingDirectives(grant: any, directives: any[]): any[] {
  const reached = grant.access.flatMap((d: any) => d.categories);
  return directives.filter(
    (d) =>
      matchesOperator(grant.client.operator.id, d.operators) &&
      (!d.categories || d.categories.some((c: string) => reached.includes(c))),
  );
}
export function effectiveDirective(
  directives: any[],
  action: string,
): "deny" | "ask-first" | "permit" | undefined {
  const effects = directives
    .filter((d) => d.action === action)
    .map((d) => d.effect);
  return (["deny", "ask-first", "permit"] as const).find((e) =>
    effects.includes(e),
  );
}
export function validatePolicy(input: any): {
  rules: any[];
  directives: any[];
} {
  keys(input, ["rules", "directives"]);
  for (const kind of ["rules", "directives"]) {
    if (!Array.isArray(input[kind]) || input[kind].length > 100) invalid();
    for (const p of input[kind]) {
      keys(
        p,
        kind === "rules"
          ? ["operators", "requires", "categories"]
          : ["action", "effect", "text", "categories", "operators"],
      );
      if (p.categories !== undefined) categories(p.categories);
      if (
        p.operators !== undefined &&
        (!strings(p.operators) ||
          p.operators.some(
            (v: string) =>
              !uri(v) &&
              !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(
                v,
              ),
          ))
      )
        invalid();
      if (kind === "rules") {
        if (p.operators === undefined && p.requires === undefined) invalid();
        if (
          p.requires !== undefined &&
          (!strings(p.requires) || !p.requires.every(uri))
        )
          invalid();
      } else if (
        (!["share", "sign", "transact"].includes(p.action) && !uri(p.action)) ||
        !["deny", "ask-first", "permit"].includes(p.effect) ||
        typeof p.text !== "string" ||
        !p.text.trim() ||
        p.text.length > 2048
      )
        invalid();
    }
  }
  return structuredClone(input);
}
