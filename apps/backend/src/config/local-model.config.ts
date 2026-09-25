import { isAbsolute, parse, resolve } from 'node:path';

/** Read only in explicit preview-model mode. Credentials are claimed lazily by the adapter. */
export interface LocalModelSelection { readonly root: string; readonly port: number }
export function createLocalModelSelection(environment: NodeJS.ProcessEnv = process.env): LocalModelSelection | undefined {
  const root = environment.LOCAL_MODEL_SESSION_ROOT;
  const portText = environment.LOCAL_MODEL_PORT;
  if (typeof root !== 'string' || !root || Buffer.byteLength(root) > 4096 || /[\u0000-\u001f\u007f]/u.test(root) ||
      !isAbsolute(root) || resolve(root) !== root || root === parse(root).root ||
      typeof portText !== 'string' || !/^[1-9][0-9]{0,4}$/u.test(portText)) return undefined;
  const port = Number(portText);
  if (port > 65535) return undefined;
  return Object.freeze({ root, port });
}
