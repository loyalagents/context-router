# Form Fill Demo

Lightweight demo fixtures for the fillable PDF form-fill flow.

This folder is intentionally simpler than `examples/memory-demo/`:

- `users/` contains reusable synthetic users.
- Each user keeps the same shape as the memory demo:
  - `simple/` has easy seedable memory.
  - `realistic/` has messy synthetic source files.
- `forms/` is for drag-and-drop-ready fillable PDFs.
- `forms-notes.md` is for lightweight notes about which forms work well.

Manual demo flow:

1. Pick a user from `users/<userId>/simple/seed-preferences.json`.
2. Seed those preferences through the dashboard or MCP.
3. Open `/dashboard/form-fill`.
4. Upload a fillable PDF from `forms/`.
5. Compare filled and skipped fields against `forms-notes.md`.

Keep all user data synthetic and non-sensitive.
