/** Explicit, isolated C2 HTTPS composition. It is never loaded by installed application roots. */
import { createServer } from "node:https";
import type { ServerOptions } from "node:https";
import {
  SyntheticExperiment,
  type ExperimentOptions,
} from "../infrastructure/hcp-experiment/store";
import type { ExperimentPaths } from "../infrastructure/hcp-experiment/ownership";
import type { ClientRegistration } from "../infrastructure/hcp-experiment/authority";
import { authorizationHandler } from "../infrastructure/hcp-experiment/http";
export interface AuthorizationExperimentOptions extends ExperimentOptions {
  tls: Pick<ServerOptions, "key" | "cert">;
  humanCredential: string;
  clients: ClientRegistration[];
  port?: number;
  reopen?: boolean;
}
export async function createSyntheticAuthorization(
  paths: ExperimentPaths,
  options: AuthorizationExperimentOptions,
) {
  // TLS construction may throw synchronously; acquire no store/lease before it succeeds.
  const server = createServer({
    key: options.tls.key,
    cert: options.tls.cert,
    minVersion: "TLSv1.2",
  });
  const store = options.reopen
    ? SyntheticExperiment.open(paths, options)
    : SyntheticExperiment.create(paths, options);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
    const port = (server.address() as { port: number }).port,
      issuer = `https://as.hcp.test:${port}`;
    const authority = store.authorization(
      { issuer, resource: issuer, clients: options.clients },
      options.humanCredential,
    );
    server.on(
      "request",
      authorizationHandler(authority, () =>
        store.inspectEntries().map((e) => ({
          id: e.id,
          categories: e.classification.categories,
          content: e.content,
        })),
      ),
    );
    let closed = false;
    return Object.freeze({
      issuer,
      async close() {
        if (closed) return;
        closed = true;
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        store.close();
      },
    });
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    throw error;
  }
}
