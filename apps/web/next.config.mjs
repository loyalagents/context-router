import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(webRoot, '../..');

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repositoryRoot,
};

export default nextConfig;
