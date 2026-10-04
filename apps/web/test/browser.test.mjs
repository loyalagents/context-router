import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { browserFixture } from './browser-fixture.mjs';

for (const kind of ['grant', 'revoke'])
  for (const outcome of ['confirmed', 'lost-response'])
    test(
      `passive invalidation retains a ${outcome} MCP ${kind} outcome after server commit`,
      { timeout: 60000 },
      async (t) => {
        const f = await browserFixture(t);
        const client = JSON.parse(f.cli('local-mcp.js', 'list').stdout)
          .result[0];
        await f.page.goto(f.ready.origin + '/dashboard/permissions');
        await f.page.getByLabel('Unlock token').fill(f.bootstrap);
        await f.page
          .getByRole('button', { name: 'Unlock local dashboard' })
          .click();
        await f.page
          .getByRole('button', { name: `Inspect ${client.id}`, exact: true })
          .click();
        await f.page
          .getByRole('region', { name: 'Selected client authority' })
          .waitFor();
        const peer = await f.context.newPage();
        await peer.goto(f.ready.origin + '/dashboard');
        await peer.evaluate(() => {
          window.managementPeer = new BroadcastChannel(
            'context-router.mcp-management.v1',
          );
          window.managementInvalidations = 0;
          window.managementPeer.onmessage = () =>
            window.managementInvalidations++;
        });
        await f.page.evaluate(() => {
          window.managementObserver = new BroadcastChannel(
            'context-router.mcp-management.v1',
          );
          window.managementInvalidations = 0;
          window.managementObserver.onmessage = () =>
            window.managementInvalidations++;
        });
        let reads = 0,
          writes = 0,
          release;
        f.page.on('request', (request) => {
          if (/\/api\/local\/mcp\/(list|inspect)$/.test(request.url())) reads++;
        });
        let committed;
        const reached = new Promise((resolve) => {
          committed = resolve;
        });
        const held = new Promise((resolve) => {
          release = resolve;
        });
        await f.page.route(`**/api/local/mcp/${kind}`, async (route) => {
          writes++;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          committed();
          await held;
          if (outcome === 'confirmed') await route.fulfill({ response });
          else await route.abort('failed');
        });
        try {
          if (kind === 'revoke')
            f.page.once('dialog', (dialog) => dialog.accept());
          await f.page
            .getByRole('button', {
              name: kind === 'grant' ? 'Save grant' : 'Revoke this instance',
            })
            .click();
          await reached;
          const before = reads;
          await peer.evaluate(() =>
            window.managementPeer.postMessage('invalidate'),
          );
          await f.page.waitForFunction(
            () => window.managementInvalidations > 0,
          );
          await f.page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('pageshow'));
          });
          await f.page.evaluate(
            () =>
              new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
              ),
          );
          assert.equal(
            reads,
            before,
            'read refresh waits for mutation settlement',
          );
          assert.equal(
            await f.page
              .getByRole('region', { name: 'Selected client authority' })
              .count(),
            0,
          );
          assert.equal(
            await f.page
              .getByRole('button', { name: 'Inspect selected instance' })
              .isDisabled(),
            true,
          );
          const failedRefresh = kind === 'grant' && outcome === 'confirmed';
          if (failedRefresh)
            await f.page.route(
              '**/api/local/mcp/list',
              (route) => route.fulfill({ status: 503, body: '{}' }),
              { times: 1 },
            );
          release();
          await f.page
            .getByText(
              outcome === 'lost-response'
                ? 'Change was not confirmed.'
                : kind === 'grant'
                  ? 'Grant saved.'
                  : 'Client instance revoked.',
              { exact: false },
            )
            .waitFor();
          await peer.waitForFunction(() => window.managementInvalidations > 0);
          if (failedRefresh) {
            await f.page
              .getByRole('alert')
              .filter({ hasText: 'Unable to load client instances.' })
              .waitFor();
            assert.equal(
              await f.page
                .getByText('Grant saved.', { exact: false })
                .isVisible(),
              true,
            );
            await f.page
              .getByRole('button', { name: 'Reload clients' })
              .click();
          }
          await f.page
            .getByRole('button', { name: `Inspect ${client.id}`, exact: true })
            .click();
          const inspected = f.page.getByRole('region', {
            name: 'Selected client authority',
          });
          await inspected
            .getByText(
              kind === 'grant'
                ? '* · READ · DENY'
                : 'Revoked: no effective access.',
              { exact: true },
            )
            .waitFor();
          assert.equal(
            writes,
            1,
            'an uncertain write is never retried automatically',
          );
          assert.equal(
            await inspected
              .getByRole('cell', { name: 'Denied', exact: true })
              .count(),
            4,
          );
        } finally {
          release();
          await peer.close();
        }
      },
    );

