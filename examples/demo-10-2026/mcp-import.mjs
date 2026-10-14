import { createRequire } from 'node:module';
import { readCredential } from '../../apps/backend/scripts/mcp-bridge/credential.mjs';
const require = createRequire(new URL('../../apps/backend/package.json', import.meta.url));
const safeError = message => Object.assign(new Error(message), { demoSafeMessage: message });

export async function connect(port, credentialFile) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'context-router-demo-check', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${readCredential(credentialFile)}` }, redirect: 'error' },
  });
  try {
    await client.connect(transport);
    await client.listTools();
    return client;
  } catch {
    await client.close().catch(() => {});
    throw safeError('Demo MCP connection failed. Check the owned server and credential.');
  }
}

export async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const payload = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text')?.text ?? 'null');
  if (result.isError || payload?.success !== true) {
    const error = safeError('Demo MCP operation failed; no automatic retry was made.');
    error.code = typeof payload?.code === 'string' ? payload.code : 'MCP_OPERATION_FAILED';
    throw error;
  }
  return payload;
}

export async function importEntries(client, entries) {
  try {
    for (const entry of entries) {
      const result = await call(client, 'mutatePreferences', { operation: 'CREATE_DEFINITION', definition: entry.definition });
      const def = result.definition;
      if (result.changed !== true || def?.slug !== entry.definition.slug || def.valueType !== 'STRING' ||
          def.scope !== 'GLOBAL' || def.isSensitive !== true || def.visibility !== 'USER') throw new Error();
      const written = await call(client, 'mutatePreferences', { operation: 'SET_PREFERENCE', preference: entry.preference });
      if (written.changed !== true || written.preference?.slug !== entry.definition.slug ||
          written.preference.value !== JSON.parse(entry.preference.value)) throw new Error();
    }
  } catch {
    throw safeError('Import stopped. Partial state was preserved; do not replay uncertain writes. Prepare a new directory for a fresh rehearsal.');
  }
}
