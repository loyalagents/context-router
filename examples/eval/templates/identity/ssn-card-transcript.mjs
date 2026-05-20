export const meta = {
  schemaVersion: 1,
  templateId: 'identity/ssn-card-transcript',
  category: 'identity',
  title: 'Social Security Card Transcript',
  outputExtension: 'md',
  requiredFactKeys: ['identity.legalName', 'identity.ssn'],
  optionalFactKeys: [],
  detailTier: 'hero',
  authority: 'high',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 50,
};

export function render({ fact }) {
  return `# Social Security Card Transcript

Cardholder name: ${fact('identity.legalName')}

Social Security number shown on card: ${fact('identity.ssn')}

The original card is not stored in this fixture. This transcript records only the synthetic evaluation value needed for payroll and employment eligibility forms.
`;
}
