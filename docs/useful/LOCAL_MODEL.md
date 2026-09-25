# Manual Local Model Preview

- Status: useful; Step 06 candidate, final qualification recorded in the linked implementation evidence
- Read when: operating the explicit non-listening SQLite model preview
- Source of truth: `apps/backend/src/infrastructure/local-model/`, `apps/backend/src/config/local-model.config.ts`, and `scripts/local-migration/fixtures/local-model-feasibility/native.mjs`
- Last reviewed: 2026-09-24

## Supported Configuration

Use pinned llama.cpp **b11146**, source `7fe450e19305b828c199d602c23a8337aaa1f03b`, and **Qwen3.5-9B Q4_K_M** on the qualified M1 Max, 64 GiB, macOS 15.1.1 arm64 machine. Other hardware/operating systems remain unqualified. Node must be 24.21.0 and pnpm 10.25.0. The [selection](../plans/active/local-migration/06-local-model/selection.md) records provenance, licenses, historical failures, cancellation/resource evidence and the accepted email-omission limitation; [implementation evidence](../plans/active/local-migration/06-local-model/implementation.md) distinguishes application qualification from CP1.

The operator installs and starts inference. The application owns its HTTPS connections and a bounded PDF parsing child. It never downloads, starts, kills or restarts inference, selects another runtime, or falls back to a hosted provider. The manual server arrangement is a Step 06 boundary; Step 09 owns managed installation, storage and process supervision.

Keep runtime binaries and model weights **outside the repository**. They are not Git assets or package dependencies. The current consented experiment stores them under `/private/tmp/context-router-step06-assets`; the 9B GGUF is about 5.68 GB. Temporary storage may be cleared by the OS or an operator, so it is not durable storage. Losing these files makes inference unavailable without deleting application data. The application will not download replacements automatically. Keep database/identity data in their separately chosen durable private roots.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `llama-b11146-bin-macos-arm64.tar.gz` | 11,189,714 | `1ad3f9eff80edb9dbef4259ad564d1720612ef7eea48fa4afed0e54f5f3d5711` |
| `Qwen3.5-9B-Q4_K_M.gguf` | 5,680,522,464 | `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8` |

