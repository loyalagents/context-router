#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadDemoPlan, defaultInput, summarize, validateDataset } from "./records.mjs";

export function parseOptions(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    input: { type: 'string' }, dataset: { type: 'string' }, agent: { type: 'string' }, out: { type: 'string' }, root: { type: 'string' },
    port: { type: 'string' }, 'mcp-port': { type: 'string' }, help: { type: 'boolean' },
  } });
  const command = values.help ? 'help' : positionals[0] ?? 'inspect';
  if (positionals.length > 1 || !['inspect', 'prepare', 'serve', 'verify', 'claude', 'codex', 'help'].includes(command)) {
    throw new Error('Unknown command. Use --help.');
  }
  if (command === 'prepare' && !values.out) throw new Error('prepare requires --out with a new directory.');
  if (['serve', 'verify', 'claude', 'codex'].includes(command) && !values.root) throw new Error(`${command} requires --root.`);
  if (values.agent && (!['a', 'b'].includes(values.agent) || command !== 'codex')) throw new Error('--agent a|b is only valid with codex.');
  const port = values.port ?? '3003', mcpPort = values['mcp-port'] ?? '8788';
  for (const value of [port, mcpPort]) {
    if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535) throw new Error('Invalid port.');
  }
  if (port === mcpPort) throw new Error('Dashboard and MCP ports must be distinct.');
  return { command, agent: values.agent, dataset: validateDataset(values.dataset ?? 'demo001'), input: values.input ?? defaultInput, out: values.out, root: values.root, port: Number(port), mcpPort: Number(mcpPort) };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.command === 'help') {
    console.log('Usage: node examples/demo-10-2026/demo.mjs [inspect | prepare --out /new/private/directory | verify --root /existing/demo | serve --root /existing/demo | claude --root /existing/demo | codex --root /existing/demo --agent a|b]\nOptional: --input /source/jsonl-directory, --dataset demo001, --port 3003, --mcp-port 8788.\ninspect is read-only. prepare never reuses or deletes state. Stop serve before verify. Client commands start cloud-backed assistants only when you explicitly run them; see README for demo-only auth.');
    return;
  }
  if (options.command === 'inspect') {
    console.log(JSON.stringify(summarize(await loadDemoPlan(options.input, options.dataset)), null, 2));
    return;
  }
  if (process.versions.node !== '24.21.0' || ['NODE_OPTIONS', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'].some(name => process.env[name])) {
    throw new Error('Use Node 24.21.0 with Node debug/options variables unset.');
  }
  const runtime = await import('./runtime.mjs');
  if (options.command === 'prepare') {
    const receipt = await runtime.prepareDemo(options);
    console.log(JSON.stringify({ status: 'prepared', root: options.out, active: receipt.active, inactiveSkipped: receipt.inactiveSkipped, next: `serve --root ${options.out}` }, null, 2));
  } else if (options.command === 'verify') {
    console.log(JSON.stringify(await runtime.verifyDemo(options.root), null, 2));
  } else if (options.command === 'serve') {
    process.exitCode = await runtime.serveDemo(options);
  } else {
    process.exitCode = await (await import('./clients.mjs')).launchClient(options);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Runtime errors can contain private values or transport headers. Do not echo them.
    console.error(`Demo command failed. ${error?.demoSafeMessage ?? 'Check arguments, pinned builds, and the private preparation status. Existing state was not reset.'}`);
    process.exitCode = 1;
  });
}
