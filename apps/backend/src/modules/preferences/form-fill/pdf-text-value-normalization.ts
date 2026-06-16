export interface PdfTextValueAction {
  fieldName: string;
  value?: string;
  sourceSlugs?: string[];
}

export function normalizeTextValueForPdfField(
  action: PdfTextValueAction,
): string {
  const value = action.value ?? '';
  if (!isSocialSecurityNumberAction(action)) {
    return value;
  }

  const digits = value.replace(/\D/g, '');
  return digits.length === 9 ? digits : value;
}

function isSocialSecurityNumberAction(action: PdfTextValueAction): boolean {
  return (
    action.fieldName === 'US Social Security Number' ||
    (action.sourceSlugs ?? []).some(
      (slug) => slug.endsWith('.identity.ssn') || slug === 'identity.ssn',
    )
  );
}
