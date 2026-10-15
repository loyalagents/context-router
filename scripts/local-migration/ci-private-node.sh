#!/usr/bin/env bash
# setup-node's shared runner ancestry can be group-writable. Keep product trust
# strict by giving this disposable CI job a private copy of the pinned runtime.
set -euo pipefail
test "${CI:-}" = true
test -n "${GITHUB_PATH:-}"
umask 077
ci_node_source="$(node -p 'require("node:fs").realpathSync(process.execPath)')"
test "$("$ci_node_source" --version)" = v24.21.0
ci_node_root="$(mktemp -d "$HOME/.context-router-ci-node.XXXXXX")"
install -m 700 "$ci_node_source" "$ci_node_root/node"
cmp "$ci_node_source" "$ci_node_root/node"
test "$("$ci_node_root/node" --version)" = v24.21.0
# Subsequent steps and their children use this exact copy. The hosted runner owns
# its lifetime; no global toolchain permissions or persistent profiles change.
printf '%s\n' "$ci_node_root" >> "$GITHUB_PATH"
