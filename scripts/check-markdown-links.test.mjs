import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  compareWithBaseline,
  createBaseline,
  discoverMarkdownFiles,
  extractMarkdownDestinations,
  findLinkViolations,
  formatFinding,
  parseCliArgs,
  validateBaselineAgainstBase,
} from './check-markdown-links.mjs';

const LINK_SCRIPT = fileURLToPath(
  new URL('./check-markdown-links.mjs', import.meta.url),
);

function makeDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-router-links-'));
}

function write(root, relativePath, contents = '') {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function initializeGit(root) {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'docs-test@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Docs Test'], { cwd: root });
}

test('extracts supported Markdown destinations and ignores code and HTML', () => {
  const markdown = [
    '[plain](docs/file.md)',
    '![image](assets/image.png "preview")',
    '[space](<docs/space file.md>)',
    '[nested](docs/a_(b).md?raw=1#part)',
    '[escaped](docs/a_\\(b\\).md)',
    '[remote](https://example.com/docs)',
    '[fragment](#local-heading)',
    '`[inline-code](missing-inline.md)`',
    '<a href="missing-html.md">raw HTML is out of scope</a>',
    '```md',
    '[fenced](missing-fenced.md)',
    '```',
    '[ref][target]',
    '[collapsed][]',
    '[undefined][missing-definition]',
    '[target]: docs/reference.md "Reference"',
    '[collapsed]: <docs/collapsed file.md>',
  ].join('\n');

  assert.deepEqual(
    extractMarkdownDestinations(markdown).map(({ target }) => target),
    [
      'docs/file.md',
      'assets/image.png',
      'docs/space file.md',
      'docs/a_(b).md?raw=1#part',
      'docs/a_(b).md',
      'https://example.com/docs',
      '#local-heading',
      'docs/reference.md',
      'docs/collapsed file.md',
    ],
  );
});

test('does not let fenced-looking text inside HTML blocks hide later links', () => {
  const markdown = [
    '<!--',
    '```md',
    '[commented](commented.md)',
    '-->',
    '[visible](visible.md)',
    '```md',
    '<!--',
    '```',
    '[also-visible](also-visible.md)',
  ].join('\n');
  assert.deepEqual(extractMarkdownDestinations(markdown), [
    { target: 'visible.md', line: 5 },
    { target: 'also-visible.md', line: 9 },
  ]);

  for (const containerMarkdown of [
    ['> <!--', '> [hidden](hidden.md)', '', '[visible](visible.md)'].join(
      '\n',
    ),
    ['- <!--', '  [hidden](hidden.md)', '', '[visible](visible.md)'].join(
      '\n',
    ),
  ]) {
    assert.deepEqual(extractMarkdownDestinations(containerMarkdown), [
      { target: 'visible.md', line: 4 },
    ]);
  }

  for (const htmlMarkdown of [
    ['<script>', '```md', '</script>', '[visible](visible.md)'].join('\n'),
    ['<pre>', '~~~', '</pre>', '[visible](visible.md)'].join('\n'),
    ['<script>', '</pre>', '[visible](visible.md)'].join('\n'),
    ['<style>', '</textarea>', '[visible](visible.md)'].join('\n'),
  ]) {
    assert.deepEqual(extractMarkdownDestinations(htmlMarkdown), [
      {
        target: 'visible.md',
        line: htmlMarkdown.split('\n').length,
      },
    ]);
  }

  assert.deepEqual(
    extractMarkdownDestinations(
      ['<del>', '```md', '</del>', '', '[visible](visible.md)'].join('\n'),
    ),
    [{ target: 'visible.md', line: 5 }],
  );
  assert.deepEqual(
    extractMarkdownDestinations(
      [
        '[x]: docs/x.md',
        '<del>',
        '```md',
        '</del>',
        '',
        '[visible](visible.md)',
      ].join('\n'),
    ),
    [
      { target: 'visible.md', line: 6 },
      { target: 'docs/x.md', line: 1 },
    ],
  );

  assert.deepEqual(
    extractMarkdownDestinations(
      [
        '<x data-value="ok" disabled>',
        '```md',
        '</x>',
        '',
        '[visible](visible.md)',
      ].join('\n'),
    ),
    [{ target: 'visible.md', line: 5 }],
  );
  for (const malformedTag of [
    '<x [visible](visible.md)>',
    '<x @ [visible](visible.md)>',
    '<x a==b [visible](visible.md)>',
  ]) {
    assert.deepEqual(extractMarkdownDestinations(malformedTag), [
      { target: 'visible.md', line: 1 },
    ]);
  }

  for (const closingTag of ['script', 'pre']) {
    assert.deepEqual(
      extractMarkdownDestinations(
        `</${closingTag}> [visible](visible.md)`,
      ),
      [{ target: 'visible.md', line: 1 }],
    );
  }
});

