'use strict';
// Private test-only evidence; zero exit does not by itself establish controls ran.
exports.threadResult = (threadId, code, cell) => {
  if (!Number.isSafeInteger(threadId) || threadId < 1 || code !== 0 || Atomics.load(cell, 0) !== 42) throw new Error('Local model thread controls incomplete');
  return { threadId, controls: 42, code, exited: true };
};
