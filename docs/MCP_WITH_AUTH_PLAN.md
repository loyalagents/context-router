# Context Router — Path A2 (Remote OAuth + DCR Shim) Plan (Patched)
*Scope: Claude + ChatGPT only (no stdio bridge in v1)*  
*Last updated: 2025-12-13*

This is the “Path A2” plan, updated with the key implementation tweaks you listed:
- Avoid issuer mismatch pitfalls (discovery issuer vs token issuer)
- Ensure `resource` (RFC8707) works end-to-end with Auth0
- Make `/.well-known/*` + `/oauth/register` public + CORS-safe
- Rate-limit `/oauth/register` from day one
- Cleanly integrate with your existing NestJS guards
- Simplify env vars (`AUTH0_DOMAIN` → derive issuer/JWKS)

---

## 1) Goal
Eliminate manual token pasting by making your **remote MCP server** support a native OAuth flow for:
- **ChatGPT** (Developer Mode custom connector)
- **Claude** (Remote MCP custom connector)

**Constraint:** Do **not** enable Auth0 Open DCR.  
Instead, implement a **DCR shim** in your backend that returns a single pre-registered Auth0 public `client_id`.

---

## 2) High-level flow (Path A2)
1. Client connects to `GET https://…/mcp`
2. Server responds `401` + `WWW-Authenticate` pointing to `/.well-known/oauth-protected-resource`
3. Client fetches:
   - PRM: `/.well-known/oauth-protected-resource`
   - Auth server metadata: `/.well-known/oauth-authorization-server`
4. Client calls your shim: `POST /oauth/register` → gets **static** `client_id`
5. Client completes OAuth code+PKCE with **Auth0** (`/authorize` + `/oauth/token`)
6. Client calls MCP tools with: `Authorization: Bearer <access_token>`

---

## 3) Auth0 configuration (minimal, safe)

### 3.1 Create an Auth0 API (Resource Server)
Auth0 Dashboard → **Applications → APIs → Create API**

- **Name:** `Context Router MCP`
- **Identifier (audience/resource):**
  - `https://context-router.example.com`  
  (You can start with the Cloud Run URL; a custom domain is strongly preferred long-term.)
- **Scopes (start small):**
  - `preferences:read`
  - `preferences:write`

### 3.2 Enable RFC8707 `resource` parameter support
Auth0 Dashboard → **Settings → Advanced**
- Enable **Resource Parameter Compatibility Profile**

This is important because ChatGPT/Claude may send `resource=…` (RFC8707). Without this, you can end up with tokens minted for the wrong audience.

### 3.3 Create a single Auth0 **public** application for MCP connectors
Auth0 Dashboard → **Applications → Applications → Create Application**

- **Type:** Native or SPA (public client, PKCE, **no secret**)
- **Name:** `Context Router MCP Connectors`
- **Grant types:** Authorization Code (+ Refresh Token optional)

**Allowed Callback URLs (tight list):**
- ChatGPT:
  - `https://chatgpt.com/connector_platform_oauth_redirect`
- Claude:
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback` (future-proof)

**Refresh tokens (recommended)**
- Enable Refresh Token Rotation
- Allow `offline_access` (if you want long-lived sessions)

**Keep Auth0 tenant-level DCR OFF**.

---

## 4) Backend changes (NestJS)

### 4.1 Important nuance: “Discovery issuer” vs “Token issuer”
**Discovery issuer** is what you publish at:
- `/.well-known/oauth-authorization-server`

For Path A2, set:
- **discovery `issuer` = your domain**, e.g. `https://context-router.example.com`  
This helps avoid strict “issuer must match fetched host” behavior in some clients.

**Token issuer** is what the JWT itself contains in `iss`:
- **JWT `iss` will be Auth0**, e.g. `https://YOUR_AUTH0_DOMAIN/`

Your resource server (MCP) must validate tokens against **Auth0 issuer** regardless of the discovery issuer you publish.

**Implementation guidance**
- Do *not* publish `/.well-known/openid-configuration` in v1.
- Do *not* advertise `openid/profile/email` scopes in v1.
This keeps clients in “OAuth mode” and reduces OIDC/ID token issuer mismatch issues.

---

## 5) Public discovery endpoints (no auth)

### 5.1 Protected Resource Metadata (PRM)
**Route:** `GET /.well-known/oauth-protected-resource`

