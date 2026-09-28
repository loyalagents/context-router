# Manual Local Model Preview

- Status: useful; manual Step 06 configuration with accepted accuracy and cancellation-recovery limitations
- Read when: operating the explicit non-listening SQLite model preview
- Source of truth: `apps/backend/src/infrastructure/local-model/`, `apps/backend/src/config/local-model.config.ts`, and `scripts/local-migration/fixtures/local-model-feasibility/native.mjs`
- Last reviewed: 2026-09-28

## Supported Configuration

The user accepted that cancellation may leave this manual model session
unavailable and require manual recovery. The five-second cancellation recovery
test remains failed; later diagnostic successes did not establish its cause or
frequency. This is a documented availability limitation, not a passing recovery
qualification. The deadline and safeguards remain unchanged. See the
[accepted selection limitation](../plans/active/local-migration/06-local-model/selection.md#accepted-cancellation-recovery-limitation)
and recovery instructions below.

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

The example certificate expires **one day after creation**, not one day after backend startup. Plan the session around its actual expiry time. Expiry makes new verified TLS connections fail; an already-established connection is not an application-level expiry timer. Each new model operation performs fresh readiness connections, so an expired certificate prevents further operations. Use the fresh-session recovery below; do not extend or replace credentials inside a consumed session.

In a separate terminal, select the same credential-root path and port, plus the existing database and identity root paths. **Wait for the runtime to finish loading before the first application model operation or status check.** Application initialization alone does not establish model readiness. A bounded public health check is:

```sh
curl -q --noproxy '*' --cacert "$LOCAL_MODEL_SESSION_ROOT/server-cert.pem" \
  --connect-timeout 2 --max-time 5 --fail --silent --show-error \
  --output /dev/null --write-out '%{http_code}\n' \
  "https://127.0.0.1:$LOCAL_MODEL_PORT/health"
```

Proceed only if the command succeeds **and prints `200`**. A `503` means loading is incomplete; wait and manually repeat this bounded check. Other failures require checking setup. The command ignores ambient curl configuration, bypasses proxies, verifies the configured certificate and does not send an API key, follow redirects or submit inference. Its public health result does not replace the application's authenticated checks and missing/wrong-key controls.

The pinned runtime [starts its HTTP listener before model loading](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server.cpp#L425) and [checks loading state before authentication](https://github.com/ggml-org/llama.cpp/blob/7fe450e19305b828c199d602c23a8337aaa1f03b/tools/server/server-http.cpp#L280). If the application's first missing-key probe receives loading `503` instead of the required `401`, the application permanently marks the session unavailable without sending user data. A later healthy response cannot recover that consumed session; follow fresh-session recovery. This startup prerequisite is separate from the accepted cancellation-recovery limitation.

After runtime readiness is confirmed, run:

```sh
pnpm --filter backend local-identity preview-model
```

The command uses the actual Nest/SQLite composition but opens **no application listener**. Its fixed readiness record means application initialization succeeded; it does not mean inference is ready. This step offers in-process integration and qualification, not a browser/MCP endpoint. Ordinary `local-identity preview` ignores model variables. Missing/malformed model selection and missing/offline inference preserve non-AI behavior; model calls return fixed errors. Hosted and explicit PostgreSQL reference modes remain unchanged.

## Claim, Cancellation And Recovery

At the first model operation/status check, the backend validates and snapshots private configuration, then exclusively creates and fsyncs `backend-session.claim`. It never removes or reclaims that marker, even after normal shutdown or failed initialization. The runtime's TLS private key is not read by the backend. Both AI aliases share the same claim, admission owner and unavailable latch.

One operation can run; there is no queue. Cancellation rejects promptly. Reuse requires request-specific admission evidence and fresh idle evidence on the retained control connection. Unwitnessed dispatch, lost continuity or uncertain cleanup leaves the session permanently unavailable. Generic idle, polling, configuration reload or reconstructing the backend cannot clear that state.

**Known limitation:** if fresh idle cannot be verified within five seconds after cancellation, AI operations remain unavailable for the rest of that session. The caller's cancellation returns promptly; the failed verification does not authorize another request. This can require operator intervention at an unknown frequency. Non-AI behavior remains available until the operator restarts the backend. Waiting, retrying or polling will not clear the latch.

For recovery or a normal restart, stop **both exact old processes and wait for their actual exits**. Provision a new private root, API key, certificate and private key, then start a new runtime/backend pair. Never delete a claim to reuse its credentials. Application shutdown closes only application-owned connections/parser work; it does not stop the manually owned runtime. Same UID/root/debugger access and compromised host/runtime are outside this protection boundary. Keep the existing database and identity roots and downloaded model/runtime assets; recovery does not require deleting application data or downloading the model again.

Step 09 owns revisiting this recovery burden during runtime and packaging qualification. Bring forward a local-model maintenance investigation if manual recovery becomes disruptive. Future supervision must preserve ownership and must not clear uncertain work merely because a timeout occurred.

## Capabilities And Limits

Text, structured JSON and strict UTF-8 files support `text/plain`, `text/markdown`, `application/json`, `application/x-yaml`, `application/yaml` and `text/yaml`. PDF input supports the qualified text subset, including tested embedded non-Latin fonts. Encrypted, empty/image-only, malformed, auxiliary-font-dependent and over-limit documents fail explicitly. There is no OCR or local PNG/JPEG inference. Retained public upload/hosted MIME contracts do not imply local image capability.

Structured output must pass actual Zod and domain checks. The model proposes extraction/search/consolidation/form actions; ownership, grants, protected definitions and form constraints remain authoritative. Editable AcroForm filling uses local extraction/validation/filling. The accepted 9B quality limitation is omission of the known personal-email fact in the adversarial extraction fixture; it is not permission for other regressions. Live remote Harbor/provider comparison was unnecessary and was not run.

If duplicate consolidation raises a typed local error, including busy or invalid response after its allowed correction, the whole document analysis fails without publishing partial suggestions or choosing the first candidate as a fallback. Invalid response maps to the existing parse-error envelope; busy and availability failures map to the AI-error envelope. This discards that analysis's proposed results, not persisted preferences. Existing generic hosted-error fallback remains unchanged.

| Bound | Limit |
| --- | --- |
| Context / rendered input / output | 16,384 / 12,000 / 2,048 tokens |
| Prompt plus decoded document / schema / response | 128 KiB / 32 KiB / 256 KiB |
| File / PDF pages | 10 MiB / 50 pages |
| Workflow / adapter operation / readiness / parser | 180 s / 120 s / 5 s / 10 s, clamped to one caller deadline |
| Correction | At most one for completed invalid JSON/Zod; no transport/auth/limit/cancellation retry |

The 120-second cap is shared by one complete adapter operation: preparation/parsing, readiness, rendering/tokenization, completion and its optional correction. Those stages do not receive fresh 120-second budgets. Extraction and any subsequent duplicate-consolidation operations share the outer 180-second workflow deadline; every operation is also limited by that deadline's remaining time. Cancellation settlement retains its separate absolute five-second bound and may continue after the caller has received cancellation.

Output is buffered, never silently truncated or salvaged. Typed errors include unavailable/unsafe configuration, busy, cancellation/deadline, unsupported input, size/context bounds and invalid response; existing public envelopes stay sanitized. The parser's 256-MiB JavaScript heap limit is not a total resident-memory guarantee. Native selection measured footprint below 18 GiB on the stated Mac; engine allocations and mapped weights overlap and are not a universal peak or support claim for smaller hardware.

The ordinary no-model adapter also uses the internal `AiError('unavailable')`
contract instead of an HTTP exception. Both previews have no listener; a future
public transport owns its error mapping. This is an intentional in-process
error-type change, not a promise of an HTTP 503 response. A status check reports
`unavailable` when its own five-second readiness budget expires; explicit caller
cancellation, invalid deadlines and an earlier caller deadline still reject.
It does not clear any unavailable latch or change recovery requirements.

If a probe's timeout was limited by the caller/operation deadline, it preserves
the typed deadline error even when the timer fires fractionally before the
precise clock boundary. An earlier independent readiness or per-probe timeout
still reports unavailable. Cancellation retains precedence; budgets and cleanup
do not change.

Document analysis gives fixed actionable reasons for input/context limits,
busy inference and unavailable/unsafe configuration. Unavailable messages
direct operators to check setup first, and to use recovery when a model session
is already configured; ordinary no-model previews have no model session to
recover. Smaller documents can resolve size limits; a consumed or uncertain session requires the manual
recovery above. Hosted generic errors stay unchanged. `PDF_INVALID` still
includes malformed input and parser infrastructure failures; a more precise
public distinction belongs to Step 08 and must not mislabel all such failures
as unsupported documents.

The Nest compiler hook verifies and stages pinned PDF assets on build, start,
development watch and debug watch emits, including after an asset is removed.
The hook runs before the compiled application starts. Production execution uses
only the copied closure and does not need the build dependency at runtime.
