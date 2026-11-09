/** Closed fixture initializer only: never a Context Client write operation. */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SyntheticFixture } from "./fixtures";
const uuid = () => `urn:uuid:${randomUUID()}`;

export function insertFixtures(
  db: DatabaseSync,
  fixtures: SyntheticFixture[],
  clock: () => number,
  append: (event: any) => void,
  approval?: { grant: any; at: number },
): void {
  const meta = db.prepare("SELECT * FROM store_metadata").get();
  const subjectId = String(meta.subject_id),
    providerId = String(meta.provider_id);
  const bootstrapId = approval?.grant.grantId ?? uuid();
  const client = approval?.grant.client ?? {
    id: uuid(),
    name: "Simulated C1 fixture initializer",
    operator: {
      id: "https://example.test/operators/synthetic",
      name: "Simulated fixture operator",
    },
  };
  const ids = fixtures.map(() => uuid());
  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const id = ids[fixtureIndex],
      subject = { id: subjectId, relationship: null };
    db.prepare("INSERT INTO entries VALUES(?,?,?,?,?)").run(
      id,
      JSON.stringify(subject),
      fixture.versions.length,
      JSON.stringify(fixture.classification),
      fixture.status,
    );
    for (const [index, v] of fixture.versions.entries()) {
      const at = new Date(clock()).toISOString(),
        version = index + 1;
      const document = {
        ...v.extensions,
        "@context": ["https://hcp.example/contexts/v2"],
        schema: "https://hcp.example/spec/entry/2.0",
        type: ["ContextEntry"],
        id,
        subject,
        content: v.content,
        assertion: v.assertion,
        evidence: v.evidence,
        record: {
          ...v.recordExtensions,
          version,
          provenance: {
            assertedBy: {
              id: subjectId,
              assurance: approval ? "authenticated" : "unverified",
            },
            assertedAt: approval ? new Date(approval.at).toISOString() : at,
            source: approval ? "person-input" : "simulated-c1-storage-fixture",
            submittedByClient: client,
            authorizedUnder: bootstrapId,
            recordedByProvider: providerId,
            recordedAt: at,
            confirmations: [],
            fixture: approval
              ? {
                  simulated: false,
                  persona: "synthetic",
                  explanation:
                    "Authenticated synthetic principal approved these statements at initialization; lifecycle/version setup is a test scenario, not past personal history",
                }
              : {
                  simulated: true,
                  explanation:
                    "Synthetic assertion, operator and bootstrap authority; no authenticated human consent or live grant",
                },
          },
          relationships: (v.relationships ?? []).map((r) => ({
            type: r.type,
            target: ids[r.targetFixture],
            assertedBy: {
              role: approval ? "management-client" : "hcp-provider",
              id: approval ? client.id : providerId,
            },
            recordedAt: at,
          })),
        },
      };
      db.prepare("INSERT INTO entry_versions VALUES(?,?,?,?)").run(
        id,
        version,
        JSON.stringify(document),
        typeof v.assertion.validUntil === "string"
          ? Date.parse(v.assertion.validUntil)
          : null,
      );
      append({
        eventId: uuid(),
        eventType: index === 0 ? "context.created" : "context.revised",
        timestamp: at,
        participants: {
          initiator: {
            role: approval ? "management-client" : "hcp-provider",
            id: approval ? client.id : providerId,
          },
          provider: { id: providerId },
          ...(approval
            ? {
                clientOperator: client.operator,
                authorizingPrincipal: { id: subjectId },
                requestingParty: { id: subjectId },
                retrievalId: uuid(),
              }
            : {}),
        },
        entryId: id,
        relatedEntryId: null,
        categories: fixture.classification.categories,
        grantId: approval ? bootstrapId : null,
        data: {
          version,
          ...(index
            ? { reason: "Explicit synthetic fixture version sequence" }
            : {}),
          fixture: {
            simulated: !approval,
            bootstrapId,
            status: fixture.status,
          },
        },
      });
    }
  }
}
