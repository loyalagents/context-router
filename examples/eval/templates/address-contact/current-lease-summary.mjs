export const meta = {
  schemaVersion: 1,
  templateId: 'address-contact/current-lease-summary',
  category: 'address-contact',
  title: 'Current Lease Summary',
  outputExtension: 'md',
  requiredFactKeys: [
    'identity.legalName',
    'address.current.street',
    'address.current.unit',
  ],
  optionalFactKeys: [
    'address.current.city',
    'address.current.state',
    'address.current.postalCode',
    'contact.email',
  ],
  detailTier: 'hero',
  authority: 'high',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 20,
};

export function render({ fact, maybeFact, choose }) {
  const cityStateZip = [
    maybeFact('address.current.city'),
    maybeFact('address.current.state'),
    maybeFact('address.current.postalCode'),
  ]
    .filter(Boolean)
    .join(' ');

  return `# Current Lease Summary

Tenant: ${fact('identity.legalName')}

Leased residence:
${fact('address.current.street')}, ${fact('address.current.unit')}
${cityStateZip}

Contact email on lease file: ${maybeFact('contact.email')}

Lease note: ${choose('lease-note', [
  'The address above is listed as the current mailing and residential address for tenant notices.',
  'Property records show this as the active residential address for notices and onboarding mail.',
])}
`;
}
