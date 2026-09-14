#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const HEADERS = [
  'Path',
  'Base-document evidence',
  'Durable information or open work',
  'Final disposition',
  'Destination kind',
  'Exact destination path and section',
  'Owner step',
  'Current verification and rationale',
  'Initial analyst',
  'Review decision',
  'Reviewer',
];

const ALLOWED_PAIRS = new Map([
  ['KEEP_ACTIVE', new Set(['ACTIVE_PLAN'])],
  ['REHOME_ACTIVE', new Set(['ACTIVE_PLAN'])],
  [
    'DISTILL_AND_DELETE',
    new Set(['MIGRATION_CONTROL', 'CURRENT', 'USEFUL', 'PACKAGE_DOCS']),
  ],
  ['DELETE', new Set(['NONE'])],
]);

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

export function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    throw new Error('Inventory table rows must start and end with a pipe');
  }
  const cells = [];
  let current = '';
  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const character = trimmed[index];
    if (character === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (character === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseInventory(markdown) {
  const lines = markdown.split('\n');
  let headerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) continue;
    let cells;
    try {
      cells = splitMarkdownTableRow(lines[index]);
    } catch {
      continue;
    }
    if (cells.join('\0') === HEADERS.join('\0')) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex === -1) throw new Error('Inventory table header is missing or invalid');
  let separatorCells;
  try {
    separatorCells = splitMarkdownTableRow(lines[headerIndex + 1] ?? '');
  } catch {
    throw new Error('Inventory table separator is missing');
  }
  if (
    separatorCells.length !== HEADERS.length ||
    separatorCells.some((cell) => !/^:?-{3,}:?$/.test(cell))
  ) {
    throw new Error('Inventory table separator is invalid');
  }

  const rows = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) break;
    const cells = splitMarkdownTableRow(lines[index]);
    if (cells.length !== HEADERS.length) {
      throw new Error(`Inventory row ${index + 1} has ${cells.length} cells; expected ${HEADERS.length}`);
    }
    rows.push(Object.fromEntries(HEADERS.map((header, cellIndex) => [header, cells[cellIndex]])));
  }
  if (rows.length === 0) throw new Error('Inventory table has no data rows');
  return rows;
}

function inventoryBaseCommit(markdown) {
  const match = markdown.match(/^- Inventory base commit:\s*`([0-9a-f]{40})`\s*$/m);
  if (!match) throw new Error('Inventory base commit must be a full SHA');
  return match[1];
}

function listBasePaths(repoRoot, baseCommit) {
  let output;
  try {
    output = execFileSync(
      'git',
      ['ls-tree', '-r', '-z', '--name-only', baseCommit, '--', 'docs/plans'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch {
    throw new Error('Unable to read inventory base commit');
  }
  return output
    .split('\0')
    .filter(Boolean)
    .map(toPosix)
    .filter((sourcePath) => /\.md$/i.test(sourcePath))
    .filter(
      (sourcePath) =>
        !sourcePath.startsWith('docs/plans/active/local-migration/'),
    )
    .sort(bytewiseCompare);
}

function addFinding(findings, reason, sourcePath = '', detail = '') {
  findings.push({ reason, path: sourcePath, detail });
}

function concreteText(value) {
  const normalized = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .replace(/^[-*+]\s+/, '')
    .trim();
  return (
    Boolean(normalized) &&
    !/^(?:tbd|todo|none|n\/a|not set|placeholder|to be determined)[.!]?$/i.test(
      normalized,
    )
  );
}

function sectionText(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^##\\s+${heading}\\s*$`, 'i').test(line),
  );
  if (start === -1) return '';
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,2}\s+/.test(lines[index])) break;
    body.push(lines[index]);
  }
  return body.join('\n');
}

function hasKeepActiveMetadata(markdown) {
  const status = markdown.match(/^- Status:\s*(.+)$/im)?.[1]?.trim() ?? '';
  const owner =
    markdown.match(/^- (?:Owner|Outcome owner):\s*(.+)$/im)?.[1]?.trim() ?? '';
  const reviewDate = markdown.match(
    /^- (?:Last reviewed|Review date|Last updated):\s*\d{4}-\d{2}-\d{2}\s*$/im,
  );
  const outcome = concreteText(sectionText(markdown, 'Outcome'));
  const nextActionSection = concreteText(sectionText(markdown, 'Next action'));
  const nextActionMetadata =
    markdown.match(/^- Next action:\s*(.+)$/im)?.[1]?.trim() ?? '';
  const nextAction = nextActionSection || concreteText(nextActionMetadata);
  return (
    Boolean(status) &&
    !/^(?:done|complete|completed|implemented|shipped|superseded|closed|tbd|todo)$/i.test(
      status,
    ) &&
    Boolean(owner) &&
    !/^(?:unassigned|none|tbd|todo|placeholder)(?:\b|$)/i.test(owner) &&
    Boolean(reviewDate) &&
    outcome &&
    nextAction
  );
}