Return JSON like:
```json
{
  "resource": "https://context-router.example.com",
  "authorization_servers": ["https://context-router.example.com"],
  "scopes_supported": ["preferences:read", "preferences:write", "offline_access"]
}
```

Rules:
- `resource` must match what you validate in token `aud` (or equivalent).
- `authorization_servers` is where you host the auth metadata below (same origin is simplest).

### 5.2 OAuth Authorization Server Metadata
**Route:** `GET /.well-known/oauth-authorization-server`

Return JSON like:
```json
{
  "issuer": "https://context-router.example.com",

  "authorization_endpoint": "https://YOUR_AUTH0_DOMAIN/authorize",
  "token_endpoint": "https://YOUR_AUTH0_DOMAIN/oauth/token",
  "jwks_uri": "https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json",

  "registration_endpoint": "https://context-router.example.com/oauth/register",

  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],

  "scopes_supported": ["preferences:read", "preferences:write", "offline_access"]
}
```

**Critical:** `code_challenge_methods_supported` must include `S256`.

---

## 6) DCR shim (registration endpoint) — *rate limited*

### 6.1 Endpoint
**Route:** `POST /oauth/register`

### 6.2 Behavior
- Accept a client registration request
- Validate requested `redirect_uris` against a strict allowlist
- Return your **static Auth0 public `client_id`**
- Return only `redirect_uris = requested ∩ allowlist`

