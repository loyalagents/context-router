interface ListenerEnvironment {
  PORT?: string;
  APP_HOST?: string;
}

export type ListenArguments =
  | [port: string | number]
  | [port: string | number, host: string];

/**
 * Preserve Nest's existing hosted listen call unless a caller explicitly opts
 * into a host. Step 02 owns changing the default bind policy.
 */
export function resolveListenArguments(
  environment: ListenerEnvironment = process.env as ListenerEnvironment,
): ListenArguments {
  const port = environment.PORT || 3000;
  return environment.APP_HOST ? [port, environment.APP_HOST] : [port];
}
