export const meta = {
  schemaVersion: 1,
  templateId: 'work-authorization/lawful-permanent-resident-note',
  category: 'work-authorization',
  title: 'Lawful Permanent Resident Note',
  outputExtension: 'md',
  requiredFactKeys: [
    'identity.legalName',
    'workAuthorization.citizenshipStatus',
    'workAuthorization.uscisANumber',
  ],
  optionalFactKeys: [],
  detailTier: 'medium',
  authority: 'high',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 55,
};

export function render({ fact }) {
  return `# Lawful Permanent Resident Work Authorization Note

Employee: ${fact('identity.legalName')}

I-9 Section 1 citizenship status: ${fact('workAuthorization.citizenshipStatus')}

USCIS or A-number for lawful permanent resident attestation: ${fact('workAuthorization.uscisANumber')}

This note is part of the synthetic onboarding packet. It records only the employee-provided Section 1 status and identifier needed for local form-fill evaluation.
`;
}
