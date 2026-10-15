jest.mock('../infrastructure/managed/managed-admission', () => ({ managedApplication: jest.fn(), managedCapability: jest.fn() }));
import { managedApplication, managedCapability } from '../infrastructure/managed/managed-admission';
import { localUiRuntime } from './local-ui-runtime';

describe('authenticated runtime presentation comes only from native admission', () => {
  afterEach(() => jest.resetAllMocks());
  it('identifies a manual source runtime without inventing native controls', () => {
    jest.mocked(managedApplication).mockReturnValue(false);
    expect(localUiRuntime()).toEqual({ mode: 'personal', launcher: 'terminal' });
    expect(managedCapability).not.toHaveBeenCalled();
  });
  it.each(['personal', 'demo'] as const)('presents admitted %s mode without paths or secrets', mode => {
    jest.mocked(managedApplication).mockReturnValue(true);
    jest.mocked(managedCapability).mockReturnValue({ mode, generation: 'a'.repeat(32), storeId: 'b'.repeat(32), envelope: '/private/secret' } as ReturnType<typeof managedCapability>);
    expect(localUiRuntime()).toEqual({ mode, launcher: 'native', generation: 'a'.repeat(32), storeId: 'b'.repeat(32) });
  });
  it('does not fall back to a source presentation when native admission is lost', () => {
    jest.mocked(managedApplication).mockImplementation(() => { throw new Error('lost'); });
    expect(() => localUiRuntime()).toThrow('lost');
  });
});
