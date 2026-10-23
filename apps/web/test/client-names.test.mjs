import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { browserFixture } from "./browser-fixture.mjs";

async function unlock(f, route = "/dashboard/permissions") {
  f.page.setDefaultTimeout(10000);
  await f.page.goto(f.ready.origin + route);
  await f.page.getByLabel("Unlock token").fill(f.bootstrap);
  await f.page.getByRole("button", { name: "Unlock local dashboard" }).click();
  await f.page.getByRole("button", { name: "Lock dashboard", exact: true }).waitFor();
}
function clients(f) {
  return JSON.parse(f.cli("local-mcp.js", "list").stdout).result;
}
function seed(f, client, suffix = "first") {
  const c = f.database.connect();
  try {
    c.run(
      "INSERT INTO mcp_access_events(id,user_id,occurred_at,client_key,surface,operation_name,outcome,correlation_id,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        "access-" + suffix,
        f.identity.principalId,
        Date.now(),
        `local:${client.id}`,
        "TOOLS_CALL",
        "syntheticRead" + suffix,
        "SUCCESS",
        suffix,
        1,
      ],
    );
    c.run(
      "INSERT INTO preference_audit_events(id,user_id,subject_slug,occurred_at,target_type,target_id,event_type,actor_type,actor_client_key,origin,correlation_id,before_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        "audit-" + suffix,
        f.identity.principalId,
        "synthetic." + suffix,
        Date.now(),
        "PREFERENCE",
        suffix,
        "PREFERENCE_SET",
        "MCP_CLIENT",
        `local:${client.id}`,
        "MCP",
        suffix,
        JSON.stringify({ value: "masked-value" }),
      ],
    );
  } finally {
    c.close();
  }
}

test(
  "client name unlock waits for authentication before session authority is copied",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    async function holdResponse(endpoint) {
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await f.page.route(`**/api/local/${endpoint}`, async (route) => {
        const response = await route.fetch();
        await held;
        await route.fulfill({ response });
      });
      return release;
    }
    const releaseUnlock = await holdResponse("unlock"),
      releaseCapabilities = await holdResponse("capabilities"),
      unlockRequested = f.page.waitForRequest("**/api/local/unlock", { timeout: 10000 });
    let completed = false;
    const unlocking = unlock(f).then(() => { completed = true; });
    void unlocking.catch(() => {});
    try {
      await unlockRequested;
      await f.page.getByRole("button", { name: "Unlocking…", exact: true }).waitFor();
      assert.equal(await f.page.evaluate(() =>
        sessionStorage.getItem("context-router.browser-session.v1") === null), true);
      assert.equal(completed, false, "unlock must await the exchange response");
      const capabilitiesRequested = f.page.waitForRequest("**/api/local/capabilities", { timeout: 10000 });
      releaseUnlock();
      await capabilitiesRequested;
      assert.equal(await f.page.evaluate(() =>
        Boolean(sessionStorage.getItem("context-router.browser-session.v1"))), true);
      assert.equal(completed, false, "unlock must await authenticated capabilities");
      releaseCapabilities();
      await unlocking;
      assert.equal(completed, true);
      await f.page.getByRole("button", { name: "Lock dashboard", exact: true }).waitFor();
    } finally {
      releaseUnlock();
      releaseCapabilities();
      await unlocking.catch(() => {});
      await f.page.unrouteAll({ behavior: "wait" });
    }
  },
);

