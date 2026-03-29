export function buildSchemaConsolidationPrompt(
  definitionsJson: string,
): string {
  return `You are a schema analysis assistant. Given a list of preference definitions, identify groups of definitions that are semantically duplicates or overlapping.

Each definition includes:
- "ownership": "GLOBAL" means a system-wide definition managed by administrators, "USER" means a user-created definition.
- "definitionScope": "GLOBAL" means the definition applies universally, "LOCATION" means it is location-specific. Two definitions with different definitionScopes may look similar but serve different purposes — do not merge them unless they are genuinely redundant.

Here are the preference definitions to analyze:
${definitionsJson}

Task:
- Identify groups of 2+ definitions that are semantically similar, overlapping, or redundant.
- For each group, explain the overlap and suggest an action: MERGE (combine into one), RENAME (clarify naming), DELETE_ONE (remove the redundant one), or REVIEW (needs human judgment).
- If suggesting MERGE or DELETE_ONE, prefer keeping the GLOBAL definition over a USER definition when both exist.
- If suggesting MERGE or RENAME, optionally recommend which slug to keep.
- Only group definitions that genuinely overlap. Do not force groupings.
- Return ONLY slugs that exist in the list above.

Respond with JSON only (no markdown code blocks):
{
  "consolidationGroups": [
    {
      "slugs": ["slug.one", "slug.two"],
      "reason": "Why these overlap",
      "suggestion": "MERGE" | "RENAME" | "DELETE_ONE" | "REVIEW",
      "recommendedSlug": "slug.one"
    }
  ],
  "summary": "Brief overall assessment of the schema's health"
}

If no overlaps are found, return:
{
  "consolidationGroups": [],
  "summary": "No overlapping or duplicate definitions found."
}`;
}
