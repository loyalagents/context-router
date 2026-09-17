import { resolveListenArguments } from './listener-options';

describe('resolveListenArguments', () => {
  it('preserves the hosted listener call shape when APP_HOST is unset', () => {
    expect(resolveListenArguments({ port: 4100 })).toEqual([4100]);
    expect(resolveListenArguments({ port: 3000 })).toEqual([3000]);
  });

  it('passes an explicit host only when APP_HOST is configured', () => {
    expect(resolveListenArguments({ port: 4100, host: '127.0.0.1' })).toEqual([
      4100,
      '127.0.0.1',
    ]);
  });

  it('treats an empty APP_HOST as unset', () => {
    expect(resolveListenArguments({ port: 4100, host: '' })).toEqual([4100]);
  });
});