for (const tab of ["Audit", "MCP Access"])
  for (const selected of [false, true])
    test(
      `client history ${tab} unchanged filters do not grow navigation history (selected=${selected})`,
      { timeout: 60000 },
      async (t) => {
        const f = await browserFixture(t),
          client = clients(f)[0];
        seed(f, client);
        await unlock(f);
        await f.page
          .getByRole("button", { name: `Rename ${client.id}`, exact: true })
          .waitFor();
        const previous = f.page.url();
        if (selected)
          await f.page
            .getByRole("link", {
              name: `View activity ${client.id}`,
              exact: true,
            })
            .click();
        else await f.page.goto(f.ready.origin + "/dashboard/history");
        await f.page.getByRole("tab", { name: tab, exact: true }).click();
        const panel = f.page.getByRole("tabpanel", { name: tab, exact: true });
        const field = panel.getByLabel(tab === "Audit" ? /^Slug/ : "Operation");
        const value =
          tab === "Audit" ? "synthetic.first" : "syntheticReadfirst";
        const length = await f.page.evaluate(() => history.length),
          destination = f.page.url();
        for (const filter of ["", value]) {
          await field.fill(filter);
          await panel
            .getByRole("button", { name: "Apply", exact: true })
            .click();
          assert.equal(await f.page.evaluate(() => history.length), length);
          assert.equal(f.page.url(), destination);
          assert.equal(await field.inputValue(), filter);
        }
        await f.page.goBack();
        await f.page
          .getByRole("button", { name: `Rename ${client.id}`, exact: true })
          .waitFor();
        assert.equal(f.page.url(), previous);
        await f.page.goForward();
        await f.page.getByRole("tab", { name: tab, exact: true }).click();
        await panel.getByRole("button", { name: "Reset", exact: true }).click();
        const resetLength = await f.page.evaluate(() => history.length);
        assert.equal(resetLength, length + (selected ? 1 : 0));
        assert.equal(new URL(f.page.url()).hash, "");
        await panel.getByRole("button", { name: "Reset", exact: true }).click();
        assert.equal(await f.page.evaluate(() => history.length), resetLength);
        await f.page.goBack();
        if (selected) {
          await f.page
            .getByRole("tab", { name: "MCP Access", selected: true })
            .waitFor();
          assert.equal(new URL(f.page.url()).hash, `#mcp-client=${client.id}`);
          await f.page.goBack();
        }
        await f.page
          .getByRole("button", { name: `Rename ${client.id}`, exact: true })
          .waitFor();
        assert.equal(f.page.url(), previous);
      },
    );

test(
  "client history clears malformed fragments once, preserves allowed search and retains manual non-local keys",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await unlock(f, "/dashboard/history");
    await f.page.getByRole("tab", { name: "MCP Access", exact: true }).click();
    const panel = f.page.getByRole("tabpanel", { name: "MCP Access" });
    await f.page.evaluate(() =>
      history.replaceState(null, "", "?_rsc=synthetic#unexpected"),
    );
    const length = await f.page.evaluate(() => history.length);
    await panel.getByLabel("Client key", { exact: true }).fill("codex");
    await panel.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(new URL(f.page.url()).search, "?_rsc=synthetic");
    assert.equal(new URL(f.page.url()).hash, "");
    assert.equal(await f.page.evaluate(() => history.length), length + 1);
    await panel.getByRole("button", { name: "Apply", exact: true }).click();
    assert.equal(await f.page.evaluate(() => history.length), length + 1);
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await panel.getByLabel("Client key", { exact: true }).waitFor();
    assert.equal(
      await panel.getByLabel("Client key", { exact: true }).inputValue(),
      "codex",
    );
  },
);

