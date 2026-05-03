# Auth0 Login Gating

- Status: useful
- Read when: changing who can create accounts, disabling invite-only access for a demo, or debugging unexpected Auth0 login denials
- Source of truth: Auth0 Dashboard Actions and Triggers, plus `apps/backend/src/modules/auth/auth.service.ts`
- Last reviewed: 2026-05-03

This app's production account gate is currently configured outside the repo in Auth0 Actions. Keep exact invited email addresses in Auth0, not in repo docs.

## Current Shape

The Auth0 tenant has two custom Actions that implement invite-only access:

- `Prevent Logins -- PreUserRegistration`
- `Prevent Logins -- Post Login`

The Pre User Registration Action blocks new database/passwordless signups when the email is not in the invite list. This does not cover every identity provider path, such as social login.

The Post Login Action blocks token issuance after authentication when the email is not in the invite list. This is the broader gate because it covers existing Auth0 users and social login users too.

Both Actions should use the same allowlist logic. If an invited email is added or removed, update both Actions unless the allowlist has been moved into a shared external store.

## Why Auth0 Is The Gate

The backend trusts valid Auth0 JWTs and, with the default `AUTH0_SYNC_STRATEGY=ON_LOGIN`, creates or links the local database user on first authenticated request.

That means the backend is not the first account-creation gate. If Auth0 lets a user authenticate and receive a token, the backend may create the local user.

## Verify The Gate Is Active

Deployed Actions do not run by themselves. They must be attached to the matching trigger flow.

Check:

1. Auth0 Dashboard -> Actions -> Triggers -> Pre User Registration
2. Confirm `Prevent Logins -- PreUserRegistration` is in the flow and active.
3. Auth0 Dashboard -> Actions -> Triggers -> Login / Post Login
4. Confirm `Prevent Logins -- Post Login` is in the flow and active.

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
