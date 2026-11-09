import {
  evaluateEntry,
  matchesOperator,
  effectiveDirective,
  validateAccess,
  validatePolicy,
  ACCESS_TYPE,
  PURPOSES,
} from "../../../src/infrastructure/hcp-experiment/policy";

const purpose = PURPOSES[0].code,
  other = PURPOSES[1].code;
const detail = {
  type: ACCESS_TYPE,
  actions: ["read"],
  categories: ["general_preferences"],
  purposes: [PURPOSES[0]],
};
const grant: any = {
  client: { operator: { id: "https://sub.example.test/operator" } },
  access: [detail],
};
const entry: any = {
  id: "urn:uuid:00000000-0000-4000-8000-000000000001",
  classification: { categories: ["general_preferences", "work_context"] },
  assertion: {},
  record: { status: "active" },
};

describe("C2 restrictions are intersected before future C3 disclosure", () => {
  it.each([
    "https://[broken",
    "https://example.test/%ZZ",
    "https://example.test/%",
    "https://example.test/path[part]",
    "https://example.test/#one#two",
    "https://user@@example.test/purpose",
    "https:/example.test/purpose",
    "https://example.test/\\purpose",
    "urn:example:raw space",
    "urn:example:rawé",
    "https://example.test/trailing\n",
  ])("rejects malformed URI %s in every policy position", (code) => {
    expect(() =>
      validateAccess([
        { ...detail, purposes: [{ code, description: "Synthetic purpose" }] },
      ]),
    ).toThrow();
    for (const rule of [{ requires: [code] }, { operators: [code] }])
      expect(() => validatePolicy({ rules: [rule], directives: [] })).toThrow();
    expect(() =>
      validatePolicy({
        rules: [],
        directives: [
          { action: code, effect: "deny", text: "Synthetic directive" },
        ],
      }),
    ).toThrow();
  });
  it.each([
    "https://example.test/purpose",
    "https://example.test/encoded%20purpose?q=a/b?c#section",
    "https://[::1]:4443/purpose",
    "urn:example:purpose",
  ])("preserves valid URI identifiers without normalization: %s", (code) => {
    const access = [
      { ...detail, purposes: [{ code, description: "Synthetic purpose" }] },
    ];
    expect(validateAccess(access)).toEqual(access);
    const policy = {
      rules: [{ requires: [code], operators: [code] }],
      directives: [
        { action: code, effect: "deny", text: "Synthetic directive" },
      ],
    };
    expect(validatePolicy(policy)).toEqual(policy);
  });

  it("validates supported narrowing and never treats unknown persisted restrictions as unrestricted", () => {
    expect(() =>
      validateAccess([{ ...detail, narrowedTo: { future: [] } }]),
    ).toThrow();
    expect(
      evaluateEntry(
        { ...grant, access: [{ ...detail, narrowedTo: { future: [] } }] },
        entry,
        purpose,
        [],
        0,
      ),
    ).toBe(false);
    expect(
      evaluateEntry(
        { ...grant, access: [{ ...detail, narrowedTo: { entryIds: [] } }] },
        entry,
        purpose,
        [],
        0,
      ),
    ).toBe(false);
    expect(
      evaluateEntry(
        {
          ...grant,
          access: [{ ...detail, narrowedTo: { entryIds: [entry.id] } }],
        },
        entry,
        purpose,
        [],
        0,
      ),
    ).toBe(true);
    expect(
      evaluateEntry(
        {
          ...grant,
          access: [
            {
              ...detail,
              categories: ["work_context"],
              narrowedTo: { entryIds: [entry.id] },
            },
          ],
        },
        { ...entry, classification: { categories: ["general_preferences"] } },
        purpose,
        [],
        0,
      ),
    ).toBe(false);
  });
  it("intersects assertion/management purposes, category authority and lifecycle/expiry", () => {
    expect(evaluateEntry(grant, entry, purpose, [], 0)).toBe(true);
    expect(evaluateEntry(grant, entry, other, [], 0)).toBe(false);
    expect(
      evaluateEntry(
        grant,
        { ...entry, assertion: { permittedPurposes: [other] } },
        purpose,
        [],
        0,
      ),
    ).toBe(false);
    expect(
      evaluateEntry(
        grant,
        {
          ...entry,
          classification: { ...entry.classification, permittedPurposes: [] },
        },
        purpose,
        [],
        0,
      ),
    ).toBe(false);
    for (const status of [
      "deleted",
      "revoked",
      "expired",
      "deprecated",
      "suspended",
      "conflicted",
    ])
      expect(
        evaluateEntry(grant, { ...entry, record: { status } }, purpose, [], 0),
      ).toBe(false);
    expect(
      evaluateEntry(
        grant,
        { ...entry, assertion: { validUntil: new Date(10).toISOString() } },
        purpose,
        [],
        10,
      ),
    ).toBe(false);
  });
  it("a rule denying any entry category prevents an alternate category route", () => {
    const rules = [
      {
        effect: "deny",
        operators: ["example.test"],
        categories: ["work_context"],
      },
    ];
    expect(evaluateEntry(grant, entry, purpose, rules, 0)).toBe(false);
    expect(
      evaluateEntry(
        grant,
        { ...entry, classification: { categories: ["general_preferences"] } },
        purpose,
        rules,
        0,
      ),
    ).toBe(true);
  });
  it("matches exact operator IDs and DNS label boundaries, with requires as conjunction", () => {
    expect(
      matchesOperator("https://sub.example.test/operator", ["example.test"]),
    ).toBe(true);
    expect(
      matchesOperator("https://example.test/operator", ["example.test"]),
    ).toBe(true);
    expect(
      matchesOperator("https://evil-example.test/operator", ["example.test"]),
    ).toBe(false);
    expect(
      matchesOperator("https://example.test.evil/operator", ["example.test"]),
    ).toBe(false);
    expect(
      matchesOperator("urn:example:operator", ["urn:example:operator"]),
    ).toBe(true);
    expect(
      matchesOperator("https://example.test/other", [
        "https://example.test/operator",
      ]),
    ).toBe(false);
    const rule = {
      effect: "deny",
      requires: [
        "https://example.test/claim/a",
        "https://example.test/claim/b",
      ],
    };
    expect(evaluateEntry(grant, entry, purpose, [rule], 0)).toBe(false);
    expect(
      evaluateEntry(
        { ...grant, client: { ...grant.client, claims: rule.requires } },
        entry,
        purpose,
        [rule],
        0,
      ),
    ).toBe(true);
    expect(
      evaluateEntry(
        { ...grant, client: { ...grant.client, claims: [rule.requires[0]] } },
        entry,
        purpose,
        [rule],
        0,
      ),
    ).toBe(false);
  });
  it("directive precedence narrows action handling without granting context access or sharing authority", () => {
    const directives = ["permit", "ask-first", "deny"].map((effect) => ({
      action: "share",
      effect,
      text: effect,
    }));
    expect(effectiveDirective(directives, "share")).toBe("deny");
    expect(effectiveDirective(directives.slice(0, 2), "share")).toBe(
      "ask-first",
    );
    expect(effectiveDirective(directives.slice(0, 1), "share")).toBe("permit");
    expect(evaluateEntry({ ...grant, access: [] }, entry, purpose, [], 0)).toBe(
      false,
    );
  });
});
