export const meta = {
  schemaVersion: 1,
  templateId: 'identity/birth-record-summary',
  category: 'identity',
  title: 'Birth Record Summary',
  outputExtension: 'txt',
  requiredFactKeys: ['identity.legalName', 'identity.dateOfBirth'],
  optionalFactKeys: [],
  detailTier: 'medium',
  authority: 'medium',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 40,
};

export function render({ fact, dateFact, choose }) {
  return `${choose('header', ['Birth Record Summary', 'Vital Records Summary'])}

Name on record: ${fact('identity.legalName')}
Date of birth: ${dateFact('identity.dateOfBirth', 'long')}

This transcript was prepared from the personal vital-records folder for onboarding identity verification. It is a summary note, not a certified copy.
`;
}
