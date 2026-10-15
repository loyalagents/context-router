#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadDemoPlan, defaultInput, summarize, validateDataset } from "./records.mjs";

export function parseOptions(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    input: { type: 'string' }, dataset: { type: 'string' }, agent: { type: 'string' }, auth: { type: 'string' }, out: { type: 'string' }, root: { type: 'string' },
    home: { type: 'string' }, fresh: { type: 'boolean' }, login: { type: 'boolean' }, config: { type: 'string' }, proposal: { type: 'string' }, 'desktop-closed': { type: 'boolean' },
    port: { type: 'string' }, 'mcp-port': { type: 'string' }, help: { type: 'boolean' },
  } });
  const command = values.help ? 'help' : positionals[0] ?? 'inspect';
  if (positionals.length > 1 || !['inspect', 'prepare', 'serve', 'verify', 'status', 'claude', 'codex', 'desktop-prepare', 'desktop-apply', 'help'].includes(command)) {
    throw new Error('Unknown command. Use --help.');
  }
  if ((values.home && (values.root || values.out)) || (values.root && values.out)) throw new Error('Do not mix --home with legacy --root/--out.');
  if (values.out && command !== 'prepare') throw new Error('--out is only valid with prepare.');
  if (values.root && !['serve', 'verify', 'status', 'claude', 'codex'].includes(command)) throw new Error('--root is only valid for an existing legacy demo.');
  if (values.fresh && (command !== 'prepare' || values.out)) throw new Error('--fresh is only valid with durable prepare.');
  if (values.login && command !== 'codex') throw new Error('--login is only valid with codex.');
  if (values.config && command !== 'desktop-prepare') throw new Error('--config is only valid with desktop-prepare.');
  if ((values.proposal || values['desktop-closed']) && command !== 'desktop-apply') throw new Error('--proposal/--desktop-closed require desktop-apply.');
  if (command === 'desktop-apply' && (!values.proposal || !values['desktop-closed'])) throw new Error('desktop-apply requires --proposal and explicit --desktop-closed attestation.');
  if (values.agent && (!['a', 'b'].includes(values.agent) || !['codex', 'claude'].includes(command))) throw new Error('--agent a|b is only valid with codex or claude.');
  if (values.auth && (!['api-key', 'subscription'].includes(values.auth) || command !== 'claude')) throw new Error('--auth api-key|subscription is only valid with claude.');
  const port = values.port ?? '3003', mcpPort = values['mcp-port'] ?? '8788';
  for (const value of [port, mcpPort]) {
    if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535) throw new Error('Invalid port.');
  }
  if (port === mcpPort && (values.root || values.out || (values.port !== undefined && values['mcp-port'] !== undefined))) throw new Error('Dashboard and MCP ports must be distinct.');
  return { command, agent: values.agent, auth: values.auth, dataset: validateDataset(values.dataset ?? 'demo001'), input: values.input ?? defaultInput,
    home: values.home, fresh: values.fresh, login: values.login, config: values.config, proposal: values.proposal, desktopClosed: values['desktop-closed'], explicit: Object.keys(values),
    out: values.out, root: values.root, port: Number(port), mcpPort: Number(mcpPort) };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.command === 'help') {
    console.log('Usage: node examples/demo-10-2026/demo.mjs inspect|prepare [--fresh]|status|verify|serve|codex --agent a|b [--login]|claude --agent a|b --auth subscription|desktop-prepare [--config /absolute/config.json]|desktop-apply --proposal /absolute/proposal.json --desktop-closed\nDurable commands use --home /private/durable/home or the macOS Application Support default; ports come from the selected generation (initially 3004/8789).\nLegacy: prepare --out /new/private/directory; serve|verify|status|codex|claude --root /existing/demo (3003/8788).\nPrepare accepts --input, --dataset, --port and --mcp-port. Fresh preserves prior generations. Stop serve before strict verify. See README for login and explicit Desktop apply.');
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
  const home = await import('./home.mjs');
  if (options.command === 'prepare') {
    const receipt = options.out ? await runtime.prepareDemo(options) : await home.prepareHome({ home: options.home, fresh: options.fresh,
      ...Object.fromEntries([['input', 'input'], ['dataset', 'dataset'], ['port', 'port'], ['mcp-port', 'mcpPort']].filter(([flag]) => options.explicit.includes(flag)).map(([, key]) => [key, options[key]])) });
    console.log(JSON.stringify({ status: 'prepared', root: receipt.root, dataset: receipt.dataset, ...(options.out ? {} : { generation: receipt.generation, port: receipt.port, mcpPort: receipt.mcpPort, profileRoot: receipt.profileRoot }) }, null, 2));
  } else if (options.command === 'desktop-apply') {
    console.log(JSON.stringify(await (await import('./desktop-setup.mjs')).applyDesktop({ home: options.home, proposal: options.proposal, desktopClosed: options.desktopClosed }), null, 2));
  } else {
    const selected = options.root ? options : await home.resolveHome({ home: options.home, allowLocked: options.command === 'status' });
    if (!options.root && [['port', 'port'], ['mcp-port', 'mcpPort'], ['dataset', 'dataset']].some(([flag, key]) => options.explicit.includes(flag) && options[key] !== selected[key])) throw runtime.safeError('Explicit options conflict with the selected generation.');
    const resolved = { ...options, ...selected }; // Pin this invocation; never reread current at client launch.
    if (options.command === 'verify') console.log(JSON.stringify(await runtime.verifyDemo(resolved.root), null, 2));
    else if (options.command === 'status') console.log(JSON.stringify({ ...selected, ...(await runtime.statusDemo(resolved.root)) }, null, 2));
    else if (options.command === 'serve') process.exitCode = await runtime.serveDemo(resolved);
    else if (options.command === 'desktop-prepare') console.log(JSON.stringify(await (await import('./desktop-setup.mjs')).prepareDesktop({ ...resolved, config: options.config }), null, 2));
    else process.exitCode = await (await import('./clients.mjs')).launchClient(resolved);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Runtime errors can contain private values or transport headers. Do not echo them.
    console.error(`Demo command failed. ${error?.demoSafeMessage ?? 'Check arguments, pinned builds, and the private preparation status. Existing state was not reset.'}`);
    process.exitCode = 1;
  });
}