test('abandons malformed outer links so nested active links remain visible', () => {
  for (const [markdown, line] of [
    ['[bad](exists.md [visible](visible.md))', 1],
    ['[bad](<exists.md> [visible](visible.md))', 1],
    [['[bad](exists.md', '', '"[visible](visible.md)")'].join('\n'), 3],
    [['[bad](exists.md "title', '', '[visible](visible.md)")'].join('\n'), 3],
    [['[bad](', '', '[visible](visible.md))'].join('\n'), 3],
    ['[bad\n\n[visible](visible.md)](https://example.com)', 3],
    ['[bad\n# heading\n[visible](visible.md)](https://example.com)', 3],
    ['[bad](https://example.com/(\n[visible](visible.md)\n))', 2],
    ['[bad](<https://example.com/\r[visible](visible.md)>)', 2],
    ['[bad](https://example.com "title\n# heading\n[visible](visible.md)")', 3],
  ]) {
    assert.deepEqual(extractMarkdownDestinations(markdown), [
      {
        target: 'visible.md',
        line,
      },
    ]);
  }
});

test('extracts container-scoped and next-line reference definitions', () => {
  const cases = [
    {
      markdown: '> [x]: /etc/passwd\n> [x][]',
      expected: [{ target: '/etc/passwd', line: 1 }],
    },
    {
      markdown: '- [x]: /etc/passwd\n  [x][]',
      expected: [{ target: '/etc/passwd', line: 1 }],
    },
    {
      markdown: '[x]:\n  /etc/passwd\n\n[x][]',
      expected: [{ target: '/etc/passwd', line: 2 }],
    },
    {
      markdown: '[x]:\n    /etc/passwd\n\n[x][]',
      expected: [{ target: '/etc/passwd', line: 2 }],
    },
    {
      markdown: '[x]:\n\t/etc/passwd\n\n[x][]',
      expected: [{ target: '/etc/passwd', line: 2 }],
    },
    {
      markdown: '[\nx\n]: /etc/passwd\n\n[x][]',
      expected: [{ target: '/etc/passwd', line: 3 }],
    },
    {
      markdown: '> [\n> x\n> ]: /etc/passwd\n\n[x][]',
      expected: [{ target: '/etc/passwd', line: 3 }],
    },
    {
      markdown: '[x]: /Users/\u00a0secret.md',
      expected: [{ target: '/Users/\u00a0secret.md', line: 1 }],
    },
    {
      markdown: '[x]: /Users/\u2028secret.md',
      expected: [{ target: '/Users/\u2028secret.md', line: 1 }],
    },
    {
      markdown: '[x]: /Users/\u2029secret.md',
      expected: [{ target: '/Users/\u2029secret.md', line: 1 }],
    },
  ];
  for (const { markdown, expected } of cases) {
    assert.deepEqual(extractMarkdownDestinations(markdown), expected);
  }
});

test('parses nested labels and ignores escaped links and container code spans', () => {
  const markdown = [
    '[nested [label]](docs/nested.md)',
    '\\[escaped](missing-escaped.md)',
    String.raw`\\[even](docs/even.md)`,
    String.raw`[escaped \] label](docs/escaped-label.md)`,
    '[nested [reference]]: docs/reference.md',
    '> ```md',
    '> [quoted fence](missing-quote.md)',
    '> ```',
    '- ~~~md',
    '  [list fence](missing-list.md)',
    '  ~~~',
    '`multiline code starts',
    '[inside code](missing-multiline.md)',
    'multiline code ends`',
    '``double multiline code starts',
    '[inside double code](missing-double.md)',
    'double multiline code ends``',
    '    ```md',
    '[after indented literal](docs/after-indented.md)',
  ].join('\n');

  assert.deepEqual(extractMarkdownDestinations(markdown), [
    { target: 'docs/nested.md', line: 1 },
    { target: 'docs/even.md', line: 3 },
    { target: 'docs/escaped-label.md', line: 4 },
    { target: 'docs/after-indented.md', line: 19 },
    { target: 'docs/reference.md', line: 5 },
  ]);
});

