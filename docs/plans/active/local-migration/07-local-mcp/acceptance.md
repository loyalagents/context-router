# Step 07: Real-Client Acceptance

Run this only after the draft PR handoff says **automated validation passed; manual acceptance pending**. Use the exact candidate SHA in that handoff. Do not merge or mark Step 07 complete until results are recorded. Help/version inspection covered Claude Code **2.1.284**, Codex CLI **0.142.3**, Node **24.21.0**, pnpm **10.25.0**, and MCP SDK **1.27.1**. Real CLI/model interactions are deliberately user-run, not an automated pass claim.

All application data below is synthetic in a newly created private root. Cloud-backed CLI assistants may send prompts and tool results to their providers; these tests do not prove the assistant is offline. Source and relocated-package application network independence is separately exercised by the automated gate. Do not enter real personal data, token values or inference keys into either assistant. Never enable shell tracing.

## 1. Verify The Existing Checkout And Prepare Private State

Use the existing repository, not a new clone/worktree. Stop if branch/SHA differ; preserve changes rather than resetting them.

```sh
cd /Users/lucasnovak/loyal-agents/context-router
git branch --show-current
git rev-parse HEAD
git status --short
# Expected branch: codex/local-migration-07-local-mcp
# Expected HEAD: the exact candidate SHA supplied in the handoff.
export PATH=/Users/lucasnovak/.nvm/versions/node/v24.21.0/bin:$PATH
node --version
pnpm --version
claude --version
codex --version
pnpm --filter backend prisma:generate
pnpm --filter backend build
set +x
umask 077
export STEP07_ROOT=$(mktemp -d /private/tmp/context-router-step07.XXXXXX)
export STEP07_REPO=/Users/lucasnovak/loyal-agents/context-router
export STEP07_PORT=18787
export LOCAL_DATABASE_ROOT="$STEP07_ROOT/data"
export LOCAL_IDENTITY_STATE_ROOT="$STEP07_ROOT/identity"
node apps/backend/dist/local-identity.js initialize
node apps/backend/dist/local-mcp.js backup --out "$STEP07_ROOT/before-upgrade"
node apps/backend/dist/local-mcp.js upgrade
node apps/backend/dist/local-mcp.js provision --label claude-step07 --out "$STEP07_ROOT/claude.token" > "$STEP07_ROOT/claude-admin.json"
node apps/backend/dist/local-mcp.js provision --label codex-step07 --out "$STEP07_ROOT/codex.token" > "$STEP07_ROOT/codex-admin.json"
STEP07_CLAUDE_ID=$(node -e 'console.log(require(process.env.STEP07_ROOT+"/claude-admin.json").result.id)')
STEP07_CODEX_ID=$(node -e 'console.log(require(process.env.STEP07_ROOT+"/codex-admin.json").result.id)')
export STEP07_CLAUDE_ID STEP07_CODEX_ID
node apps/backend/dist/local-mcp.js permissions --id "$STEP07_CLAUDE_ID" --capabilities preferences:write,preferences:define --targets 'synthetic.*'
node apps/backend/dist/local-mcp.js permissions --id "$STEP07_CODEX_ID" --capabilities preferences:read --targets 'synthetic.*'
node <<'JS'
const fs = require('node:fs');
const keys = ['STEP07_ROOT','STEP07_REPO','STEP07_PORT','STEP07_CLAUDE_ID','STEP07_CODEX_ID','LOCAL_DATABASE_ROOT','LOCAL_IDENTITY_STATE_ROOT'];
fs.writeFileSync(process.env.STEP07_ROOT+'/environment.sh',keys.map(k=>'export '+k+'='+JSON.stringify(process.env[k])).join('\n')+'\n',{flag:'wx',mode:0o600});
fs.writeFileSync(process.env.STEP07_ROOT+'/claude-mcp.json',JSON.stringify({mcpServers:{context_router_step07:{type:'http',url:'${CONTEXT_ROUTER_MCP_URL}',headers:{Authorization:'Bearer ${CONTEXT_ROUTER_MCP_TOKEN}'},timeout:190000}}},null,2),{flag:'wx',mode:0o600});
JS
printf 'Private test root: %s\n' "$STEP07_ROOT"
```

