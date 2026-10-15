import { fileURLToPath } from 'node:url';
import { loadDemoPlan as load } from '../../apps/backend/scripts/demo/records.mjs';
export * from '../../apps/backend/scripts/demo/records.mjs';
export const defaultInput = fileURLToPath(new URL('./001_user_001', import.meta.url));
export const loadDemoPlan = (input = defaultInput, dataset = 'demo001') => load(input, dataset);
