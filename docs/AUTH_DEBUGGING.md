# MCP OAuth Debugging Session - 2025-12-20

## Current Status: In Progress

Claude Desktop successfully completes DCR registration but fails to show Auth0 login screen. Instead, it redirects to claude.ai and shows an error.

---

## What We're Trying to Achieve

Enable OAuth authentication for the MCP server so Claude Desktop (and ChatGPT) can authenticate via Auth0 without manually pasting tokens. This follows the "Path A2" pattern from `docs/MCP_WITH_AUTH_PLAN.md`:

1. Client hits `/mcp` -> gets 401 with WWW-Authenticate header
2. Client fetches `/.well-known/oauth-protected-resource`
3. Client fetches `/.well-known/oauth-authorization-server`
4. Client calls `/oauth/register` (DCR shim) -> gets pre-registered client_id
5. Client redirects user to Auth0 `/authorize`
6. User logs in, Auth0 redirects back to Claude with auth code
7. Claude exchanges code for token at Auth0 `/oauth/token`
8. Claude calls `/mcp` with Bearer token

---

## What's Working

- **OAuth metadata endpoints** (`/.well-known/*`) return correct data
- **DCR shim** (`/oauth/register`) successfully accepts Claude's registration request
- **Auth0 configuration** is correct (tested manually with authorization URL)
- **Localhost support** for Claude Desktop redirect URIs

---

## The Problem

After successful DCR (step 4), Claude opens a browser window but:
- Does NOT show Auth0 login screen
- Immediately shows an error on claude.ai: `{"type":"error","error":{"type":"invalid_request_error","message":"code: Field required"}}`

This error is from Claude's callback endpoint, not Auth0. It means Claude is trying to process an OAuth callback without receiving an authorization code.

---

## What We Tried

### 1. Fixed DCR validation bypass
**Problem**: NestJS DTO validation was rejecting Claude's request before our code ran.
**Solution**: Changed `@Body() dto: RegisterClientDto` to `@Body() body: any` and added flexible parsing.
**File**: `apps/backend/src/mcp/auth/dcr-shim.controller.ts`
**Status**: Fixed - DCR now returns 201

### 2. Added localhost port flexibility
**Problem**: Claude Desktop uses dynamic localhost ports.
**Solution**: Allow any `http://localhost:*` or `http://127.0.0.1:*` URL.
**File**: `apps/backend/src/mcp/auth/dcr-shim.controller.ts`
**Status**: Fixed

### 3. Added raw body logging
**Problem**: Couldn't see what Claude was sending.
**Solution**: Log full request body before any processing.
**File**: `apps/backend/src/mcp/auth/dcr-shim.controller.ts`
**Status**: Working - can see Claude sends `redirect_uris: ["https://claude.ai/api/mcp/auth_callback"]`

### 4. Added path-specific OAuth metadata endpoints
**Problem**: Some clients look for `/.well-known/oauth-authorization-server/mcp`.
**Solution**: Added route for path-specific metadata.
**File**: `apps/backend/src/mcp/auth/oauth-metadata.controller.ts`
**Status**: Added but not yet deployed/tested

### 5. Relaxed CORS on DCR endpoint
**Problem**: Had `Access-Control-Allow-Origin: https://chatgpt.com` hardcoded.
**Solution**: Changed to `Access-Control-Allow-Origin: *`.
**File**: `apps/backend/src/mcp/auth/dcr-shim.controller.ts`
**Status**: Fixed

---

## Current Theories

### Theory 1: Claude's OAuth client has a bug
Claude might be failing to properly construct the Auth0 authorization URL after receiving our DCR response. The fact that we see no Auth0 logs suggests the redirect never happens.

### Theory 2: Missing `audience` parameter
Auth0 requires the `audience` parameter to know which API to issue a token for. Claude might not know to add this. Our OAuth metadata might need an additional field to hint at this.

### Theory 3: Token endpoint auth method mismatch
Claude requested `token_endpoint_auth_method: "client_secret_post"` but we return `token_endpoint_auth_method: "none"`. This might confuse Claude's OAuth client.

---

## Files Changed (for debugging)

### `apps/backend/src/mcp/auth/dcr-shim.controller.ts`
- Removed DTO validation (temporary for debugging)
- Added raw body logging
- Added flexible redirect_uri parsing (handles singular/plural forms)
- Changed CORS to allow all origins
- **TODO**: Re-add DTO validation after debugging

### `apps/backend/src/mcp/auth/oauth-metadata.controller.ts`
- Added path-specific endpoint `/.well-known/oauth-authorization-server/mcp`
- Refactored to use `buildAuthorizationServerMetadata()` helper

### `apps/backend/src/config/mcp.config.ts`
- Added various Claude callback URL patterns to allowlist
- **This is production-ready**

---

## Files NOT Changed (production code)

- `apps/backend/src/mcp/mcp.controller.ts` - unchanged
- `apps/backend/src/mcp/auth/mcp-auth.guard.ts` - unchanged
- `apps/backend/src/mcp/mcp.service.ts` - unchanged

---

## Cleanup Needed After Debugging

1. **Re-add DTO validation** to `dcr-shim.controller.ts`:
   - Change `@Body() body: any` back to `@Body() dto: RegisterClientDto`
   - Or create a more flexible DTO that accepts both formats

2. **Remove excessive logging** from `dcr-shim.controller.ts`:
   - Remove `DCR RAW BODY` log (contains full request)
   - Keep sanitized logging for production

3. **Tighten CORS** on DCR endpoint:
   - Change from `*` to specific allowlist: `https://claude.ai, https://chatgpt.com`

4. **Consider `token_endpoint_auth_method`**:
   - May need to return `client_secret_post` instead of `none` if Claude requires it
   - OR file a bug with Anthropic if Claude should support `none` for PKCE

---

## Useful Commands

### View recent HTTP requests to your service
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=context-router AND timestamp>\"2025-12-20T01:00:00Z\"" --format=json | jq -r '.[] | select(.httpRequest != null) | "\(.timestamp) \(.httpRequest.requestMethod) \(.httpRequest.requestUrl) \(.httpRequest.status)"' | sort
```

### View DCR-specific logs
```bash
gcloud logging read "resource.type=cloud_run_revision AND textPayload:DCR" --limit=20 --format="table(timestamp,textPayload)"
```

### Test DCR endpoint manually
```bash
curl -i -X POST https://context-router-tvvjziqt3a-uc.a.run.app/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}'
```

### Test Auth0 authorization URL manually
```bash
open "https://hcp-pcr.us.auth0.com/authorize?response_type=code&client_id=R32nJTzigHeOStYW49Xrt4LQXY9gzxE0&redirect_uri=https://claude.ai/api/mcp/auth_callback&scope=openid%20profile%20email&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256"
```

---

## Next Steps

1. Deploy latest changes (path-specific OAuth metadata endpoint)
2. Check Auth0 logs to see if any authorization requests are coming through
3. If no Auth0 requests, the issue is in Claude's OAuth client construction
4. Consider reaching out to Anthropic MCP team for guidance on expected OAuth flow
5. Try with ChatGPT to see if the issue is Claude-specific

---

## Auth0 Configuration Reference

- **Tenant**: `hcp-pcr.us.auth0.com`
- **MCP Public Client ID**: `R32nJTzigHeOStYW49Xrt4LQXY9gzxE0`
- **Allowed Callback URLs**:
  - `https://chatgpt.com/connector_platform_oauth_redirect`
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`
