import {
  type LocalIdentityAdminService,
  runLocalIdentityAdminCli,
} from './local-identity-admin.cli';

const SECRET_CREDENTIAL = 'credential-canary-do-not-print';
const SECRET_DATABASE = 'database-password-canary-do-not-print';
const SECRET_PRINCIPAL = 'principal-canary-do-not-print';

function ready(generation: number) {
  return {
    state: {
      schemaVersion: 1 as const,
      databaseTargetId: 'A'.repeat(43),
      principalId: SECRET_PRINCIPAL,
      credential: SECRET_CREDENTIAL,
      generation,
    },
    bytes: Buffer.from(SECRET_CREDENTIAL),
    digest: 'B'.repeat(43),
  };
}

function fakeService(): LocalIdentityAdminService {
  return {
    initialize: jest.fn(async () => ready(1)),
    recoverInitialize: jest.fn(async () => ready(1)),
    rotate: jest.fn(async () => ready(2)),
    recoverRotation: jest.fn(async () => ready(2)),
  };
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    writeStdout: (value: string) => {
      stdout += value;
    },
    writeStderr: (value: string) => {
      stderr += value;
    },
    output: () => ({ stdout, stderr }),
  };
}

describe('runLocalIdentityAdminCli', () => {
  it.each([
    ['initialize', 'initialize', 1],
    ['recover-initialize', 'recoverInitialize', 1],
    ['rotate', 'rotate', 2],
    ['recover-rotation', 'recoverRotation', 2],
  ] as const)(
    'dispatches %s with one fixed non-secret success record',
    async (command, method, generation) => {
      const service = fakeService();
      const io = capture();

      const code = await runLocalIdentityAdminCli({
        argv: [command],
        createService: () => service,
        ...io,
      });

      expect(code).toBe(0);
      expect(service[method]).toHaveBeenCalledTimes(1);
      expect(io.output()).toEqual({
        stdout: `${JSON.stringify({
          type: 'context-router.local-identity.admin',
          version: 1,
          operation: command,
          status: 'ok',
          generation,
        })}\n`,
        stderr: '',
      });
      expect(JSON.stringify(io.output())).not.toContain(SECRET_CREDENTIAL);
      expect(JSON.stringify(io.output())).not.toContain(SECRET_PRINCIPAL);
    },
  );

  it('reports a clean no-state initialize recovery without inventing a principal', async () => {
    const service = fakeService();
    service.recoverInitialize = jest.fn(async () => null);
    const io = capture();

    await expect(
      runLocalIdentityAdminCli({
        argv: ['recover-initialize'],
        createService: () => service,
        ...io,
      }),
    ).resolves.toBe(0);
    expect(io.output().stdout).toBe(
      '{"type":"context-router.local-identity.admin","version":1,"operation":"recover-initialize","status":"ok","generation":null}\n',
    );
  });

  it.each(
    [
      [],
      ['unknown'],
      ['preview'],
      ['--', 'initialize'],
      ['initialize', 'extra'],
      ['--credential', SECRET_CREDENTIAL],
      ['open'],
    ].map((argv) => [argv]),
  )(
    'rejects every non-exact command shape without constructing services: %j',
    async (argv) => {
      const io = capture();
      const createService = jest.fn();

      await expect(
        runLocalIdentityAdminCli({
          argv,
          createService,
          ...io,
        }),
      ).resolves.toBe(2);
      expect(createService).not.toHaveBeenCalled();
      expect(io.output()).toEqual({
        stdout: '',
        stderr: 'Invalid local identity command\n',
      });
      expect(io.output().stderr).not.toContain(SECRET_CREDENTIAL);
    },
  );

  it('maps all runtime failures to one fixed diagnostic with no cause, credential, principal, or database secret', async () => {
    const service = fakeService();
    service.initialize = jest.fn(async () => {
      throw new Error(
        `${SECRET_CREDENTIAL}:${SECRET_PRINCIPAL}:${SECRET_DATABASE}`,
      );
    });
    const io = capture();

    await expect(
      runLocalIdentityAdminCli({
        argv: ['initialize'],
        createService: () => service,
        ...io,
      }),
    ).resolves.toBe(1);
    expect(io.output()).toEqual({
      stdout: '',
      stderr: 'Local identity command failed\n',
    });
  });
});
