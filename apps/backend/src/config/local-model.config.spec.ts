import { createLocalModelSelection } from './local-model.config';

describe('explicit manual model selection', () => {
  it('returns an immutable path/port selection without reading credentials or checking availability', () => {
    const environment = { LOCAL_MODEL_SESSION_ROOT: '/private/missing-session', LOCAL_MODEL_PORT: '18090' };
    const result = createLocalModelSelection(environment);
    environment.LOCAL_MODEL_PORT = '18091';
    expect(result).toEqual({ root: '/private/missing-session', port: 18090 });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each([
    {}, { LOCAL_MODEL_SESSION_ROOT: '/private/session' },
    { LOCAL_MODEL_SESSION_ROOT: 'relative', LOCAL_MODEL_PORT: '18090' },
    { LOCAL_MODEL_SESSION_ROOT: '/', LOCAL_MODEL_PORT: '18090' },
    { LOCAL_MODEL_SESSION_ROOT: '/private/a/../b', LOCAL_MODEL_PORT: '18090' },
    { LOCAL_MODEL_SESSION_ROOT: '/private/session', LOCAL_MODEL_PORT: '0' },
    { LOCAL_MODEL_SESSION_ROOT: '/private/session', LOCAL_MODEL_PORT: '65536' },
    { LOCAL_MODEL_SESSION_ROOT: '/private/session', LOCAL_MODEL_PORT: '18090junk' },
    { LOCAL_MODEL_SESSION_ROOT: '/private/session', LOCAL_MODEL_PORT: '18090.0' },
    { LOCAL_MODEL_SESSION_ROOT: '/private/session\n', LOCAL_MODEL_PORT: '18090' },
  ])('degrades malformed/missing model configuration to unavailable AI: %p', (environment) => {
    expect(createLocalModelSelection(environment)).toBeUndefined();
  });
});
