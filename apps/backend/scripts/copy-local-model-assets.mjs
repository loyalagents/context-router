import { fileURLToPath } from 'node:url';
import { copyPinnedAssets } from './local-model-assets.plugin.cjs';

// Retained explicit build helper; ordinary Nest emits use the same pinned copier.
copyPinnedAssets(fileURLToPath(new URL('../dist', import.meta.url)));
