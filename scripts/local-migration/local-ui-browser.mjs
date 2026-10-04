import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

export function localUiBrowserPrerequisite(
  repositoryRoot,
  environment = process.env,
) {
  const require = createRequire(
    path.join(repositoryRoot, 'apps/web/package.json'),
  );
  const { chromium } = require('playwright');
  const core = path.dirname(
    createRequire(require.resolve('playwright/package.json')).resolve(
      'playwright-core/package.json',
    ),
  );
  const pinned = JSON.parse(
    fs.readFileSync(path.join(core, 'browsers.json'), 'utf8'),
  ).browsers.find((b) => b.name === 'chromium');
  assert.equal(require('playwright/package.json').version, '1.63.0');
  const requested =
    environment.LOCAL_UI_BROWSER_EXECUTABLE ?? chromium.executablePath();
  assert.ok(
    path.isAbsolute(requested),
    'Chromium prerequisite path must be absolute',
  );
  let executable;
  try {
    executable = fs.realpathSync(requested);
    fs.accessSync(executable, fs.constants.X_OK);
  } catch {
    throw new Error(
      'Pinned Chromium prerequisite missing; run pnpm --filter web exec playwright install chromium before the gate.',
    );
  }
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    env: { PATH: environment.PATH, HOME: environment.HOME, LANG: 'C' },
  });
  assert.equal(result.status, 0, 'Chromium prerequisite version probe failed');
  assert.equal(
    result.stdout.trim().split(/\s+/).at(-1),
    pinned.browserVersion,
    'Chromium prerequisite differs from pinned Playwright browser',
  );
  return {
    executable,
    version: pinned.browserVersion,
    revision: pinned.revision,
    playwright: '1.63.0',
  };
}
