import rawCatalogData = require('./preferences.catalog.json');
import { PREFERENCE_CATALOG } from './preferences.catalog';

const catalogData =
  'default' in rawCatalogData ? rawCatalogData.default : rawCatalogData;

describe('PREFERENCE_CATALOG', () => {
  it('exports the JSON-backed catalog data unchanged', () => {
    expect(PREFERENCE_CATALOG).toEqual(catalogData);
    expect(PREFERENCE_CATALOG['profile.email']).toMatchObject({
      valueType: 'string',
      scope: 'global',
      isSensitive: true,
    });
    expect(PREFERENCE_CATALOG['communication.preferred_channels']).toMatchObject(
      {
        valueType: 'array',
        scope: 'global',
      },
    );
  });
});
