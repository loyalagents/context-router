#!/bin/bash

# One bounded renderer for macOS Bash 3.2 and Linux; no external tree dependency.
set -eo pipefail
export LC_ALL=C
unset GLOBIGNORE
shopt -s nullglob dotglob

usage() {
  printf '%s\n' 'Usage: ./print-repo-structure.sh [--depth N]' \
    'Print the repository layout (default depth: 4; N: 1-64, no leading zeros).' \
    'Use --depth 6 for a deeper view, or --help for this message.'
}

depth=4
if [[ $# -eq 1 && $1 == --help ]]; then
  usage
  exit 0
elif [[ $# -eq 2 && $1 == --depth ]]; then
  depth=$2
  if ! [[ $depth =~ ^[1-9][0-9]?$ && $depth -le 64 ]]; then
    printf '%s\n' 'Error: depth must be an integer from 1 to 64 without leading zeros.' >&2
    exit 2
  fi
elif [[ $# -ne 0 ]]; then
  usage >&2
  exit 2
fi

script_directory=.
if [[ ${BASH_SOURCE[0]} == */* ]]; then
  script_directory=${BASH_SOURCE[0]%/*}
fi
REPO_ROOT=$(CDPATH= cd -- "$script_directory" && pwd -P)

excluded() {
  case "$1" in
    node_modules|dist|.next|build|coverage|.git|*.lock|.cache|.pnpm-store|.claude|.DS_Store)
      return 0 ;;
  esac
  return 1
}

render_directory() {
  local directory=$1 prefix=$2 remaining=$3 entry name group suffix is_directory
  if [[ ! -r $directory || ! -x $directory ]]; then
    printf 'Error: cannot read or search directory: %s\n' "$directory" >&2
    return 1
  fi
  local entries=("$directory"/*)
  for group in directories files; do
    for entry in "${entries[@]}"; do
      name=${entry##*/}
      if excluded "$name"; then continue; fi
      is_directory=false
      suffix=
      if [[ -L $entry ]]; then
        suffix=@
      elif [[ -d $entry ]]; then
        is_directory=true
        suffix=/
      elif [[ -f $entry && -x $entry ]]; then
        suffix='*'
      fi
      if [[ $group == directories && $is_directory == false ]] ||
         [[ $group == files && $is_directory == true ]]; then continue; fi
      printf '%s+--%s%s\n' "$prefix" "$name" "$suffix"
      if [[ $is_directory == true && $remaining -gt 1 ]]; then
        render_directory "$entry" "$prefix|  " "$((remaining - 1))"
      fi
    done
  done
}

printf '# Context Router - Project Structure\n\nDepth: %s (use --depth N to change).\n\n```\n.\n' "$depth"
render_directory "$REPO_ROOT" '' "$depth"
printf '%s\n' '```' '' '## Key Directories' '' \
  '- **apps/backend**: NestJS GraphQL API, Prisma storage, and MCP' \
  '- **apps/web**: Next.js dashboard and support routes' \
  '- **apps/desktop**: native Mac menu/guardian and installed-app packaging' \
  '- **docs**: current references, runbooks, and work plans' \
  '- **scripts**: repository validation and development utilities'