test(
  'unlock capacity feedback permits retry of the same unconsumed token',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard');
    let attempts = 0;
    await f.page.route('**/api/local/unlock', (route) => {
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: '{"error":"Local UI request rejected"}',
        });
      return route.continue();
    });
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('alert')
      .filter({ hasText: 'same unexpired unlock token' })
      .waitFor();
    assert.equal(attempts, 1);
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('heading', { name: 'Dashboard', exact: true })
      .waitFor();
    assert.equal(attempts, 2);
  },
);

test(
  'capability failure after unlock does not suggest reusing a consumed token',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard');
    await f.page.route('**/api/local/capabilities', (route) =>
      route.fulfill({ status: 429, body: '{}' }),
    );
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('alert')
      .filter({ hasText: 'Use a fresh unlock file' })
      .waitFor();
    const replay = await f.context.request.post(
      f.ready.origin + '/api/local/unlock',
      {
        headers: { origin: f.ready.origin, 'x-context-router-ui': '1' },
        data: { bootstrap: f.bootstrap },
      },
    );
    assert.equal(replay.status(), 401);
  },
);

test(
  'production dashboard hydrates with nonce CSP, unlocks without Auth0 and edits local profile',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    const response = await f.page.goto(f.ready.origin + '/dashboard');
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-security-policy'], /nonce-/);
    const shell = await response.text();
    assert.equal(shell.includes(f.identity.principalId), false);
    assert.equal(shell.includes(f.bootstrap), false);
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('heading', { name: 'Dashboard', exact: true })
      .waitFor();
    assert.equal(
      await f.page.getByRole('link', { name: 'Debug Token' }).count(),
      0,
    );
    assert.equal(
      await f.page.getByRole('link', { name: 'Test AI Chat' }).count(),
      0,
    );
    await f.page
      .getByRole('link', { name: 'Edit Profile', exact: true })
      .click();
    await f.page
      .getByLabel('Full Name', { exact: true })
      .fill('Synthetic Browser Person');
    await f.page
      .getByLabel('Contact Email', { exact: true })
      .fill('synthetic@example.invalid');
    await f.page
      .getByLabel('First Name', { exact: true })
      .fill('Remove after first save');
    await f.page.getByRole('button', { name: 'Save Changes' }).click();
    await f.page.getByText('Profile updated successfully.').waitFor();
    await f.page.getByLabel('First Name', { exact: true }).fill('');
    const savedAgain = f.page.waitForResponse(
      (response) =>
        response.url().endsWith('/graphql') &&
        response.request().postData()?.includes('SetProfilePreference'),
    );
    await f.page.getByRole('button', { name: 'Save Changes' }).click();
    await savedAgain;
    await f.page.getByText('Profile updated successfully.').waitFor();
    assert.equal(
      (
        await f.graphql('{ activePreferences { slug value } }')
      ).activePreferences.some((p) => p.slug === 'profile.first_name'),
      false,
    );
    await f.page.getByRole('link', { name: /Back to Dashboard/ }).click();
    await f.page
      .getByText('Synthetic Browser Person', { exact: false })
      .waitFor();
    assert.equal((await f.context.cookies()).length, 0);
    assert.equal(await f.page.evaluate(() => localStorage.length), 0);
    let releaseLogout;
    await f.context.route('**/api/local/logout', async (route) => {
      await new Promise((resolve) => {
        releaseLogout = resolve;
      });
      await route.continue();
    });
    await f.page.getByRole('button', { name: 'Lock dashboard' }).click();
    await f.page.getByLabel('Unlock token').waitFor({ timeout: 2000 });
    assert.equal(await f.page.evaluate(() => sessionStorage.length), 0);
    // Private UI and storage disappear even while server acknowledgement is delayed.
    while (!releaseLogout)
      await new Promise((resolve) => setTimeout(resolve, 5));
    releaseLogout();
    assert.deepEqual(f.outbound, []);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.policyViolations, []);
    assert.equal(f.stdout().includes(f.bootstrap), false);
  },
);

