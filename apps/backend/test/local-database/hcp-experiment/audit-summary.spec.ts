import * as audit from "../../../src/infrastructure/hcp-experiment/audit";
const at = (minute: number) =>
  new Date(Date.UTC(2026, 10, 15, 12, minute)).toISOString();
const client = {
  id: "a",
  name: "Synthetic A",
  operator: { id: "urn:operator:a", name: "A operator" },
};
const issued = (grantId: string) => ({
  eventType: "grant.issued",
  grantId,
  timestamp: at(0),
  data: { client },
});
const read = (
  grantId: string,
  time: number,
  until: number,
  category = "general_preferences",
) => ({
  eventType: "context.read",
  grantId,
  timestamp: at(time),
  purpose: "urn:purpose:test",
  disclosed: [
    {
      entryId: "urn:entry:1",
      version: 1,
      categories: [category],
      useUntil: at(until),
    },
  ],
  data: { categoriesSearched: [category] },
});
it("summarizes immutable per-copy facts before combining grant-specific revocation cutoffs", () => {
  const events = [
    issued("A1"),
    issued("A2"),
    read("A1", 1, 20),
    read("A2", 2, 30),
    { eventType: "grant.revoked", grantId: "A1", timestamp: at(4), data: {} },
    {
      eventType: "revocation.notified",
      grantId: "A1",
      timestamp: at(5),
      data: { outcome: "delivered" },
    },
  ];
  const result = audit.disclosureSummary(events, {});
  expect(result.clients[0]).toMatchObject({
    client,
    entries: 1,
    retrievals: 2,
    usableUntil: at(30),
    notification: "delivered",
    categories: ["general_preferences"],
  });
  expect(
    audit.disclosureSummary(events, { to: at(1) }).clients[0].usableUntil,
  ).toBe(at(5));
});
it("counts empty retrievals with no invented copy date, and write copies without inventing retrieval events", () => {
  const empty = {
    eventType: "context.read",
    grantId: "A1",
    timestamp: at(1),
    purpose: "urn:purpose:test",
    disclosed: [],
    data: { categoriesSearched: ["general_preferences"] },
  };
  expect(
    audit.disclosureSummary([issued("A1"), empty], {}).clients[0],
  ).toMatchObject({ entries: 0, retrievals: 1, usableUntil: null });
  const write = { ...read("A1", 2, 30), eventType: "context.created" };
  expect(
    audit.disclosureSummary([issued("A1"), write], {}).clients[0],
  ).toMatchObject({ entries: 1, retrievals: 0, usableUntil: at(30) });
  expect(
    audit.disclosureSummary([issued("A1"), empty], {
      category: "general_preferences",
    }).clients,
  ).toEqual([]);
});
it("normalizes inclusive RFC3339 filters and rejects impossible dates and unknown filters", () => {
  expect(
    audit.auditFilters({ from: "2026-11-15T04:00:00-08:00", to: at(0) }).from,
  ).toBe(at(0));
  for (const input of [
    { from: "yesterday" },
    { from: "2026-02-30T00:00:00Z" },
    { from: at(2), to: at(1) },
    { unknown: "value" },
  ])
    expect(() => audit.auditFilters(input)).toThrow();
});
it("finds immutable policy/grant categories and reported sharing entry references", () => {
  for (const e of [
    { eventType: "rule.set", data: { categories: ["general_preferences"] } },
    {
      eventType: "directive.removed",
      data: { categories: ["general_preferences"] },
    },
    {
      eventType: "grant.issued",
      data: { access: [{ categories: ["general_preferences"] }] },
    },
  ])
    expect(
      audit.matchesAudit(e, { category: "general_preferences" }, new Map()),
    ).toBe(true);
  expect(
    audit.matchesAudit(
      {
        eventType: "context.shared",
        data: { entries: [{ id: "urn:entry:1" }] },
      },
      { entryId: "urn:entry:1" },
      new Map(),
    ),
  ).toBe(true);
  const grants = audit.grantFacts([
    {
      ...issued("A1"),
      data: { client, access: [{ categories: ["general_preferences"] }] },
    },
  ]);
  for (const eventType of [
    "grant.revoked",
    "grant.expired",
    "revocation.notified",
  ])
    expect(
      audit.matchesAudit(
        { eventType, grantId: "A1", data: {} },
        { category: "general_preferences" },
        grants,
      ),
    ).toBe(true);
  expect(
    audit.matchesAudit(
      { eventType: "directive.set", data: {} },
      { category: "work_context" },
      grants,
    ),
  ).toBe(true);
  expect(
    audit.matchesAudit(
      { eventType: "directive.set", data: { categories: [] } },
      { category: "work_context" },
      grants,
    ),
  ).toBe(false);
});
