import type { Prisma } from "../../prisma/generated-client";
import {
  StorageConflictError,
  StorageUnavailableError,
} from "../../../domains/shared/storage/storage-errors";

/** Call only at a provider boundary, never on an arbitrary application callback exception. */
export function postgresFailure(error: unknown): Error {
  const failure = error as {
    code?: unknown;
    cause?: { code?: unknown };
    meta?: { code?: unknown };
  };
  if (failure?.code === "P2002") return new StorageConflictError("unique");
  if (
    failure?.code === "P2034" ||
    failure?.code === "40001" ||
    failure?.cause?.code === "40001" ||
    failure?.meta?.code === "40001"
  )
    return new StorageConflictError("serialization");
  return new StorageUnavailableError();
}

/** Internal delegate wrapper: only provider calls are normalized; no provider object crosses a port. */
export function postgresClient(
  client: Prisma.TransactionClient,
): Prisma.TransactionClient {
  const delegates = new Map<PropertyKey, object>();
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== "object" || value === null) return value;
      if (!delegates.has(key))
        delegates.set(
          key,
          new Proxy(value, {
            get(delegate, method) {
              const call = Reflect.get(delegate, method);
              if (typeof call !== "function") return call;
              return async (...args: unknown[]) => {
                try {
                  return await call.apply(delegate, args);
                } catch (error) {
                  throw postgresFailure(error);
                }
              };
            },
          }),
        );
      return delegates.get(key);
    },
  });
}
