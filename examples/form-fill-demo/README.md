# Form Fill Demo

Lightweight demo fixtures for the fillable PDF form-fill flow.

This folder is intentionally simpler than `examples/memory-demo/`:

- `users/` contains reusable synthetic users.
- Each user keeps the same shape as the memory demo:
  - `simple/` has easy seedable memory.
  - `realistic/` has messy synthetic source files.
- `forms/` contains one folder per fillable PDF:
  - `forms/<formId>/form.pdf` is the drag-and-drop-ready PDF.
  - `forms/<formId>/fields.generated.json` is the machine-readable field manifest.
  - `forms/<formId>/fake-user-requirements.generated.md` is a generated human summary for fake user data.
- `forms-notes.md` is for lightweight notes about which forms work well.

Regenerate form manifests after adding or replacing PDFs:

```bash
pnpm demo:form-fill:manifests
```

The generated files are intentionally committed so fake-user generation and demo
planning can inspect form requirements without re-parsing every PDF.

Manual demo flow:

1. Pick a user from `users/<userId>/simple/seed-preferences.json`.
2. Seed those preferences through the dashboard or MCP.
3. Open `/dashboard/form-fill`.
4. Upload a fillable PDF from `forms/<formId>/form.pdf`.
5. Compare filled and skipped fields against `forms-notes.md`.

Keep all user data synthetic and non-sensitive.
