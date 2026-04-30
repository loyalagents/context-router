# Support Native Markdown/YAML And Easy Text-Like Local File Types

## Summary

- Create this workstream folder first and keep the implementation plan here before code changes start.
- Ship three behavior changes in one workstream:
  - native backend MIME support for markdown and YAML
  - local-orchestrator support for easy text-like config files
  - a new opt-in `--include-hidden` path so `.env` files are actually reachable
- Keep the dashboard upload widget aligned with the new backend-native markdown/YAML support, but keep config-like formats as local-orchestrator-only for now.
- Finish by adding `implementation-summary.md` and then updating `docs/plans/active/local-file-upload/TODO.md`.

## Public Interface Changes

- Backend document analysis accepts:
  - `text/markdown`
  - `application/yaml`
  - `text/yaml`
  - `application/x-yaml`
- Default outbound local-orchestrator MIME becomes:
  - `.md`, `.markdown` -> `text/markdown`
  - `.yml`, `.yaml` -> `application/yaml`
- Local orchestrator adds `--include-hidden`, default `false`.
  - when `false`, hidden-file skip behavior stays unchanged
  - when `true`, hidden files and directories are traversed and evaluated normally
- Local orchestrator support matrix becomes:
  - native/backend MIME: `.txt`, `.json`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.md`, `.markdown`, `.yml`, `.yaml`
  - local-to-`text/plain`: `.toml`, `.ini`, `.cfg`, `.conf`
  - name-pattern-to-`text/plain`: `.env` and `.env.*`
- Manifest schema bumps from `version: 2` to `version: 3` and adds `config.includeHidden: boolean`.
- Dashboard single-file upload expands only for markdown/YAML and validates by MIME or recognized filename extension so browser MIME quirks do not block common files.

## Implementation Changes

### Checkpoint 1: Docs scaffold and backend MIME tests first

- Add this implementation plan before behavior changes start.
- Add backend document-analysis e2e coverage for accepted markdown and YAML uploads.
- Keep rejection coverage for unsupported types unchanged.
- Extend the backend document-upload allowlist to accept markdown and YAML MIME types.
- Keep file-size limits, extraction prompts, suggestion filtering, and apply behavior unchanged.

Verification:

- targeted backend document-analysis e2e passes

### Checkpoint 2: Native markdown/YAML in local orchestrator

- Replace markdown/YAML `text/plain` coercion with native outbound MIME mapping.
- Move markdown and YAML into the direct support map so they are recorded as supported native types rather than coerced types.
- Expand text-like preview detection so file-stage AI still previews markdown and YAML after the native MIME switch.
- Update local-orchestrator README/help/manifests/tests to reflect native support and remove old coercion wording for markdown/YAML.

Verification:

- `pnpm --filter local-orchestrator test`
- `pnpm --filter local-orchestrator build`
- `pnpm --filter local-orchestrator lint`

### Checkpoint 3: Easy config formats and hidden-file support

- Refactor discovery support resolution to check basename/pattern rules before extension rules so `.env` and `.env.*` can be recognized correctly.
- Add `.toml`, `.ini`, `.cfg`, and `.conf` as extension-based `text/plain` uploads.
- Add `.env` and `.env.*` as basename/pattern-based `text/plain` uploads.
- Add `--include-hidden` to CLI parsing, help text, runtime config, manifest config, README, and summary output.
- Keep default behavior unchanged when the flag is absent.
- When `--include-hidden` is set:
  - hidden files and directories are traversed
  - supported hidden files are analyzed normally
  - unsupported hidden files are recorded as unsupported rather than counted as hidden skips
- Bump manifest schema to `version: 3`.

Verification:

- local-orchestrator tests cover:
  - `.env`
  - `.env.local`
  - hidden directory traversal
  - default hidden skipping
  - manifest `version: 3`
  - dry-run discovery for the new config formats
- `pnpm --filter local-orchestrator test`
- `pnpm --filter local-orchestrator build`
- `pnpm --filter local-orchestrator lint`

### Checkpoint 4: Dashboard parity for backend-native types

- Update the dashboard upload widget to accept markdown and YAML in both the browser `accept` hint and client-side validation.
- Use MIME-or-extension validation for the new types.
- Do not expand the dashboard to `.toml`, `.ini`, `.cfg`, `.conf`, or `.env` in this workstream.
- Update the visible upload copy to list the new supported file types accurately.

Verification:

- `pnpm --filter web lint`
- manual dashboard upload succeeds for one markdown file and one YAML file

### Checkpoint 5: Docs closeout and final smoke

- Add `implementation-summary.md` last.
  - summarize shipped behavior
  - list added file types
  - capture manifest and CLI changes
  - record tests run
  - record remaining limitations
- Update `docs/plans/active/local-file-upload/TODO.md` last.
  - remove the shipped markdown/YAML backend MIME follow-up
  - keep and refine remaining follow-ups such as:
    - broader dotfile allowlists
    - more text-like formats
    - content sniffing vs filename-only mapping
    - possible future dashboard parity for config-like files
- Run one local-orchestrator dry-run smoke against a fixture folder containing markdown, YAML, TOML, `.env.local`, and one unsupported file, using `--include-hidden`, and confirm the manifest decisions match the new support policy.

## Assumptions And Defaults

- This workstream includes `--include-hidden` now because `.env` support is not useful otherwise.
- `.env` support means exact `.env` plus `.env.*`; it does not open the door to arbitrary dotfiles such as `.gitconfig` or `.npmrc`.
- Dashboard scope is limited to markdown/YAML parity only; config-like formats remain local-orchestrator-only.
- No new shared cross-package constant/module is introduced just to deduplicate allowed MIME lists.
- No change is made to extraction logic, prompt content, apply mutations, rate limiting, or retry policy in this workstream.