Keep that printed path. In every additional terminal, first run `source /private/tmp/context-router-step07.XXXXXX/environment.sh`, replacing `XXXXXX` with this exact generated suffix, then `cd "$STEP07_REPO"` and select the pinned Node PATH above. The environment file contains paths and IDs, never token bytes. Do not initialize these roots again. The two token exports must be distinct `0600` files; do not print their contents.

## 2. Start One Shared Backend

In a dedicated backend terminal:

```sh
node apps/backend/dist/local-mcp.js serve --port "$STEP07_PORT"
```

Expect one `context-router.local-mcp.ready` record with host `127.0.0.1`, the selected port and `modelConfigured:false`. Port conflicts fail; select a different unused port consistently in the environment/client commands instead of stopping an unrelated process. Keep this backend running while both clients connect. Application readiness does not certify model readiness.

## 3. Open Both Clients Securely

In the Claude terminal, after sourcing the environment file:

```sh
(
  set +x
  CONTEXT_ROUTER_MCP_TOKEN=$(cat "$STEP07_ROOT/claude.token") || exit 1
  test -n "$CONTEXT_ROUTER_MCP_TOKEN" || exit 1
  export CONTEXT_ROUTER_MCP_TOKEN
  export CONTEXT_ROUTER_MCP_URL="http://127.0.0.1:$STEP07_PORT/mcp"
  MCP_TOOL_TIMEOUT=190000 CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=190000 \
  CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0 \
    claude --strict-mcp-config --mcp-config "$STEP07_ROOT/claude-mcp.json"
)
```

In the Codex terminal:

```sh
(
  set +x
  CONTEXT_ROUTER_MCP_TOKEN=$(cat "$STEP07_ROOT/codex.token") || exit 1
  test -n "$CONTEXT_ROUTER_MCP_TOKEN" || exit 1
  export CONTEXT_ROUTER_MCP_TOKEN
  codex \
    -c "mcp_servers.context_router_step07.url=\"http://127.0.0.1:$STEP07_PORT/mcp\"" \
    -c 'mcp_servers.context_router_step07.bearer_token_env_var="CONTEXT_ROUTER_MCP_TOKEN"' \
    -c 'mcp_servers.context_router_step07.tool_timeout_sec=190' \
    -c 'mcp_servers.context_router_step07.enabled=true'
)
```

These commands do not overwrite saved client configuration. Claude's strict flag excludes other MCP configurations. Codex's per-run overrides leave unrelated configured/plugin servers enabled; use only `context_router_step07` for this test. For selective isolation, append `-c 'mcp_servers.NAME.enabled=false'` for each unrelated configured server, and `-c 'plugins."PLUGIN_ID".mcp_servers.SERVER.enabled=false'` for plugin servers. Installed interactive Codex has no verified blanket isolation flag; `--ignore-user-config` belongs to its `exec` command and is not used here. Normal CLI session/history persistence may still occur. Token variables live only inside the launch subshells; they are not command arguments or JSON token literals.

## 4. Read, Denial, Cross-Client Write And Simultaneous Use

Give each assistant this instruction: **Use only the `context_router_step07` MCP server for the following synthetic test. Do not read local credential/configuration files, use other servers, or put secrets in prompts. Report actual tool results; do not simulate success.** Approve the named synthetic tool calls through the client's normal interface.

1. In Claude, call `mutatePreferences` separately for these two definitions, then set a value. Definition scope `GLOBAL` here means a value not tied to a location; these user-created definitions remain personal to the stable human principal.

   ```json
   {"operation":"CREATE_DEFINITION","definition":{"slug":"synthetic.response_style","description":"Synthetic preferred response style","valueType":"STRING","scope":"GLOBAL"}}
   {"operation":"CREATE_DEFINITION","definition":{"slug":"synthetic.reply_style","description":"Synthetic alternate response style","valueType":"STRING","scope":"GLOBAL"}}
   {"operation":"SET_PREFERENCE","preference":{"slug":"synthetic.response_style","value":"\"brief\""}}
   ```

