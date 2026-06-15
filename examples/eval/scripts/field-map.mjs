import { getFactValue } from './shared.mjs';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CONDITIONAL_INACTIVE_SKIP_KIND = 'conditional-inactive';

export function isConditionalField(fieldMap) {
  return Boolean(fieldMap?.mode === 'fact' && fieldMap.when);
}

export function fieldIsActive(fieldMap, facts) {
  if (!isConditionalField(fieldMap)) return true;
  const actual = getFactValue(facts ?? {}, fieldMap.when.factKey);
  return conditionExpectedValues(fieldMap.when).some((expected) => actual === expected);
}

export function conditionExpectedValues(when) {
  if (!when || !Object.hasOwn(when, 'equals')) return [];
  return Array.isArray(when.equals) ? when.equals : [when.equals];
}

export function renderFactValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'string' && ISO_DATE_PATTERN.test(value)) {
    const [year, month, day] = value.split('-');
    return `${month}/${day}/${year}`;
  }
  return String(value);
}

export function renderFieldValue(value, fieldMap) {
  const rendered = renderFactValue(value);
  if (fieldMap.render === 'digits-only') {
    return rendered.replace(/\D/g, '');
  }
  if (fieldMap.render === 'mmddyyyy') {
    return renderMmddyyyy(value);
  }
  return rendered;
}

export function fieldValuesEquivalent(expected, actual, fieldMap) {
  if (expected == null || actual == null) return expected === actual;
  if (fieldMap?.render === 'digits-only' || fieldMap?.render === 'mmddyyyy') {
    const expectedDigits = String(expected).replace(/\D/g, '');
    const actualDigits = String(actual).replace(/\D/g, '');
    return expectedDigits.length > 0 && expectedDigits === actualDigits;
  }
  return actual === expected;
}

function renderMmddyyyy(value) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${month}${day}${year}`;
  }
  const digits = raw.replace(/\D/g, '');
  return digits.length === 8 ? digits : raw;
}
