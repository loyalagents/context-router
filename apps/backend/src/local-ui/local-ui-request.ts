import type { IncomingMessage } from 'node:http';
import type { AiExecutionOptions } from '../domains/shared/ports/ai-execution';
import type { LocalUiAiPolicy } from './local-ui-ai';
export const UI_EXECUTION = Symbol('local-browser-execution');
export const UI_REVALIDATE = Symbol('local-browser-revalidate');
export const UI_UPLOAD_POLICY = Symbol('local-browser-upload-policy');
export type LocalUiRequest = IncomingMessage & {
  [UI_EXECUTION]?: Readonly<AiExecutionOptions>;
  [UI_REVALIDATE]?: () => void;
  [UI_UPLOAD_POLICY]?: LocalUiAiPolicy;
};
export function revalidateBrowserRequest(req?: LocalUiRequest): void {
  req?.[UI_REVALIDATE]?.();
}
export function readBrowserBearer(
  req: Pick<IncomingMessage, 'headers' | 'rawHeaders'>,
): string | null {
  const count = req.rawHeaders.filter(
    (_, i) =>
      i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'authorization',
  ).length;
  const value = req.headers.authorization;
  if (count !== 1 || typeof value !== 'string') return null;
  return /^Bearer (cr_ui_session_[A-Za-z0-9_-]{43})$/.exec(value)?.[1] ?? null;
}
export function browserExecution(
  req?: LocalUiRequest,
): Readonly<AiExecutionOptions> | undefined {
  return req?.[UI_EXECUTION];
}
