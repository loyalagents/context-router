export const meta = {
  schemaVersion: 1,
  templateId: 'identity/name-history-note',
  category: 'identity',
  title: 'Name History Note',
  outputExtension: 'md',
  requiredFactKeys: [
    'identity.legalName',
    'identity.middleInitial',
    'identity.otherLastNames',
  ],
  optionalFactKeys: [],
  detailTier: 'medium',
  authority: 'medium',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 10,
};

export function render({ fact, joinFact }) {
  return `# Name History Note

Current legal name: ${fact('identity.legalName')}

Middle initial used on abbreviated forms: ${fact('identity.middleInitial')}

Other last names used in older records: ${joinFact('identity.otherLastNames', ', ')}

This note is kept with onboarding paperwork so name fields can be matched consistently across identity records, tax setup, and employment forms.
`;
}
