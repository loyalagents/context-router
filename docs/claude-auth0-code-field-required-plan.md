# Claude Connectors ↔ Auth0: Fixing `code: Field required`

You’re seeing:

```json
{"type":"error","error":{"type":"invalid_request_error","message":"code: Field required"}}
```

This almost always means **Claude expected an OAuth authorization code (`code`) at the callback step, but it didn’t receive one**.

---

## 0) What “good” looks like (mental model)

**Happy path:**

1. Claude opens your **authorization endpoint** (authorize)
2. User logs in / consents
3. Auth server redirects back to Claude’s callback with query params:
   - `?code=...&state=...`
4. Claude exchanges the **code** at your **token endpoint**
5. Claude stores tokens and completes the connector setup

If the callback URL has **no `code`**, Claude will error exactly like you’re seeing.

---

## 1) Quick triage (2 minutes)

### A) Copy the URL in the address bar when the error appears

When you hit the JSON error page, **click the address bar and copy the full URL**.

Check which of these you have:

- ✅ **Good callback:**  
  `https://claude.ai/api/mcp/auth_callback?code=...&state=...`

- ❌ **No code (your error):**  
  `https://claude.ai/api/mcp/auth_callback` (no query params)

- ❌ **Auth failure:**  
  `https://claude.ai/api/mcp/auth_callback?error=...&error_description=...`

**Outcome:**
- If you see **no `code`** → your issue is **before** token exchange (authorize/redirect/consent).
- If you see **`code` present** → your issue is **during** token exchange (token endpoint expectations, PKCE, client secret, etc.).

---

## 2) The 3 most common causes

### 1) Your redirect back to Claude does not include `?code=...`
Often because:
- User/org policy blocks consent (`error=access_denied`)
- Auth server returns `error=` instead of `code=`
- `code` is placed in a URL **fragment** (`#code=...`) rather than **query** (`?code=...`)

Claude needs `code` in the **query string**.

### 2) Wrong OAuth flow (not Authorization Code + PKCE)
If you’re using implicit/hybrid (returning tokens directly), you may not get a `code`.

For desktop-style clients, you generally want:
- **Authorization Code**
- **PKCE**
- No client secret required (public client)

### 3) Redirects or proxies strip query params
A proxy/CDN/custom redirect handler can accidentally drop `?code=...&state=...`.

---

## 3) Auth0 checklist (common gotchas)

### Allowed Callback URLs
In **Auth0 → Application → Allowed Callback URLs**, add Claude callbacks exactly:

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback` *(recommended to allowlist too)*

> Auth0 requires exact matches; trailing slashes and scheme must match.

### App type / client auth method
For PKCE-style public clients:
- Ensure you are not requiring a client secret for code exchange
- Ensure Authorization Code + PKCE is supported/allowed

### Watch Auth0 logs
In Auth0 tenant logs for that attempt, look for:
- redirect_uri mismatch
- blocked consent / access denied
- invalid scope / invalid request
- application type restrictions

---

## 4) If the callback DOES include `code=...`, test token exchange manually

Claude will do a server-to-server token exchange:

**Important:** token request should usually be **form-encoded**, not JSON.

```bash
curl -i -X POST "https://YOUR_AUTH_SERVER/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "client_id=YOUR_CLIENT_ID" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "code=THE_CODE_FROM_CALLBACK" \
  --data-urlencode "code_verifier=YOUR_CODE_VERIFIER"
```

**Notes:**
- If your token endpoint **requires client_secret**, that can break public-client flows.
- If your token endpoint expects JSON, that’s unusual for OAuth2; verify what it supports.
- If you can’t reproduce because you don’t have `code_verifier`, that suggests the issue is *still likely client/PKCE mismatch* rather than just token formatting.

---

## 5) A clean “test recipe” to isolate where it breaks

### Step 1 — Validate authorize redirect
- Start connector setup
- Log in
- Confirm Claude callback includes:
  - `code`
  - `state`

### Step 2 — Validate that Claude’s callback domain is allowed
- If Auth0 shows `redirect_uri mismatch`, fix Allowed Callback URLs.

### Step 3 — Validate token exchange
- If `code` arrives but setup fails, your token endpoint may be rejecting:
  - missing/invalid `code_verifier`
  - mismatched `redirect_uri`
  - client authentication method mismatch
  - unsupported content type

### Step 4 — Check query stripping
- If sometimes `code` appears and sometimes not, look for proxies or multiple redirects.

---

## 6) What to paste back to debug fast

If you want a quick diagnosis, paste (with the actual code value redacted):
1. The exact **callback URL** you see in the address bar
2. Any `error=` params (if present)
3. The relevant Auth0 log line(s) for that attempt
