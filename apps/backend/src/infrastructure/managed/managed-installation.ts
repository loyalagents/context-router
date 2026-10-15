import { StorageUnavailableError } from '../../domains/shared/storage/storage-errors';
export type ManagedMode = 'personal' | 'demo';
export interface ManagedInstallation {
  version: 2; installationId: string; minimumEpoch: 2;
  personalStore: string; demoStore: string | null; mode: ManagedMode; selectedStore: string;
  setup: 'initializing' | 'ready' | 'failed';
  pendingRestore: null | { storeId: string; sourceDigest: string; expectedSelection: string; status: 'reserved' | 'complete' | 'failed' };
  pendingDemo: null | { storeId: string; priorMode: ManagedMode; priorStore: string; seedVersion: string; seedSha256: string; status: 'reserved' | 'failed' };
}
const exact = (v: any, keys: string[]) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const id = (v: any) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const hash = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const fail = (): never => { throw new StorageUnavailableError(); };
/** Strict fixed-slot metadata, never authority by itself. */
export function validateManagedInstallation(value: unknown): ManagedInstallation {
  const v = value as ManagedInstallation;
  if (!exact(v, ['version', 'installationId', 'minimumEpoch', 'personalStore', 'demoStore', 'mode', 'selectedStore', 'setup', 'pendingRestore', 'pendingDemo']) ||
      v.version !== 2 || v.minimumEpoch !== 2 || !id(v.installationId) || !id(v.personalStore) ||
      (v.demoStore !== null && (!id(v.demoStore) || v.demoStore === v.personalStore)) ||
      !['personal', 'demo'].includes(v.mode) || v.selectedStore !== (v.mode === 'personal' ? v.personalStore : v.demoStore) ||
      !id(v.selectedStore) || !['initializing', 'ready', 'failed'].includes(v.setup) || (v.mode === 'demo' && v.setup !== 'ready')) fail();
  if (v.pendingRestore !== null) {
    const p = v.pendingRestore;
    if (!exact(p, ['storeId', 'sourceDigest', 'expectedSelection', 'status']) || !id(p.storeId) ||
        [v.personalStore, v.demoStore].includes(p.storeId) || !hash(p.sourceDigest) || p.expectedSelection !== v.personalStore ||
        !['reserved', 'complete', 'failed'].includes(p.status) || v.pendingDemo !== null) fail();
  }
  if (v.pendingDemo !== null) {
    const p = v.pendingDemo;
    if (!exact(p, ['storeId', 'priorMode', 'priorStore', 'seedVersion', 'seedSha256', 'status']) || !id(p.storeId) ||
        [v.personalStore, v.demoStore].includes(p.storeId) || p.priorMode !== v.mode || p.priorStore !== v.selectedStore ||
        p.seedVersion !== 'historical-2024-2025-v1' || !hash(p.seedSha256) || !['reserved', 'failed'].includes(p.status) || v.setup !== 'ready') fail();
  }
  return v;
}