2. In Codex, call `searchPreferences` with `{}`. Expect `brief` for the synthetic slug, without unrelated catalog/value access. Attempt `SET_PREFERENCE` to `"denied"` and `CREATE_DEFINITION`. Expect authorization denial (the mutation tool may be absent from discovery); verify Claude still reads `brief`. Do not grant permission merely to make this denial test pass.
3. In the admin terminal, explicitly allow Codex value writes, leaving definition authority absent:

   ```sh
   node apps/backend/dist/local-mcp.js permissions --id "$STEP07_CODEX_ID" --capabilities preferences:write --targets 'synthetic.*'
   ```

   Reconnect/relaunch Codex if its tool discovery is cached. Have Codex set `synthetic.response_style` to `"detailed"`; Claude must read `detailed`. Request reads in both clients simultaneously. Both should succeed against the same backend. DEFINE remains denied to Codex.
4. Exit Claude normally. Codex must continue reading and the backend must remain running. Relaunch Claude with its same dedicated token. This is reconnection of one instance, not provisioning a new identity.
5. Before model setup, call `smartSearchPreferences` with a short synthetic query. Expect a fixed unavailable error. `context-router://capabilities` reports unavailable/unconfigured; ordinary reads still work. `consolidateSchema` with two allowed personal definitions must also report unavailable. Fewer than two definitions can legitimately return a no-analysis success.

## 5. Restart And Independent Revocation

Stop the backend with Ctrl-C in its own terminal and wait for the shell prompt (conventional exit 130). Restart the same `serve` command with the same roots. Relaunch/reconnect clients because in-memory session IDs expire at restart. Both must read `detailed` without recreating identity or data.

In the admin terminal:

```sh
node apps/backend/dist/local-mcp.js revoke --id "$STEP07_CLAUDE_ID"
node apps/backend/dist/local-mcp.js list
```

Claude's next request/reconnect must fail authentication; Codex must still read/write. Do not follow an OAuth login flow for this local endpoint. Stop/restart the backend again and verify revocation and the latest Codex value both persist. An already admitted call can finish after revocation; this does not authorize a later request. Record any ambiguous mutation result instead of automatically retrying it.

## 6. Bounded Selected-Model Acceptance

Reuse already verified Step 06 artifacts. This checklist does not authorize downloads, model changes or renewed benchmarking. Stop the no-model backend and wait for its exit. Use the same database/identity/MCP files. In a dedicated model terminal, after sourcing the environment:

```sh
export LLAMA_SERVER=/private/tmp/context-router-step06-assets/runtime/llama-b11146/llama-server
export LOCAL_MODEL_FILE=/private/tmp/context-router-step06-assets/Qwen3.5-9B-Q4_K_M.gguf
test -x "$LLAMA_SERVER" && test -f "$LOCAL_MODEL_FILE"
umask 077
export LOCAL_MODEL_SESSION_ROOT=$(mktemp -d "$STEP07_ROOT/model-session.XXXXXX")
export LOCAL_MODEL_PORT=58080
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -nodes -sha256 -days 1 -subj /CN=ContextRouterLocal \
  -addext subjectAltName=IP:127.0.0.1 -addext basicConstraints=critical,CA:TRUE \
  -keyout "$LOCAL_MODEL_SESSION_ROOT/server-key.pem" -out "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem"
node -e 'const fs=require("node:fs"),crypto=require("node:crypto");fs.writeFileSync(process.env.LOCAL_MODEL_SESSION_ROOT+"/api-key.txt",crypto.randomBytes(32).toString("hex")+"\n",{flag:"wx",mode:0o600})'
chmod 600 "$LOCAL_MODEL_SESSION_ROOT/server-key.pem" "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem"
printf 'Fresh model session: %s\n' "$LOCAL_MODEL_SESSION_ROOT"
"$LLAMA_SERVER" --model "$LOCAL_MODEL_FILE" --host 127.0.0.1 --port "$LOCAL_MODEL_PORT" \
  --alias step06-qwen35 --ctx-size 16384 --parallel 1 --gpu-layers all --flash-attn on --fit off \
  --batch-size 512 --ubatch-size 512 --load-mode mmap --offline \
  --api-key-file "$LOCAL_MODEL_SESSION_ROOT/api-key.txt" \
  --ssl-key-file "$LOCAL_MODEL_SESSION_ROOT/server-key.pem" --ssl-cert-file "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem" \
  --chat-template-kwargs '{"enable_thinking":false}' --no-webui --slots --no-context-shift \
  --cache-ram 0 --no-cache-idle-slots --no-cache-prompt --log-verbosity 3 --threads-http 4
```