**Allowlist (v1)**
- `https://chatgpt.com/connector_platform_oauth_redirect`
- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`

**Do not include localhost here** (stdio bridge is out of scope for v1).

Example response:
```json
{
  "client_id": "YOUR_AUTH0_PUBLIC_CLIENT_ID",
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"]
}
```

### 6.3 Day-one hardening (recommended)
- **Rate limit `/oauth/register` from day one**
  - Example: 30 requests / minute / IP with burst control
- Log:
  - caller IP
  - user-agent
  - requested redirect_uris (sanitized)
- Stateless: no DB writes required

---

## 7) MCP auth guard integration (coexists with your current guards)

You already have GraphQL guards under:
`apps/backend/src/common/guards/*`

### 7.1 Add an MCP-specific guard
Create `apps/backend/src/mcp/auth/mcp-auth.guard.ts` that:
- Extracts `Authorization: Bearer <token>`
- Verifies token via Auth0 JWKS
- Enforces scope per tool
- Returns proper auth challenges:
  - `401` for missing/invalid token
  - `403` for insufficient scope (with `insufficient_scope`)

### 7.2 Ensure public routes stay public
Explicitly keep these endpoints unauthenticated:
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth/register`

### 7.3 Do not break existing GraphQL auth
Do **not** replace your existing GraphQL guards. Apply the MCP guard only to:
- `/mcp` controller
- tool execution entrypoints (if separate)

---

## 8) Auth challenges (required)

### 8.1 Missing/invalid token
`401 Unauthorized` with header:
```
WWW-Authenticate: Bearer resource_metadata="https://context-router.example.com/.well-known/oauth-protected-resource",
                 scope="preferences:read"
```

### 8.2 Insufficient scope
`403 Forbidden` with header:
```
WWW-Authenticate: Bearer error="insufficient_scope",
                 scope="preferences:write",
                 resource_metadata="https://context-router.example.com/.well-known/oauth-protected-resource"
```

**Note:** If ChatGPT doesn’t prompt users to connect, you may need to include MCP-specific auth metadata in tool errors (e.g., `mcp/www_authenticate`) in addition to HTTP headers. Start with HTTP headers first.

---

## 9) RFC8707 `resource` parameter verification (must test)
After enabling Auth0 resource compatibility:
- Confirm that `resource=https://context-router.example.com` is accepted by Auth0
- Confirm minted access token contains correct audience (`aud`) for your resource/API identifier

---

## 10) CORS & public accessibility
- `/.well-known/*`: allow `GET` publicly. Adding `Access-Control-Allow-Origin: *` is safe.
- `/oauth/register`: allow `POST` publicly. If you add CORS:
  - Prefer an allowlist of origins (`https://chatgpt.com`, `https://claude.ai`) rather than `*`.

Many clients fetch server-side (no CORS), but permissive GET CORS avoids headaches in debugging and future client behaviors.

---

## 11) Implementation steps (ordered)
1. Auth0: create API + public app; enable Resource Parameter Compatibility Profile
2. Backend: implement `/.well-known/oauth-protected-resource`
3. Backend: implement `/.well-known/oauth-authorization-server` (with S256)
4. Backend: implement `/oauth/register` (intersection + allowlist + rate limit)
5. Backend: implement `mcp-auth.guard.ts` + `401/403` challenges
6. Deploy Cloud Run env vars
7. Test with curl → Inspector → Claude → ChatGPT

---

## 12) Testing checklist (v1)

### 12.1 Discovery / metadata
```bash
curl -sS https://context-router.example.com/.well-known/oauth-protected-resource | jq
curl -sS https://context-router.example.com/.well-known/oauth-authorization-server | jq
```
Confirm:
- `authorization_servers` + `issuer` correct
- `registration_endpoint` correct
- `code_challenge_methods_supported` includes `"S256"`

### 12.2 `/mcp` auth challenge
```bash
curl -i https://context-router.example.com/mcp
```
Expect:
- `401`
- `WWW-Authenticate` contains `resource_metadata=...`

### 12.3 Registration shim (allowed redirect)
```bash
curl -sS -X POST https://context-router.example.com/oauth/register   -H "Content-Type: application/json"   -d '{"redirect_uris":["https://chatgpt.com/connector_platform_oauth_redirect"]}' | jq
```
Expect:
- `client_id` = static Auth0 client id
- `redirect_uris` includes only allowed values

### 12.4 Registration shim (forbidden redirect)
```bash
curl -i -X POST https://context-router.example.com/oauth/register   -H "Content-Type: application/json"   -d '{"redirect_uris":["https://evil.example/cb"]}'
```
Expect:
- `400`

### 12.5 Token audience sanity check (post-login)
After completing OAuth once, decode the access token and confirm:
- `iss` = Auth0 issuer
- `aud` includes your resource/API identifier
- `scope` (or permissions) includes expected scopes

### 12.6 Claude + ChatGPT end-to-end
- Add connector in Claude → login → call read tool → call write tool
- Add connector in ChatGPT → login → call read tool → call write tool

---

## 13) Repo structure (fits your current tree)

You already have:
`apps/backend/src/mcp/*` plus existing guards under `apps/backend/src/common/guards/*`.

### 13.1 Proposed backend additions (only the delta)
```txt
apps/backend/src/mcp/
  auth/                                  # NEW
    oauth-metadata.controller.ts         # NEW: /.well-known/oauth-protected-resource + /.well-known/oauth-authorization-server
    dcr-shim.controller.ts               # NEW: POST /oauth/register (intersection + allowlist)
    dto/
      register-client.dto.ts             # NEW: validation for redirect_uris, grant_types, etc.
    mcp-auth.guard.ts                    # NEW: validates Auth0 JWT + emits 401/403 challenges
    auth0-jwt-verifier.service.ts        # NEW: JWKS caching + verify token (iss/aud/exp)
    scope-map.ts                         # NEW: tool -> required scopes
```

### 13.2 Suggested scripts/docs
```txt
docs/
  MCP_OAUTH_A2_DCR_SHIM_PLAN_PATCHED.md  # optional: commit this patched plan

scripts/
  test-mcp-oauth/
    01_prm.sh
    02_oauth_metadata.sh
    03_register_allowed.sh
    04_register_forbidden.sh
    05_mcp_challenge.sh
```

---

## 14) Environment variables (simplified)
Prefer a single domain var and derive the rest:

- `AUTH0_DOMAIN=your-tenant.us.auth0.com`
- Derived:
  - `AUTH0_ISSUER=https://${AUTH0_DOMAIN}/`
  - `AUTH0_JWKS_URI=https://${AUTH0_DOMAIN}/.well-known/jwks.json`

Other vars:
- `MCP_RESOURCE=https://context-router.example.com`
- `AUTH0_AUDIENCE=https://context-router.example.com`
- `AUTH0_MCP_PUBLIC_CLIENT_ID=...`

---

## 15) Out of scope (v1)
- stdio bridge / CLI wrapper
- Cursor support
- `/.well-known/openid-configuration`
- Streamable HTTP transport upgrade (keep SSE for now; add later)

---

## 16) Done criteria
- Claude + ChatGPT can connect and authenticate via Auth0
- No token pasting required anywhere
- `/oauth/register` is rate-limited and cannot whitelist arbitrary redirect URIs
- Auth0 tenant-level DCR remains disabled
