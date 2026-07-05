You are working in `/app`.

This is step 2 of 2. The source documents are no longer available.

Read `freshness-task.json` and write `/app/outputs/freshness-canary-report.json`.

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
- For this canary, `allowed_alpha` maps to `canary.allowed_alpha`, and
  `allowed_beta` maps to `canary.allowed_beta`.
- Searches such as `canary`, `allowed_alpha`, `allowed_beta`,
  `canary.allowed_alpha`, or `canary.allowed_beta` are appropriate.

Copy the filesystem carryover fields from `freshness-probe-runtime.json` into
the `freshness` object of your output.
