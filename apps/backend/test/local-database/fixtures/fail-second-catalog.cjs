const path = require('node:path');
const { SqliteCatalogStorage } = require(path.join(path.dirname(process.argv[1]), 'infrastructure/storage/sqlite/sqlite-catalog-storage.js'));
const original = SqliteCatalogStorage.prototype.createGlobal;
let count = 0;
SqliteCatalogStorage.prototype.createGlobal = function (...args) {
  if (++count === 2) throw new Error('private-catalog-canary');
  return original.apply(this, args);
};
