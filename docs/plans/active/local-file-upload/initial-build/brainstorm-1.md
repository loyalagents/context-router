# Batch Preference Upload — Brainstorm

- Status: brainstorm
- Last updated: 2026-04-26

## The core problem

We have a folder of files. We want to extract preferences from them and load them into Context Router. Today this is a one-file-at-a-time flow via `POST /api/preferences/analysis`.

Future extension: a local AI sub-agent (Claude Code, Codex, Ollama, etc.) decides if each file contains useful preferences before uploading.

---

## Options

### Option 1: CLI script that loops over the existing document analysis endpoint

A standalone TypeScript/shell script that scans a folder and calls the existing `POST /api/preferences/analysis` for each file.

| | |
|---|---|
| **Pros** | Reuses the full AI extraction pipeline (Vertex AI, schema validation, duplicate consolidation, audit logging). Zero backend changes. |
| **Cons** | Requires running backend + Vertex AI. Sequential per file (or limited parallelism). Needs a JWT auth token. Suggestions land as SUGGESTED, still need manual accept. |

### Option 2: CLI script that calls GraphQL `setPreference` / `suggestPreference` directly

For when files are already structured (JSON/YAML of slug-value pairs), skip AI extraction and call GraphQL mutations directly.

| | |
|---|---|
| **Pros** | Fast, no AI costs, works offline from Vertex. Can set preferences directly to ACTIVE. |
| **Cons** | Files must already be in a known format. No intelligence — it's just a bulk loader. |

### Option 3: CLI script that calls MCP `mutatePreferences`

Same as Option 2 but via the MCP endpoint.

| | |
|---|---|
| **Pros** | Uses MCP permission grants, so you can test MCP auth flows. |
| **Cons** | More complex OAuth setup. Same "files must be structured" limitation. |

### Option 4: New backend batch endpoint

A new `POST /api/preferences/analysis/batch` that accepts multiple files in one request.

| | |
|---|---|
| **Pros** | Single request, server-side parallelism, can return a consolidated result. |
| **Cons** | Risk of timeouts with many files. Harder to stream progress. More backend code to maintain. |

### Option 5: Standalone script that uses Prisma directly (seed-style)

Bypass the API entirely, talk to the DB like the seed script does.

| | |
|---|---|
| **Pros** | Fastest. No auth needed. Good for dev/test data loading. |
| **Cons** | Skips all validation, audit logging, normalization. Dangerous for production use. |

---

## Recommendation: Two-stage CLI pipeline

Given that a local AI filter step is planned, the recommended approach is a two-stage CLI pipeline script:

```
folder/
  +-- file1.pdf
  +-- file2.txt
  +-- file3.md
        |
        v
  +---------------------+
  |  Stage 1: Filter     |  <-- pluggable, optional
  |  (local AI agent)    |  <-- Claude Code / Codex / Ollama
  |  "Does this file     |
  |   contain useful     |
  |   preferences?"      |
  +---------------------+
        | relevant files only
        v
  +---------------------+
  |  Stage 2: Upload     |
  |  calls POST          |
  |  /api/preferences/   |
  |  analysis per file   |
  +---------------------+
        |
        v
  results summary (JSON/table)
```

### Why this shape

- **Stage 2 (upload)** reuses the existing document analysis pipeline — no backend changes needed. All the schema validation, duplicate consolidation, audit logging is already there.
- **Stage 1 (filter)** is a pure function: `(fileContent) -> boolean`. Easy to swap implementations (hardcoded -> Ollama -> Claude API -> Codex). Build stage 2 now and plug in stage 1 later behind a flag like `--filter=ollama`.
- The script lives in the repo (e.g., `scripts/batch-upload.ts`) and uses the existing backend as a service.

### Filter interface design

```typescript
// Simple contract — build stage 2 against this interface
interface FileFilter {
  shouldUpload(filePath: string, content: Buffer, mimeType: string): Promise<boolean>;
}

// Default: no filtering, upload everything
class PassthroughFilter implements FileFilter { ... }

// Future: local AI filter
class OllamaFilter implements FileFilter { ... }
class ClaudeApiFilter implements FileFilter { ... }
```

### What to build now

1. A `scripts/batch-upload.ts` script that:
   - Takes `--folder <path>` and `--token <jwt>` (or reads from env)
   - Scans the folder for supported file types
   - Calls `POST /api/preferences/analysis` for each file
   - Collects results, prints a summary (total files, suggestions found, errors)
   - Has a `--filter` flag that defaults to passthrough
   - Has `--concurrency` to control parallelism (default 1)

2. The `FileFilter` interface so the filter is pluggable from day one
