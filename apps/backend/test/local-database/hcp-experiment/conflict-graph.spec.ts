import { DatabaseSync } from "node:sqlite";
import { DATA_SCHEMA } from "../../../src/infrastructure/hcp-experiment/schema";
import {
  applyMutation,
  storedEntry,
} from "../../../src/infrastructure/hcp-experiment/writes";
import { CONFLICT_DETECTION } from "../../../src/infrastructure/hcp-experiment/conflicts";
import * as graph from "../../../src/infrastructure/hcp-experiment/conflict-graph";

const now = Date.parse("2026-11-13T12:00:00Z");
const actor = { role: "hcp-provider", id: "urn:provider:synthetic" };
const entry = (
  id: string,
  value: string,
  type = "model-inferred",
  assurance = "unverified",
  asserter = id,
) => ({
  id,
  subject: { id: "urn:subject:synthetic" },
  content: {
    profile: "https://hcp.example/spec/profiles/general-context/2.0",
    value: {
      type: CONFLICT_DETECTION,
      slot: "contact",
      setting: "work",
      value,
    },
  },
  classification: { categories: ["general_preferences"] },
  assertion: { declarationType: type },
  record: {
    status: "active",
    version: 1,
    relationships: [],
    provenance: {
      assertedBy: { id: asserter, assurance },
      confirmations: [],
      recordedAt: new Date(now).toISOString(),
    },
  },
});