test(
  "client names isolate RTL and bidi override labels from stable IDs without changing accessible identity",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0];
    seed(f, client);
    await unlock(f, `/dashboard/history#mcp-client=${client.id}`);
    const panel = f.page.getByRole("tabpanel", { name: "MCP Access" });
    for (const name of ["\u202Elaptop", "حاسوب شخصي"]) {
      f.cli("local-mcp.js", "rename", "--id", client.id, "--label", name);
      await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await panel.getByText(name, { exact: true }).first().waitFor();
      const row = panel
        .getByRole("button")
        .filter({ hasText: "syntheticReadfirst" });
      assert.equal(await row.locator("button, a, input").count(), 0);
      const accessible = await row.ariaSnapshot();
      assert.ok(accessible.includes(name));
      assert.ok(accessible.includes(`(instance local:${client.id})`));
      const presentation = panel.locator(`[title="local:${client.id}"]`);
      const layouts = await presentation.evaluateAll((items) =>
        items.map((item) => {
          const label = item.firstElementChild,
            suffix = item.querySelector("code");
          const text =
            [...suffix.childNodes].find(
              (node) => node.nodeType === Node.TEXT_NODE,
            ) ?? suffix.firstElementChild.firstChild;
          const xs = Array.from({ length: text.length }, (_, i) => {
            const range = document.createRange();
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            return range.getBoundingClientRect().x;
          });
          const fullKey =
            item.lastElementChild.firstElementChild ?? item.lastElementChild;
          return {
            labelIsolation: getComputedStyle(label).unicodeBidi,
            fullKeyDirection: getComputedStyle(fullKey).direction,
            fullKeyIsolation: getComputedStyle(fullKey).unicodeBidi,
            suffixAfterLabel:
              suffix.getBoundingClientRect().left >=
              label.getBoundingClientRect().right,
            xs,
          };
        }),
      );
      assert.ok(
        layouts.length >= 2,
        "filter chip and expandable row both render the name",
      );
      for (const layout of layouts) {
        assert.ok(
          layout.xs.every((x, i, xs) => i === 0 || x >= xs[i - 1]),
          "stable ID suffix reads left to right",
        );
        assert.equal(layout.suffixAfterLabel, true);
        assert.equal(layout.labelIsolation, "isolate");
        assert.equal(layout.fullKeyDirection, "ltr");
        assert.equal(layout.fullKeyIsolation, "isolate");
      }
      assert.equal(
        clients(f).find((item) => item.id === client.id).label,
        name,
      );
      await row.focus();
      await f.page.keyboard.press("Enter");
      await panel
        .getByText(`Client key: local:${client.id}`, { exact: true })
        .waitFor();
    }
    await f.page.route("**/api/local/mcp/labels", (route) =>
      route.fulfill({ json: { items: [] } }),
    );
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const fallback = panel.getByText(`local:${client.id}`, { exact: true });
    await fallback.first().waitFor();
    for (const style of await fallback.evaluateAll((items) =>
      items.map((item) => ({
        direction: getComputedStyle(item).direction,
        isolation: getComputedStyle(item).unicodeBidi,
      })),
    ))
      assert.deepEqual(style, { direction: "ltr", isolation: "isolate" });
  },
);

test(
  "client names update another window through rename broadcast without changing its history filter",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      client = clients(f)[0];
    seed(f, client);
    await unlock(f);
    const second = await f.context.newPage();
    second.setDefaultTimeout(10000);
    const token = await f.page.evaluate(() =>
      sessionStorage.getItem("context-router.browser-session.v1"),
    );
    await second.addInitScript(
      (token) =>
        sessionStorage.setItem("context-router.browser-session.v1", token),
      token,
    );
    await second.goto(
      `${f.ready.origin}/dashboard/history#mcp-client=${client.id}`,
    );
    const history = second.getByRole("tabpanel", { name: "MCP Access" });
    await history.getByText(client.label, { exact: true }).first().waitFor();
    await f.page
      .getByRole("button", { name: `Rename ${client.id}`, exact: true })
      .click();
    await f.page
      .getByLabel("Client name", { exact: true })
      .fill("Other window name");
    await f.page.getByRole("button", { name: "Save name" }).click();
    await f.page
      .getByRole("status", { name: "Client name saved", exact: true })
      .waitFor();
    await history
      .getByText("Other window name", { exact: true })
      .first()
      .waitFor();
    assert.equal(new URL(second.url()).hash, `#mcp-client=${client.id}`);
    assert.equal(
      await history.getByLabel("Client key").inputValue(),
      `local:${client.id}`,
    );
    await history
      .getByRole("button")
      .filter({ hasText: "syntheticReadfirst" })
      .waitFor();
  },
);

