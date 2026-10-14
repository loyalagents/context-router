import { validateManagedInstallation } from './managed-installation';
const personal = 'a'.repeat(32), demo = 'b'.repeat(32);
const installation = () => ({ version: 2, installationId: 'c'.repeat(32), minimumEpoch: 2,
  personalStore: personal, demoStore: demo, mode: 'personal', selectedStore: personal,
  setup: 'ready', pendingRestore: null, pendingDemo: null });

describe('managed fixed personal/demo installation grammar', () => {
  it('accepts exactly two named slots and binds selection to mode', () => {
    expect(validateManagedInstallation(installation())).toEqual(installation());
    const active = { ...installation(), mode: 'demo', selectedStore: demo };
    expect(validateManagedInstallation(active)).toEqual(active);
    expect(validateManagedInstallation({ ...installation(), demoStore: null })).toBeDefined();
  });
  it.each([
    { version: 1 }, { minimumEpoch: 1 }, { mode: 'third' }, { mode: 'demo' },
    { demoStore: personal }, { selectedStore: demo }, { personalStore: '../escape' },
    { extra: true }, { mode: 'demo', selectedStore: demo, demoStore: null },
  ])('refuses invalid/contradictory selection %j', delta => {
    expect(() => validateManagedInstallation({ ...installation(), ...delta })).toThrow();
  });
  it('reserves only a unique candidate bound to the exact prior selection and seed', () => {
    const pending = { storeId: 'd'.repeat(32), priorMode: 'personal', priorStore: personal,
      seedVersion: 'historical-2024-2025-v1', seedSha256: 'e'.repeat(64), status: 'reserved' };
    expect(validateManagedInstallation({ ...installation(), pendingDemo: pending })).toBeDefined();
    for (const delta of [{ storeId: personal }, { storeId: demo }, { priorMode: 'demo' },
      { priorStore: demo }, { status: 'complete' }, { seedSha256: 'bad' }, { extra: true }]) {
      expect(() => validateManagedInstallation({ ...installation(), pendingDemo: { ...pending, ...delta } })).toThrow();
    }
    expect(() => validateManagedInstallation({ ...installation(), pendingDemo: pending,
      pendingRestore: { storeId: 'f'.repeat(32), sourceDigest: 'e'.repeat(64), expectedSelection: personal, status: 'reserved' } })).toThrow();
  });
  it('personal restore remains personal-bound while demo is selected', () => {
    const value = { ...installation(), mode: 'demo', selectedStore: demo,
      pendingRestore: { storeId: 'f'.repeat(32), sourceDigest: 'e'.repeat(64), expectedSelection: personal, status: 'reserved' } };
    expect(validateManagedInstallation(value)).toBeDefined();
    expect(() => validateManagedInstallation({ ...value, pendingRestore: { ...value.pendingRestore, expectedSelection: demo } })).toThrow();
  });
});