test('gives nested links precedence while retaining nested images', () => {
  assert.deepEqual(
    extractMarkdownDestinations(
      '[outer [inner](visible.md)](https://example.com)',
    ),
    [{ target: 'visible.md', line: 1 }],
  );
  assert.deepEqual(
    extractMarkdownDestinations(
      '[outer ![image](image.png)](https://example.com)',
    ),
    [
      { target: 'image.png', line: 1 },
      { target: 'https://example.com', line: 1 },
    ],
  );
  for (const markdown of [
    '![<https://e/a]b>](/etc/passwd)',
    '![<x title="]">x</x>](/etc/passwd)',
  ]) {
    assert.deepEqual(extractMarkdownDestinations(markdown), [
      { target: '/etc/passwd', line: 1 },
    ]);
  }
});

test('keeps fenced-code state within its blockquote or list container', () => {
  const cases = [
    {
      markdown: [
        '> ~~~md',
        '> [hidden](hidden.md)',
        '',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 4 }],
    },
    {
      markdown: [
        '> ~~~md',
        '> [hidden](hidden.md)',
        '',
        '> [visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 4 }],
    },
    {
      markdown: [
        '- ~~~md',
        '  [hidden](hidden.md)',
        '',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 4 }],
    },
    {
      markdown: [
        '> ~~~md',
        '> [hidden](hidden.md)',
        '~~~',
        '[inside-root](inside.md)',
        '~~~',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 6 }],
    },
    {
      markdown: [
        '10. item',
        '',
        '    ~~~md',
        '    [hidden](hidden.md)',
        '    ~~~',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 6 }],
    },
    {
      markdown: [
        '- ~~~md',
        '  [hidden-a](a.md)',
        '',
        '  [hidden-b](b.md)',
        '  ~~~',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 6 }],
    },
    {
      markdown: ['```bad`info', '[visible](visible.md)'].join('\n'),
      expected: [{ target: 'visible.md', line: 2 }],
    },
    {
      markdown: [
        '- - ~~~md',
        '    [hidden](hidden.md)',
        '    ~~~',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 4 }],
    },
    {
      markdown: [
        '- > ~~~md',
        '  > [hidden](hidden.md)',
        '  > ~~~',
        '[visible](visible.md)',
      ].join('\n'),
      expected: [{ target: 'visible.md', line: 4 }],
    },
    {
      markdown: ['-     ~~~md', '  [visible](visible.md)'].join('\n'),
      expected: [{ target: 'visible.md', line: 2 }],
    },
    {
      markdown: ['-\t```md', '  [visible](visible.md)'].join('\n'),
      expected: [{ target: 'visible.md', line: 2 }],
    },
    {
      markdown: ['-\t~~~md', '  [visible](visible.md)'].join('\n'),
      expected: [{ target: 'visible.md', line: 2 }],
    },
    {
      markdown: ['1.\t```md', '   [visible](visible.md)'].join('\n'),
      expected: [{ target: 'visible.md', line: 2 }],
    },
    {
      markdown: ['>\t- ```md', '>   [visible](visible.md)'].join('\n'),
      expected: [{ target: 'visible.md', line: 2 }],
    },
  ];
  for (const { markdown, expected } of cases) {
    assert.deepEqual(extractMarkdownDestinations(markdown), expected);
  }
});

test('does not apply backslash escaping inside code spans', () => {
  const markdown = '`[hidden](hidden.md)\\` [visible](visible.md) later`';
  assert.deepEqual(extractMarkdownDestinations(markdown), [
    { target: 'visible.md', line: 1 },
  ]);
});