test(
  "client names rename one instance and resolve old history through exact activity navigation",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    const b = JSON.parse(
      f.cli(
        "local-mcp.js",
        "provision",
        "--label",
        a.label,
        "--out",
        path.join(f.root, "second.token"),
      ).stdout,
    ).result;
    seed(f, a);
    seed(f, b, "second");
    await unlock(f);
    const row = f.page.getByRole("listitem").filter({
      has: f.page.getByRole("button", {
        name: `Rename ${a.id}`,
        exact: true,
      }),
    });
    await row
      .getByRole("button", { name: `Rename ${a.id}`, exact: true })
      .click();
    await f.page
      .getByLabel("Client name", { exact: true })
      .fill("discard this");
    await f.page.getByRole("button", { name: "Cancel rename" }).focus();
    await f.page.keyboard.press("Enter");
    assert.equal(
      await row
        .getByRole("button", { name: `Rename ${a.id}`, exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    );
    assert.equal(clients(f).find((c) => c.id === a.id).label, a.label);
    await row
      .getByRole("button", { name: `Rename ${a.id}`, exact: true })
      .click();
    await f.page
      .getByLabel("Client name", { exact: true })
      .fill("  Personal laptop  ");
    await f.page.getByRole("button", { name: "Save name" }).click();
    await f.page
      .getByRole("status", { name: "Client name saved", exact: true })
      .waitFor();
    assert.equal(clients(f).find((c) => c.id === b.id).label, b.label);
    await row.getByText("Personal laptop", { exact: true }).waitFor();
    await row
      .getByRole("link", { name: `View activity ${a.id}`, exact: true })
      .click();
    await f.page
      .getByRole("tab", { name: "MCP Access", selected: true })
      .waitFor();
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadfirst" })
      .waitFor();
    assert.equal(
      await f.page.getByText("syntheticReadsecond", { exact: true }).count(),
      0,
    );
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByText("Personal laptop", { exact: true })
      .first()
      .waitFor();
    assert.ok(await f.page.locator(`[title="local:${a.id}"]`).count());
    await f.page.setViewportSize({ width: 390, height: 844 });
    const accessRow = f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadfirst" });
    await accessRow.focus();
    await f.page.keyboard.press("Enter");
    assert.equal(await accessRow.getAttribute("aria-expanded"), "true");
    await f.page
      .getByText(`Client key: local:${a.id}`, { exact: true })
      .waitFor();
    await f.page.getByRole("tab", { name: "Audit", exact: true }).click();
    await f.page
      .getByRole("button")
      .filter({ hasText: "synthetic.first" })
      .waitFor();
    const auditRow = f.page
      .getByRole("button")
      .filter({ hasText: "synthetic.first" });
    await auditRow.focus();
    await f.page.keyboard.press("Enter");
    await f.page
      .getByRole("tabpanel", { name: "Audit", exact: true })
      .getByText(`Client key: local:${a.id}`, { exact: true })
      .waitFor();
    await f.page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(
      await f.page.getByText("masked-value", { exact: false }).count(),
      0,
    );
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await f.page
      .getByRole("button")
      .filter({ hasText: "synthetic.first" })
      .waitFor();
    await f.page.getByRole("button", { name: "Remove client filter" }).click();
    assert.equal(new URL(f.page.url()).hash, "");
    await f.page
      .getByRole("button")
      .filter({ hasText: "synthetic.second" })
      .waitFor();
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await f.page
      .getByRole("button")
      .filter({ hasText: "synthetic.second" })
      .waitFor();
    const c = f.database.connect();
    try {
      assert.equal(
        c.get(
          "SELECT actor_client_key FROM preference_audit_events WHERE id=?",
          ["audit-first"],
        ).actor_client_key,
        `local:${a.id}`,
      );
    } finally {
      c.close();
    }
    if (process.env.CLIENT_NAMES_SCREENSHOT_DIR)
      await f.page.screenshot({
        path: path.join(
          process.env.CLIENT_NAMES_SCREENSHOT_DIR,
          `mcp-client-names-history-${process.pid}.png`,
        ),
        fullPage: true,
      });
  },
);

for (const outcome of ["confirmed", "lost-response"])
  test(
    `client names retain ${outcome} rename through passive invalidation without retry`,
    { timeout: 60000 },
    async (t) => {
      const f = await browserFixture(t),
        a = clients(f)[0];
      await unlock(f);
      await f.page
        .getByRole("button", { name: `Rename ${a.id}`, exact: true })
        .click();
      await f.page
        .getByLabel("Client name", { exact: true })
        .fill("Changed name");
      let committed,
        release,
        writes = 0;
      const reached = new Promise((r) => (committed = r)),
        held = new Promise((r) => (release = r));
      await f.page.route("**/api/local/mcp/rename", async (route) => {
        writes++;
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        committed();
        await held;
        if (outcome === "confirmed") await route.fulfill({ response });
        else await route.abort("failed");
      });
      try {
        await f.page.getByRole("button", { name: "Save name" }).click();
        await reached;
        await f.page.evaluate(() => {
          window.dispatchEvent(new Event("focus"));
          window.dispatchEvent(new Event("pageshow"));
        });
        release();
        await f.page
          .getByRole(outcome === "confirmed" ? "status" : "alert", {
            name:
              outcome === "confirmed"
                ? "Client name saved"
                : "Change not confirmed",
            exact: true,
          })
          .waitFor();
        assert.equal(writes, 1);
        assert.equal(clients(f)[0].label, "Changed name");
        if (outcome === "lost-response") {
          assert.equal(
            await f.page
              .getByLabel("Client name", { exact: true })
              .inputValue(),
            "Changed name",
          );
          assert.equal(
            await f.page
              .getByRole("button", { name: "Save name" })
              .isDisabled(),
            true,
          );
          await f.page
            .getByRole("button", { name: "Read current name" })
            .click();
          await f.page
            .getByText("Current name: Changed name", { exact: true })
            .waitFor();
        }
      } finally {
        release();
      }
    },
  );

test(
  "client names lookup failure keeps history usable and retries reads; unknown fragments never filter",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    seed(f, a);
    let reads = 0;
    await f.page.route("**/api/local/mcp/labels", async (route) => {
      reads++;
      if (reads === 1) await route.fulfill({ status: 503, body: "{}" });
      else await route.continue();
    });
    await unlock(f, `/dashboard/history#mcp-client=${a.id}`);
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadfirst" })
      .waitFor();
    await f.page.getByRole("button", { name: "Retry client names" }).click();
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByText(a.label, { exact: true })
      .first()
      .waitFor();
    assert.equal(reads, 2);
    await f.page.goto(
      f.ready.origin +
        `/dashboard/history#mcp-client=${a.id}&mcp-client=${a.id}`,
    );
    await f.page
      .getByRole("button", { name: "Remove client filter" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await f.page
        .getByRole("button", { name: "Remove client filter" })
        .count(),
      0,
    );
  },
);

test(
  "client names reject stale drafts, retain instance identity and discard delayed writes on lock",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    await unlock(f);
    await f.page
      .getByRole("button", { name: `Rename ${a.id}`, exact: true })
      .click();
    await f.page.getByLabel("Client name", { exact: true }).fill("   ");
    await f.page.getByRole("button", { name: "Save name" }).click();
    await f.page
      .getByText(
        "Enter a name of 1–64 characters without control characters.",
        { exact: true },
      )
      .waitFor();
    await f.page
      .getByLabel("Client name", { exact: true })
      .fill("My intended name");
    f.cli(
      "local-mcp.js",
      "rename",
      "--id",
      a.id,
      "--label",
      "Other window name",
    );
    await f.page.getByRole("button", { name: "Save name" }).click();
    await f.page
      .getByRole("alert", { name: "Name not saved", exact: true })
      .waitFor();
    assert.equal(clients(f)[0].label, "Other window name");
    assert.equal(
      await f.page.getByLabel("Client name", { exact: true }).inputValue(),
      "My intended name",
    );
    await f.page.getByRole("button", { name: "Read current name" }).click();
    await f.page
      .getByText("Current name: Other window name", { exact: true })
      .waitFor();
    let reached, release;
    const committed = new Promise((r) => (reached = r)),
      held = new Promise((r) => (release = r));
    await f.page.route("**/api/local/mcp/rename", async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      reached();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    try {
      await f.page.getByRole("button", { name: "Save name" }).click();
      await committed;
      await f.page.getByRole("button", { name: "Lock dashboard" }).click();
      release();
      await f.page.getByLabel("Unlock token").waitFor();
      assert.equal(
        await f.page.getByLabel("Client name", { exact: true }).count(),
        0,
      );
      assert.equal(
        await f.page
          .getByRole("status", { name: "Client name saved", exact: true })
          .count(),
        0,
      );
      assert.equal(clients(f)[0].label, "My intended name");
    } finally {
      release();
    }
  },
);

test(
  "client names refresh on CLI changes and exact filters survive focus, manual edits and browser back and forward",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    const b = JSON.parse(
      f.cli(
        "local-mcp.js",
        "provision",
        "--label",
        a.label,
        "--out",
        path.join(f.root, "second.token"),
      ).stdout,
    ).result;
    seed(f, a);
    seed(f, b, "second");
    await unlock(f, `/dashboard/history#mcp-client=${a.id}`);
    const inputs = [];
    f.page.on("request", (request) => {
      if (request.url().endsWith("/graphql")) {
        const body = request.postDataJSON();
        if (body.query?.includes("mcpAccessHistory"))
          inputs.push(body.variables.input);
      }
    });
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadfirst" })
      .waitFor();
    f.cli(
      "local-mcp.js",
      "rename",
      "--id",
      a.id,
      "--label",
      "<img src=x onerror=bad()>",
    );
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByText("<img src=x onerror=bad()>", { exact: true })
      .first()
      .waitFor();
    assert.equal(await f.page.locator('img[src="x"]').count(), 0);
    await f.page
      .getByLabel("Client key", { exact: true })
      .fill(`local:${b.id}`);
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByRole("button", { name: "Apply", exact: true })
      .click();
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadsecond" })
      .waitFor();
    assert.equal(new URL(f.page.url()).hash, `#mcp-client=${b.id}`);
    assert.ok(inputs.some((input) => input.clientKey === `local:${b.id}`));
    await f.page.goBack();
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadfirst" })
      .waitFor();
    await f.page.goForward();
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadsecond" })
      .waitFor();
    assert.equal(new URL(f.page.url()).hash, `#mcp-client=${b.id}`);
    assert.equal(
      await f.page.getByLabel("Client key", { exact: true }).inputValue(),
      `local:${b.id}`,
    );
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByRole("button", { name: "Reset", exact: true })
      .click();
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadsecond" })
      .waitFor();
    await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await f.page
      .getByRole("button")
      .filter({ hasText: "syntheticReadsecond" })
      .waitFor();
    assert.equal(new URL(f.page.url()).hash, "");
  },
);

