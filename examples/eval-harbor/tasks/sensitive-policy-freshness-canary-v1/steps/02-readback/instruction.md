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

Copy the filesystem carryover fields from `freshness-probe-runtime.json` into
the `freshness` object of your output.
