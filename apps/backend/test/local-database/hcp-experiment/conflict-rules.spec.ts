import * as rules from "../../../src/infrastructure/hcp-experiment/conflicts";

const fact = (value: any, extra = {}) => ({
  type: "urn:context-router:exclusive-fact:v1",
  slot: "contact-channel",
  setting: "work",
  value,
  ...extra,
});
const entry = (
  id: string,
  type = "model-inferred",
  assurance = "unverified",
  value: any = "email",
  extra = {},
) => ({
  id,
  content: { value: fact(value) },
  classification: {
    categories: ["general_preferences"],
    dimension: "Contact channel",
  },
  assertion: {
    declarationType: type,
    confidence: type === "model-inferred" ? "high" : null,
  },
  record: {
    status: "active",
    version: 1,
    provenance: {
      assertedBy: { id: `urn:model:${id}`, assurance },
      confirmations: [],
      recordedAt: "2026-11-13T12:00:00Z",
    },
  },
  ...extra,
});

describe("C4 bounded structural conflict rules", () => {
  it("requires comparable mutually exclusive typed facts; a dimension alone never proves contradiction", () => {
    const a = entry("a");
    expect(
      rules.contradicts(a, entry("b", "model-inferred", "unverified", "phone")),
    ).toBe(true);
    expect(rules.contradicts(a, entry("b"))).toBe(false);
    expect(
      rules.contradicts(a, {
        ...entry("b"),
        content: { value: "I also like phone calls" },
      }),
    ).toBe(false);
    expect(
      rules.contradicts(a, {
        ...entry("b"),
        content: { value: fact("phone", { setting: "home" }) },
      }),
    ).toBe(false);
    expect(
      rules.contradicts(a, {
        ...entry("b", "model-inferred", "unverified", "phone"),
        classification: { categories: ["work_context"] },
      }),
    ).toBe(false);
    expect(
      rules.contradicts(
        entry("a", "model-inferred", "unverified", 1),
        entry("b", "model-inferred", "unverified", "1"),
      ),
    ).toBe(true);
    expect(
      rules.contradicts(a, {
        ...entry("b"),
        content: { value: fact({ not: "scalar" }) },
      }),
    ).toBe(false);
  });

  it("uses standing rather than asserted person type or cross-model confidence in both arrival orders", () => {
    const model = entry("model"),
      person = entry("person", "person-declared", "authenticated", "phone");
    expect(rules.conflictOutcome(model, person, "model")).toEqual({
      model: "conflicted",
      person: "active",
    });
    expect(rules.conflictOutcome(person, model, "person")).toEqual({
      person: "active",
      model: "conflicted",
    });
    const unverified = entry(
      "person",
      "person-declared",
      "unverified",
      "phone",
    );
    expect(rules.conflictOutcome(model, unverified, "model")).toEqual({
      model: "conflicted",
      person: "conflicted",
    });
    const low = entry("low");
    low.assertion.confidence = "low";
    expect(rules.conflictOutcome(model, low, "model")).toEqual({
      model: "conflicted",
      low: "conflicted",
    });
    const confirmed = structuredClone(model);
    confirmed.record.provenance.confirmations = [
      { disposition: "confirmed" },
    ] as any;
    expect(rules.conflictOutcome(confirmed, person, "model")).toEqual({
      model: "active",
      person: "active",
    });
    expect(
      rules.conflictOutcome(
        person,
        entry("second", "person-declared", "unverified"),
        "person",
      ),
    ).toEqual({ person: "active", second: "active" });
  });

  it("allows only same-asserter unconfirmed inference supersession and respects retained lifecycle precedence", () => {
    const old = entry("old"),
      newer = entry("new");
    newer.record.provenance.assertedBy.id = old.record.provenance.assertedBy.id;
    expect(rules.conflictOutcome(old, newer, "new")).toEqual({
      old: "deprecated",
      new: "active",
    });
    old.record.provenance.confirmations = [{ disposition: "confirmed" }] as any;
    expect(rules.conflictOutcome(old, newer, "new")).toEqual({
      old: "active",
      new: "conflicted",
    });
    for (const status of ["expired", "deleted", "deprecated"]) {
      old.record.status = status;
      expect(rules.conflictOutcome(old, newer, "new")[old.id]).toBe(status);
    }
  });
});