test('does not open code spans from backticks inside tighter-binding syntax', () => {
  for (const { markdown, expected } of [
    {
      markdown: '[remote](https://example.com/`)\n[visible](visible.md)\n`',
      expected: ['https://example.com/`', 'visible.md'],
    },
    {
      markdown: '[local](docs/a`b.md)\n[visible](visible.md)\n`',
      expected: ['docs/a`b.md', 'visible.md'],
    },
    {
      markdown: '<https://example.com/`>\n[visible](visible.md)\n`',
      expected: ['https://example.com/`', 'visible.md'],
    },
    {
      markdown: '<a title="`">x</a>\n[visible](visible.md)\n`',
      expected: ['visible.md'],
    },
    {
      markdown: '[x]: docs/a`b.md\n[visible](visible.md)\n`',
      expected: ['visible.md', 'docs/a`b.md'],
    },
    {
      markdown: [
        '[x]: docs/x.md "',
        'title `',
        '"',
        '[visible](visible.md)',
        '`',
      ].join('\n'),
      expected: ['visible.md', 'docs/x.md'],
    },
  ]) {
    assert.deepEqual(
      extractMarkdownDestinations(markdown).map(({ target }) => target),
      expected,
    );
  }
});

test('does not let multiline code spans cross whitespace-only paragraphs', () => {
  for (const markdown of [
    ['`unmatched', '   ', '[visible](visible.md)', 'later`'].join('\n'),
    '`unmatched\r\n \t\r\n[visible](visible.md)\r\nlater`',
    ['`unmatched', '# [visible](visible.md) later`'].join('\n'),
    ['`code', '    [inside](inside.md)`', '[visible](visible.md)'].join('\n'),
    ['`open', '<script>', '</script>', '[visible](visible.md)', '`'].join('\n'),
    ['`open', '=', '[visible](visible.md)', '`'].join('\n'),
    ['`open', '--', '[visible](visible.md)', '`'].join('\n'),
  ]) {
    assert.deepEqual(extractMarkdownDestinations(markdown), [
      {
        target: 'visible.md',
        line: markdown.includes('# [visible]')
          ? 2
          : markdown.includes('<script>')
            ? 4
            : 3,
      },
    ]);
  }

  const crOnly = '`open\r\r[visible](visible.md)\r`';
  assert.deepEqual(extractMarkdownDestinations(crOnly), [
    { target: 'visible.md', line: 3 },
  ]);

  assert.deepEqual(
    extractMarkdownDestinations(
      [
        '10. `open',
        '    # heading',
        '    [visible](visible.md)',
        '    `',
      ].join('\n'),
    ),
    [{ target: 'visible.md', line: 3 }],
  );
  assert.deepEqual(
    extractMarkdownDestinations(
      [
        '10. [bad](https://example.com "title',
        '    # heading',
        '    [visible](visible.md)")',
      ].join('\n'),
    ),
    [{ target: 'visible.md', line: 3 }],
  );
  assert.deepEqual(
    extractMarkdownDestinations(
      ['``open', '```bad`info', '[hidden](hidden.md)', '``'].join('\n'),
    ),
    [],
  );
});

test('accepts in-repository files and directories', () => {
  const root = makeDirectory();
  write(
    root,
    'README.md',
    [
      '[file](docs/file.md)',
      '[dir](docs/)',
      '[query](docs/file.md?x=1&amp;y=2)',
      '[fragment](docs/file.md#x&amp;y)',
      '[remote](https://example.com/?x=1&amp;y=2)',
      '[remote-path](https://example.com/f&auml;)',
      '[encoded-scheme](https%3A%2F%2Fexample.invalid%2Fexisting.md)',
    ].join('\n'),
  );
  write(root, 'docs/file.md', '# File\n');
  write(root, 'https:/example.invalid/existing.md', '# Encoded path\n');

  assert.deepEqual(findLinkViolations({ repoRoot: root, files: ['README.md'] }), []);
});

