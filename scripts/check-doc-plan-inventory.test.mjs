import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseInventoryCliArgs,
  splitMarkdownTableRow,
  validateInventory,
} from './check-doc-plan-inventory.mjs';

const INVENTORY_SCRIPT = fileURLToPath(
  new URL('./check-doc-plan-inventory.mjs', import.meta.url),
);

const HEADER =
  '| Path | Base-document evidence | Durable information or open work | Final disposition | Destination kind | Exact destination path and section | Owner step | Current verification and rationale | Initial analyst | Review decision | Reviewer |';
const SEPARATOR =
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function makeRepo({ activeMetadata = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-router-inventory-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'inventory@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Inventory Test'], { cwd: root });
  const source = path.join(root, 'docs/plans/active/topic.md');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(
    source,
    activeMetadata
      ? '# Topic\n\n- Status: active\n- Owner: docs-team\n- Review date: 2026-10-01\n\n## Outcome\nKeep this useful plan.\n\n## Next action\nRun the experiment.\n'
      : '# Topic\n\nUnowned notes.\n',
  );
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return {
    root,
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  };
}

function writeInventory(root, baseCommit, row) {
  const relativePath =
    'docs/plans/active/local-migration/00-document-consolidation/inventory.md';
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    [
      '# Inventory',
      '',
      `- Inventory base commit: \`${baseCommit}\``,
      '',
      HEADER,
      SEPARATOR,
      ...(Array.isArray(row) ? row : [row]),
      '',
    ].join('\n'),
  );
  return relativePath;
}

function validate(root, baseCommit, inventoryPath, expectedCount = 1) {
  return validateInventory({
    repoRoot: root,
    inventoryPath,
    expectedBaseCommit: baseCommit,
    expectedCount,
  });
}

function deleteRow(overrides = {}) {
  const values = {
    path: 'docs/plans/active/topic.md',
    evidence: 'Heading `Topic`; contains reviewed notes',
    durable: 'None',
    disposition: 'DELETE',
    kind: 'NONE',
    destination: '',
    owner: '00C',
    rationale: 'No adopted decision or unfinished work remains',
    analyst: 'analyst-a',
    decision: 'Approved',
    reviewer: 'reviewer-b',
    ...overrides,
  };
  return `| ${values.path} | ${values.evidence} | ${values.durable} | ${values.disposition} | ${values.kind} | ${values.destination} | ${values.owner} | ${values.rationale} | ${values.analyst} | ${values.decision} | ${values.reviewer} |`;
}

test('splits escaped pipes without changing cell content', () => {
  assert.deepEqual(splitMarkdownTableRow('| one | A \\| B | three |'), [
    'one',
    'A | B',
    'three',
  ]);
});

test('accepts an exact, independently approved inventory', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, baseCommit, deleteRow());
  assert.deepEqual(validate(root, baseCommit, inventoryPath), []);
});

test('accepts a proposed Markdown package-document destination', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({
      durable: 'Benchmark-family contributor guidance',
      disposition: 'DISTILL_AND_DELETE',
      kind: 'PACKAGE_DOCS',
      destination: 'examples/eval/PLAYBOOK.md#benchmark-families',
      owner: '00B',
    }),
  );
  assert.deepEqual(validate(root, baseCommit, inventoryPath), []);
});

test('rejects a non-Markdown package-document destination', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({
      durable: 'Benchmark-family contributor guidance',
      disposition: 'DISTILL_AND_DELETE',
      kind: 'PACKAGE_DOCS',
      destination: 'examples/eval/config.ts#benchmark-families',
      owner: '00B',
    }),
  );
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('invalid-destination-path-or-anchor'));
});

test('rejects path-set mismatches, invalid pairs, and non-independent review', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({
      path: 'docs/plans/active/wrong.md',
      kind: 'ACTIVE_PLAN',
      analyst: 'same-agent',
      reviewer: 'same-agent',
    }),
  );
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('missing-inventory-path'));
  assert.ok(reasons.includes('unexpected-inventory-path'));
  assert.ok(reasons.includes('invalid-disposition-destination-pair'));
  assert.ok(reasons.includes('reviewer-not-independent'));
});

test('rejects a legacy source changed after the recorded base commit', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, baseCommit, deleteRow());
  fs.appendFileSync(path.join(root, 'docs/plans/active/topic.md'), '\nChanged.\n');
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('legacy-blob-changed'));
});