test(
  "client names refresh only represented IDs after changing the selected instance",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    const b = JSON.parse(
      f.cli(
        "local-mcp.js",
        "provision",
        "--label",
        "Second client",
        "--out",
        path.join(f.root, "second.token"),
      ).stdout,
    ).result;
    seed(f, a);
    seed(f, b, "second");
    const batches = [];
    f.page.on("request", (request) => {
      if (request.url().endsWith("/api/local/mcp/labels"))
        batches.push(request.postDataJSON().ids);
    });
    await unlock(f, `/dashboard/history#mcp-client=${a.id}`);
    const history = f.page.getByRole("tabpanel", { name: "MCP Access" });
    await history.getByText(a.label, { exact: true }).first().waitFor();
    await history
      .getByLabel("Client key", { exact: true })
      .fill(`local:${b.id}`);
    await history.getByRole("button", { name: "Apply", exact: true }).click();
    await history
      .getByRole("button")
      .filter({ hasText: "syntheticReadsecond" })
      .waitFor();
    await history.getByText(b.label, { exact: true }).first().waitFor();
    assert.equal(
      await history
        .getByRole("button")
        .filter({ hasText: "syntheticReadfirst" })
        .count(),
      0,
    );
    for (const refresh of ["focus", "broadcast"]) {
      const nextName = `Second client after ${refresh}`;
      f.cli("local-mcp.js", "rename", "--id", b.id, "--label", nextName);
      batches.length = 0;
      await f.page.evaluate((refresh) => {
        if (refresh === "focus") window.dispatchEvent(new Event("focus"));
        else {
          const channel = new BroadcastChannel(
            "context-router.mcp-management.v1",
          );
          channel.postMessage("invalidate");
          channel.close();
        }
      }, refresh);
      await history.getByText(nextName, { exact: true }).first().waitFor();
      assert.ok(batches.length > 0);
      assert.ok(
        batches.every(
          (batch) =>
            batch.length > 0 &&
            batch.length <= 100 &&
            batch.every((id) => id === b.id),
        ),
        `${refresh} fetched an instance no longer represented: ${JSON.stringify(batches)}`,
      );
    }
  },
);

