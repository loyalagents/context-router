# Support Codex/Claude Wrapper Scripts and Command Args

## Summary

Implement Codex and Claude support as repo-owned wrapper scripts that continue to use the existing `command` adapter contract, while expanding the local orchestrator CLI to support repeatable command arguments. Keep `--ai-adapter command` as the only adapter in scope, support both `file` and `suggestion` stages through each wrapper script, and make the docs work a first-class part of the change.

## Key Changes

1. **Docs scaffold first**
   Create the folder `docs/plans/active/local-file-upload/codex-claude-scripts`.
   Add `codex-claude-scripts/implementation-plan.md` at the start of the work and put this implementation plan there.
   Treat this doc folder as the canonical work log for the feature until the implementation is complete.

2. **Expand the generic command interface instead of adding native adapters**
   Keep `--ai-adapter command` as the only supported adapter.
   Add a repeatable `--ai-command-arg <value>` CLI flag and plumb it through `CliOptions`, runtime filter construction, manifest config, and the command adapter spawn call.
   Update validation so `--ai-command-arg` is only valid when `--ai-filter` is enabled and `--ai-command` is present.
   Extend manifest v2 config with `config.aiFilter.commandArgs`.
   Do not add `codex` or `claude` as new adapter enum values or new top-level orchestrator modes.

3. **Add repo-owned Node executable wrapper scripts**
   Add two executable Node scripts under `apps/local-orchestrator/scripts/`:
   `claude-filter.mjs` and `codex-filter.mjs`.
   Each script must read the existing adapter request JSON from `stdin`, branch on `stage`, and emit the existing adapter response JSON to `stdout`.
   Each script must support both `file` and `suggestion` stages in one executable, so users only switch script paths, not orchestrator flow.
   Each script should accept a minimal optional `--model <name>` argument so `--ai-command-arg` has a concrete first use.
   Claude script behavior: run Claude in non-interactive print mode with structured-output constraints, tools disabled, and a prompt that asks only for the target decision JSON.
   Codex script behavior: run Codex in non-interactive mode with read-only/safe execution settings, no repo mutation intent, and a prompt that asks only for the target decision JSON.
   Both scripts must validate provider output before returning it to the orchestrator and exit non-zero with a useful stderr message on auth failure, CLI invocation failure, timeout, or malformed provider output.

4. **Standardize prompt and decision policy inside the scripts**
   Use one stable prompt shape per stage and keep provider-specific differences inside the wrappers.
   Suggestion-stage prompts must only decide among backend-accepted suggestions and must never revive `filteredSuggestions`.
   File-stage prompts must decide only `analyze` vs `skip` from the provided preview and metadata.
   Keep the output contract identical to the existing `command` adapter schema so no downstream runner behavior changes are required beyond arg forwarding.

5. **Update user-facing docs at the end**
   At the end of the implementation, add `codex-claude-scripts/implementation-summary.md` summarizing the shipped behavior, CLI changes, script paths, examples, tests run, and known limitations.
   At the end of the implementation, update `docs/plans/active/local-file-upload/TODO.md` to remove or narrow the generic “add Codex/Claude wrappers” follow-up and replace it with remaining work such as native adapters, richer wrapper options, and prompt-policy presets.
   At the end of the implementation, update `docs/useful/local-orchestrator-commands.md` with copy-paste examples for Claude and Codex dry-run and apply flows, including `--ai-filter`, `--ai-filter-stage both`, `--ai-command`, and `--ai-command-arg --model ...`.
   Also update the package README/help examples so they stay aligned with the CLI surface and documented script paths.

## Public Interface Changes

- Add `--ai-command-arg <value>` as a repeatable CLI flag.
- Add `aiCommandArgs: string[]` to local orchestrator CLI/runtime types.
- Add `config.aiFilter.commandArgs` to manifest v2 output.
- Keep `--ai-command` as the executable path and `--ai-adapter command` as the only adapter value.
- Add two documented script entrypoints:
  `apps/local-orchestrator/scripts/claude-filter.mjs`
  `apps/local-orchestrator/scripts/codex-filter.mjs`

## Test Plan

- Update CLI parser tests to cover repeated `--ai-command-arg`, ordering preservation, and invalid combinations without `--ai-filter` or `--ai-command`.
- Update command-adapter tests to verify child-process args are forwarded exactly and still preserve existing timeout and invalid-response behavior.
- Add wrapper-script tests for both scripts using fake `claude` and `codex` binaries on `PATH`, covering valid `file` and `suggestion` responses, malformed provider output, and provider non-zero exit behavior.
- Update runner tests to confirm manifest `config.aiFilter.commandArgs` is emitted and existing fallback/apply-skip semantics remain unchanged.
- Update README/help sync tests so the new examples and script paths stay current.

## Assumptions And Defaults

- Scope is wrappers plus generic command-arg support only; native named adapters are out of scope.
- Both wrapper scripts support both AI stages in the first implementation.
- Scripts are executable Node `.mjs` files under `apps/local-orchestrator/scripts/` rather than shell scripts or package subcommands.
- No backend API or backend preference-extraction changes are needed for this work.
- The end-of-work documentation sequence is required: write `implementation-summary.md`, then update `local-file-upload/TODO.md`, then update `docs/useful/local-orchestrator-commands.md`.
