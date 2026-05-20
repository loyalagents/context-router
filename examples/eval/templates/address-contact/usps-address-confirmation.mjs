export const meta = {
  schemaVersion: 1,
  templateId: 'address-contact/usps-address-confirmation',
  category: 'address-contact',
  title: 'USPS Address Confirmation',
  outputExtension: 'txt',
  requiredFactKeys: [
    'identity.legalName',
    'address.current.city',
    'address.current.state',
    'address.current.postalCode',
  ],
  optionalFactKeys: ['address.current.street', 'address.current.unit'],
  detailTier: 'medium',
  authority: 'medium',
  freshness: 'current',
  expectedUse: 'extract',
  defaultOrder: 30,
};

export function render({ fact, maybeFact }) {
  const streetLine = [maybeFact('address.current.street'), maybeFact('address.current.unit')]
    .filter(Boolean)
    .join(', ');

  return `USPS Address Confirmation

Recipient: ${fact('identity.legalName')}
Delivery line: ${streetLine}
City: ${fact('address.current.city')}
State: ${fact('address.current.state')}
ZIP Code: ${fact('address.current.postalCode')}

Address verification note: current delivery point confirmed for ordinary mail routing.
`;
}
