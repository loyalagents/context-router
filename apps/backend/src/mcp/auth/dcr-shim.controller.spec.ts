import { Logger } from '@nestjs/common';
import { DcrShimController } from './dcr-shim.controller';

describe('DCR diagnostics', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['invalid', 'mixed'])(
    'redacts rejected %s redirect URI contents',
    (status) => {
      const controller = new DcrShimController({
        resolveForDcr: () => ({ status }),
      } as never);
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      expect(() =>
        controller.registerClient(
          { redirect_uris: ['https://example.test/redirect-secret-canary'] },
          { headers: {}, ip: '127.0.0.1' } as never,
        ),
      ).toThrow();
      expect(JSON.stringify([log.mock.calls, warn.mock.calls])).not.toContain(
        'redirect-secret-canary',
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('count=1'));
    },
  );
});
