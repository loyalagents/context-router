import { runLocalIdentityEntrypoint } from './local-identity';

describe('local identity process entrypoint', () => {
  it('maps loader and other top-level failures to one fixed diagnostic', async () => {
    const canaries = [
      '/absolute/source/path',
      'missing-dependency-name',
      'database-password-canary',
      'principal-canary',
      'credential-canary',
    ];
    let stderr = '';

    await expect(
      runLocalIdentityEntrypoint({
        argv: ['initialize'],
        invoke: async () => {
          throw new Error(canaries.join(':'));
        },
        writeStderr: (value) => {
          stderr += value;
        },
      }),
    ).resolves.toBe(1);

    expect(stderr).toBe('Local identity command failed\n');
    for (const canary of canaries) expect(stderr).not.toContain(canary);
  });
});