function parseDestination(destination, { requireAnchor }) {
  const hashIndex = destination.indexOf('#');
  const hasOneHash = hashIndex !== -1 && hashIndex === destination.lastIndexOf('#');
  if ((requireAnchor && !hasOneHash) || (!requireAnchor && hashIndex !== -1)) {
    return null;
  }

  const targetPath = requireAnchor ? destination.slice(0, hashIndex) : destination;
  const anchor = requireAnchor ? destination.slice(hashIndex + 1) : null;
  const segments = targetPath.split('/');
  if (
    !targetPath ||
    path.posix.isAbsolute(targetPath) ||
    /^[A-Za-z]:\//.test(targetPath) ||
    /^~(?:\/|$)/.test(targetPath) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(targetPath) ||
    targetPath.includes('\\') ||
    targetPath.includes('%') ||
    targetPath.includes('?') ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(targetPath) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..') ||
    path.posix.normalize(targetPath) !== targetPath ||
    !/\.md$/i.test(targetPath)
  ) {
    return null;
  }
  if (
    requireAnchor &&
    (!anchor ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(anchor))
  ) {
    return null;
  }
  return { targetPath, anchor };
}

function hasExactPathCase(root, relativePath) {
  let current = root;
  for (const segment of relativePath.split('/')) {
    let entries;
    try {
      entries = fs.readdirSync(current);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    current = path.join(current, segment);
  }
  return true;
}

function headingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  let fence = null;
  let htmlComment = false;
  for (const rawLine of markdown.split('\n')) {
    if (fence) {
      const rawFenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (
        rawFenceMatch &&
        rawFenceMatch[1][0] === fence.character &&
        rawFenceMatch[1].length >= fence.length &&
        rawFenceMatch[2].trim() === ''
      ) {
        fence = null;
      }
      continue;
    }

    let line = '';
    let remainder = rawLine;
    while (remainder) {
      if (htmlComment) {
        const end = remainder.indexOf('-->');
        if (end === -1) {
          remainder = '';
          continue;
        }
        htmlComment = false;
        remainder = remainder.slice(end + 3);
        continue;
      }
      const start = remainder.indexOf('<!--');
      if (start === -1) {
        line += remainder;
        remainder = '';
        continue;
      }
      line += remainder.slice(0, start);
      remainder = remainder.slice(start + 4);
      htmlComment = true;
    }

    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (!heading) continue;
    const base = heading
      .trim()
      .toLocaleLowerCase('en-US')
      .replace(/<[^>]*>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-');
    if (!base) continue;
    const duplicateIndex = counts.get(base) ?? 0;
    counts.set(base, duplicateIndex + 1);
    anchors.add(duplicateIndex === 0 ? base : `${base}-${duplicateIndex}`);
  }
  return anchors;
}

function validateDestination({ repoRoot, row, findings }) {
  const sourcePath = row.Path;
  const disposition = row['Final disposition'];
  const kind = row['Destination kind'];
  const destination = row['Exact destination path and section'];
  const allowedKinds = ALLOWED_PAIRS.get(disposition);
  if (!allowedKinds || !allowedKinds.has(kind)) {
    addFinding(findings, 'invalid-disposition-destination-pair', sourcePath);
    return;
  }

  if (disposition === 'DELETE') {
    if (destination) addFinding(findings, 'delete-destination-must-be-empty', sourcePath);
    return;
  }

  if (!destination) {
    addFinding(findings, 'required-field-missing', sourcePath, 'destination');
    return;
  }

  const parsedDestination = parseDestination(destination, {
    requireAnchor: disposition !== 'KEEP_ACTIVE',
  });
  if (!parsedDestination) {
    addFinding(findings, 'invalid-destination-path-or-anchor', sourcePath);
    return;
  }
  const { targetPath, anchor } = parsedDestination;
  const resolvedTarget = path.resolve(repoRoot, targetPath);
  if (!isInside(repoRoot, resolvedTarget)) {
    addFinding(findings, 'invalid-destination-path-or-anchor', sourcePath);
    return;
  }
  if (disposition === 'KEEP_ACTIVE') {
    if (kind !== 'ACTIVE_PLAN' || targetPath !== sourcePath || !sourcePath.startsWith('docs/plans/active/')) {
      addFinding(findings, 'invalid-keep-active-destination', sourcePath);
    }
    return;
  }

  if (disposition === 'REHOME_ACTIVE') {
    if (!targetPath.startsWith('docs/plans/active/') || targetPath === sourcePath) {
      addFinding(findings, 'invalid-rehome-destination', sourcePath);
    }
    return;
  }

  const kindPrefixes = {
    MIGRATION_CONTROL: 'docs/plans/active/local-migration/',
    CURRENT: 'docs/current/',
    USEFUL: 'docs/useful/',
  };
  if (kindPrefixes[kind] && !targetPath.startsWith(kindPrefixes[kind])) {
    addFinding(findings, 'invalid-distillation-destination', sourcePath);
  }
  if (kind === 'PACKAGE_DOCS' && targetPath.startsWith('docs/plans/')) {
    addFinding(findings, 'invalid-distillation-destination', sourcePath);
  }
  if (kind === 'MIGRATION_CONTROL') {
    let markdown;
    try {
      const stat = fs.lstatSync(resolvedTarget);
      const realTarget = fs.realpathSync(resolvedTarget);
      if (
        !stat.isFile() ||
        !isInside(repoRoot, realTarget) ||
        !hasExactPathCase(repoRoot, targetPath)
      ) {
        throw new Error('Invalid migration-control destination');
      }
      markdown = fs.readFileSync(realTarget, 'utf8');
    } catch {
      addFinding(findings, 'migration-control-destination-missing', sourcePath);
      return;
    }
    if (!headingAnchors(markdown).has(anchor)) {
      addFinding(
        findings,
        'migration-control-destination-anchor-missing',
        sourcePath,
      );
    }
  }
}

function verifyLegacyBlob(repoRoot, baseCommit, sourcePath) {
  const currentPath = path.join(repoRoot, sourcePath);
  if (!fs.existsSync(currentPath)) return false;
  let baseBlob;
  try {
    baseBlob = execFileSync('git', ['show', `${baseCommit}:${sourcePath}`], {
      cwd: repoRoot,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false;
  }
  return Buffer.compare(baseBlob, fs.readFileSync(currentPath)) === 0;
}

export function validateInventory({
  repoRoot,
  inventoryPath,
  expectedBaseCommit,
  expectedCount,
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedBaseCommit ?? '')) {
    throw new Error('Expected base commit must be a full SHA');
  }
  if (!Number.isSafeInteger(expectedCount) || expectedCount <= 0) {
    throw new Error('Expected inventory count must be a positive integer');
  }
  const root = fs.realpathSync(repoRoot);
  const absoluteInventory = path.resolve(root, inventoryPath);
  if (!isInside(root, absoluteInventory)) {
    throw new Error('Inventory path escapes repository');
  }
  const markdown = fs.readFileSync(absoluteInventory, 'utf8');
  const findings = [];
  let declaredBaseCommit;
  let rows;
  try {
    declaredBaseCommit = inventoryBaseCommit(markdown);
    rows = parseInventory(markdown);
  } catch (error) {
    return [{ reason: 'inventory-parse-error', path: '', detail: error.message }];
  }

  if (declaredBaseCommit !== expectedBaseCommit) {
    addFinding(findings, 'inventory-base-commit-mismatch');
  }

  const expectedPaths = listBasePaths(root, expectedBaseCommit);
  if (expectedPaths.length !== expectedCount) {
    addFinding(
      findings,
      'inventory-base-count-mismatch',
      '',
      `expected ${expectedCount}; base contains ${expectedPaths.length}`,
    );
  }
  if (rows.length !== expectedCount) {
    addFinding(
      findings,
      'inventory-row-count-mismatch',
      '',
      `expected ${expectedCount}; inventory contains ${rows.length}`,
    );
  }

  const rowPaths = rows.map((row) => row.Path);
  const sortedRowPaths = [...rowPaths].sort(bytewiseCompare);
  const firstOrderMismatch = rowPaths.findIndex(
    (sourcePath, index) => sourcePath !== sortedRowPaths[index],
  );
  if (firstOrderMismatch !== -1) {
    addFinding(
      findings,
      'inventory-path-order',
      rowPaths[firstOrderMismatch] ?? '',
    );
  }

  const expectedSet = new Set(expectedPaths);
  const rowsByPath = new Map();

  for (const row of rows) {
    const sourcePath = row.Path;
    if (!sourcePath) {
      addFinding(findings, 'required-field-missing', '', 'Path');
      continue;
    }
    if (rowsByPath.has(sourcePath)) {
      addFinding(findings, 'duplicate-inventory-path', sourcePath);
    } else {
      rowsByPath.set(sourcePath, row);
    }

    const requiredFields = [
      'Base-document evidence',
      'Durable information or open work',
      'Final disposition',
      'Destination kind',
      'Owner step',
      'Current verification and rationale',
      'Initial analyst',
      'Review decision',
      'Reviewer',
    ];
    for (const field of requiredFields) {
      if (!row[field]) addFinding(findings, 'required-field-missing', sourcePath, field);
    }

    validateDestination({ repoRoot: root, row, findings });
    if (row['Review decision'] !== 'Approved') {
      addFinding(findings, 'row-not-approved', sourcePath);
    }
    if (
      row['Initial analyst'] &&
      row.Reviewer &&
      row['Initial analyst'] === row.Reviewer
    ) {
      addFinding(findings, 'reviewer-not-independent', sourcePath);
    }

    if (row['Final disposition'] === 'KEEP_ACTIVE') {
      try {
        const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
        if (!hasKeepActiveMetadata(source)) {
          addFinding(findings, 'keep-active-metadata-missing', sourcePath);
        }
      } catch {
        addFinding(findings, 'keep-active-metadata-missing', sourcePath);
      }
    }
  }

  for (const expectedPath of expectedPaths) {
    if (!rowsByPath.has(expectedPath)) {
      addFinding(findings, 'missing-inventory-path', expectedPath);
    }
    if (!verifyLegacyBlob(root, expectedBaseCommit, expectedPath)) {
      addFinding(findings, 'legacy-blob-changed', expectedPath);
    }
  }
  for (const sourcePath of rowsByPath.keys()) {
    if (!expectedSet.has(sourcePath)) {
      addFinding(findings, 'unexpected-inventory-path', sourcePath);
    }
  }

  return findings.sort((left, right) => {
    const pathOrder = bytewiseCompare(left.path, right.path);
    if (pathOrder !== 0) return pathOrder;
    const reasonOrder = bytewiseCompare(left.reason, right.reason);
    if (reasonOrder !== 0) return reasonOrder;
    return bytewiseCompare(left.detail, right.detail);
  });
}

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Git discovery failed');
  }
}

