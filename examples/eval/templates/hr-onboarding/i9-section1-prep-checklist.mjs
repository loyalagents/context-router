export const meta = {
  schemaVersion: 1,
  templateId: 'hr-onboarding/i9-section1-prep-checklist',
  category: 'hr-onboarding',
  title: 'I-9 Section 1 Prep Checklist',
  outputExtension: 'md',
  requiredFactKeys: [
    'identity.legalName',
    'identity.dateOfBirth',
    'workAuthorization.citizenshipStatus',
  ],
  optionalFactKeys: [
    'identity.ssn',
    'address.current.street',
    'address.current.unit',
    'address.current.city',
    'address.current.state',
    'address.current.postalCode',
  ],
  detailTier: 'hero',
  authority: 'high',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 60,
};

export function render({ fact, maybeFact, dateFact }) {
  const address = [
    maybeFact('address.current.street'),
    maybeFact('address.current.unit'),
    maybeFact('address.current.city'),
    maybeFact('address.current.state'),
    maybeFact('address.current.postalCode'),
  ]
    .filter(Boolean)
    .join(', ');

  return `# I-9 Section 1 Prep Checklist

Employee: ${fact('identity.legalName')}
Citizenship status for Section 1: ${fact('workAuthorization.citizenshipStatus')}
Date of birth on file: ${dateFact('identity.dateOfBirth', 'us')}
Synthetic SSN on file: ${maybeFact('identity.ssn')}
Current address: ${address}

People Ops reminder: complete only employee Section 1 fields from memory. Signature and employer document review fields require separate manual action.
`;
}
