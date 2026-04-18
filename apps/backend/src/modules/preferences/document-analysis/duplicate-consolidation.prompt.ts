export function buildDuplicateConsolidationPrompt(
  slug: string,
  currentValue: unknown,
  candidatesJson: string,
): string {
  return `You are consolidating multiple AI-generated preference suggestions for the same preference slug.

Target slug:
${slug}

Current stored value for this slug:
${JSON.stringify(currentValue, null, 2)}

Candidate suggestions for the same slug:
${candidatesJson}

Task:
- Return exactly one consolidated suggestion for the provided slug.
- Do not change the slug and do not invent facts not supported by the candidates.
- If candidates contain complementary array values, merge them and remove duplicates.
- If candidates contain conflicting scalar values, choose the best-supported value from the candidates.
- Use one of the provided sourceSnippet/sourceMeta pairs as representative evidence for the merged suggestion.
- Return a confidence score between 0 and 1 that reflects support and consistency across the candidates.

Respond with JSON only (no markdown code blocks):
{
  "suggestion": {
    "slug": "${slug}",
    "operation": "CREATE" | "UPDATE",
    "oldValue": any | null,
    "newValue": any,
    "confidence": 0.0-1.0,
    "sourceSnippet": "string",
    "sourceMeta": { "page": number | null, "line": number | null }
  }
}`;
}