test(
  'an idle browser clears private state at the authenticated absolute lifetime',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.clock.install();
    await f.page.goto(f.ready.origin + '/dashboard');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('heading', { name: 'Dashboard', exact: true })
      .waitFor();
    await f.page.clock.fastForward(8 * 60 * 60 * 1000 + 1000);
    await f.page.getByLabel('Unlock token').waitFor();
    assert.equal(await f.page.evaluate(() => sessionStorage.length), 0);
    assert.equal(
      await f.page
        .getByRole('heading', { name: 'Dashboard', exact: true })
        .count(),
      0,
    );
  },
);

test(
  'history masks archived and legacy payloads, confirms both-stream clear and preserves live memory',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('heading', { name: 'Dashboard', exact: true })
      .waitFor();
    const created = await f.graphql(
      'mutation { createPreferenceDefinition(input: {slug:"synthetic.private",description:"Private synthetic",valueType:STRING,scope:GLOBAL,isSensitive:true}) { id } }',
    );
    await f.graphql(
      'mutation { setPreference(input:{slug:"synthetic.private",value:"private-value-canary"}) { id } }',
    );
    await f.graphql(
      'mutation($id: ID!) { archivePreferenceDefinition(id:$id) { id } }',
      { id: created.createPreferenceDefinition.id },
    );
    await f.graphql(
      'mutation { setPreference(input:{slug:"profile.first_name",value:"Preserved synthetic"}) { id } }',
    );
    const c = f.database.connect();
    try {
      c.run(
        'INSERT INTO preference_audit_events(id,user_id,subject_slug,occurred_at,target_type,target_id,event_type,actor_type,origin,correlation_id,before_state,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          'legacy-event',
          f.identity.principalId,
          'synthetic.legacy',
          Date.now(),
          'PREFERENCE',
          'legacy-value',
          'PREFERENCE_SET',
          'USER',
          'GRAPHQL',
          'legacy',
          JSON.stringify({
            value: 'legacy-value-canary',
            evidence: 'legacy-evidence-canary',
          }),
          JSON.stringify({
            consumedSuggestion: { value: 'legacy-consumed-canary' },
          }),
        ],
      );
      c.run(
        'INSERT INTO mcp_access_events(id,user_id,occurred_at,client_key,surface,operation_name,outcome,correlation_id,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          'access-event',
          f.identity.principalId,
          Date.now(),
          'synthetic-instance',
          'TOOLS_CALL',
          'syntheticRead',
          'SUCCESS',
          'legacy',
          1,
        ],
      );
    } finally {
      c.close();
    }
    await f.page
      .getByRole('link', { name: 'Audit History', exact: true })
      .click();
    await f.page.getByRole('button', { name: /synthetic.legacy/ }).click();
    assert.equal(
      (await f.page.textContent('body')).includes('legacy-value-canary'),
      false,
    );
    await f.page.getByLabel('Show sensitive values').check();
    await f.page.getByText('legacy-value-canary', { exact: false }).waitFor();
    await f.page.getByLabel('Show sensitive values').uncheck();
    await f.page.getByRole('tab', { name: 'MCP Access' }).click();
    await f.page.getByText('syntheticRead', { exact: true }).waitFor();
    await f.page
      .getByRole('button', { name: 'Clear both history streams' })
      .click();
    await f.page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await f.page.getByText('syntheticRead', { exact: true }).waitFor();
    await f.page
      .getByRole('button', { name: 'Clear both history streams' })
      .click();
    await f.page
      .getByLabel('Type CLEAR HISTORY to confirm')
      .fill('CLEAR HISTORY');
    await f.page
      .getByRole('button', { name: 'Clear history permanently' })
      .click();
    await f.page
      .getByText('Both history streams cleared.', { exact: false })
      .waitFor();
    assert.equal(
      await f.page.getByText('syntheticRead', { exact: true }).count(),
      0,
    );
    await f.page.getByRole('tab', { name: 'Audit', exact: true }).click();
    await f.page.getByText('No audit history yet.', { exact: true }).waitFor();
    assert.equal(
      (await f.page.textContent('body')).includes('legacy-value-canary'),
      false,
    );
    const data = await f.graphql(
      '{ activePreferences { slug value } preferenceAuditHistory(input:{first:20}) { items { id } } mcpAccessHistory(input:{first:20}) { items { id } } }',
    );
    assert.ok(
      data.activePreferences.some((p) => p.value === 'Preserved synthetic'),
    );
    assert.deepEqual(data.preferenceAuditHistory.items, []);
    assert.deepEqual(data.mcpAccessHistory.items, []);
  },
);

