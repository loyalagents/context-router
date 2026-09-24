# Auth0 Login Gating

- Status: useful
- Read when: changing who can create accounts, debugging unexpected Auth0 login denials, or configuring initial hosted profile claims
- Source of truth: Auth0 Dashboard Actions and Triggers, plus `apps/backend/src/modules/auth/verified-human-identity.resolver.ts`
- Last reviewed: 2026-09-23

This hosted-only account gate is configured outside the repo in Auth0 Actions.
Both the SQLite local preview and PostgreSQL reference preview have no Auth0 signup, login, or browser
session. Keep exact invited email addresses in Auth0, not in repo docs.

## Current Shape

The Auth0 tenant has two custom Actions that implement invite-only access:

- `Prevent Logins -- PreUserRegistration`
- `Prevent Logins -- Post Login`

The Pre User Registration Action blocks new database/passwordless signups when the email is not in the invite list. This does not cover every identity provider path, such as social login.

The Post Login Action blocks token issuance after authentication when the email is not in the invite list. This is the broader gate because it covers existing Auth0 users and social login users too.

Both Actions should use the same allowlist logic. If an invited email is added or removed, update both Actions unless the allowlist has been moved into a shared external store.

## Why Auth0 Is The Gate

The backend trusts valid Auth0 JWTs and resolves the exact
`(provider="auth0", issuer, subject)` tuple on the first authenticated request.
It creates a fresh local principal when that tuple is new and never links by
email. Auth0 is the current edge adapter; the persisted identity model is not
Auth0-specific.

That means the backend is not the first account-creation gate. If Auth0 lets a
user authenticate and receive a token, the backend may create a local principal
for that exact issuer and subject.

## Verify The Gate Is Active

Deployed Actions do not run by themselves. They must be attached to the matching trigger flow.

Check:

1. Auth0 Dashboard -> Actions -> Triggers -> Pre User Registration
2. Confirm `Prevent Logins -- PreUserRegistration` is in the flow and active.
3. Auth0 Dashboard -> Actions -> Triggers -> Login / Post Login
4. Confirm `Prevent Logins -- Post Login` is in the flow and active.

## Optional Hosted Profile Claims (Main-Line Step 03)

The backend reads profile hints from the verified **API access token**, not the
web session, ID token, `/userinfo`, or Management API. Its Auth0 adapter accepts
top-level `email` only with the literal boolean `email_verified: true`, plus
optional `name`, `given_name`, and `family_name`. Namespaced alternatives are
not mapped by this adapter. Missing or malformed optional values are ignored
individually, without trimming or coercion; valid sibling hints survive. They
never change the exact issuer/subject identity or make an invalid token valid.

For interactive Universal Login to the custom Context Router API, request
`openid email` (and `profile` if names are wanted). Scopes alone do not prove the
API token contains those claims; ID-token claims are not sufficient. Auth0
applies scope filtering even to native claims added by a Post Login Action.
See [Auth0 OIDC scopes](https://auth0.com/docs/get-started/apis/scopes/openid-connect-scopes).

If initial account contact email is wanted, an operator can deploy and attach
a Post Login Action that copies only Auth0's verified email into the API token:

```javascript
exports.onExecutePostLogin = async (event, api) => {
  if (event.user.email_verified === true && typeof event.user.email === "string") {
    api.accessToken.setCustomClaim("email", event.user.email);
    api.accessToken.setCustomClaim("email_verified", true);
  }
};
```

Do not infer verification merely from an email's presence. Optional native name
claims can similarly be copied from string-valued user fields when requesting
`profile`. This is guidance for the interactive flow, not a guarantee for every
grant type or a claim that the current tenant has this Action configured. See
[Auth0 access-token profile claims](https://auth0.com/docs/troubleshoot/product-lifecycle/past-migrations/custom-claims-migration#oidc-user-profile-claims).
Keep this separate from the invite gate so a demo bypass does not accidentally
skip profile enrichment. This PR does not modify a tenant or the deployed
`hosted-v1-maintenance` line.

Verify in a disposable main-line environment with a fresh principal: use a
token for the backend's configured issuer and audience, confirm claim presence
and boolean types privately, then check `me.email` and the seeded profile
preferences. Never paste or log the bearer token. Without usable verified
email, authentication still succeeds and `me.email` is a non-routable
`<hash>@principal.invalid` compatibility value; the current dashboard can show
that value, so it must not be treated as verified contact information.

This is **first-creation-only** enrichment. Later logins do not rewrite an
existing `User.email`, repair its synthetic value, or reseed missing profile
rows. Users can edit `profile.email` through ordinary preferences; those edits
do not change account identity or `User.email`. No backfill or historical-user
migration is part of this step. See
[profile semantics](../current/PREFERENCE_SCHEMA.md).

## Demo Disable Pattern

For temporary demos, prefer a secret-controlled bypass instead of removing Actions from flows. This keeps the flow wiring intact and makes re-enabling low risk.

Add an Action Secret to both Actions:

```text
INVITE_GATE_ENABLED=true
```

Then put this at the top of each Action handler:

```javascript
const gateEnabled = event.secrets.INVITE_GATE_ENABLED === "true";

if (!gateEnabled) {
  return;
}
```

To disable invite-only gating for a demo, set the secret to:

```text
INVITE_GATE_ENABLED=false
```

To re-enable invite-only gating, set it back to:

```text
INVITE_GATE_ENABLED=true
```

If you change Action code, deploy the Action. If you only change the secret value, still test one denied and one allowed login after the change.

## Disable Versus Remove

If Auth0 shows a flow-level disable control for a bound Action, disabling should stop that Action from running until it is re-enabled.

If you remove or unbind an Action from a trigger flow, you must add it back to that flow later. Removing it from the flow is more error-prone than the secret-controlled bypass.

## Hard User Caps

Auth0 does not provide a simple app setting for "allow only the first N signups" in this setup.

Reasonable options:

- Keep the email allowlist. This is simplest when demo participants are known.
- Use invite codes. This needs a store for codes or accepted emails.
- Add a max-count check in an Auth0 Action. Avoid relying on Auth0 user search alone for a hard cap because user search can be eventually consistent.
- Use a backend slot-reservation endpoint. This is the strongest cap: the Auth0 Action calls a backend endpoint that atomically checks and reserves a signup slot in Postgres, then the Action denies access when slots are full.

For public demos, prefer the email allowlist or a backend slot-reservation endpoint. For a short private demo, temporarily setting `INVITE_GATE_ENABLED=false` and monitoring usage is usually enough.
