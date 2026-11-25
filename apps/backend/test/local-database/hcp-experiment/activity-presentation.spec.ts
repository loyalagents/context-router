import { activityPage } from "../../../src/infrastructure/hcp-experiment/activity-presentation";
it("renders only allowlisted activity facts, escaped, with no unknown or free-text payload dump", () => {
  const event = {
    eventId: "urn:uuid:00000000-0000-4000-8000-000000000001",
    eventType: "context.read",
    timestamp: "2026-11-25T12:00:00Z",
    participants: {
      initiator: { role: "context-client", id: "<script>bad()</script>" },
    },
    purposeDescription: "PRIVATE-TASK",
    data: {
      query: "PRIVATE-QUERY",
      reason: "PRIVATE-REASON",
      directiveDocuments: [{ text: "PRIVATE-DIRECTIVE" }],
      extension: { credential: "PRIVATE-CREDENTIAL" },
    },
    disclosed: [],
  };
  const html = activityPage(
    { events: [event], associations: [{}], filters: {}, nextCursor: null },
    20,
  );
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(html).not.toMatch(/<script|PRIVATE-|Full recorded|JSON/);
  expect(html).toContain("Receipt is unconfirmed");
  expect(html).toContain("No entries in this recorded attempt");
  expect(
    activityPage(
      { events: [], associations: [], filters: {}, nextCursor: null },
      20,
    ),
  ).toContain("No recorded activity");
});
it("keeps missing historical grant facts unknown and does not interpret unknown event payloads", () => {
  const html = activityPage(
    {
      events: [
        {
          eventId: "id",
          eventType: "future.kind",
          timestamp: "2026-11-25T12:00:00Z",
          data: {
            from: ["PRIVATE-BEFORE"],
            to: ["PRIVATE-AFTER"],
            client: { name: "FORGED-CLIENT" },
          },
          grantId: "missing",
        },
      ],
      associations: [{}],
      filters: {},
      nextCursor: null,
    },
    20,
  );
  expect(html).toContain("Recorded event");
  expect(html).toContain("Grant issuance facts unavailable");
  expect(html).not.toMatch(/PRIVATE-|FORGED-CLIENT/);
});
it("does not promote imported policy extension names into interpreted fields", () => {
  for (const [eventType, extensions] of [
    [
      "rule.set",
      {
        action: "PRIVATE-EXTENSION-ACTION",
        version: "PRIVATE-EXTENSION-VERSION",
      },
    ],
    [
      "directive.set",
      {
        requires: ["PRIVATE-EXTENSION-CLAIM"],
        disposition: "PRIVATE-EXTENSION-DISPOSITION",
      },
    ],
  ] as const) {
    const html = activityPage(
      {
        events: [
          {
            eventId: "id",
            eventType,
            timestamp: "2026-11-25T12:00:00Z",
            data: { effect: "deny", ...extensions },
          },
        ],
        associations: [{}],
        filters: {},
        nextCursor: null,
      },
      20,
    );
    expect(html).not.toContain("PRIVATE-EXTENSION");
  }
});

it("describes notification acknowledgements and zero-import outcomes without claiming receipt or added memories", () => {
  const render = (eventType: string, data: any) =>
    activityPage(
      {
        events: [
          { eventId: "id", eventType, timestamp: "2026-11-25T12:00:00Z", data },
        ],
        associations: [{}],
        filters: {},
        nextCursor: null,
      },
      20,
    );
  expect(
    render("revocation.notified", { outcome: "abandoned", attempts: 5 }),
  ).toContain("without a delivery acknowledgement");
  expect(
    render("revocation.notified", { outcome: "abandoned", attempts: 5 }),
  ).not.toContain("client was not notified");
  expect(
    render("revocation.notified", { outcome: "delivered", attempts: 1 }),
  ).toContain("endpoint acknowledged delivery");
  expect(
    render("context.imported", {
      outcomes: [{ id: "entry", outcome: "skipped" }],
    }),
  ).not.toContain("Memories imported");
  expect(
    render("context.imported", {
      outcomes: [{ id: "entry", outcome: "skipped" }],
    }),
  ).toContain("0 imported");
});