If the verified artifacts are absent, report that limitation; do not download replacements as part of this checklist. Use an unused inference port consistently. In the backend terminal export the **same printed fresh model-root path** and model port, then wait for this bounded health check to succeed and print **200**:

```sh
export LOCAL_MODEL_SESSION_ROOT=/private/tmp/context-router-step07.XXXXXX/model-session.XXXXXX
export LOCAL_MODEL_PORT=58080
curl -q --noproxy '*' --cacert "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem" \
  --connect-timeout 2 --max-time 5 --fail --silent --show-error \
  --output /dev/null --write-out '%{http_code}\n' "https://127.0.0.1:$LOCAL_MODEL_PORT/health"
node apps/backend/dist/local-mcp.js serve-model --port "$STEP07_PORT"
```

Do not issue a capability/model operation while inference is still loading. An early missing-key readiness probe receiving loading 503 instead of required 401 can consume/latch the session. See the full [model prerequisites and recovery](../../../../useful/LOCAL_MODEL.md).

Reconnect Codex, then read `context-router://capabilities` and perform **one** `smartSearchPreferences` call asking for the synthetic response style. Expect available capability and a successful result restricted to allowed synthetic definitions/values. One `consolidateSchema` call over the two synthetic personal definitions should return the existing advisory shape, without modifying definitions. Each adapter operation is capped at 120 seconds inside a 180-second workflow; the client timeout is 190 seconds. Report any tool timeout/error as observed, without retries or quality benchmarking.

For a single cancellation check, cancel one in-flight AI tool through the CLI's normal cancellation control. If it finishes before cancellation, record that instead of claiming cancellation. After the request ends, allow the separate five-second settlement interval, then check capabilities and a non-AI read. **Accepted H permits AI to remain unavailable**; a successful idle witness may also leave it available. Repeated polling cannot clear a latch. A CLI that only disconnects may leave the admitted operation running until its deadline; the server does not treat disconnect as cancellation. Report the actual client behavior.

## 7. Recovery, Cleanup And Report

If AI is latched unavailable, stop the exact backend and inference processes in their own terminals with Ctrl-C and wait for both shell prompts. Keep database, identity and MCP credentials. Provision a new model-session root/key/certificate, restart the same pinned inference runtime, wait for health=200, and start a fresh backend. **Never delete a claim or reuse consumed model credentials.** One fresh-session recovery is sufficient for this acceptance; stop and report a repeat failure. Accepted E remains only the previously documented personal-email omission, not a waiver for other defects.

For final cleanup, exit both client sessions, stop/reap the backend and model runtime, and keep the private test root until results are understood. No saved MCP configuration was added by these per-run commands. Remove only this exact synthetic root when finished, after all four processes have exited:

```sh
case "$STEP07_ROOT" in
  /private/tmp/context-router-step07.??????)
    test -d "$STEP07_ROOT" && test ! -L "$STEP07_ROOT" && rm -rf -- "$STEP07_ROOT"
    ;;
  *) printf 'Refusing unexpected test root\n' ;;
esac
unset CONTEXT_ROUTER_MCP_TOKEN LOCAL_MODEL_SESSION_ROOT LOCAL_MODEL_PORT
```

This does not remove shared model assets or any existing application state. Do not use broad process-kill or Docker cleanup commands.

Report candidate SHA, CLI versions, pass/fail for steps 4–6, observed cancellation/H outcome, whether both old processes exited for recovery, and any fixed error text. Redact tokens, private file contents and unrelated personal output. Keep the PR draft until defects, affected reviews/tests and required manual evidence are resolved; never merge automatically.
