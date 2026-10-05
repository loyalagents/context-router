export interface UploadPolicy {
  mimeTypes: string[];
  maxFileSizeBytes: number;
}
const extensions: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  pdf: 'application/pdf',
};
export function localFileMime(file: Pick<File, 'name' | 'type'>): string {
  return file.type && file.type !== 'application/octet-stream'
    ? file.type
    : (extensions[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '');
}
export function validateLocalFile(
  file: Pick<File, 'size' | 'name' | 'type'>,
  policy: UploadPolicy,
): string | null {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size <= 0 ||
    file.size > policy.maxFileSizeBytes
  )
    return `Choose a nonempty file no larger than ${Math.floor(policy.maxFileSizeBytes / 1024 / 1024)} MB.`;
  if (!policy.mimeTypes.includes(localFileMime(file)))
    return 'This file format is not supported by the selected runtime. Images and OCR are unavailable.';
  return null;
}
/** Bounded by validateLocalFile before reading. Never log or retain detected contents. */
export async function reviewLocalFile(
  file: File,
  policy: UploadPolicy,
  signal: AbortSignal,
): Promise<boolean> {
  const invalid = validateLocalFile(file, policy);
  if (invalid) throw new Error(invalid);
  signal.throwIfAborted();
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  const text = new TextDecoder().decode(bytes);
  const suspicious =
    /(?:^|[._-])(?:env|secrets?|credentials?|id_rsa|id_ed25519|private[._-]?key)(?:[._-]|$)/i.test(
      file.name,
    ) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{16,})|(?:api[_-]?key|password|secret|access[_-]?token)\s*[=:]\s*\S+/i.test(
      text,
    );
  return (
    !suspicious ||
    window.confirm(
      'This file may contain a secret or credential. Review and remove secrets first. Continue uploading this file to the local model?',
    )
  );
}
export function operationFailure(error: unknown, signal: AbortSignal): string {
  return signal.aborted
    ? 'Operation cancelled or deadline reached. No result was published. Check model status before starting another operation.'
    : error instanceof Error
      ? error.message
      : 'Operation failed. Check model status.';
}