test(
  "client names batch loaded pages, include revoked names and keep missing IDs visible",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    seed(f, a);
    f.cli("local-mcp.js", "revoke", "--id", a.id);
    const c = f.database.connect();
    try {
      for (let i = 0; i < 25; i++)
        c.run(
          "INSERT INTO mcp_access_events(id,user_id,occurred_at,client_key,surface,operation_name,outcome,correlation_id,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            "paged-" + i,
            f.identity.principalId,
            Date.now() + i,
            "local:" + String(i).padStart(22, "Z"),
            "TOOLS_CALL",
            "pagedRead" + i,
            "SUCCESS",
            "page-" + i,
            1,
          ],
        );
    } finally {
      c.close();
    }
    const batches = [];
    f.page.on("request", (request) => {
      if (request.url().endsWith("/api/local/mcp/labels"))
        batches.push(request.postDataJSON().ids);
    });
    await unlock(f, "/dashboard/history");
    await f.page.getByRole("tab", { name: "MCP Access" }).click();
    await f.page
      .getByRole("button")
      .filter({ hasText: "pagedRead24" })
      .waitFor();
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByRole("button", { name: "Load more" })
      .click();
    await f.page
      .getByRole("tabpanel", { name: "MCP Access" })
      .getByText(a.label, { exact: true })
      .first()
      .waitFor();
    assert.ok(batches.every((batch) => batch.length <= 100));
    assert.ok(
      batches.length <= 3,
      `must batch rows, got ${batches.length} requests`,
    );
    assert.equal(
      new Set(batches.flat()).size,
      batches.flat().length,
      "loaded IDs fetched once until invalidation",
    );
    assert.ok(
      (await f.page.textContent("body")).includes(
        "local:" + String(24).padStart(22, "Z"),
      ),
    );
  },
);

