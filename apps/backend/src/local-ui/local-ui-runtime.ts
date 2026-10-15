import { managedApplication, managedCapability } from '../infrastructure/managed/managed-admission';

/** This is presentation only. It grants no lifecycle or storage authority. */
export function localUiRuntime() {
  if (!managedApplication()) return { mode: 'personal' as const, launcher: 'terminal' as const };
  const { mode, generation, storeId } = managedCapability();
  return { mode, launcher: 'native' as const, generation, storeId };
}
