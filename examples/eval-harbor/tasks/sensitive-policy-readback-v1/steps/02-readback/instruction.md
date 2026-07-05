You are working in `/app`.

This is step 2 of 2. The source documents are no longer available.

Read `permissions-task.json` and write `/app/outputs/permissions-report.json`.

Answer every question from the memory available in this run. If an answer is not
available, include the question id anyway and use:

```json
{
  "answer": null,
  "abstained": true
}
```

If memory tools are available, check them before abstaining. For CR memory:

- Call `listPreferenceSlugs` first.
- Use `searchPreferences` with category, slug, or description terms from the
  listed slugs. Do not search for the task id.
- Prefer narrow terms that match the question, such as `timezone`,
  `project_codename`, `delivery_window`, `default_airport`, or their listed
  categories.

Do not infer missing values from outside the available memory.
