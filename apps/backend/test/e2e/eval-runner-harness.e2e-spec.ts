import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { getPrismaClient } from '../setup/test-db';
import {
  PreferenceScope,
  PreferenceStatus,
} from '../../src/infrastructure/prisma/generated-client';

describe('Eval runner harness (e2e)', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'backend-eval-harness-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('boots as a standalone non-Jest process and persists deterministic hydration', async () => {
    const pdfPath = path.join(tempRoot, 'form.pdf');
    await writeFile(pdfPath, await createUploadPdf());

    const inputPath = path.join(tempRoot, 'input.json');
    const outputPath = path.join(tempRoot, 'output.json');
    await writeFile(
      inputPath,
      `${JSON.stringify(
        {
          scenario: { scenarioId: 'harness-smoke' },
          formPdfPath: pdfPath,
          seedPreferences: [
            { slug: 'profile.full_name', value: 'Alex Rivera' },
          ],
          evalDefinitions: [
            {
              factKey: 'identity.middleInitial',
              slug: 'eval.identity.middle_initial',
              value: 'Q',
              valueType: 'STRING',
            },
          ],
          fillActions: [
            {
              fieldName: 'full_name',
              action: 'SET_TEXT',
              value: 'Alex Rivera',
              sourceSlugs: ['profile.full_name'],
              confidence: 0.99,
            },
            {
              fieldName: 'middle_initial',
              action: 'SET_TEXT',
              value: 'Q',
              sourceSlugs: ['eval.identity.middle_initial'],
              confidence: 0.99,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const child = await runHarnessProcess({ inputPath, outputPath });
    expect(child.exitCode).toBe(0);

    const output = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(output.response).toMatchObject({
      status: 'success',
      originalFilename: 'form.pdf',
      outputFilename: 'filled-form.pdf',
      outputMimeType: 'application/pdf',
      summary: {
        totalFields: 2,
        filledCount: 2,
        skippedCount: 0,
      },
    });
    expect(output.filledPdfFields.full_name.value).toBe('Alex Rivera');
    expect(output.filledPdfFields.middle_initial.value).toBe('Q');

    const prisma = getPrismaClient();
    const user = await prisma.user.findFirstOrThrow({
      where: { email: 'test@example.com' },
    });
    const evalDefinition = await prisma.preferenceDefinition.findFirstOrThrow({
      where: { slug: 'eval.identity.middle_initial' },
    });
    expect(evalDefinition.ownerUserId).toBe(user.userId);
    expect(evalDefinition.scope).toBe(PreferenceScope.GLOBAL);

    const activePreferences = await prisma.preference.findMany({
      where: { userId: user.userId, status: PreferenceStatus.ACTIVE },
      include: { definition: true },
    });
    const valuesBySlug = new Map(
      activePreferences.map((preference) => [
        preference.definition.slug,
        preference.value,
      ]),
    );
    expect(valuesBySlug.get('profile.full_name')).toBe('Alex Rivera');
    expect(valuesBySlug.get('eval.identity.middle_initial')).toBe('Q');
    expect(valuesBySlug.has('eval.identity.null_fact')).toBe(false);
  });
});

async function createUploadPdf(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 260]);
  const form = pdfDoc.getForm();

  form
    .createTextField('full_name')
    .addToPage(page, { x: 40, y: 180, width: 220, height: 24 });
  form
    .createTextField('middle_initial')
    .addToPage(page, { x: 40, y: 130, width: 80, height: 24 });

  return Buffer.from(await pdfDoc.save());
}

function runHarnessProcess({
  inputPath,
  outputPath,
}: {
  inputPath: string;
  outputPath: string;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const backendRoot = path.resolve(__dirname, '../..');
  const child = spawn(
    process.execPath,
    [
      '-r',
      'tsconfig-paths/register',
      '-r',
      'ts-node/register',
      'test/eval-runner/harness.ts',
      '--input',
      inputPath,
      '--output',
      outputPath,
    ],
    {
      cwd: backendRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(
            [
              `eval harness exited with code ${exitCode}`,
              stdout.trim() ? `stdout:\n${stdout}` : '',
              stderr.trim() ? `stderr:\n${stderr}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          ),
        );
        return;
      }
      resolve({ exitCode, stdout, stderr });
    });
  });
}
