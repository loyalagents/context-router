import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from '@nestjs/common/constants';

const backendRoot = join(__dirname, '..', '..');
const sourceRoot = join(backendRoot, 'src');
const tokenPath = join(sourceRoot, 'domains/shared/ports/ai.tokens.ts');
const hostedAdapterPath = join(
  sourceRoot,
  'composition/hosted-model-adapter.module.ts',
);

const textTokenValue = ['Ai', 'TextGenerator', 'Port'].join('');
const structuredTokenValue = ['Ai', 'StructuredOutput', 'Port'].join('');

function typescriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return typescriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function repoRelative(path: string): string {
  return relative(backendRoot, path).replaceAll('\\', '/');
}

describe('model composition boundaries', () => {
  it('selects the hosted adapter only at AppModule and keeps consumers on ports', () => {
    const violations: string[] = [];
    const allFiles = [
      ...typescriptFiles(sourceRoot),
      ...typescriptFiles(join(backendRoot, 'test')),
    ];

    if (!existsSync(tokenPath)) {
      violations.push(
        'missing canonical model-port token constants at src/domains/shared/ports/ai.tokens.ts',
      );
    } else {
      const tokenModule = require(tokenPath) as Record<string, string>;
      for (const [name, value] of [
        ['AI_TEXT_GENERATOR_PORT', textTokenValue],
        ['AI_STRUCTURED_OUTPUT_PORT', structuredTokenValue],
      ]) {
        if (tokenModule[name] !== value) {
          violations.push(`missing stable ${name} token value`);
        }
      }
    }

    if (!existsSync(hostedAdapterPath)) {
      violations.push(
        'missing the hosted model adapter binding at src/composition/hosted-model-adapter.module.ts',
      );
    } else {
      const adapterSource = readFileSync(hostedAdapterPath, 'utf8');
      if (!adapterSource.includes('@Global()')) {
        violations.push('HostedModelAdapterModule must be global');
      }
      if (
        !adapterSource.includes('VertexAiService') ||
        !adapterSource.includes('VertexAiStructuredService')
      ) {
        violations.push('hosted binding must register both concrete adapters');
      }
      const exportsBlock =
        adapterSource.match(/exports\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
      if (
        !exportsBlock.includes('AI_TEXT_GENERATOR_PORT') ||
        !exportsBlock.includes('AI_STRUCTURED_OUTPUT_PORT')
      ) {
        violations.push('hosted binding must export both model-port tokens');
      }
      if (
        exportsBlock.includes('VertexAiService') ||
        exportsBlock.includes('VertexAiStructuredService')
      ) {
        violations.push('hosted binding must not export concrete adapters');
      }

      const tokenModule = require(tokenPath) as Record<string, string>;
      const adapterModule = require(hostedAdapterPath) as Record<
        string,
        new (...args: never[]) => unknown
      >;
      const moduleType = adapterModule.HostedModelAdapterModule;
      type ProviderEntry =
        | { name?: string }
        | { provide?: unknown; useExisting?: { name?: string } };
      const providers =
        (Reflect.getMetadata(
          MODULE_METADATA.PROVIDERS,
          moduleType,
        ) as ProviderEntry[]) ?? [];
      const exportedTokens =
        (Reflect.getMetadata(
          MODULE_METADATA.EXPORTS,
          moduleType,
        ) as unknown[]) ?? [];
      const classProviders = providers
        .filter((provider) => typeof provider === 'function')
        .map((provider) => (provider as { name?: string }).name)
        .sort();
      if (
        JSON.stringify(classProviders) !==
        JSON.stringify(['VertexAiService', 'VertexAiStructuredService'])
      ) {
        violations.push(
          `hosted binding concrete providers must be exact; found ${JSON.stringify(classProviders)}`,
        );
      }
      for (const [tokenName, adapterName] of [
        ['AI_TEXT_GENERATOR_PORT', 'VertexAiService'],
        ['AI_STRUCTURED_OUTPUT_PORT', 'VertexAiStructuredService'],
      ]) {
        const token = tokenModule[tokenName];
        const aliases = providers.filter(
          (provider) =>
            typeof provider === 'object' &&
            provider !== null &&
            (provider as { provide?: unknown }).provide === token,
        ) as Array<{ useExisting?: { name?: string } }>;
        if (
          aliases.length !== 1 ||
          aliases[0].useExisting?.name !== adapterName
        ) {
          violations.push(
            `${tokenName} must have one useExisting alias to ${adapterName}`,
          );
        }
      }
      if (
        exportedTokens.length !== 2 ||
        !exportedTokens.includes(tokenModule.AI_TEXT_GENERATOR_PORT) ||
        !exportedTokens.includes(tokenModule.AI_STRUCTURED_OUTPUT_PORT)
      ) {
        violations.push('hosted binding metadata must export only both tokens');
      }
      if (Reflect.getMetadata(GLOBAL_MODULE_METADATA, moduleType) !== true) {
        violations.push('HostedModelAdapterModule metadata must be global');
      }
    }

    const hostedBindingImporters = allFiles
      .filter((path) => path.startsWith(sourceRoot))
      .filter((path) =>
        readFileSync(path, 'utf8').includes(
          'composition/hosted-model-adapter.module',
        ),
      )
      .map(repoRelative);
    if (
      hostedBindingImporters.length !== 1 ||
      hostedBindingImporters[0] !== 'src/app.module.ts'
    ) {
      violations.push(
        `AppModule must be the sole hosted binding importer; found ${JSON.stringify(hostedBindingImporters)}`,
      );
    }

    const legacyTransportImporters = allFiles
      .filter((path) => path.startsWith(sourceRoot))
      .filter((path) =>
        readFileSync(path, 'utf8').includes('vertex-ai/vertex-ai.module'),
      )
      .map(repoRelative);
    if (
      legacyTransportImporters.length !== 1 ||
      legacyTransportImporters[0] !== 'src/app.module.ts'
    ) {
      violations.push(
        `AppModule must be the sole legacy GraphQL transport importer; found ${JSON.stringify(legacyTransportImporters)}`,
      );
    }

    const featureModules = [
      'src/modules/preferences/document-analysis/document-analysis.module.ts',
      'src/modules/preferences/form-fill/form-fill.module.ts',
      'src/modules/workflows/workflows.module.ts',
    ];
    for (const file of featureModules) {
      const source = readFileSync(join(backendRoot, file), 'utf8');
      if (source.includes('vertex-ai/vertex-ai.module')) {
        violations.push(`${file} imports the provider-specific VertexAiModule`);
      }
    }

    const legacyModulePath = join(
      sourceRoot,
      'modules/vertex-ai/vertex-ai.module.ts',
    );
    const legacyModuleSource = readFileSync(legacyModulePath, 'utf8');
    if (
      legacyModuleSource.includes('VertexAiService') ||
      legacyModuleSource.includes('VertexAiStructuredService')
    ) {
      violations.push(
        'legacy GraphQL transport module still mixes concrete adapter binding with transport',
      );
    }
    const legacyExportsBlock =
      legacyModuleSource.match(/exports\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    if (
      legacyExportsBlock.includes('VertexAiService') ||
      legacyExportsBlock.includes('VertexAiStructuredService')
    ) {
      violations.push(
        'legacy GraphQL transport module exports concrete adapters',
      );
    }
    const legacyModule = require(legacyModulePath) as Record<
      string,
      new (...args: never[]) => unknown
    >;
    const legacyProviders =
      (Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        legacyModule.VertexAiModule,
      ) as Array<{ name?: string }>) ?? [];
    if (
      legacyProviders.length !== 1 ||
      legacyProviders[0]?.name !== 'VertexAiResolver'
    ) {
      violations.push(
        'legacy GraphQL transport module must provide only VertexAiResolver',
      );
    }
    const legacyExports =
      (Reflect.getMetadata(
        MODULE_METADATA.EXPORTS,
        legacyModule.VertexAiModule,
      ) as unknown[]) ?? [];
    if (legacyExports.length !== 0) {
      violations.push('legacy GraphQL transport module must export nothing');
    }

    const resolverPath = join(
      sourceRoot,
      'modules/vertex-ai/vertex-ai.resolver.ts',
    );
    if (readFileSync(resolverPath, 'utf8').includes('VertexAiService')) {
      violations.push(
        'VertexAiResolver depends on the concrete VertexAiService',
      );
    }

    const concreteServiceImportPattern =
      /from ['"][^'"]*(?:infrastructure\/vertex-ai\/(?:vertex-ai|vertex-ai-structured)\.service|\.\/vertex-ai\.service)['"]/;
    const allowedConcreteServiceImporters = new Set([
      'src/composition/hosted-model-adapter.module.ts',
      'src/infrastructure/vertex-ai/vertex-ai-structured.service.ts',
      'src/infrastructure/vertex-ai/vertex-ai-structured.service.spec.ts',
      'src/infrastructure/vertex-ai/vertex-ai.service.ts',
      'test/integration/vertex-ai-structured.spec.ts',
    ]);
    const vertexSdkImportPattern =
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@google-cloud\/vertexai(?:\/[^'"]*)?['"]/;
    const allowedVertexSdkImporters = new Set([
      'src/infrastructure/vertex-ai/vertex-ai.service.ts',
    ]);
    for (const path of allFiles) {
      const file = repoRelative(path);
      const source = readFileSync(path, 'utf8');
      if (
        concreteServiceImportPattern.test(source) &&
        !allowedConcreteServiceImporters.has(file)
      ) {
        violations.push(`${file} imports a concrete Vertex adapter`);
      }
      if (
        vertexSdkImportPattern.test(source) &&
        !allowedVertexSdkImporters.has(file)
      ) {
        violations.push(`${file} imports the Vertex SDK outside its adapter`);
      }
    }

    for (const path of allFiles) {
      if (path === tokenPath) continue;
      const source = readFileSync(path, 'utf8');
      for (const value of [textTokenValue, structuredTokenValue]) {
        if (source.includes(`'${value}'`) || source.includes(`"${value}"`)) {
          violations.push(
            `${repoRelative(path)} contains raw model token ${value}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
