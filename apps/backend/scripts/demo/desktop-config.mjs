import { safeError } from './files.mjs';

// Shared by source and installed adapters: configuration is strict UTF-8 JSON,
// and every compare/replace decision uses the original bytes, not reserialized JSON.
export function parsedConfig(bytes) {
  let value;
  try { value = bytes === null ? {} : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw safeError('Desktop config must be valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value.mcpServers !== undefined && (!value.mcpServers || typeof value.mcpServers !== 'object' || Array.isArray(value.mcpServers)))) {
    throw safeError('Invalid Desktop config structure.');
  }
  return value;
}
export const sameConfigBytes = (a, b) => a === null ? b === null : b !== null && a.equals(b);