test(
  'MCP clients show per-instance maximum and effective grants, reject stale edits and revoke only the selected instance',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    const first = JSON.parse(f.cli('local-mcp.js', 'list').stdout).result[0];
    f.cli(
      'local-mcp.js',
      'provision',
      '--label',
      first.label,
      '--out',
      f.root + '/second.token',
    );
    f.cli(
      'local-mcp.js',
      'permissions',
      '--id',
      first.id,
      '--capabilities',
      'preferences:write',
      '--targets',
      'profile.*',
    );
    await f.page.goto(f.ready.origin + '/dashboard/permissions');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('button', { name: `Inspect ${first.id}`, exact: true })
      .click();
    const selected = f.page.getByRole('region', {
      name: 'Selected client authority',
    });
    await selected
      .getByRole('cell', { name: 'Allowed', exact: true })
      .first()
      .waitFor();
    await f.page.getByLabel('Action', { exact: true }).selectOption('DEFINE');
    await f.page.getByLabel('Effect', { exact: true }).selectOption('ALLOW');
    await f.page.getByRole('button', { name: 'Save grant' }).click();
    await f.page.getByText('ALLOW was not saved:', { exact: false }).waitFor();
    await f.page
      .getByRole('button', { name: `Inspect ${first.id}`, exact: true })
      .click();
    await selected
      .getByText('No database grants; maximum policy applies.', { exact: true })
      .waitFor();
    await f.page.getByLabel('Action', { exact: true }).selectOption('READ');
    await f.page.getByLabel('Effect', { exact: true }).selectOption('DENY');
    await f.page.getByLabel('Target', { exact: true }).fill('profile.*');
    await f.page.getByRole('button', { name: 'Save grant' }).click();
    await f.page.getByText('Grant saved.', { exact: false }).waitFor();
    await f.page
      .getByRole('button', { name: `Inspect ${first.id}`, exact: true })
      .click();
    await selected
      .getByText('profile.* · READ · DENY', { exact: true })
      .waitFor();
    assert.equal(
      await selected.getByRole('cell', { name: 'Denied', exact: true }).count(),
      4,
    );
    await selected.getByRole('button', { name: 'Remove grant' }).click();
    await f.page.getByText('Grant saved.', { exact: false }).waitFor();
    await f.page
      .getByRole('button', { name: `Inspect ${first.id}`, exact: true })
      .click();
    await selected
      .getByText('No database grants; maximum policy applies.', { exact: true })
      .waitFor();
    f.cli(
      'local-mcp.js',
      'grant',
      '--id',
      first.id,
      '--target',
      '*',
      '--action',
      'READ',
      '--effect',
      'DENY',
    );
    await f.page.getByRole('button', { name: 'Save grant' }).click();
    await f.page
      .getByText('Change was not confirmed.', { exact: false })
      .waitFor();
    await f.page
      .getByRole('button', { name: `Inspect ${first.id}`, exact: true })
      .click();
    await selected.getByText('* · READ · DENY', { exact: true }).waitFor();
    f.page.once('dialog', (dialog) => dialog.accept());
    await f.page.getByRole('button', { name: 'Revoke this instance' }).click();
    await f.page
      .getByText('Client instance revoked.', { exact: false })
      .waitFor();
    const final = JSON.parse(f.cli('local-mcp.js', 'list').stdout).result;
    assert.equal(final.find((client) => client.id === first.id).revoked, true);
    assert.equal(final.find((client) => client.id !== first.id).revoked, false);
    assert.deepEqual(f.outbound, []);
    assert.deepEqual(f.errors, []);
  },
);

