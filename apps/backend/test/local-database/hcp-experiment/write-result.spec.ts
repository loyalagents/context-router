import * as writes from "../../../src/infrastructure/hcp-experiment/writes";
import {
  ACCESS_TYPE,
  PURPOSES,
} from "../../../src/infrastructure/hcp-experiment/policy";

it("authorizes mutation representation with read authority, including historical withdrawal metadata", () => {
  const grant = {
    client: { operator: { id: "https://example.test/operator" } },
    access: [
      {
        type: ACCESS_TYPE,
        actions: ["read"],
        categories: ["general_preferences"],
        purposes: [PURPOSES[0]],
      },
    ],
  };
  const entry = {
    id: "urn:uuid:00000000-0000-4000-8000-000000000001",
    classification: { categories: ["general_preferences"] },
    assertion: {},
    record: { status: "active" },
  };
  const allows = (e: any, operation: string, rules = []) =>
    (writes as any).canDiscloseMutation(
      grant,
      e,
      PURPOSES[0].code,
      rules,
      1000,
      operation,
    );
  expect(allows(entry, "create")).toBe(true);
  expect(allows(entry, "revise")).toBe(true);
  const deleted = {
    ...entry,
    assertion: { validUntil: new Date(1).toISOString() },
    record: { status: "deleted" },
  };
  expect(allows(deleted, "withdraw")).toBe(true);
  expect(allows(deleted, "create")).toBe(false);
  expect(
    (writes as any).canDiscloseMutation(
      grant,
      deleted,
      PURPOSES[1].code,
      [],
      1000,
      "withdraw",
    ),
  ).toBe(false);
  expect(
    (writes as any).canDiscloseMutation(
      grant,
      deleted,
      PURPOSES[0].code,
      [{ effect: "deny", operators: [grant.client.operator.id] }],
      1000,
      "withdraw",
    ),
  ).toBe(false);
});
