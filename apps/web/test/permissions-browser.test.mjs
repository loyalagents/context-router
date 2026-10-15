import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { browserFixture } from "./browser-fixture.mjs";
const clients = (f) => JSON.parse(f.cli("local-mcp.js", "list").stdout).result;
async function open(f, id = clients(f)[0].id) {
  f.page.setDefaultTimeout(10000);
  await f.page.goto(f.ready.origin + "/dashboard/permissions");
  await f.page.getByLabel("Unlock token").fill(f.bootstrap);
  await f.page.getByRole("button", { name: "Unlock local dashboard" }).click();
  await f.page
    .getByRole("button", { name: "Edit permissions " + id, exact: true })
    .click();
  const panel = f.page.getByRole("region", {
    name: "Edit permissions",
    exact: true,
  });
  await panel.getByLabel("Maximum value access").waitFor();
  return panel;
}
async function preview(panel) {
  await panel.getByRole("button", { name: "Preview resulting access" }).click();
  await panel
    .getByRole("region", { name: "Resulting access preview" })
    .waitFor();
}
async function save(panel) {
  await preview(panel);
  await panel
    .getByRole("button", { name: "Save permissions", exact: true })
    .click();
  await panel.getByText("Permissions saved", { exact: true }).waitFor();
}
function rules(f, id) {
  const c = f.database.connect();
  try {
    return c.all(
      "SELECT * FROM permission_grants WHERE client_key=? ORDER BY target,action",
      [`local:${id}`],
    );
  } finally {
    c.close();
  }
}

test(
  "permissions editor searches scope, preserves custom arrays, shows widening and saves once with credentials intact",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0];
    f.cli(
      "local-mcp.js",
      "permissions",
      "--id",
      client.id,
      "--capabilities",
      "preferences:read,preferences:suggest",
      "--targets",
      "custom-legacy.*,profile.*",
    );
    let mutations = 0;
    f.page.on("request", (req) => {
      if (req.url().endsWith("/api/local/mcp/save")) mutations++;
    });
    const panel = await open(f, client.id);
    if (process.env.PERMISSIONS_CARDS_SCREENSHOT)
      await f.page
        .locator("ul")
        .filter({
          has: f.page.getByRole("button", {
            name: "Rename " + client.id,
            exact: true,
          }),
        })
        .screenshot({ path: process.env.PERMISSIONS_CARDS_SCREENSHOT });
    assert.equal(
      await panel.getByLabel("Maximum value access").inputValue(),
      "Suggest changes",
    );
    await panel.getByLabel("Allow definition management (DEFINE)").check();
    await panel.getByLabel("Search categories or fields").fill("first_name");
    await panel
      .getByRole("button", { name: /Allow target profile.first_name/ })
      .first()
      .waitFor();
    await preview(panel);
    await panel.getByText("Access widening", { exact: true }).waitFor();
    if (process.env.PERMISSIONS_SCREENSHOT)
      await panel.screenshot({ path: process.env.PERMISSIONS_SCREENSHOT });
    await panel
      .getByRole("button", { name: "Save permissions", exact: true })
      .click();
    await panel.getByText("Permissions saved", { exact: true }).waitFor();
    assert.equal(mutations, 1);
    const after = clients(f)[0];
    assert.deepEqual(after.policy.capabilities, [
      "preferences:read",
      "preferences:suggest",
      "preferences:define",
    ]);
    assert.deepEqual(after.policy.targets, ["custom-legacy.*", "profile.*"]);
    assert.equal(after.id, client.id);
    assert.equal(after.generation, 1);
    for (const level of ["Blocked", "Read", "Suggest changes", "Write"]) {
      await panel.getByLabel("Maximum value access").selectOption(level);
      await save(panel);
      assert.equal(
        await panel
          .getByLabel("Allow definition management (DEFINE)")
          .isChecked(),
        true,
      );
    }
    assert.equal(mutations, 5);
  },
);