test('reports missing, malformed, escaping, and absolute targets without leaking them', () => {
  const root = makeDirectory();
  write(
    root,
    'docs/source.md',
    [
      '[missing](missing.md)',
      '[encoded-scheme](https%3A%2F%2Fexample.invalid%2Fmissing.md)',
      '[escape](../../outside.md)',
      '[posix](/Users/private/secret.md)',
      '[home](~/secret.md)',
      '[windows](C:/Users/private/secret.md)',
      '[unc](//server/private/secret.md)',
      '[file](file:///Users/private/secret.md)',
      '[bad](bad%ZZ.md)',
      '[encoded-posix](%2FUsers%2Fprivate%2Fsecret.md)',
      '[encoded-home](%7E%2Fprivate%2Fsecret.md)',
      '[encoded-windows](C:%5CUsers%5Cprivate%5Csecret.md)',
      '[encoded-unc](%2F%2Fserver%2Fprivate%2Fsecret.md)',
      '[encoded-backslash-unc](%5C%5Cserver%5Cprivate%5Csecret.md)',
      '[encoded-file](file%3A%2F%2F%2FUsers%2Fprivate%2Fsecret.md)',
      '[control](safe%0Ainjected.md)',
      '[escape-control](safe%1Binjected.md)',
      '[bidi-control](safe%E2%80%AEinjected.md)',
      String.raw`[escaped-posix](\/Users/private/secret.md)`,
      String.raw`[escaped-file](file\:///Users/private/secret.md)`,
      String.raw`[escaped-home](\~/private/secret.md)`,
      String.raw`[escaped-windows](C\:/Users/private/secret.md)`,
      String.raw`[escaped-unc](\/\/server/private/secret.md)`,
      '[entity-posix](&#47;Users/private/secret.md)',
      '[entity-file](file&#58;&#47;&#47;&#47;Users/private/secret.md)',
      '<file:///Users/private/secret.md>',
      '<FILE://server/share/file.md>',
      '[unicode-nbsp](/Users/\u00a0secret.md)',
      '[unicode-line-separator](/Users/\u2028secret.md)',
      '[unicode-paragraph-separator](/Users/\u2029secret.md)',
    ].join('\n'),
  );

  const findings = findLinkViolations({ repoRoot: root, files: ['docs/source.md'] });
  assert.deepEqual(
    findings.map(({ reason }) => reason),
    [
      'missing-target',
      'missing-target',
      'target-outside-repository',
      'absolute-posix-target',
      'home-relative-target',
      'absolute-windows-target',
      'unc-target',
      'file-url-target',
      'invalid-target-encoding',
      'absolute-posix-target',
      'home-relative-target',
      'absolute-windows-target',
      'unc-target',
      'unc-target',
      'file-url-target',
      'target-control-character',
      'target-control-character',
      'target-control-character',
      'absolute-posix-target',
      'file-url-target',
      'home-relative-target',
      'absolute-windows-target',
      'unc-target',
      'invalid-target-encoding',
      'invalid-target-encoding',
      'file-url-target',
      'file-url-target',
      'absolute-posix-target',
      'target-control-character',
      'target-control-character',
    ],
  );
  const diagnostics = findings.map(formatFinding).join('\n');
  assert.doesNotMatch(diagnostics, /Users\/private|server\/private|secret\.md/);
  assert.match(diagnostics, /docs\/source\.md:1.*missing-target/);
  assert.equal(diagnostics.split('\n').length, findings.length);
});

