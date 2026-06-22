import { normalizeTextValueForPdfField } from './pdf-text-value-normalization';

describe('normalizeTextValueForPdfField', () => {
  it('normalizes dates for mmddyyyy fields', () => {
    expect(
      normalizeTextValueForPdfField({
        fieldName: 'Date of Birth mmddyyyy',
        value: '1991-02-22',
      }),
    ).toBe('02221991');
    expect(
      normalizeTextValueForPdfField({
        fieldName: 'Date of Birth mmddyyyy',
        value: '19910222',
      }),
    ).toBe('02221991');
    expect(
      normalizeTextValueForPdfField({
        fieldName: 'Date of Birth mmddyyyy',
        value: '02221991',
      }),
    ).toBe('02221991');
  });

  it('leaves unparseable mmddyyyy values unchanged', () => {
    expect(
      normalizeTextValueForPdfField({
        fieldName: 'Date of Birth mmddyyyy',
        value: 'February 22',
      }),
    ).toBe('February 22');
  });

  it('keeps existing social security number normalization', () => {
    expect(
      normalizeTextValueForPdfField({
        fieldName: 'US Social Security Number',
        value: '000-00-0417',
      }),
    ).toBe('000000417');
  });
});
