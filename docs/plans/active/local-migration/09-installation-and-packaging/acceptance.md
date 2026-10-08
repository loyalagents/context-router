# Consolidated Installed-App Acceptance

Status: pending. This checklist records human/platform acceptance separately from
automated qualification. Do not mark it passed from component tests or a build.
Use Candidate 05 named in the [implementation evidence](implementation.md), manifest
`a3f624fb6dacf12e73b0a36a6dfdd0ce41713cf0d58076a5aac221a573f9d6eb`. Its unsigned
status, actual hardware and unrun release checks remain visible in the PR.

The [installed runbook](../../../../useful/INSTALLED_MAC_APP.md) contains exact
CLI syntax and recovery constraints. Use synthetic pilot data and a private
installation; never clear ownership metadata to bypass a refusal.

| Check | Expected result | Status |
| --- | --- | --- |
| Open the complete candidate in Finder | CR menu appears; dashboard opens; no developer tools or separately operated server needed | Pending human |
| New unlock code, copy, unlock; Lock and repeat | One-use code works once, expires after five minutes, re-unlock needs a new code | Pending native menu/clipboard |
| Close all dashboard windows | Menu/MCP remain available; Open dashboard returns to local UI | Automated browser passed; human pending |
| Use preferences and a manual MCP client at `http://127.0.0.1:8787/mcp` | Shared state and per-client grants; browser code is rejected as MCP credential | Installed guard tested; external client human pending |
| Restart local runtime with an idle connected client | Connections interrupt; fresh browser unlock works; same MCP URL/credential and persisted state remain | Automated installed restart; menu human pending |
| Quit, then reopen | Owned cohort exits; normal relaunch preserves state | Automated guardian; menu human pending |
| Explicit model consent and Cancel | Correct pinned source/size shown; progress bounded; non-AI stays usable; no incomplete asset selected | Deterministic downloader passed; dialog/real download pending |
| Selected model already installed, network unavailable | Local AI works within retained limits; no hosted fallback | Separately approved live series pending |
| Real sleep/wake with installed model | AI remains unavailable until explicit Restart; no automatic replay; non-AI remains healthy | Pending actual pilot |
| Certificate expiry or model failure | AI unavailable; explicit whole-generation restart required; preserved data/authority | Deterministic fixtures; human pending |
| Backup, pending restore, revoke/rotate restored authority, activate | Current selection retained until acknowledgment; resulting credential behavior matches explicit restored authority | Automated installed flow passed; human pending |
| Compatible replacement and app-only uninstall/reinstall | Complete verified app starts; data/identity/MCP/models retained; altered payload refuses before state access | Automated installed checks passed; human pending |
| Duplicate launch and occupied MCP port | Existing owner/listener untouched; no second ready listener or fallback | Native fixtures; actual menu pending |
| Abrupt owner loss and reboot recovery | Uncertain state preserved and launch refused; no metadata deletion or inferred successful recovery | Cross-boot recovery unqualified |
| Signed private distribution | Real signing identity, nested signing, notarization, Gatekeeper and declared release destination verified | Blocked on missing access/destination |

Record candidate manifest/archive digest, Mac model/RAM/macOS build, each observed
result, timing and failures. Do not put unlock codes, credentials or personal data
in evidence. A failed or unobserved shutdown is not a successful restart. Preserve
its envelope and report the failure for diagnosis.

Windows/Linux deferral is approved; this checklist does not expand the supported
hardware claim. Steps 10–11 and full MCP onboarding/UI redesign remain deferred.
