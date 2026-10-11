// Test-only observation; prevent accidental real HTTP even if a startup guard regresses.
import fs from 'node:fs';
import http from 'node:http';
const lstat = fs.lstatSync;
fs.lstatSync = function (file, ...args) {
  if (file === process.env.CR_TEST_CREDENTIAL_FILE)
    process.stderr.write('TEST_CREDENTIAL_READ\n');
  return lstat.call(this, file, ...args);
};
http.request = () => {
  process.stderr.write('TEST_HTTP_ATTEMPT\n');
  throw new Error('Synthetic HTTP denied');
};