test(
  "client names label existing preference attribution and discard delayed name reads on lock",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    await unlock(f, "/dashboard");
    await f.page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await f.graphql(
      'mutation { setPreference(input:{slug:"profile.first_name",value:"Synthetic attribution"}) { id } }',
    );
    const c = f.database.connect();
    try {
      c.run(
        "UPDATE user_preferences SET last_actor_type=?,last_actor_client_key=?,last_origin=? WHERE user_id=?",
        ["MCP_CLIENT", `local:${a.id}`, "MCP", f.identity.principalId],
      );
    } finally {
      c.close();
    }
    f.cli(
      "local-mcp.js",
      "rename",
      "--id",
      a.id,
      "--label",
      "Preference editor",
    );
    await f.page.goto(f.ready.origin + "/dashboard/preferences");
    await f.page.getByText("Preference editor", { exact: true }).waitFor();
    assert.ok((await f.page.textContent("body")).includes(`local:${a.id}`));
    let reached, release;
    const waiting = new Promise((r) => (reached = r)),
      held = new Promise((r) => (release = r));
    await f.page.route("**/api/local/mcp/labels", async (route) => {
      const response = await route.fetch();
      reached();
      await held;
      await route.fulfill({ response }).catch(() => {});
    });
    try {
      await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await waiting;
      await f.page.getByRole("button", { name: "Lock dashboard" }).click();
      release();
      await f.page.getByLabel("Unlock token").waitFor();
      assert.equal(
        await f.page.getByText("Preference editor", { exact: true }).count(),
        0,
      );
    } finally {
      release();
    }
  },
);