test('requires KEEP_ACTIVE source metadata', () => {
  const { root, baseCommit } = makeRepo({ activeMetadata: false });
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({
      durable: 'Unfinished experiment',
      disposition: 'KEEP_ACTIVE',
      kind: 'ACTIVE_PLAN',
      destination: 'docs/plans/active/topic.md',
      owner: 'independent-active-plan',
      rationale: 'Work is still active',
    }),
  );
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('keep-active-metadata-missing'));
});

test('requires concrete KEEP_ACTIVE outcome and next-action content', () => {
  const { root } = makeRepo();
  fs.writeFileSync(
    path.join(root, 'docs/plans/active/topic.md'),
    [
      '# Topic',
      '',
      '- Status: active',
      '- Owner: docs-team',
      '- Review date: 2026-10-01',
      '',
      '## Outcome',
      '',
      '## Next action',
      '',
      'TBD',
      '',
    ].join('\n'),
  );
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'empty active sections'], { cwd: root });
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({
      durable: 'Unfinished experiment',
      disposition: 'KEEP_ACTIVE',
      kind: 'ACTIVE_PLAN',
      destination: 'docs/plans/active/topic.md',
      owner: 'independent-active-plan',
      rationale: 'Work is still active',
    }),
  );
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('keep-active-metadata-missing'));
});

test('rejects pending or incomplete evidence fields', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({ evidence: '', rationale: '', decision: 'Pending', reviewer: '' }),
  );
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('required-field-missing'));
  assert.ok(reasons.includes('row-not-approved'));
});

test('pins the inventory base commit and expected source count', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, 'a'.repeat(40), deleteRow());
  const findings = validate(root, baseCommit, inventoryPath, 2);
  const reasons = findings.map(({ reason }) => reason);
  assert.ok(reasons.includes('inventory-base-commit-mismatch'));
  assert.ok(reasons.includes('inventory-base-count-mismatch'));
  assert.ok(!reasons.includes('missing-inventory-path'));
  assert.ok(!reasons.includes('legacy-blob-changed'));
});

test('rejects duplicate rows and a row-count mismatch', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, baseCommit, [deleteRow(), deleteRow()]);
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('duplicate-inventory-path'));
  assert.ok(reasons.includes('inventory-row-count-mismatch'));
});

test('requires an actual Markdown table separator', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, baseCommit, deleteRow());
  const absolutePath = path.join(root, inventoryPath);
  fs.writeFileSync(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8').replace(
      SEPARATOR,
      deleteRow({ evidence: 'This data row must not be discarded as a separator' }),
    ),
  );
  const reasons = validate(root, baseCommit, inventoryPath).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('inventory-parse-error'));
});

