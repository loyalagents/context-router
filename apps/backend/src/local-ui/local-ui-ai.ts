import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  LOCAL_AI_CAPABILITIES,
  type AiCapabilities,
} from '../domains/shared/ports/ai-execution';

export interface LocalUiUploadPolicy {
  readonly mimeTypes: readonly string[];
  readonly maxFileSizeBytes: number;
}
export interface LocalUiAiPolicy {
  readonly analysis: LocalUiUploadPolicy;
  readonly formFill: LocalUiUploadPolicy;
  readonly search: boolean;
  readonly strictExecutionControls: boolean;
}
export function createLocalUiAiPolicy(
  text: AiCapabilities,
  structured: AiCapabilities,
  configuration: Pick<ConfigService, 'getOrThrow'>,
): LocalUiAiPolicy {
  const upload = (
    key: 'documentUpload' | 'formFill',
    supported: readonly string[],
  ): LocalUiUploadPolicy => {
    const configured = configuration.getOrThrow<string[]>(
      `${key}.allowedMimeTypes`,
    );
    const limit = configuration.getOrThrow<number>(`${key}.maxFileSizeBytes`);
    if (
      !Array.isArray(configured) ||
      !Number.isSafeInteger(limit) ||
      limit <= 0
    )
      throw new Error('Invalid local upload configuration');
    return Object.freeze({
      mimeTypes: Object.freeze(
        supported.filter((mime) => configured.includes(mime)),
      ),
      maxFileSizeBytes: Math.min(limit, 10 * 1024 * 1024),
    });
  };
  return Object.freeze({
    analysis: upload(
      'documentUpload',
      structured.structured
        ? structured.fileMimeTypes.filter((mime) =>
            LOCAL_AI_CAPABILITIES.fileMimeTypes.includes(mime),
          )
        : [],
    ),
    formFill: upload(
      'formFill',
      structured.structured ? ['application/pdf'] : [],
    ),
    search: structured.structured,
    strictExecutionControls:
      text.strictExecutionControls && structured.strictExecutionControls,
  });
}
export async function validateLocalUpload(
  file: Express.Multer.File,
  policy?: LocalUiUploadPolicy,
): Promise<void> {
  if (!policy) return; // Hosted compatibility is owned by the existing controller checks.
  const reject = () => {
    throw new BadRequestException('Unsupported or invalid local upload');
  };
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.size !== file.buffer.length ||
    file.buffer.length > policy.maxFileSizeBytes ||
    !policy.mimeTypes.includes(file.mimetype)
  )
    return reject();
  if (file.mimetype === 'application/pdf') {
    if (
      !/^%PDF-[12]\.[0-9]/.test(file.buffer.subarray(0, 8).toString('ascii')) ||
      !/%%EOF\s*$/.test(file.buffer.subarray(-1024).toString('latin1'))
    )
      return reject();
    // Do not decompress attacker-controlled PDF objects in this shared process.
    // Analysis performs structural/text parsing in the existing bounded PdfProcess.
    // Form extraction retains its existing parser contract.
  } else {
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch {
      return reject();
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(decoded))
      return reject();
  }
}
