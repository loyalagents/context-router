import { main, runLocalIdentityEntrypoint } from './local-identity';

describe('local identity process entrypoint', () => {
  it('routes only the exact preview command to the lazy preview runner', async () => {
    const preview = jest.fn().mockResolvedValue(143);
    const admin = jest.fn().mockResolvedValue(2);
    const loadPreview = jest.fn(async () => preview);
    const loadAdmin = jest.fn(async () => admin);

    await expect(main(['preview'], { loadPreview, loadAdmin })).resolves.toBe(
      143,
    );
    expect(loadPreview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(loadAdmin).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled();
  });

  it.each([
    ['initialize'],
    ['recover-initialize'],
    ['rotate'],
    ['recover-rotation'],
    ['preview', 'extra'],
    [],
  ])(
    'routes non-preview argv %p to the four-verb admin parser',
    async (...argv) => {
      const preview = jest.fn().mockResolvedValue(0);
      const admin = jest.fn().mockResolvedValue(2);
      const loadPreview = jest.fn(async () => preview);
      const loadAdmin = jest.fn(async () => admin);

      await expect(main(argv, { loadPreview, loadAdmin })).resolves.toBe(2);
      expect(loadPreview).not.toHaveBeenCalled();
      expect(preview).not.toHaveBeenCalled();
      expect(loadAdmin).toHaveBeenCalledTimes(1);
      expect(admin).toHaveBeenCalledWith(argv);
    },
  );

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