test(
  "parent Blocked preset writes three denies while preserving descendant READ and DEFINE exceptions",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0];
    f.cli(
      "local-mcp.js",
      "permissions",
      "--id",
      client.id,
      "--capabilities",
      "preferences:write,preferences:define",
      "--targets",
      "*",
    );
    for (const [target, action, effect] of [
      ["work.*", "READ", "ALLOW"],
      ["work.*", "SUGGEST", "DENY"],
      ["work.*", "WRITE", "DENY"],
      ["work.special", "READ", "ALLOW"],
      ["work.*", "DEFINE", "ALLOW"],
    ])
      f.cli(
        "local-mcp.js",
        "grant",
        "--id",
        client.id,
        "--target",
        target,
        "--action",
        action,
        "--effect",
        effect,
      );
    const before = rules(f, client.id),
      panel = await open(f, client.id);
    await panel.getByLabel("Default target", { exact: true }).fill("work.*");
    await panel.getByLabel("Scope value default").selectOption("Blocked");
    await panel.getByRole("button", { name: "Add scope change" }).click();
    await save(panel);
    const after = rules(f, client.id);
    for (const action of ["READ", "SUGGEST", "WRITE"])
      assert.equal(
        after.find((r) => r.target === "work.*" && r.action === action).effect,
        "DENY",
      );
    for (const row of before.filter(
      (r) => r.target === "work.special" || r.action === "DEFINE",
    ))
      assert.deepEqual(
        after.find((r) => r.id === row.id),
        row,
      );
  },
);

for (const mode of ["committed-lost", "unforwarded", "malformed"])
  test(
    `permissions ${mode} outcome remains uncertain beside reconciliation and never retries`,
    { timeout: 60000 },
    async (t) => {
      const f = await browserFixture(t),
        client = clients(f)[0],
        panel = await open(f, client.id);
      let saves = 0,
        reads = 0;
      await panel.getByLabel("Maximum value access").selectOption("Write");
      await f.page.route("**/api/local/mcp/save", async (route) => {
        saves++;
        if (mode !== "unforwarded") await route.fetch();
        if (mode === "malformed")
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
          });
        else await route.abort("failed");
      });
      f.page.on("request", (req) => {
        if (req.url().endsWith("/api/local/mcp/inspect")) reads++;
      });
      await preview(panel);
      await panel
        .getByRole("button", { name: "Save permissions", exact: true })
        .click();
      await panel.getByText("Save not confirmed", { exact: true }).waitFor();
      await panel
        .getByRole("button", { name: "Read current permissions" })
        .waitFor();
      await panel
        .getByRole("button", { name: "Read current permissions" })
        .click();
      assert.equal(saves, 1);
      assert.ok(reads >= 2);
      await panel.getByText("Save not confirmed", { exact: true }).waitFor();
      assert.deepEqual(
        clients(f)[0].policy.capabilities,
        mode === "unforwarded" ? ["preferences:read"] : ["preferences:write"],
      );
    },
  );

test(
  "draft edits invalidate in-flight previews; CLI conflict preserves draft and requires new inspection",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0],
      panel = await open(f, client.id);
    let release, entered, settled;
    const waiting = new Promise((r) => (entered = r)),
      finished = new Promise((r) => (settled = r));
    await f.page.route("**/api/local/mcp/preview", async (route) => {
      const response = await route.fetch();
      entered();
      await new Promise((r) => (release = r));
      await route.fulfill({ response });
      settled();
    });
    await panel
      .getByRole("button", { name: "Preview resulting access" })
      .click();
    await waiting;
    await panel.getByLabel("Maximum value access").selectOption("Write");
    release();
    await finished;
    await f.page.unroute("**/api/local/mcp/preview");
    await panel
      .getByRole("button", { name: "Preview resulting access" })
      .waitFor();
    assert.equal(
      await panel
        .getByRole("button", { name: "Save permissions", exact: true })
        .isEnabled(),
      false,
    );
    await preview(panel);
    f.cli(
      "local-mcp.js",
      "permissions",
      "--id",
      client.id,
      "--capabilities",
      "preferences:suggest",
      "--targets",
      "profile.*",
    );
    await panel
      .getByRole("button", { name: "Save permissions", exact: true })
      .click();
    await panel.getByText("Permissions conflict", { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel("Maximum value access").inputValue(),
      "Write",
    );
    await panel
      .getByRole("button", { name: "Read current permissions" })
      .click();
    await save(panel);
    assert.deepEqual(clients(f)[0].policy.capabilities, ["preferences:write"]);
  },
);

for (const mode of ["lock", "navigation"])
  test(
    `permissions ${mode} discards draft and late preview`,
    { timeout: 60000 },
    async (t) => {
      const f = await browserFixture(t),
        panel = await open(f);
      let release, entered;
      const waiting = new Promise((r) => (entered = r));
      await f.page.route("**/api/local/mcp/preview", async (route) => {
        const response = await route.fetch();
        entered();
        await new Promise((r) => (release = r));
        try {
          await route.fulfill({ response });
        } catch {}
      });
      await panel
        .getByLabel("Search categories or fields")
        .fill("private-draft-canary");
      await panel
        .getByRole("button", { name: "Preview resulting access" })
        .click();
      await waiting;
      if (mode === "lock")
        await f.page.getByRole("button", { name: "Lock dashboard" }).click();
      else await f.page.goto(f.ready.origin + "/dashboard");
      release();
      assert.equal(
        await f.page
          .getByRole("region", { name: "Edit permissions", exact: true })
          .count(),
        0,
      );
      assert.equal(
        (await f.page.textContent("body")).includes("private-draft-canary"),
        false,
      );
    },
  );

