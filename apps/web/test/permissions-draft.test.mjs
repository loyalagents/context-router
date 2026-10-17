import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  ts = require("typescript");
const code = ts.transpileModule(
  fs.readFileSync(
    new URL("../components/local/permissions-draft.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const module = { exports: {} };
new Function("exports", "module", code)(module.exports, module);
const {
  createPermissionDraft,
  editPermissionDraft,
  rebasePermissionDraft,
  projectPermissionDraft,
  resolvePermissionConflict,
} = module.exports;
const original = {
  policy: {
    capabilities: ["preferences:read", "preferences:suggest"],
    targets: ["profile.*", "old.*"],
    allowSensitive: false,
  },
  grants: [{ target: "profile.*", action: "READ", effect: "ALLOW" }],
};
test("untouched current arrays and custom scope survive dimension-specific edits and target intent", () => {
  let draft = createPermissionDraft(original);
  draft = editPermissionDraft(
    draft,
    {
      ...original.policy,
      allowSensitive: true,
      targets: ["profile.*", "draft.*"],
    },
    [],
  );
  const current = {
    policy: {
      capabilities: [
        "preferences:define",
        "preferences:read",
        "preferences:suggest",
      ],
      targets: ["work.*", "profile.*", "old.*", "custom-legacy.*"],
      allowSensitive: false,
    },
    grants: original.grants,
  };
  draft = rebasePermissionDraft(draft, current);
  const result = projectPermissionDraft(draft);
  assert.deepEqual(result.policy, {
    ...current.policy,
    targets: ["work.*", "profile.*", "custom-legacy.*", "draft.*"],
    allowSensitive: true,
  });
  assert.deepEqual(result.conflicts, []);
});
test("same value dimension and grant key require choices that persist across repeated reads", () => {
  let draft = editPermissionDraft(
    createPermissionDraft(original),
    { ...original.policy, capabilities: ["preferences:write"] },
    [{ target: "profile.*", action: "READ", effect: "DENY" }],
  );
  const current = {
    policy: {
      capabilities: [],
      targets: ["profile.*", "work.*"],
      allowSensitive: true,
    },
    grants: [],
  };
  draft = rebasePermissionDraft(draft, current);
  draft = rebasePermissionDraft(draft, current);
  let result = projectPermissionDraft(draft);
  assert.equal(result.conflicts.length, 2);
  const valueConflict = result.conflicts.find(
    (row) => row.label === "Maximum value access",
  );
  const ruleConflict = result.conflicts.find((row) =>
    row.label.includes("profile.*"),
  );
  draft = resolvePermissionConflict(draft, valueConflict.key, "draft");
  draft = resolvePermissionConflict(draft, ruleConflict.key, "current");
  result = projectPermissionDraft(draft);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.edits, []);
  assert.deepEqual(result.policy, {
    ...current.policy,
    capabilities: ["preferences:write"],
  });
  assert.equal(
    projectPermissionDraft(
      rebasePermissionDraft(draft, {
        ...current,
        policy: { ...current.policy, capabilities: ["preferences:read"] },
      }),
    ).conflicts.length,
    1,
  );
});
test("converged changes do not require choice, while using current discards only that deliberate edit", () => {
  let draft = editPermissionDraft(
    createPermissionDraft(original),
    {
      ...original.policy,
      capabilities: ["preferences:write"],
      allowSensitive: true,
    },
    [],
  );
  draft = rebasePermissionDraft(draft, {
    ...original,
    policy: { ...original.policy, capabilities: ["preferences:write"] },
  });
  assert.equal(projectPermissionDraft(draft).conflicts.length, 0);
  draft = rebasePermissionDraft(draft, {
    ...original,
    policy: { ...original.policy, capabilities: [] },
  });
  const conflict = projectPermissionDraft(draft).conflicts[0];
  draft = resolvePermissionConflict(draft, conflict.key, "current");
  assert.deepEqual(projectPermissionDraft(draft).policy, {
    ...original.policy,
    capabilities: [],
    allowSensitive: true,
  });
});

test("an absent-rule baseline survives a concurrent insertion and subsequent draft edits", () => {
  const initial = { ...original, grants: [] };
  let draft = editPermissionDraft(
    createPermissionDraft(initial),
    initial.policy,
    [{ target: "profile.*", action: "READ", effect: "ALLOW" }],
  );
  draft = rebasePermissionDraft(draft, {
    ...initial,
    grants: [{ target: "profile.*", action: "READ", effect: "DENY" }],
  });
  draft = editPermissionDraft(draft, projectPermissionDraft(draft).policy, [
    { target: "profile.*", action: "READ", effect: "REMOVE" },
  ]);
  assert.equal(projectPermissionDraft(draft).conflicts.length, 1);
  draft = rebasePermissionDraft(draft, draft.current);
  assert.equal(projectPermissionDraft(draft).conflicts.length, 1);
});

test("deliberately returning to a stale baseline survives a late read after uncertain Save", () => {
  const initial = {
    policy: {
      capabilities: ["preferences:read"],
      targets: ["profile.*"],
      allowSensitive: false,
    },
    grants: [],
  };
  let draft = editPermissionDraft(
    createPermissionDraft(initial),
    { ...initial.policy, capabilities: ["preferences:write"] },
    [{ target: "profile.*", action: "READ", effect: "ALLOW" }],
  );
  draft = editPermissionDraft(draft, initial.policy, [
    { target: "profile.*", action: "READ", effect: "REMOVE" },
  ]);
  draft = rebasePermissionDraft(draft, {
    policy: { ...initial.policy, capabilities: ["preferences:write"] },
    grants: [{ target: "profile.*", action: "READ", effect: "ALLOW" }],
  });
  const result = projectPermissionDraft(draft);
  assert.deepEqual(result.policy.capabilities, ["preferences:read"]);
  assert.equal(result.edits[0].effect, "REMOVE");
  assert.equal(result.conflicts.length, 2);
});