export function parseInventoryCliArgs(args) {
  const options = {
    expectedBaseCommit: null,
    expectedCount: null,
    inventoryPath: null,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') {
      if (options.help) throw new Error('Duplicate --help option');
      options.help = true;
    } else if (argument === '--expected-base') {
      if (options.expectedBaseCommit !== null || !args[index + 1]) {
        throw new Error('--expected-base requires one value');
      }
      options.expectedBaseCommit = args[++index];
    } else if (argument === '--expected-count') {
      if (options.expectedCount !== null || !args[index + 1]) {
        throw new Error('--expected-count requires one value');
      }
      const value = args[++index];
      if (!/^[1-9][0-9]*$/.test(value)) {
        throw new Error('--expected-count requires a positive integer');
      }
      options.expectedCount = Number(value);
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (options.inventoryPath === null) {
      options.inventoryPath = argument;
    } else {
      throw new Error('Expected one inventory path');
    }
  }

  if (options.help) {
    if (args.length !== 1) throw new Error('--help cannot be combined with other arguments');
    return options;
  }
  if (
    !/^[0-9a-f]{40}$/.test(options.expectedBaseCommit ?? '') ||
    !Number.isSafeInteger(options.expectedCount) ||
    !options.inventoryPath
  ) {
    throw new Error('Expected a pinned base, count, and inventory path');
  }
  return options;
}

function main() {
  try {
    const options = parseInventoryCliArgs(process.argv.slice(2));
    if (options.help) {
      console.log(
        'Usage: node scripts/check-doc-plan-inventory.mjs --expected-base FULL_SHA --expected-count COUNT INVENTORY_PATH',
      );
      return 0;
    }
    const repoRoot = fs.realpathSync(gitTopLevel(process.cwd()));
    const findings = validateInventory({
      repoRoot,
      inventoryPath: options.inventoryPath,
      expectedBaseCommit: options.expectedBaseCommit,
      expectedCount: options.expectedCount,
    });
    for (const finding of findings) {
      const suffix = finding.detail ? ` (${finding.detail})` : '';
      console.log(`${finding.path || '<inventory>'} [${finding.reason}]${suffix}`);
    }
    if (findings.length > 0) {
      console.error(`Inventory validation found ${findings.length} issue(s).`);
      return 1;
    }
    console.log('Inventory validation passed.');
    return 0;
  } catch {
    console.error('Inventory validation failed due to an operational or configuration error.');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