test(
  "confirmed Save with failed reconciliation shows saved acknowledgement and explicitly stale authority",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      panel = await open(f);
    await panel.getByLabel("Maximum value access").selectOption("Write");
    await panel
      .getByRole("button", { name: "Preview resulting access" })
      .click();
    await panel
      .getByRole("button", { name: "Save permissions", exact: true })
      .waitFor({ state: "visible" });
    await f.page.route("**/api/local/mcp/inspect", (route) =>
      route.abort("failed"),
    );
    await panel
      .getByRole("button", { name: "Save permissions", exact: true })
      .click();
    await panel.getByText("Permissions saved", { exact: true }).waitFor();
    await panel.getByText(/Current permissions could not be read/).waitFor();
    assert.equal(
      await panel.getByText("Current saved authority", { exact: true }).count(),
      0,
    );
    await panel
      .getByText("Last read authority (stale)", { exact: true })
      .waitFor();
    assert.equal(
      (await panel.textContent()).includes("Current authority is shown below"),
      false,
    );
  },
);
test(
  "malformed acknowledged policy is uncertain and cannot crash or confirm the editor",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0],
      panel = await open(f);
    await f.page.route("**/api/local/mcp/save", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          changed: true,
          revision: "a".repeat(64),
          client: {
            ...client,
            policy: { capabilities: null, targets: [], allowSensitive: false },
          },
        }),
      }),
    );
    await panel
      .getByRole("button", { name: "Preview resulting access" })
      .click();
    await panel
      .getByRole("button", { name: "Save permissions", exact: true })
      .click();
    await panel.getByText("Save not confirmed", { exact: true }).waitFor();
    assert.equal(
      await panel.getByText("Permissions saved", { exact: true }).count(),
      0,
    );
  },
);

test(
  "demo permission Save changes only selected client and preserves peer, personal store and receipt",
  { timeout: 60000 },
  async (t) => {
    const personal = await browserFixture(t),
      f = await browserFixture(t, { demo: true });
    const personalBefore = clients(personal),
      before = clients(f),
      receipt = fs.readFileSync(path.join(f.root, "demo/generation.json"));
    const id = JSON.parse(receipt).clients.agentB,
      panel = await open(f, id);
    await panel.getByLabel("Maximum value access").selectOption("Write");
    await save(panel);
    const after = clients(f);
    assert.deepEqual(
      after.filter((c) => c.id !== id),
      before.filter((c) => c.id !== id),
    );
    assert.deepEqual(clients(personal), personalBefore);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, "demo/generation.json")),
      receipt,
    );
    assert.deepEqual(after.find((c) => c.id === id).policy.capabilities, [
      "preferences:write",
    ]);
  },
);
test(
  "permissions focus invalidation preserves draft, keyboard Cancel restores focus and mobile fits",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.setViewportSize({ width: 390, height: 844 });
    const client = clients(f)[0],
      panel = await open(f, client.id);
    await panel.getByLabel("Maximum value access").selectOption("Write");
    await preview(panel);
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    assert.equal(
      await panel.getByLabel("Maximum value access").inputValue(),
      "Write",
    );
    assert.equal(
      await panel
        .getByRole("button", { name: "Save permissions", exact: true })
        .isEnabled(),
      false,
    );
    await panel
      .getByRole("button", { name: "Read current permissions" })
      .click();
    await preview(panel);
    assert.ok(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await panel.getByRole("button", { name: "Cancel", exact: true }).focus();
    await f.page.keyboard.press("Enter");
    await f.page.waitForFunction(
      (id) =>
        document.activeElement?.getAttribute("aria-label") ===
        "Edit permissions " + id,
      client.id,
    );
  },
);
test(
  "permissions uncertain Save keeps its outcome across failed read, retry and late authoritative reconciliation",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0],
      panel = await open(f, client.id);
    let saves = 0,
      reads = 0;
    await panel.getByLabel("Maximum value access").selectOption("Write");
    let release, entered;
    const waiting = new Promise((r) => (entered = r));
    await f.page.route("**/api/local/mcp/save", async (route) => {
      saves++;
      await route.fetch();
      await route.abort("failed");
    });
    await f.page.route("**/api/local/mcp/inspect", async (route) => {
      reads++;
      if (reads === 1) return route.abort("failed");
      const response = await route.fetch();
      entered();
      await new Promise((r) => (release = r));
      await route.fulfill({ response });
    });
    await preview(panel);
    await panel
      .getByRole("button", { name: "Save permissions", exact: true })
      .click();
    await panel.getByText(/Current permissions could not be read/).waitFor();
    await panel.getByText("Save not confirmed", { exact: true }).waitFor();
    await panel
      .getByRole("button", { name: "Read current permissions" })
      .click();
    await waiting;
    await panel.getByLabel("Maximum value access").selectOption("Read");
    release();
    await panel.getByText("Current saved authority", { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel("Maximum value access").inputValue(),
      "Read",
    );
    await panel.getByText("Save not confirmed", { exact: true }).waitFor();
    assert.equal(saves, 1);
    assert.equal(reads, 2);
    assert.deepEqual(clients(f)[0].policy.capabilities, ["preferences:write"]);
  },
);
test(
  "permissions expiry discards private editor state",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      panel = await open(f);
    await panel
      .getByLabel("Search categories or fields")
      .fill("secret-editor-draft");
    await f.page.route("**/api/local/session", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: "{}",
      }),
    );
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await f.page.getByLabel("Unlock token").waitFor();
    assert.equal(
      await f.page
        .getByRole("region", { name: "Edit permissions", exact: true })
        .count(),
      0,
    );
    assert.equal(
      (await f.page.textContent("body")).includes("secret-editor-draft"),
      false,
    );
  },
);