for (const exit of ["expiry", "navigation"])
  test(
    `client names discard a delayed rename on ${exit}`,
    { timeout: 60000 },
    async (t) => {
      const f = await browserFixture(t),
        a = clients(f)[0];
      await unlock(f);
      await f.page
        .getByRole("button", { name: `Rename ${a.id}`, exact: true })
        .click();
      await f.page
        .getByLabel("Client name", { exact: true })
        .fill("Private draft");
      let reached, release;
      const committed = new Promise((r) => (reached = r)),
        held = new Promise((r) => (release = r));
      await f.page.route("**/api/local/mcp/rename", async (route) => {
        const response = await route.fetch();
        reached();
        await held;
        await route.fulfill({ response }).catch(() => {});
      });
      try {
        await f.page.getByRole("button", { name: "Save name" }).click();
        await committed;
        if (exit === "expiry") {
          await f.page.route("**/api/local/session", (route) =>
            route.fulfill({ status: 401, body: "{}" }),
          );
          await f.page.evaluate(() => window.dispatchEvent(new Event("focus")));
          await f.page.getByLabel("Unlock token").waitFor();
        } else await f.page.goto(f.ready.origin + "/dashboard");
        release();
        assert.equal(
          await f.page
            .getByRole("status", { name: "Client name saved", exact: true })
            .count(),
          0,
        );
        assert.equal(
          await f.page.getByLabel("Client name", { exact: true }).count(),
          0,
        );
      } finally {
        release();
      }
    },
  );

test(
  "client names with colliding short IDs remain inspectable and empty activity keeps the selected name",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    const b = JSON.parse(
      f.cli(
        "local-mcp.js",
        "provision",
        "--label",
        a.label,
        "--out",
        path.join(f.root, "second.token"),
      ).stdout,
    ).result;
    const ids = ["A".repeat(14) + "SameId00", "B".repeat(14) + "SameId00"];
    const c = f.database.connect();
    try {
      c.run("UPDATE local_mcp_clients SET id=? WHERE id=?", [ids[0], a.id]);
      c.run("UPDATE local_mcp_clients SET id=? WHERE id=?", [ids[1], b.id]);
    } finally {
      c.close();
    }
    await unlock(f);
    for (const id of ids)
      await f.page
        .getByRole("listitem")
        .filter({
          has: f.page.getByRole("button", {
            name: `Rename ${id}`,
            exact: true,
          }),
        })
        .getByText(id, { exact: true })
        .waitFor();
    await f.page
      .getByRole("link", { name: `View activity ${ids[1]}`, exact: true })
      .click();
    const mcp = f.page.getByRole("tabpanel", { name: "MCP Access" });
    await mcp
      .getByText("No MCP access events match the current filters.", {
        exact: true,
      })
      .waitFor();
    await mcp.getByText(a.label, { exact: true }).waitFor();
    assert.ok((await mcp.innerText()).includes("local:" + ids[1]));
    assert.equal((await mcp.innerText()).includes("local:" + ids[0]), false);
    await f.page.getByRole("tab", { name: "Audit", exact: true }).click();
    await f.page
      .getByRole("tabpanel", { name: "Audit", exact: true })
      .getByText("No events match the current filters.", { exact: true })
      .waitFor();
  },
);

test(
  "client names preserve typing while a fresh expected-name read is pending",
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t),
      a = clients(f)[0];
    await unlock(f);
    await f.page
      .getByRole("button", { name: `Rename ${a.id}`, exact: true })
      .click();
    await f.page.getByLabel("Client name", { exact: true }).fill("First draft");
    let reached, release;
    const read = new Promise((r) => (reached = r)),
      held = new Promise((r) => (release = r));
    await f.page.route(
      "**/api/local/mcp/inspect",
      async (route) => {
        const response = await route.fetch();
        reached();
        await held;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    try {
      await f.page.getByRole("button", { name: "Read current name" }).click();
      await read;
      await f.page
        .getByLabel("Client name", { exact: true })
        .fill("Typed during read");
      release();
      await f.page
        .getByText("Current name: " + a.label, { exact: true })
        .waitFor();
      assert.equal(
        await f.page.getByLabel("Client name", { exact: true }).inputValue(),
        "Typed during read",
      );
    } finally {
      release();
    }
  },
);
