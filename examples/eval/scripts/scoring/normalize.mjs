import { factValueVariants, isPlainObject } from '../shared.mjs';

export function isAbsentValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function valueMatchesFact(factKey, expected, actual) {
  if (expected == null || actual == null) return expected === actual;

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    return expected.every((entry, index) =>
      valueMatchesFact(factKey, entry, actual[index]),
    );
  }

  if (typeof expected === 'boolean' || typeof actual === 'boolean') {
    return expected === actual;
  }

  if (isPlainObject(expected) || isPlainObject(actual)) {
    return JSON.stringify(expected) === JSON.stringify(actual);
  }

  const expectedVariants = normalizedVariants(factKey, expected);
  const actualVariants = normalizedVariants(factKey, actual);
  return actualVariants.some((actualVariant) =>
    expectedVariants.includes(actualVariant),
  );
}

export function normalizedVariants(factKey, value) {
  if (value == null) return [null];
  if (Array.isArray(value) || isPlainObject(value)) {
    return [JSON.stringify(value)];
  }
  return [...new Set(factValueVariants(factKey, value).map(normalizeScalar))];
}

function normalizeScalar(value) {
  return String(value).trim();
}

export function rate(numerator, denominator) {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(3));
}