test(
  'history clear invalidates hidden tabs and rejects an older response in another browser window',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard/history');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page.getByRole('tab', { name: 'Audit', exact: true }).waitFor();
    await f.graphql(
      'mutation { setPreference(input:{slug:"profile.first_name",value:"Cross-window retained memory"}) { id } }',
    );
    const c = f.database.connect();
    try {
      c.run(
        'INSERT INTO mcp_access_events(id,user_id,occurred_at,client_key,surface,operation_name,outcome,correlation_id,latency_ms) VALUES(?,?,?,?,?,?,?,?,?)',
        [
          'cross-window-access',
          f.identity.principalId,
          Date.now(),
          'synthetic-instance',
          'TOOLS_CALL',
          'hidden-access-canary',
          'SUCCESS',
          'cross-window',
          1,
        ],
      );
    } finally {
      c.close();
    }
    const second = await f.context.newPage();
    const token = await f.page.evaluate(() =>
      sessionStorage.getItem('context-router.browser-session.v1'),
    );
    await second.addInitScript(
      (token) =>
        sessionStorage.setItem('context-router.browser-session.v1', token),
      token,
    );
    await second.goto(f.ready.origin + '/dashboard/history');
    await second.getByRole('button', { name: /profile.first_name/ }).waitFor();
    await second.getByRole('tab', { name: 'MCP Access' }).click();
    await second.getByText('hidden-access-canary', { exact: true }).waitFor();
    await second.getByRole('tab', { name: 'Audit', exact: true }).click();
    let release, captured;
    const intercepted = new Promise((resolve) => {
      captured = resolve;
    });
    let once = true;
    await second.route('**/graphql', async (route) => {
      if (
        !once ||
        !route.request().postData()?.includes('preferenceAuditHistory')
      )
        return route.continue();
      once = false;
      const response = await route.fetch();
      captured();
      await new Promise((resolve) => {
        release = resolve;
      });
      await route.fulfill({ response }).catch(() => {});
    });
    await second.evaluate(() => window.dispatchEvent(new Event('focus')));
    await intercepted;
    await f.page
      .getByRole('button', { name: 'Clear both history streams' })
      .click();
    await f.page
      .getByLabel('Type CLEAR HISTORY to confirm')
      .fill('CLEAR HISTORY');
    await f.page
      .getByRole('button', { name: 'Clear history permanently' })
      .click();
    await f.page
      .getByText('Both history streams cleared.', { exact: false })
      .waitFor();
    release();
    await second.getByText('No audit history yet.', { exact: true }).waitFor();
    assert.equal(
      (await second.textContent('body')).includes('hidden-access-canary'),
      false,
    );
    assert.equal(
      await second.getByRole('button', { name: /profile.first_name/ }).count(),
      0,
    );
    await second.getByRole('tab', { name: 'MCP Access' }).click();
    assert.equal(
      await second.getByText('hidden-access-canary', { exact: true }).count(),
      0,
    );
    assert.ok(
      (
        await f.graphql('{ activePreferences { value } }')
      ).activePreferences.some(
        (p) => p.value === 'Cross-window retained memory',
      ),
    );
  },
);

test(
  'locking during a history clear discards the delayed result without publishing into a closed view',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard/history');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page.getByRole('tab', { name: 'Audit', exact: true }).waitFor();
    let release, reached;
    const captured = new Promise((resolve) => {
      reached = resolve;
    });
    await f.page.route('**/graphql', async (route) => {
      if (!route.request().postData()?.includes('mutation ClearHistory'))
        return route.continue();
      const response = await route.fetch();
      reached();
      await new Promise((resolve) => {
        release = resolve;
      });
      await route.fulfill({ response }).catch(() => {});
    });
    await f.page
      .getByRole('button', { name: 'Clear both history streams' })
      .click();
    await f.page
      .getByLabel('Type CLEAR HISTORY to confirm')
      .fill('CLEAR HISTORY');
    await f.page
      .getByRole('button', { name: 'Clear history permanently' })
      .click();
    await captured;
    await f.page.getByRole('button', { name: 'Lock dashboard' }).click();
    await f.page.getByLabel('Unlock token').waitFor();
    release();
    await f.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.deepEqual(f.errors, []);
    assert.equal(
      await f.page
        .getByText('Both history streams cleared.', { exact: false })
        .count(),
      0,
    );
  },
);

