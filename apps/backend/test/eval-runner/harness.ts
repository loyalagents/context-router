import '../setup/env';

import { readFile, writeFile } from 'fs/promises';
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib';
import request from 'supertest';
import {
  createTestApp,
  createTestUser,
} from '../setup/test-app';
import {
  disconnectPrisma,
  resetDb,
  seedPreferenceDefinitions,
} from '../setup/test-db';
import {
  AuditActorType,
  AuditOrigin,
  PreferenceScope,
  PreferenceValueType,
  SourceType,
} from '../../src/infrastructure/prisma/generated-client';
import { PreferenceDefinitionService } from '../../src/modules/preferences/preference-definition/preference-definition.service';
import { PreferenceService } from '../../src/modules/preferences/preference/preference.service';
import { MutationContext } from '../../src/modules/preferences/audit/audit.types';

interface HarnessInput {
  scenario: {
    scenarioId: string;
  };
  formPdfPath: string;
  seedPreferences: Array<{ slug: string; value: unknown }>;
  evalDefinitions: Array<{
    factKey: string;
    slug: string;
    value: unknown;
    valueType: keyof typeof PreferenceValueType;
  }>;
  fillActions: unknown[];
}

async function main() {
  const { inputPath, outputPath } = parseArgs(process.argv.slice(2));
  const input = JSON.parse(await readFile(inputPath, 'utf8')) as HarnessInput;

  let testApp: Awaited<ReturnType<typeof createTestApp>> | null = null;
  try {
    await resetDb();
    await seedPreferenceDefinitions();

    testApp = await createTestApp({
      mockVertexAi: {
        generateText: async () => 'Eval runner mock text response',
        generateTextWithFile: async () =>
          JSON.stringify({ suggestions: [], documentSummary: 'Eval runner mock' }),
      },
      mockStructuredAi: {
        generateStructured: async () => ({ fillActions: input.fillActions }),
        generateStructuredWithFile: async () => ({
          suggestions: [],
          documentSummary: 'Eval runner mock',
        }),
      },
      mockAuth0: {
        getUserInfo: async () => ({
          data: {
            user_id: `auth0|eval-${input.scenario.scenarioId}`,
            email: `${input.scenario.scenarioId}@eval.example.test`,
            name: 'Eval Runner',
          },
        }),
        updateUserMetadata: async () => ({}),
        getManagementClient: () => undefined,
        getAuthClient: () => undefined,
      },
    });

    const user = await createTestUser();
    testApp.setTestUser(user);

    await hydratePreferences({
      input,
      userId: user.userId,
      preferenceService: testApp.module.get(PreferenceService),
      definitionService: testApp.module.get(PreferenceDefinitionService),
    });

    const pdfBuffer = await readFile(input.formPdfPath);
    const response = await request(testApp.app.getHttpServer())
      .post('/api/form-fill/pdf')
      .attach('file', pdfBuffer, {
        filename: 'form.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const filledPdfFields = response.body.filledPdfBase64
      ? await readFilledPdfFields(response.body.filledPdfBase64)
      : {};

    await writeFile(
      outputPath,
      `${JSON.stringify({ response: response.body, filledPdfFields }, null, 2)}\n`,
    );
  } finally {
    if (testApp) await testApp.app.close();
    await disconnectPrisma();
  }
}

async function hydratePreferences({
  input,
  userId,
  preferenceService,
  definitionService,
}: {
  input: HarnessInput;
  userId: string;
  preferenceService: PreferenceService;
  definitionService: PreferenceDefinitionService;
}) {
  const context = mutationContext(input.scenario.scenarioId);

  for (const definition of input.evalDefinitions) {
    await definitionService.create(
      {
        slug: definition.slug,
        displayName: definition.factKey,
        description: `Eval-only preference for ${definition.factKey}`,
        valueType: PreferenceValueType[definition.valueType],
        scope: PreferenceScope.GLOBAL,
        isSensitive: false,
        isCore: false,
      },
      userId,
      context,
    );
  }

  for (const preference of [
    ...input.seedPreferences,
    ...input.evalDefinitions.map((definition) => ({
      slug: definition.slug,
      value: definition.value,
    })),
  ]) {
    await preferenceService.setPreference(
      userId,
      { slug: preference.slug, value: preference.value },
      context,
    );
  }
}

function mutationContext(scenarioId: string): MutationContext {
  return {
    actorType: AuditActorType.SYSTEM,
    origin: AuditOrigin.SYSTEM,
    sourceType: SourceType.SYSTEM,
    correlationId: `eval-runner:${scenarioId}`,
  };
}

async function readFilledPdfFields(base64: string) {
  const pdfDoc = await PDFDocument.load(Buffer.from(base64, 'base64'));
  const fields: Record<string, unknown> = {};

  for (const field of pdfDoc.getForm().getFields()) {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      fields[name] = { value: field.getText() ?? '' };
    } else if (field instanceof PDFCheckBox) {
      fields[name] = { checked: field.isChecked() };
    } else if (field instanceof PDFDropdown) {
      fields[name] = { selected: field.getSelected() };
    } else if (field instanceof PDFOptionList) {
      fields[name] = { selected: field.getSelected() };
    } else if (field instanceof PDFRadioGroup) {
      fields[name] = { selected: field.getSelected() ? [field.getSelected()] : [] };
    } else {
      fields[name] = {};
    }
  }

  return fields;
}

function parseArgs(args: string[]) {
  let inputPath: string | null = null;
  let outputPath: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    if (arg === '--input') inputPath = value;
    else if (arg === '--output') outputPath = value;
    else throw new Error(`Unsupported argument: ${arg}`);
  }

  if (!inputPath || !outputPath) {
    throw new Error('--input and --output are required');
  }
  return { inputPath, outputPath };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
