import type { RuntimeConfiguration } from './runtime-config';

export type ListenArguments = [port: number] | [port: number, host: string];

/**
 * Preserve Nest's existing hosted listen call unless a caller explicitly opts
 * into a host. Step 02 owns changing the default bind policy.
 */
export function resolveListenArguments(
  configuration: Pick<RuntimeConfiguration, 'port' | 'host'>,
): ListenArguments {
  return configuration.host
    ? [configuration.port, configuration.host]
    : [configuration.port];
}