Obtain only these pinned artifacts from the [plan's exact source revisions](../plans/active/local-migration/06-local-model/plan.md#checkpoints), verify byte counts and SHA-256 before extraction/use, and retain the MIT runtime and Apache-2.0 model licenses. Do not substitute the failed 4B candidate or a newer runtime without qualification. PDF.js 6.3.289 is pinned as a build dependency; the ordinary backend build verifies and copies only its required license/package/two bundles into the installed parser closure. No model weights are embedded in the application.

## One Fresh Exclusive Session

First initialize the separate SQLite database and identity roots following [local identity administration](LOCAL_IDENTITY_ADMIN.md). Use a third, distinct canonical absolute directory for model credentials. It must not overlap either application root. All ancestors must be trusted root/current-user-owned directories without symlinks or foreign write access. A root-owned sticky temporary directory is permitted only when followed by a current-user-owned directory.

Every runtime/backend session requires new credentials and a new root. The root must be current-user-owned `0700`; `api-key.txt` and `server-cert.pem` must be regular single-link `0600` files. The runtime private key must also stay private. Example provisioning, run under the pinned Node runtime:

```sh
umask 077
SESSION_PARENT=/absolute/canonical/private-parent
LOCAL_MODEL_SESSION_ROOT=$(mktemp -d "$SESSION_PARENT/model-session.XXXXXX")
export LOCAL_MODEL_SESSION_ROOT
chmod 700 "$LOCAL_MODEL_SESSION_ROOT"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -nodes -sha256 -days 1 -subj /CN=ContextRouterLocal \
  -addext subjectAltName=IP:127.0.0.1 -addext basicConstraints=critical,CA:TRUE \
  -keyout "$LOCAL_MODEL_SESSION_ROOT/server-key.pem" \
  -out "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem"
node -e 'const fs=require("node:fs"),crypto=require("node:crypto");fs.writeFileSync(process.env.LOCAL_MODEL_SESSION_ROOT+"/api-key.txt",crypto.randomBytes(32).toString("hex")+"\n",{flag:"wx",mode:0o600})'
chmod 600 "$LOCAL_MODEL_SESSION_ROOT/server-key.pem" "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem"
export LOCAL_MODEL_PORT=58080
```

Choose an unused numeric port. Start exactly one directly bound runtime, exclusively for this backend; retain the exact process handle in your terminal. Set `LLAMA_SERVER` and `LOCAL_MODEL_FILE` to the verified absolute artifact paths:

```sh
"$LLAMA_SERVER" --model "$LOCAL_MODEL_FILE" \
  --host 127.0.0.1 --port "$LOCAL_MODEL_PORT" --alias step06-qwen35 \
  --ctx-size 16384 --parallel 1 --gpu-layers all --flash-attn on --fit off \
  --batch-size 512 --ubatch-size 512 --load-mode mmap --offline \
  --api-key-file "$LOCAL_MODEL_SESSION_ROOT/api-key.txt" \
  --ssl-key-file "$LOCAL_MODEL_SESSION_ROOT/server-key.pem" \
  --ssl-cert-file "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem" \
  --chat-template-kwargs '{"enable_thinking":false}' \
  --no-webui --slots --no-context-shift --cache-ram 0 \
  --no-cache-idle-slots --no-cache-prompt --log-verbosity 3 --threads-http 4
```

Do not enable TRACE/DEBUG or request-body logging. Do not put key bytes in argv, environment, logs or issues. Other clients, proxies, routers, shared listeners, reuse-port, copied certificates and replacing the runtime behind existing credentials are unsupported. TLS pins the configured certificate and literal peer; it cannot attest the binary/model or prove the operator followed the exclusive-session rules.

In a separate terminal, select the same credential-root path and port, plus the existing database and identity root paths, then run:

```sh
pnpm --filter backend local-identity preview-model
```

The command uses the actual Nest/SQLite composition but opens **no application listener**. Its fixed readiness record means application initialization succeeded; it does not mean inference is ready. This step offers in-process integration and qualification, not a browser/MCP endpoint. Ordinary `local-identity preview` ignores model variables. Missing/malformed model selection and missing/offline inference preserve non-AI behavior; model calls return fixed errors. Hosted and explicit PostgreSQL reference modes remain unchanged.

## Claim, Cancellation And Recovery

At the first model operation/status check, the backend validates and snapshots private configuration, then exclusively creates and fsyncs `backend-session.claim`. It never removes or reclaims that marker, even after normal shutdown or failed initialization. The runtime's TLS private key is not read by the backend. Both AI aliases share the same claim, admission owner and unavailable latch.

One operation can run; there is no queue. Cancellation rejects promptly. Reuse requires request-specific admission evidence and fresh idle evidence on the retained control connection. Unwitnessed dispatch, lost continuity or uncertain cleanup leaves the session permanently unavailable. Generic idle, polling, configuration reload or reconstructing the backend cannot clear that state.

For recovery or a normal restart, stop **both exact old processes and wait for their actual exits**. Provision a new private root, API key, certificate and private key, then start a new runtime/backend pair. Never delete a claim to reuse its credentials. Application shutdown closes only application-owned connections/parser work; it does not stop the manually owned runtime. Same UID/root/debugger access and compromised host/runtime are outside this protection boundary.

## Capabilities And Limits

Text, structured JSON and strict UTF-8 files support `text/plain`, `text/markdown`, `application/json`, `application/x-yaml`, `application/yaml` and `text/yaml`. PDF input supports the qualified text subset, including tested embedded non-Latin fonts. Encrypted, empty/image-only, malformed, auxiliary-font-dependent and over-limit documents fail explicitly. There is no OCR or local PNG/JPEG inference. Retained public upload/hosted MIME contracts do not imply local image capability.

Structured output must pass actual Zod and domain checks. The model proposes extraction/search/consolidation/form actions; ownership, grants, protected definitions and form constraints remain authoritative. Editable AcroForm filling uses local extraction/validation/filling. The accepted 9B quality limitation is omission of the known personal-email fact in the adversarial extraction fixture; it is not permission for other regressions. Live remote Harbor/provider comparison was unnecessary and was not run.

| Bound | Limit |
| --- | --- |
| Context / rendered input / output | 16,384 / 12,000 / 2,048 tokens |
| Prompt plus decoded document / schema / response | 128 KiB / 32 KiB / 256 KiB |
| File / PDF pages | 10 MiB / 50 pages |
| Workflow / inference / readiness / parser | 180 s / 120 s / 5 s / 10 s, clamped to one caller deadline |
| Correction | At most one for completed invalid JSON/Zod; no transport/auth/limit/cancellation retry |

Output is buffered, never silently truncated or salvaged. Typed errors include unavailable/unsafe configuration, busy, cancellation/deadline, unsupported input, size/context bounds and invalid response; existing public envelopes stay sanitized. The parser's 256-MiB JavaScript heap limit is not a total resident-memory guarantee. Native selection measured footprint below 18 GiB on the stated Mac; engine allocations and mapped weights overlap and are not a universal peak or support claim for smaller hardware.

The ordinary no-model adapter also uses the internal `AiError('unavailable')`
contract instead of an HTTP exception. Both previews have no listener; a future
public transport owns its error mapping. This is an intentional in-process
error-type change, not a promise of an HTTP 503 response. A status check reports
`unavailable` when its own five-second readiness budget expires; explicit caller
cancellation, invalid deadlines and an earlier caller deadline still reject.
It does not clear any unavailable latch or change recovery requirements.

Document analysis gives fixed actionable reasons for input/context limits,
busy inference and unavailable/unsafe configuration. Smaller documents can
resolve size limits; a consumed or uncertain session requires the manual
recovery above. Hosted generic errors stay unchanged. `PDF_INVALID` still
includes malformed input and parser infrastructure failures; a more precise
public distinction belongs to Step 08 and must not mislabel all such failures
as unsupported documents.

The Nest compiler hook verifies and stages pinned PDF assets on build, start,
development watch and debug watch emits, including after an asset is removed.
The hook runs before the compiled application starts. Production execution uses
only the copied closure and does not need the build dependency at runtime.
