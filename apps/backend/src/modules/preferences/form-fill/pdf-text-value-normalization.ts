export interface PdfTextValueAction {
  fieldName: string;
  value?: string;
  sourceSlugs?: string[];
}

export function normalizeTextValueForPdfField(
  action: PdfTextValueAction,
): string {
  const value = action.value ?? '';
  if (isMmddyyyyAction(action)) {
    return normalizeMmddyyyy(value);
  }
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

function isMmddyyyyAction(action: PdfTextValueAction): boolean {
  return /\bmm\s*dd\s*yyyy\b/i.test(action.fieldName);
}

function normalizeMmddyyyy(value: string): string {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    return formatMmddyyyy(isoMatch[1], isoMatch[2], isoMatch[3]) ?? value;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (slashMatch) {
    return formatMmddyyyy(slashMatch[3], slashMatch[1], slashMatch[2]) ?? value;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length !== 8) {
    return value;
  }

  const yearFirst = formatMmddyyyy(
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8),
  );
  if (yearFirst) {
    return yearFirst;
  }

  const alreadyMmddyyyy = formatMmddyyyy(
    digits.slice(4, 8),
    digits.slice(0, 2),
    digits.slice(2, 4),
  );
  return alreadyMmddyyyy ? digits : value;
}

function formatMmddyyyy(
  rawYear: string,
  rawMonth: string,
  rawDay: string,
): string | null {
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2099 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }
  return `${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}${String(year).padStart(4, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