describe("C4 persistent conflict graph", () => {
  let db: DatabaseSync, events: any[];
  const emit = (event: any) => events.push(event);
  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(DATA_SCHEMA.join(";"));
    events = [];
  });
  afterEach(() => db.close());
  const get = (id: string) => storedEntry(db, id);
  function write(document: any) {
    const previous = get(document.id);
    db.exec("BEGIN");
    try {
      applyMutation(db, previous ? "revise" : "create", document, previous);
      graph.evaluateWrite(db, document.id, previous, now, actor, emit);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return get(document.id);
  }
  function revise(id: string, value: string) {
    const document = get(id);
    document.content.value.value = value;
    document.record.version++;
    document.record.status = "active";
    document.record.provenance.confirmations = [];
    document.record.relationships = [];
    return write(document);
  }

  it.each([false, true])(
    "records symmetric version-bound provider edges in either arrival order (%s)",
    (reverse) => {
      const model = entry("model", "phone"),
        person = entry("person", "email", "person-declared", "authenticated");
      for (const doc of reverse ? [model, person] : [person, model]) write(doc);
      expect(get("model").record.status).toBe("conflicted");
      expect(get("person").record.status).toBe("active");
      expect(get("model").record.relationships).toEqual([
        expect.objectContaining({
          type: "contradicts",
          target: "person",
          assertedBy: actor,
          recordedAt: new Date(now).toISOString(),
        }),
      ]);
      expect(get("person").record.relationships[0].target).toBe("model");
      expect(
        events.filter((e) => e.eventType === "conflict.detected"),
      ).toHaveLength(1);
      const detected = events.find((e) => e.eventType === "conflict.detected");
      expect(detected.entryId).toBe("model");
      expect(detected.relatedEntryId).toBe("person");
      expect(
        detected.data.before.find((e: any) => e.id === "model").status,
      ).toBe("active");
      expect(
        detected.data.after.find((e: any) => e.id === "model").status,
      ).toBe("conflicted");
      expect(db.prepare("SELECT count(*) n FROM relations").get().n).toBe(1);
    },
  );

  it("collects every candidate before quarantine and releases only removed reasons", () => {
    write(entry("p1", "email", "person-declared"));
    write(entry("p2", "email", "person-declared"));
    write(entry("m", "phone"));
    expect(get("m").record.relationships).toHaveLength(2);
    expect(["p1", "p2", "m"].map((id) => get(id).record.status)).toEqual([
      "conflicted",
      "conflicted",
      "conflicted",
    ]);
    revise("p1", "phone");
    expect(get("p1").record.status).toBe("active");
    expect(get("m").record.status).toBe("conflicted");
    revise("p2", "phone");
    expect(get("m").record.status).toBe("active");
    expect(
      events.filter(
        (e) =>
          e.eventType === "conflict.resolved" &&
          e.data.transition === "superseded",
      ),
    ).toHaveLength(2);
  });

  it("orders same-asserter supersession by write transaction even with equal timestamps", () => {
    write(
      entry("z-old", "email", "model-inferred", "unverified", "urn:model:same"),
    );
    write(
      entry("a-new", "phone", "model-inferred", "unverified", "urn:model:same"),
    );
    expect(get("z-old").record.status).toBe("deprecated");
    expect(get("a-new").record.status).toBe("active");
    expect(events.at(-1).data.transition).toBe("asserter-superseded");
    expect(revise("z-old", "email").record.status).toBe("active");
    expect(get("a-new").record.status).toBe("deprecated");
  });

  it.each(["same-model", "explicit-supersedes"])(
    "closes a client contradiction whose peer was superseded in the same write (%s)",
    (kind) => {
      const model = kind === "same-model";
      write(
        entry(
          "old",
          "email",
          model ? "model-inferred" : "person-declared",
          "unverified",
          "urn:model:same",
        ),
      );
      write(
        entry(
          "new",
          "phone",
          model ? "model-inferred" : "person-declared",
          "unverified",
          "urn:model:same",
        ),
      );
      const client = { role: "context-client", id: "urn:client:a" };
      graph.assertRelationships(
        db,
        "new",
        [
          ...(model
            ? []
            : [
                {
                  target: "old",
                  type: "supersedes",
                  maySupersede: true,
                  assertedBy: client,
                  recordedAt: new Date(now).toISOString(),
                },
              ]),
          {
            target: "old",
            type: "contradicts",
            assertedBy: client,
            recordedAt: new Date(now).toISOString(),
            extension: "retained",
          },
        ],
        now,
        client,
        emit,
      );
      expect(get("old").record.status).toBe("deprecated");
      expect(get("new").record.status).toBe("active");
      expect(graph.snapshot(db, "new")).toEqual([]);
      const row: any = db
        .prepare(
          "SELECT * FROM relations WHERE type='contradicts' AND origin='client'",
        )
        .get();
      expect(row.disposition).toBe(model ? "superseded" : "ended");
      expect(JSON.parse(row.document)).toMatchObject({
        assertedBy: client,
        extension: "retained",
      });
      expect(
        events.filter((e) => e.eventType === "conflict.resolved").at(-1).data
          .transition,
      ).toBe(model ? "asserter-superseded" : "ended");
    },
  );

  it("retains quarantine after authoritative withdrawal and preserves expired precedence", () => {
    const person = write(
      entry("person", "email", "person-declared", "authenticated"),
    );
    write(entry("m", "phone"));
    db.prepare("UPDATE entries SET status='deleted' WHERE id=?").run("person");
    graph.evaluateWrite(db, "person", person, now, actor, emit);
    expect(get("m").record.status).toBe("conflicted");
    // Removing an opponent is not endorsement; a no-op revision must not wash
    // away the retained cause, even though that opponent is no longer readable.
    expect(revise("m", "phone").record.status).toBe("conflicted");
    expect(revise("m", "email").record.status).toBe("active");
    db.prepare("UPDATE entries SET status='expired' WHERE id=?").run("m");
    graph.evaluateWrite(db, "m", get("m"), now, actor, emit);
    expect(get("m").record.status).toBe("expired");
  });

  it("rejects one endpoint without endorsing its peer or clearing unrelated edges", () => {
    write(entry("p1", "email", "person-declared"));
    write(entry("p2", "email", "person-declared"));
    write(entry("m", "phone"));
    graph.resolveEntry(db, "p1", "rejected", now, actor, emit);
    expect(get("p1").record.status).toBe("deleted");
    expect(get("m").record.status).toBe("conflicted");
    graph.resolveEntry(db, "p2", "rejected", now, actor, emit);
    expect(get("m").record.status).toBe("active");
    expect(get("m").record.provenance.confirmations).toEqual([]);
  });

  it("accepts a reviewed inference without changing its asserter and deprecates its authoritative opponent", () => {
    write(entry("person", "email", "person-declared", "authenticated"));
    write(entry("m", "phone"));
    // The authority service appends the confirmation in the same transaction.
    db.prepare(
      "INSERT INTO confirmations(entry_id,version,document) VALUES(?,?,?)",
    ).run("m", 1, JSON.stringify({ disposition: "confirmed" }));
    graph.resolveEntry(db, "m", "confirmed", now, actor, emit);
    expect(get("m").record.status).toBe("active");
    expect(get("person").record.status).toBe("deprecated");
    expect(get("m").assertion.declarationType).toBe("model-inferred");
    expect(get("m").record.provenance.assertedBy.id).toBe("m");
  });

  it("does not release quarantine when rejecting an active authoritative opponent", () => {
    write(entry("person", "email", "person-declared", "authenticated"));
    write(entry("m", "phone"));
    graph.resolveEntry(db, "person", "rejected", now, actor, emit);
    expect(get("person").record.status).toBe("deleted");
    expect(get("m").record.status).toBe("conflicted");
    expect(graph.incident(db, "m")).toHaveLength(1);
  });

  it("keeps an unconfirmed opposing inference quarantined after accepting one", () => {
    write(entry("a", "email"));
    write(entry("b", "phone"));
    db.prepare(
      "INSERT INTO confirmations(entry_id,version,document) VALUES(?,?,?)",
    ).run("a", 1, JSON.stringify({ disposition: "confirmed" }));
    graph.resolveEntry(db, "a", "confirmed", now, actor, emit);
    expect(get("a").record.status).toBe("active");
    expect(get("b").record.status).toBe("conflicted");
    expect(graph.incident(db, "b")).toHaveLength(1);
    expect(events.at(-1).data.remainingPeerStatus).toBe("conflicted");
  });

  it("does not turn ordinary confirmation of an active entry into conflict acceptance", () => {
    write(entry("p1", "email", "person-declared", "authenticated"));
    write(entry("p2", "phone", "person-declared", "authenticated"));
    graph.resolveEntry(db, "p1", "confirmed", now, actor, emit);
    expect(get("p2").record.status).toBe("active");
    expect(graph.incident(db, "p1")).toHaveLength(1);
  });

  it("does not attribute an existing quarantine to a person/person conflict", () => {
    write(entry("p", "email", "person-declared"));
    write(entry("q", "phone", "person-declared"));
    write(entry("m", "phone"));
    expect(get("p").record.status).toBe("conflicted");
    revise("q", "phone");
    graph.resolveEntry(db, "m", "rejected", now, actor, emit);
    expect(get("p").record.status).toBe("active");
    expect(
      get("p").record.relationships.some((r: any) => r.target === "q"),
    ).toBe(true);
  });

  it("uses each relation's quarantine effects when recording rejection transitions", () => {
    write(entry("p", "email", "person-declared"));
    write(entry("q", "phone", "person-declared"));
    write(entry("m", "phone"));
    graph.resolveEntry(db, "p", "rejected", now, actor, emit);
    const resolved = events.filter((e) => e.eventType === "conflict.resolved");
    expect(
      resolved.find((e) => [e.entryId, e.relatedEntryId].includes("q")).data
        .transition,
    ).toBe("ended");
    expect(
      resolved.find((e) => [e.entryId, e.relatedEntryId].includes("m")).data
        .transition,
    ).toBe("rejected");
  });

  it("ends an empty historical hold when a new authenticated person revision supplies authority", () => {
    const p = write(entry("p", "email", "person-declared", "authenticated"));
    write(entry("m", "phone"));
    db.prepare("UPDATE entries SET status='deleted' WHERE id=?").run("p");
    graph.evaluateWrite(db, "p", p, now, actor, emit);
    const person = entry("m", "phone", "person-declared", "authenticated");
    person.record.version = 2;
    write(person);
    expect(get("m").record.status).toBe("active");
    expect(graph.incident(db, "m")).toEqual([]);
    expect(events.at(-1).data.transition).toBe("superseded");
  });

  it("accepting one quarantine does not deprecate an authoritative person on a no-status edge", () => {
    write(entry("p", "email", "person-declared"));
    write(entry("q", "phone", "person-declared", "authenticated"));
    write(entry("m", "phone"));
    const previous = get("p");
    db.prepare(
      "INSERT INTO confirmations(entry_id,version,document) VALUES(?,?,?)",
    ).run("p", 1, JSON.stringify({ disposition: "confirmed" }));
    graph.resolveEntry(db, "p", "confirmed", now, actor, emit, previous);
    expect(get("p").record.status).toBe("active");
    expect(get("q").record.status).toBe("active");
    expect(get("m").record.status).toBe("conflicted");
    expect(graph.incident(db, "q")).toHaveLength(1);
    expect(
      events.filter((e) => e.eventType === "conflict.resolved"),
    ).toHaveLength(1);
  });

  it.each(["withdraw", "reject", "dismiss-then-withdraw"])(
    "ends no-status conflicts on %s without inventing quarantine",
    (action) => {
      const p = write(entry("p", "email", "person-declared", "authenticated"));
      write(entry("q", "phone", "person-declared", "authenticated"));
      if (action === "dismiss-then-withdraw")
        graph.dismiss(db, graph.incident(db, "p")[0].id, now, actor, emit);
      if (action === "reject")
        graph.resolveEntry(db, "p", "rejected", now, actor, emit);
      else {
        db.prepare("UPDATE entries SET status='deleted' WHERE id=?").run("p");
        graph.evaluateWrite(db, "p", p, now, actor, emit);
      }
      expect(graph.incident(db, "q")).toEqual([]);
      expect(get("q").record.status).toBe("active");
      if (action !== "dismiss-then-withdraw")
        expect(events.at(-1).data.transition).toBe("ended");
      revise("q", "phone");
      expect(graph.incident(db, "q")).toEqual([]);
    },
  );

  it("records proposal fields without applying the proposed action", () => {
    write(entry("p", "email", "person-declared"));
    write(entry("q", "email", "person-declared"));
    graph.assertRelationships(
      db,
      "p",
      [
        {
          type: "contradicts",
          target: "q",
          assertedBy: actor,
          recordedAt: new Date(now).toISOString(),
          maySupersede: false,
          proposal: {
            act: "reject",
            entry: "q",
            weighed: ["basis"],
            rationale: "controlled test",
            proposedBy: actor,
            proposedAt: new Date(now).toISOString(),
            before: "forged audit history",
            after: "forged audit history",
            transition: "forged transition",
          },
        },
      ],
      now,
      actor,
      emit,
    );
    expect(events.at(-1)).toMatchObject({
      eventType: "conflict.proposed",
      data: {
        act: "reject",
        entry: "q",
        weighed: ["basis"],
        proposedBy: actor,
      },
    });
    expect(get("q").record.status).toBe("active");
    expect(events.at(-1).data.before).toBeInstanceOf(Array);
    expect(events.at(-1).data.after).toBeInstanceOf(Array);
    expect(events.at(-1).data.transition).toBe("proposed");
    expect(events.at(-1).data.relationship.proposal.before).toBe(
      "forged audit history",
    );
  });

  it("preserves incoming informational provenance when its target is revised", () => {
    write(entry("p", "email", "person-declared"));
    write(entry("q", "email", "person-declared"));
    graph.assertRelationships(
      db,
      "p",
      [
        {
          type: "derivedFrom",
          target: "q",
          assertedBy: actor,
          recordedAt: new Date(now).toISOString(),
          maySupersede: false,
        },
      ],
      now,
      actor,
      emit,
    );
    revise("q", "email");
    expect(get("p").record.relationships).toEqual([
      expect.objectContaining({ type: "derivedFrom", target: "q" }),
    ]);
    expect(storedEntry(db, "p", 1).record.relationships).toHaveLength(1);
    revise("p", "email");
    expect(get("p").record.relationships).toEqual([]);
  });

  it("dismisses only conflicts that changed no status, retaining history until revision", () => {
    write(entry("p1", "email", "person-declared", "authenticated"));
    write(entry("p2", "phone", "person-declared", "authenticated"));
    const relation = graph.incident(db, "p1")[0];
    graph.dismiss(db, relation.id, now, actor, emit);
    expect(graph.incident(db, "p1")).toEqual([]);
    expect(get("p1").record.relationships).toHaveLength(1);
    revise("p2", "phone");
    expect(graph.incident(db, "p1")).toHaveLength(1);
    write(entry("m", "letter"));
    expect(() =>
      graph.dismiss(db, graph.incident(db, "m")[0].id, now, actor, emit),
    ).toThrow();
  });
});
