import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import {
  PREFERENCE_CATALOG_INTEGRITY_MESSAGE,
  PREFERENCE_CATALOG_MISSING_MESSAGE,
} from '../../src/bootstrap/startup-diagnostics';
import {
  PREFERENCE_CATALOG_BYTE_LENGTH,
  PREFERENCE_CATALOG_SHA256,
  createValidatedPreferenceCatalogSnapshot,
  readPreferenceCatalogFile,
  validateHostedRuntimeResources,
} from '../../src/bootstrap/runtime-resource-preflight';
import { bootstrapHostedApplication } from '../../src/bootstrap/hosted-bootstrap';

const repositoryRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}

function repositorySourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((path) => existsSync(join(repositoryRoot, path)))
    .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
    .filter(
      (path) =>
        !/(^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(path) &&
        !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path),
    );
}

function nearestPackageManifest(sourcePath: string): string {
  let directory = dirname(join(repositoryRoot, sourcePath));
  while (true) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) return relative(repositoryRoot, manifest);
    if (directory === repositoryRoot) break;
    directory = dirname(directory);
  }
  throw new Error(`No package manifest owns ${sourcePath}`);
}

describe('runtime resource and package closure contract', () => {
  const catalogBytes = readFileSync(
    join(repositoryRoot, 'apps/backend/src/config/preferences.catalog.json'),
  );

  it('validates one catalog buffer against the compiled digest and JSON shape', async () => {
    const readCatalogBytes = jest.fn().mockResolvedValue(catalogBytes);

    await expect(
      validateHostedRuntimeResources({ readCatalogBytes }),
    ).resolves.toBeUndefined();
    expect(readCatalogBytes).toHaveBeenCalledTimes(1);
    expect(createHash('sha256').update(catalogBytes).digest('hex')).toBe(
      PREFERENCE_CATALOG_SHA256,
    );
  });

  it('feeds consumers the validated snapshot without re-reading replaced bytes', () => {
    let currentBytes = catalogBytes;
    const readCatalogBytes = jest.fn(() => currentBytes);
    const snapshot = createValidatedPreferenceCatalogSnapshot(readCatalogBytes);

    snapshot.validate();
    currentBytes = Buffer.from(
      JSON.stringify({ replacement: 'post-validation-secret-canary' }),
    );

    expect(snapshot.getCatalog()).toEqual(
      JSON.parse(catalogBytes.toString('utf8')),
    );
    expect(readCatalogBytes).toHaveBeenCalledTimes(1);
    const catalogModule = read(
      'apps/backend/src/config/preferences-catalog-data.ts',
    );
    expect(catalogModule).toContain('getValidatedPreferenceCatalog()');
    expect(catalogModule).not.toMatch(/readFile|from ['"]fs|from ['"]path/);
  });

  it('maps missing and tampered catalogs to fixed cause-free messages', async () => {
    const missingCanary = '/private/repository/catalog-secret-canary.json';
    const missingError = (await validateHostedRuntimeResources({
      readCatalogBytes: jest
        .fn()
        .mockRejectedValue(new Error(`ENOENT ${missingCanary}`)),
    }).catch((error: Error) => error)) as Error;

    expect(missingError.message).toBe(PREFERENCE_CATALOG_MISSING_MESSAGE);
    expect('cause' in missingError).toBe(false);
    expect(JSON.stringify(missingError)).not.toContain(missingCanary);

    const tamperCanary = 'valid-json-resource-secret-canary';
    const tamperedBytes = Buffer.from(
      JSON.stringify({ tamperCanary }).padEnd(
        PREFERENCE_CATALOG_BYTE_LENGTH,
        ' ',
      ),
    );
    expect(tamperedBytes).toHaveLength(PREFERENCE_CATALOG_BYTE_LENGTH);
    const tamperedError = (await validateHostedRuntimeResources({
      readCatalogBytes: jest.fn().mockResolvedValue(tamperedBytes),
    }).catch((error: Error) => error)) as Error;

    expect(tamperedError.message).toBe(PREFERENCE_CATALOG_INTEGRITY_MESSAGE);
    expect('cause' in tamperedError).toBe(false);
    expect(JSON.stringify(tamperedError)).not.toContain(tamperCanary);
  });

  it('rejects symlink, directory, FIFO, and oversized catalog files promptly as integrity failures', async () => {
    const resourceRoot = mkdtempSync(join(tmpdir(), 'catalog-file-guards-'));
    const validTarget = join(resourceRoot, 'target-secret-canary.json');
    const directoryPath = join(resourceRoot, 'directory-secret-canary');
    const oversizedPath = join(resourceRoot, 'oversized-secret-canary.json');
    const guardedPaths: string[] = [directoryPath, oversizedPath];

    try {
      writeFileSync(validTarget, catalogBytes, { mode: 0o600 });
      mkdirSync(directoryPath, { mode: 0o700 });
      writeFileSync(
        oversizedPath,
        Buffer.alloc(PREFERENCE_CATALOG_BYTE_LENGTH + 1, 'x'),
        { mode: 0o600 },
      );

      if (process.platform !== 'win32') {
        const symlinkPath = join(resourceRoot, 'symlink-secret-canary.json');
        const fifoPath = join(resourceRoot, 'fifo-secret-canary.json');
        symlinkSync(validTarget, symlinkPath);
        execFileSync('mkfifo', [fifoPath]);
        guardedPaths.push(symlinkPath, fifoPath);
      }

      const startedAt = Date.now();
      for (const guardedPath of guardedPaths) {
        const error = (await validateHostedRuntimeResources({
          readCatalogBytes: () => readPreferenceCatalogFile(guardedPath),
        }).catch((failure: Error) => failure)) as Error;

        expect(error.message).toBe(PREFERENCE_CATALOG_INTEGRITY_MESSAGE);
        expect('cause' in error).toBe(false);
        expect(JSON.stringify(error)).not.toContain(resourceRoot);
        expect(JSON.stringify(error)).not.toContain('secret-canary');
      }
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      rmSync(resourceRoot, { recursive: true, force: true });
    }
  });

  it('fails resource preflight before application creation, listeners, or readiness', async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'resource-preflight-'));
    const events: string[] = [];
    const createApplication = jest.fn(async () => {
      events.push('create');
      throw new Error('application-secret-canary');
    });
    const processController = {
      on: jest.fn(() => events.push('signal-on')),
      off: jest.fn(),
      terminate: jest.fn(),
    };
    const reportReadiness = jest.fn(() => events.push('ready'));

    try {
      await expect(
        bootstrapHostedApplication({
          packageRoot,
          environment: {},
          validateRuntimeResources: async () => {
            events.push('preflight');
            throw new Error(PREFERENCE_CATALOG_MISSING_MESSAGE);
          },
          createApplication,
          processController,
          reportReadiness,
        }),
      ).rejects.toThrow(PREFERENCE_CATALOG_MISSING_MESSAGE);
      expect(events).toEqual(['preflight']);
      expect(createApplication).not.toHaveBeenCalled();
      expect(processController.on).not.toHaveBeenCalled();
      expect(processController.terminate).not.toHaveBeenCalled();
      expect(reportReadiness).not.toHaveBeenCalled();
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it('assigns each non-test Vertex SDK importer to its owning package', () => {
    const vertexSdkPackage = ['@google-cloud', 'vertexai'].join('/');
    const vertexSdkImportPattern = new RegExp(
      String.raw`(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]${vertexSdkPackage}(?:\/[^'"]*)?['"]`,
    );
    const rootPackage = JSON.parse(read('package.json'));
    const backendPackage = JSON.parse(read('apps/backend/package.json'));
    const lockfile = read('pnpm-lock.yaml');

    const importers = repositorySourceFiles()
      .filter((path) => vertexSdkImportPattern.test(read(path)))
      .sort();
    expect(importers).toEqual([
      'apps/backend/src/infrastructure/vertex-ai/vertex-ai.service.ts',
      'examples/eval/scripts/generate.mjs',
    ]);
    expect(
      Object.fromEntries(
        importers.map((path) => [path, nearestPackageManifest(path)]),
      ),
    ).toEqual({
      'apps/backend/src/infrastructure/vertex-ai/vertex-ai.service.ts':
        'apps/backend/package.json',
      'examples/eval/scripts/generate.mjs': 'package.json',
    });

    expect(rootPackage.dependencies[vertexSdkPackage]).toBe('^1.10.0');
    expect(backendPackage.dependencies[vertexSdkPackage]).toBe(
      rootPackage.dependencies[vertexSdkPackage],
    );
    expect(
      read('apps/backend/src/infrastructure/vertex-ai/vertex-ai.service.ts'),
    ).toContain(`from '${vertexSdkPackage}'`);
    expect(read('examples/eval/scripts/generate.mjs')).toContain(
      `import('${vertexSdkPackage}')`,
    );
    expect(lockfile).toMatch(
      /apps\/backend:[\s\S]*?'@google-cloud\/vertexai':[\s\S]*?specifier: \^1\.10\.0/,
    );
  });

  it('keeps the Auth0 server SDK outside the backend package closure', () => {
    const backendPackage = JSON.parse(read('apps/backend/package.json'));
    const lockfile = read('pnpm-lock.yaml');
    const auth0ImportPattern =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]auth0(?:\/[^'"]*)?['"]/;

    expect(backendPackage.dependencies?.auth0).toBeUndefined();
    expect(backendPackage.optionalDependencies?.auth0).toBeUndefined();
    expect(backendPackage.peerDependencies?.auth0).toBeUndefined();
    expect(
      repositorySourceFiles().filter((path) =>
        auth0ImportPattern.test(read(path)),
      ),
    ).toEqual([]);
    expect(lockfile).not.toMatch(/auth0@5\.1\.0|auth0-legacy/);
  });

  it('restricts the deploy packlist and explicitly copies the raw catalog asset', () => {
    const backendPackage = JSON.parse(read('apps/backend/package.json'));
    const nestCli = JSON.parse(read('apps/backend/nest-cli.json'));
    const backendTsconfig = JSON.parse(read('apps/backend/tsconfig.json'));
    const lockfile = read('pnpm-lock.yaml');

    expect(backendPackage.files).toEqual(['dist']);
    expect(read('pnpm-workspace.yaml')).toMatch(
      /^injectWorkspacePackages: true$/m,
    );
    expect(lockfile).toMatch(
      /^settings:\n(?:  .+\n)*  injectWorkspacePackages: true$/m,
    );
    expect(nestCli.compilerOptions.assets).toContainEqual({
      include: 'config/preferences.catalog.json',
      outDir: 'dist',
    });
    expect(backendTsconfig.exclude).toContain('**/*.spec.ts');
  });
});