test(
  "new browser session with demo presentation clears personal draft and ignores its late preview",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    let demo = false;
    // Only native presentation metadata is injected. This proves browser session
    // replacement cleanup; installed demo-smoke proves actual store switching.
    await f.page.route("**/api/local/capabilities", async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.runtime = {
        mode: demo ? "demo" : "personal",
        launcher: "native",
        generation: (demo ? "d" : "c").repeat(32),
        storeId: (demo ? "b" : "a").repeat(32),
      };
      await route.fulfill({ response, json: body });
    });
    const panel = await open(f);
    await panel.getByLabel("Maximum value access").selectOption("Write");
    await panel
      .getByLabel("Search categories or fields")
      .fill("personal-private-draft");
    let release, entered, done;
    const waiting = new Promise((resolve) => (entered = resolve)),
      finished = new Promise((resolve) => (done = resolve));
    await f.page.route("**/api/local/mcp/preview", async (route) => {
      const response = await route.fetch();
      entered();
      await new Promise((resolve) => (release = resolve));
      try {
        await route.fulfill({ response });
      } catch {
      } finally {
        done();
      }
    });
    await panel
      .getByRole("button", { name: "Preview resulting access" })
      .click();
    await waiting;
    await f.page.getByRole("button", { name: "Lock dashboard" }).click();
    demo = true;
    f.child.stdin.write("unlock\n");
    let fresh;
    for (let count = 0; count < 100 && !fresh; count++) {
      fresh = f
        .stdout()
        .split("\n")
        .filter((line) =>
          line.startsWith('{"type":"context-router.local-ui.unlock"'),
        )
        .at(-1);
      if (!fresh) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(fresh, "fresh session unlock was exported");
    await f.page
      .getByLabel("Unlock token")
      .fill(fs.readFileSync(JSON.parse(fresh).unlockFile, "utf8").trim());
    await f.page
      .getByRole("button", { name: "Unlock local dashboard" })
      .click();
    await f.page.getByRole("complementary", { name: "Demo mode" }).waitFor();
    release();
    await finished;
    assert.equal(
      await f.page
        .getByRole("region", { name: "Edit permissions", exact: true })
        .count(),
      0,
    );
    assert.equal(
      (await f.page.textContent("body")).includes("personal-private-draft"),
      false,
    );
    await f.page
      .getByRole("button", {
        name: "Edit permissions " + clients(f)[0].id,
        exact: true,
      })
      .click();
    const replacement = f.page.getByRole("region", {
      name: "Edit permissions",
      exact: true,
    });
    assert.equal(
      await replacement.getByLabel("Maximum value access").inputValue(),
      "Read",
    );
    assert.equal(
      await replacement.getByLabel("Search categories or fields").inputValue(),
      "",
    );
    assert.equal(
      await replacement
        .getByRole("region", { name: "Resulting access preview" })
        .count(),
      0,
    );
  },
);