test('requires bytewise inventory path order', () => {
  const { root } = makeRepo();
  const secondPath = path.join(root, 'docs/plans/active/Alpha.md');
  fs.writeFileSync(secondPath, '# Alpha\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'second legacy plan'], { cwd: root });
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const inventoryPath = writeInventory(root, baseCommit, [
    deleteRow(),
    deleteRow({ path: 'docs/plans/active/Alpha.md' }),
  ]);
  const reasons = validate(root, baseCommit, inventoryPath, 2).map(
    ({ reason }) => reason,
  );
  assert.ok(reasons.includes('inventory-path-order'));
});

test('requires canonical repository-relative Markdown destinations and anchors', () => {
  const invalidDestinations = [
    { destination: '/docs/current/x.md#x', kind: 'CURRENT' },
    { destination: 'docs/current/../x.md#x', kind: 'CURRENT' },
    { destination: 'docs\\current\\x.md#x', kind: 'CURRENT' },
    { destination: 'docs/current/x.md#', kind: 'CURRENT' },
    { destination: 'C:/outside.md#x', kind: 'PACKAGE_DOCS' },
    { destination: 'file:/outside.md#x', kind: 'PACKAGE_DOCS' },
    { destination: 'https:/example.com/x.md#x', kind: 'PACKAGE_DOCS' },
    { destination: '~/x.md#x', kind: 'PACKAGE_DOCS' },
    { destination: 'examples/eval/\u202espoof.md#x', kind: 'PACKAGE_DOCS' },
    { destination: 'examples/eval/\u0085spoof.md#x', kind: 'PACKAGE_DOCS' },
    { destination: 'examples/eval/\u2028spoof.md#x', kind: 'PACKAGE_DOCS' },
    {
      destination: 'docs/current/%2e%2e/useful/x.md#x',
      kind: 'CURRENT',
    },
  ];
  for (const { destination, kind } of invalidDestinations) {
    const { root, baseCommit } = makeRepo();
    const inventoryPath = writeInventory(
      root,
      baseCommit,
      deleteRow({
        durable: 'Current behavior',
        disposition: 'DISTILL_AND_DELETE',
        kind,
        destination,
        owner: '00B',
      }),
    );
    const reasons = validate(root, baseCommit, inventoryPath).map(
      ({ reason }) => reason,
    );
    assert.ok(
      reasons.includes('invalid-destination-path-or-anchor'),
      destination,
    );
  }

  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(
    root,
    baseCommit,
    deleteRow({
      durable: 'Current behavior',
      disposition: 'DISTILL_AND_DELETE',
      kind: 'CURRENT',
      destination: 'docs/current/x.md#x',
      owner: '00B',
    }),
  );
  assert.deepEqual(validate(root, baseCommit, inventoryPath), []);
});

test('requires a real heading for migration-control destinations', () => {
  const { root, baseCommit } = makeRepo();
  const controlPath = path.join(
    root,
    'docs/plans/active/local-migration/orchestration.md',
  );
  fs.mkdirSync(path.dirname(controlPath), { recursive: true });
  fs.writeFileSync(
    controlPath,
    [
      '# Orchestration',
      '',
      '```md',
      '## Fenced Heading',
      '```not-a-closing-fence',
      '## Phantom Anchor',
      '``` <!-- literal code, not a close -->',
      '## Still Fenced',
      '```',
      '',
      '<!--',
      '## Commented Anchor',
      '-->',
      '',
      '## Planning Inputs That Must Not Be Lost',
      '',
    ].join('\n'),
  );
  const row = (anchor) =>
    deleteRow({
      durable: 'Migration input',
      disposition: 'DISTILL_AND_DELETE',
      kind: 'MIGRATION_CONTROL',
      destination: `docs/plans/active/local-migration/orchestration.md#${anchor}`,
      owner: '01-contract-baseline-and-product-scope',
    });

  let inventoryPath = writeInventory(
    root,
    baseCommit,
    row('planning-inputs-that-must-not-be-lost'),
  );
  assert.deepEqual(validate(root, baseCommit, inventoryPath), []);

  for (const invalidAnchor of [
    'fenced-heading',
    'phantom-anchor',
    'still-fenced',
    'commented-anchor',
  ]) {
    inventoryPath = writeInventory(root, baseCommit, row(invalidAnchor));
    const reasons = validate(root, baseCommit, inventoryPath).map(
      ({ reason }) => reason,
    );
    assert.ok(
      reasons.includes('migration-control-destination-anchor-missing'),
      invalidAnchor,
    );
  }
});

test('requires pinned CLI arguments and returns operational status for bad input', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, baseCommit, deleteRow());
  assert.deepEqual(
    parseInventoryCliArgs([
      '--expected-count',
      '1',
      inventoryPath,
      '--expected-base',
      baseCommit,
    ]),
    {
      expectedBaseCommit: baseCommit,
      expectedCount: 1,
      inventoryPath,
      help: false,
    },
  );

  const valid = spawnSync(
    process.execPath,
    [
      INVENTORY_SCRIPT,
      '--expected-base',
      baseCommit,
      '--expected-count',
      '1',
      inventoryPath,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(valid.status, 0, valid.stderr);

  for (const args of [
    [INVENTORY_SCRIPT, inventoryPath],
    [
      INVENTORY_SCRIPT,
      '--expected-base',
      baseCommit,
      '--expected-count',
      '0',
      inventoryPath,
    ],
    [
      INVENTORY_SCRIPT,
      '--unknown',
      '--expected-base',
      baseCommit,
      '--expected-count',
      '1',
      inventoryPath,
    ],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stderr);
  }
});

test('fails closed when a shallow clone lacks the pinned base object', () => {
  const { root, baseCommit } = makeRepo();
  const inventoryPath = writeInventory(root, baseCommit, deleteRow());
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'inventory'], { cwd: root });

  const cloneParent = makeDirectoryForClone();
  const clone = path.join(cloneParent, 'shallow');
  execFileSync(
    'git',
    ['clone', '-q', '--depth', '1', `file://${root}`, clone],
    { cwd: cloneParent },
  );
  const result = spawnSync(
    process.execPath,
    [
      INVENTORY_SCRIPT,
      '--expected-base',
      baseCommit,
      '--expected-count',
      '1',
      inventoryPath,
    ],
    { cwd: clone, encoding: 'utf8' },
  );
  assert.equal(result.status, 2, result.stderr);
});

function makeDirectoryForClone() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-router-clone-'));
}