test('escapes control characters in diagnostic source paths', () => {
  const root = makeDirectory();
  const source = 'docs/source\nforged.md';
  write(root, source, '[missing](missing.md)\n');
  const diagnostic = formatFinding(
    findLinkViolations({ repoRoot: root, files: [source] })[0],
  );
  assert.doesNotMatch(diagnostic, /source\nforged/);
  assert.ok(diagnostic.includes(String.raw`source\u{a}forged`));
  assert.equal(diagnostic.split('\n').length, 1);

  const unicodeSource = 'docs/source\u0085\u202e\u2066\ufeff.md';
  write(root, unicodeSource, '[missing](missing.md)\n');
  const unicodeDiagnostic = formatFinding(
    findLinkViolations({ repoRoot: root, files: [unicodeSource] })[0],
  );
  assert.doesNotMatch(unicodeDiagnostic, /[\u0085\u202e\u2066\ufeff]/u);
  assert.match(unicodeDiagnostic, /\\u\{/);
  assert.equal(unicodeDiagnostic.split('\n').length, 1);
});

test('rejects case mismatches and symlinks that leave the repository', (t) => {
  const root = makeDirectory();
  const outside = makeDirectory();
  write(root, 'README.md', '[case](Case.md)\n[outside](external.md)\n');
  write(root, 'case.md', '# lower case\n');
  write(outside, 'external.md', '# external\n');

  try {
    fs.symlinkSync(path.join(outside, 'external.md'), path.join(root, 'external.md'));
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }

  const findings = findLinkViolations({ repoRoot: root, files: ['README.md'] });
  assert.deepEqual(
    findings.map(({ reason }) => reason),
    ['target-case-mismatch', 'target-outside-repository'],
  );
});

test('discovers existing tracked and untracked Markdown with NUL-safe Git output', () => {
  const root = makeDirectory();
  initializeGit(root);
  write(root, '.gitignore', 'ignored.md\n');
  write(root, 'tracked.md', '# tracked\n');
  write(root, 'deleted.md', '# deleted\n');
  write(root, 'old name.md', '# old\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });

  fs.rmSync(path.join(root, 'deleted.md'));
  fs.renameSync(path.join(root, 'old name.md'), path.join(root, 'new name.md'));
  write(root, 'untracked.md', '# untracked\n');
  write(root, 'ignored.md', '# ignored\n');

  assert.deepEqual(discoverMarkdownFiles(root), [
    'new name.md',
    'tracked.md',
    'untracked.md',
  ]);
});

test('skips deletion races but does not suppress other discovery errors', () => {
  const root = makeDirectory();
  initializeGit(root);
  write(root, 'tracked.md', '# tracked\n');
  write(root, 'deleted.md', '# deleted\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });

  const sentinel = Object.assign(new Error('denied'), { code: 'EACCES' });
  const lstatSync = (target) => {
    if (target.endsWith('deleted.md')) {
      const error = new Error('gone');
      error.code = 'ENOENT';
      throw error;
    }
    if (target.endsWith('tracked.md')) {
      throw sentinel;
    }
    return fs.lstatSync(target);
  };
  assert.throws(() => discoverMarkdownFiles(root, { lstatSync }), (error) => {
    assert.equal(error, sentinel);
    return true;
  });
});

test('baseline contains redacted hashes and rejects only unexpected findings', () => {
  const findings = [
    {
      source: 'docs/plans/a.md',
      line: 4,
      reason: 'absolute-posix-target',
      targetKind: 'absolute-posix',
      fingerprintInput: 'docs/plans/a.md\0absolute-posix-target\0/Users/private/a.md',
    },
    {
      source: 'docs/plans/b.md',
      line: 2,
      reason: 'missing-target',
      safeTarget: 'docs/missing.md',
      fingerprintInput: 'docs/plans/b.md\0missing-target\0docs/missing.md',
    },
  ];
  const baseline = createBaseline(findings, 'a'.repeat(40));
  assert.equal(baseline.entries.length, 2);
  assert.doesNotMatch(JSON.stringify(baseline), /Users\/private/);
  assert.deepEqual(compareWithBaseline([findings[0]], baseline), []);

  const unexpected = {
    ...findings[1],
    fingerprintInput: 'docs/plans/b.md\0missing-target\0docs/another.md',
  };
  assert.deepEqual(compareWithBaseline([unexpected], baseline), [unexpected]);

  assert.equal(compareWithBaseline([findings[0], findings[0]], baseline).length, 1);
  assert.deepEqual(
    compareWithBaseline(
      [findings[0], findings[0]],
      createBaseline([findings[0], findings[0]], 'a'.repeat(40)),
    ),
    [],
  );

  for (const malformed of [
    { ...baseline, findingCount: 99 },
    { ...baseline, countsByReason: { 'missing-target': 99 } },
    { ...baseline, rawTarget: '/Users/private/secret.md' },
    {
      ...baseline,
      entries: [
        { ...baseline.entries[0], rawTarget: '/Users/private/secret.md' },
        baseline.entries[1],
      ],
    },
  ]) {
    assert.throws(() => compareWithBaseline([], malformed), /Malformed link baseline/);
  }
});

test('binds baseline entries to a pinned commit and legacy source findings', () => {
  const root = makeDirectory();
  initializeGit(root);
  write(
    root,
    'docs/plans/active/legacy.md',
    '[absolute](/Users/private/secret.md)\n',
  );
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const findings = findLinkViolations({
    repoRoot: root,
    files: ['docs/plans/active/legacy.md'],
  });
  const baseline = createBaseline(findings, baseCommit);
  assert.doesNotThrow(() =>
    validateBaselineAgainstBase({
      repoRoot: root,
      baseline,
      expectedBaseCommit: baseCommit,
    }),
  );

  fs.writeFileSync(
    path.join(root, 'docs/plans/active/legacy.md'),
    '# resolved in the working tree\n',
  );
  assert.doesNotThrow(() =>
    validateBaselineAgainstBase({
      repoRoot: root,
      baseline,
      expectedBaseCommit: baseCommit,
    }),
  );
  assert.throws(
    () =>
      validateBaselineAgainstBase({
        repoRoot: root,
        baseline,
        expectedBaseCommit: 'b'.repeat(40),
      }),
    /Malformed link baseline/,
  );
  assert.throws(
    () =>
      validateBaselineAgainstBase({
        repoRoot: root,
        baseline: {
          ...baseline,
          entries: baseline.entries.map((entry) => ({
            ...entry,
            hash: 'f'.repeat(64),
          })),
        },
        expectedBaseCommit: baseCommit,
      }),
    /Malformed link baseline/,
  );
});

test('does not baseline filesystem-dependent findings against current target state', () => {
  const existingAtBase = makeDirectory();
  initializeGit(existingAtBase);
  write(
    existingAtBase,
    'docs/plans/active/legacy.md',
    '[target](../../target.txt)\n',
  );
  write(existingAtBase, 'docs/target.txt', 'present at base\n');
  execFileSync('git', ['add', '.'], { cwd: existingAtBase });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: existingAtBase });
  const existingBaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: existingAtBase,
    encoding: 'utf8',
  }).trim();
  fs.rmSync(path.join(existingAtBase, 'docs/target.txt'));
  const newlyMissing = findLinkViolations({
    repoRoot: existingAtBase,
    files: ['docs/plans/active/legacy.md'],
  });
  assert.equal(newlyMissing[0]?.reason, 'missing-target');
  assert.throws(
    () =>
      validateBaselineAgainstBase({
        repoRoot: existingAtBase,
        baseline: createBaseline(newlyMissing, existingBaseCommit),
        expectedBaseCommit: existingBaseCommit,
      }),
    /Malformed link baseline/,
  );

  const missingAtBase = makeDirectory();
  initializeGit(missingAtBase);
  write(
    missingAtBase,
    'docs/plans/active/legacy.md',
    '[target](../../target.txt)\n',
  );
  execFileSync('git', ['add', '.'], { cwd: missingAtBase });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: missingAtBase });
  const missingBaseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: missingAtBase,
    encoding: 'utf8',
  }).trim();
  const genuinelyMissing = findLinkViolations({
    repoRoot: missingAtBase,
    files: ['docs/plans/active/legacy.md'],
  });
  write(missingAtBase, 'docs/target.txt', 'added later\n');
  assert.throws(
    () =>
      validateBaselineAgainstBase({
        repoRoot: missingAtBase,
        baseline: createBaseline(genuinelyMissing, missingBaseCommit),
        expectedBaseCommit: missingBaseCommit,
      }),
    /Malformed link baseline/,
  );
});

test('unknown CLI flags and operational discovery failures remain errors', () => {
  assert.throws(() => parseCliArgs(['--unknown']), /Unknown option/);
  assert.throws(
    () => parseCliArgs(['--baseline', 'baseline.json']),
    /requires --expected-base/,
  );
  assert.deepEqual(
    parseCliArgs([
      '--baseline',
      'baseline.json',
      '--expected-base',
      'a'.repeat(40),
    ]),
    {
      baselinePath: 'baseline.json',
      expectedBaseCommit: 'a'.repeat(40),
      printBaselineCommit: null,
      help: false,
    },
  );
  assert.throws(() => discoverMarkdownFiles(makeDirectory()), /Git discovery failed/);

  const root = makeDirectory();
  initializeGit(root);
  write(root, 'README.md', '# Test\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  const result = spawnSync(
    process.execPath,
    [LINK_SCRIPT, '--print-baseline', 'f'.repeat(40)],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 2, result.stderr);
});
