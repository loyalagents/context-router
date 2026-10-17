/** Fixture-only response: derive references from the actual authorized prompt, never assume catalog ordering. */
export function localSearchReply(prompt, slugs, queryInterpretation = 'Synthetic') {
  const rows = JSON.parse(prompt.split('\n').find(line => line.startsWith('[[')) ?? '[]');
  return { relevantReferences: slugs.map(slug => rows.find(row => row[2] === slug || row[2].startsWith(slug + ' ('))?.[0] ?? Number.MAX_SAFE_INTEGER), queryInterpretation };
}