test(
  'no-model browser creates, edits, exports and archives a personal definition while manual memory remains separate',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard/schema');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('button', { name: '+ Add Definition', exact: true })
      .click();
    await f.page
      .getByLabel('Slug', { exact: true })
      .fill('synthetic.browser_crud');
    await f.page
      .getByLabel('Description', { exact: true })
      .fill('Synthetic browser schema');
    await f.page.getByRole('button', { name: 'Create', exact: true }).click();
    await f.page.getByText('synthetic.browser_crud', { exact: true }).waitFor();
    const download = f.page.waitForEvent('download');
    await f.page.getByTitle('Download PERSONAL definitions as JSON').click();
    const artifact = await download;
    const chunks = [];
    for await (const chunk of await artifact.createReadStream())
      chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.ok(
      exported.some(
        (d) =>
          d.slug === 'synthetic.browser_crud' &&
          d.description === 'Synthetic browser schema',
      ),
    );
    await f.page.goto(f.ready.origin + '/dashboard/preferences');
    await f.page
      .getByLabel('Slug', { exact: true })
      .fill('synthetic.browser_crud');
    await f.page
      .getByLabel('Value', { exact: true })
      .fill('Manual synthetic value');
    await f.page
      .getByRole('button', { name: 'Save Preference', exact: true })
      .click();
    await f.page.getByTitle('Edit', { exact: true }).click();
    await f.page
      .getByLabel('Value for synthetic.browser_crud')
      .fill('"Edited synthetic value"');
    await f.page.getByRole('button', { name: 'Save', exact: true }).click();
    await f.page
      .getByText('"Edited synthetic value"', { exact: true })
      .waitFor();
    f.page.once('dialog', (dialog) => dialog.accept());
    await f.page.getByTitle('Delete', { exact: true }).click();
    await f.page.getByText('No preferences yet.', { exact: false }).waitFor();
    const result = await f.graphql(
      '{ preferenceCatalog { id slug description } activePreferences { slug } }',
    );
    assert.ok(
      result.preferenceCatalog.some((d) => d.slug === 'synthetic.browser_crud'),
    );
    assert.deepEqual(result.activePreferences, []);
    await f.page.goto(f.ready.origin + '/dashboard/schema');
    await f.page.getByTitle('Edit', { exact: true }).click();
    await f.page
      .getByLabel('Description', { exact: true })
      .fill('Edited synthetic schema');
    await f.page
      .getByRole('button', { name: 'Save Changes', exact: true })
      .click();
    await f.page
      .getByText('Edited synthetic schema', { exact: true })
      .waitFor();
    f.page.once('dialog', (dialog) => dialog.accept());
    await f.page.getByTitle('Archive', { exact: true }).click();
    await f.page
      .getByText('synthetic.browser_crud', { exact: true })
      .waitFor({ state: 'hidden' });
    assert.equal(
      (
        await f.graphql('{ preferenceCatalog { slug } }')
      ).preferenceCatalog.some((d) => d.slug === 'synthetic.browser_crud'),
      false,
    );
  },
);

for (const kind of ['grant', 'revoke'])
  test(
    `locking during a delayed MCP ${kind} discards publication`,
    { timeout: 60000 },
    async (t) => {
      const f = await browserFixture(t);
      const first = JSON.parse(f.cli('local-mcp.js', 'list').stdout).result[0];
      await f.page.goto(f.ready.origin + '/dashboard/permissions');
      await f.page.getByLabel('Unlock token').fill(f.bootstrap);
      await f.page
        .getByRole('button', { name: 'Unlock local dashboard' })
        .click();
      await f.page
        .getByRole('button', { name: `Inspect ${first.id}`, exact: true })
        .click();
      await f.page
        .getByRole('region', { name: 'Selected client authority' })
        .waitFor();
      let release;
      let entered;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      await f.context.route(`**/api/local/mcp/${kind}`, async (route) => {
        await new Promise((resolve) => {
          release = resolve;
          entered();
        });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ changed: true }),
        });
      });
      if (kind === 'revoke') f.page.once('dialog', (dialog) => dialog.accept());
      await f.page
        .getByRole('button', {
          name: kind === 'grant' ? 'Save grant' : 'Revoke this instance',
        })
        .click();
      await started;
      await f.page.getByRole('button', { name: 'Lock dashboard' }).click();
      await f.page.getByLabel('Unlock token').waitFor();
      release();
      await f.page.waitForTimeout(100);
      assert.equal(
        await f.page.getByText(/Grant saved|Client instance revoked/).count(),
        0,
      );
      assert.deepEqual(f.errors, []);
    },
  );

