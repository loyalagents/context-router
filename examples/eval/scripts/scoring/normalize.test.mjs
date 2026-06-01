import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueMatchesFact } from './normalize.mjs';

test('matches SSN dashed and digits-only values', () => {
  assert.equal(valueMatchesFact('identity.ssn', '000-00-0292', '000000292'), true);
});

test('matches date render variants without substring search', () => {
  assert.equal(
    valueMatchesFact('identity.dateOfBirth', '1992-03-14', '03/14/1992'),
    true,
  );
  assert.equal(
    valueMatchesFact('identity.firstName', 'Alex', 'Alex Jordan Rivera'),
    false,
  );
});

test('matches typed arrays exactly', () => {
  assert.equal(
    valueMatchesFact('communication.preferredChannels', ['email'], ['email']),
    true,
  );
  assert.equal(
    valueMatchesFact('communication.preferredChannels', ['email'], ['sms']),
    false,
  );
});

