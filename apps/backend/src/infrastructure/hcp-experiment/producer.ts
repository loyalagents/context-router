/** Registered controlled fixture producer. This path never invokes a model. */
import { categories, invalid, keys, object } from "./policy";
export const CONTROLLED_PRODUCER = Object.freeze({
  id: "urn:context-router:controlled-synthetic-model:v1",
  source: "urn:context-router:controlled-synthetic-source:v1",
  version: "1",
});
export function controlledProposal(input: any, now: number): any {
  keys(input, ["content", "classification", "confidence", "validUntil"]);
  if (
    !object(input.content) ||
    input.content.profile !==
      "https://hcp.example/spec/profiles/general-context/2.0" ||
    !(typeof input.content.value === "string" || object(input.content.value)) ||
    !object(input.classification) ||
    Object.prototype.hasOwnProperty.call(
      input.classification,
      "permittedPurposes",
    ) ||
    !["high", "medium", "low"].includes(input.confidence) ||
    Buffer.byteLength(JSON.stringify(input)) > 32768
  )
    invalid();
  categories(input.classification.categories);
  if (
    input.validUntil !== undefined &&
    (typeof input.validUntil !== "string" ||
      !Number.isFinite(Date.parse(input.validUntil)) ||
      Date.parse(input.validUntil) <= now)
  )
    invalid();
  return {
    producer: CONTROLLED_PRODUCER,
    createdAt: new Date(now).toISOString(),
    request: {
      schema: "https://hcp.example/spec/entry/2.0",
      content: structuredClone(input.content),
      classification: structuredClone(input.classification),
      assertion: {
        declarationType: "model-inferred",
        confidence: input.confidence,
        ...(input.validUntil === undefined
          ? {}
          : { validUntil: input.validUntil }),
        basis: {
          drawnFrom: ["observation"],
          task: "Controlled synthetic test",
          rationale: "Constructed fixture proposal; no model was executed.",
        },
      },
      record: {
        provenance: {
          assertedBy: { id: CONTROLLED_PRODUCER.id },
          source: CONTROLLED_PRODUCER.source,
          assertedAt: new Date(now).toISOString(),
          fixture: {
            simulated: true,
            modelExecuted: false,
            producerVersion: CONTROLLED_PRODUCER.version,
          },
        },
      },
    },
  };
}