test(
  'hostile browser origin and ambient cookies cannot access either authority; RSC shells contain no private data',
  { timeout: 60000 },
  async (t) => {
    const f = await browserFixture(t);
    await f.page.goto(f.ready.origin + '/dashboard');
    await f.page.getByLabel('Unlock token').fill(f.bootstrap);
    await f.page
      .getByRole('button', { name: 'Unlock local dashboard' })
      .click();
    await f.page
      .getByRole('heading', { name: 'Dashboard', exact: true })
      .waitFor();
    const canary = 'RSC_PRIVATE_SYNTHETIC_CANARY';
    await f.graphql(
      'mutation($value:JSON!){setPreference(input:{slug:"profile.first_name",value:$value}){id}}',
      { value: canary },
    );
    const token = await f.page.evaluate(() =>
      sessionStorage.getItem('context-router.browser-session.v1'),
    );
    const mcpToken = readFileSync(f.root + '/mcp.token', 'utf8').trim();
    const mcpOrigin = new URL(f.ready.mcpOrigin).origin;
    await f.context.addCookies([
      {
        name: 'context-router.browser-session.v1',
        value: token,
        url: f.ready.origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'mcp_session',
        value: mcpToken,
        url: mcpOrigin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const cookieReplay = await f.page.evaluate(async () => {
      const result = await fetch('/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-context-router-ui': '1',
        },
        body: JSON.stringify({ query: '{me{userId}}' }),
      });
      return result.status;
    });
    assert.equal(cookieReplay, 401);
    // A native client with only the same ambient cookies has no MCP bearer authority.
    const nativeReplay = await f.context.request.post(mcpOrigin + '/mcp', {
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    assert.equal(nativeReplay.status(), 401);
    for (const route of [
      '/dashboard',
      '/dashboard/profile',
      '/dashboard/preferences',
      '/dashboard/schema',
      '/dashboard/history',
      '/dashboard/permissions',
      '/dashboard/form-fill',
    ]) {
      const response = await f.context.request.get(
        f.ready.origin + route + '?_rsc=synthetic',
        {
          headers: {
            RSC: '1',
            'Next-Router-Prefetch': '1',
            'Next-Url': '/dashboard',
          },
        },
      );
      assert.equal(response.status(), 200);
      assert.match(response.headers()['content-type'], /text\/x-component/);
      const body = await response.text();
      for (const secret of [
        canary,
        token,
        mcpToken,
        f.bootstrap,
        f.identity.principalId,
      ])
        assert.equal(body.includes(secret), false);
      assert.match(response.headers()['cache-control'], /no-store/);
    }
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>Owned hostile origin</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    const hostileOrigin = `http://127.0.0.1:${server.address().port}`;
    assert.notEqual(hostileOrigin, f.ready.origin);
    await f.context.route(hostileOrigin + '/**', (route) => route.continue());
    await f.context.route(mcpOrigin + '/**', (route) => route.continue());
    const hostile = await f.context.newPage();
    await hostile.goto(hostileOrigin);
    const result = await hostile.evaluate(
      async ({ ui, mcp }) => {
        const attempt = async (url, options) => {
          try {
            const response = await fetch(url, options);
            return { type: response.type, status: response.status };
          } catch {
            return { rejected: true };
          }
        };
        return {
          storage: sessionStorage.length,
          preflight: await attempt(ui + '/graphql', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': 'application/json',
              'x-context-router-ui': '1',
            },
            body: JSON.stringify({ query: '{me{userId}}' }),
          }),
          csrf: await attempt(ui + '/graphql', {
            method: 'POST',
            mode: 'no-cors',
            credentials: 'include',
            headers: { 'content-type': 'text/plain' },
            body: JSON.stringify({
              query:
                'mutation{clearMyHistory(confirmation:"CLEAR HISTORY"){preferenceAuditEventsDeleted mcpAccessEventsDeleted status}}',
            }),
          }),
          native: await attempt(mcp + '/mcp', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
        };
      },
      { ui: f.ready.origin, mcp: mcpOrigin },
    );
    assert.equal(result.storage, 0);
    assert.deepEqual(result.preflight, { rejected: true });
    assert.deepEqual(result.native, { rejected: true });
    assert.ok(result.csrf.rejected || result.csrf.type === 'opaque');
    assert.equal(
      (
        await f.graphql('{activePreferences{slug value}}')
      ).activePreferences.find((p) => p.slug === 'profile.first_name').value,
      canary,
    );
    assert.ok(
      (await f.graphql('{preferenceAuditHistory(input:{first:10}){items{id}}}'))
        .preferenceAuditHistory.items.length > 0,
      'hostile clear did not commit',
    );
    await hostile.close();
  },
);
