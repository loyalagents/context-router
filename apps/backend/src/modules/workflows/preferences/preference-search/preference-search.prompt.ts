export function buildPreferenceSearchPrompt(
  catalogJson: string,
  query: string,
): string {
  return `You are a preference-matching assistant. Given a catalog of preference definitions and a natural-language query, identify which preferences are relevant.

Here is the catalog of available preference definitions:
${catalogJson}

User query: "${query}"

Task:
- Identify which preference slugs from the catalog are semantically relevant to the user's query.
- Consider synonyms, related concepts, and intent — not just keyword matches.
- Return ONLY slugs that exist in the catalog above. Do not invent new slugs.
- Provide a brief interpretation of what the user is looking for.

Respond with JSON only (no markdown code blocks):
{
  "relevantSlugs": ["slug1", "slug2"],
  "queryInterpretation": "Brief description of what the user is looking for"
}

If no preferences match the query, return:
{
  "relevantSlugs": [],
  "queryInterpretation": "Brief explanation of why nothing matched"
}`;
}
