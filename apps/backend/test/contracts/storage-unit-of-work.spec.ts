import { PostgresStorageUnitOfWork } from "../../src/infrastructure/storage/postgres/postgres-unit-of-work";
import {
  StorageConflictError,
  StorageScopeExpiredError,
  StorageUnavailableError,
} from "../../src/domains/shared/storage/storage-errors";
import type { StorageScope } from "../../src/domains/shared/storage/storage-unit-of-work";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("transaction acknowledgement and failure boundary", () => {
  it("expires an extracted method before commit acknowledgement and waits for acknowledgement before returning", async () => {
    const commit = deferred<void>();
    const callbackSettled = deferred<void>();
    const rootWrite = jest.fn(() => {
      throw new Error("root storage must not be used");
    });
    const transactionWrite = jest.fn().mockResolvedValue({});
    const callbackClient = {
      preferenceAuditEvent: { create: transactionWrite },
    };
    const driver = {
      preferenceAuditEvent: { create: rootWrite },
      $transaction: jest.fn(async (operation) => {
        const result = await operation(callbackClient);
        callbackSettled.resolve();
        await commit.promise;
        return result;
      }),
    };
    const unit = new PostgresStorageUnitOfWork(
      driver as unknown as PrismaService,
    );
    let append!: StorageScope["audit"]["record"];
    const event = {
      userId: "owner",
      subjectSlug: "contract.scope",
      targetType: "PREFERENCE" as const,
      targetId: "target",
      eventType: "PREFERENCE_SET" as const,
      actorType: "USER" as const,
      origin: "GRAPHQL" as const,
      correlationId: "contract",
    };
    let delivered = false;
    const result = unit
      .run(async (scope) => {
        append = scope.audit.record;
        await append(event);
        return "committed";
      })
      .then((value) => {
        delivered = true;
        return value;
      });
    await callbackSettled.promise;
    expect(delivered).toBe(false);
    await expect(append(event)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    expect(transactionWrite).toHaveBeenCalledTimes(1);
    expect(rootWrite).not.toHaveBeenCalled();
    commit.resolve();
    await expect(result).resolves.toBe("committed");
  });

  it.each([NaN, undefined, null, "callback failure"])(
    "preserves arbitrary application rejection %s",
    async (failure) => {
      const driver = { $transaction: jest.fn((operation) => operation({})) };
      const unit = new PostgresStorageUnitOfWork(
        driver as unknown as PrismaService,
      );
      await expect(
        unit.run(async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(driver.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["P2002", "unique"],
    ["P2034", "serialization"],
    ["40001", "serialization"],
    ["unknown", undefined],
  ] as const)(
    "normalizes provider transaction failure %s once without retaining details",
    async (code, kind) => {
      const driver = {
        $transaction: jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("private SQL secret"), { code }),
          ),
      };
      const unit = new PostgresStorageUnitOfWork(
        driver as unknown as PrismaService,
      );
      const failure = await unit
        .run(async () => undefined)
        .catch((error) => error);
      expect(failure).toBeInstanceOf(
        kind ? StorageConflictError : StorageUnavailableError,
      );
      if (kind) expect(failure.kind).toBe(kind);
      expect(String(failure)).not.toContain("private SQL secret");
      expect(failure).not.toHaveProperty("cause");
      expect(driver.$transaction).toHaveBeenCalledTimes(1);
    },
  );

  it("uses default isolation for ordinary work and one explicit serializable attempt for identity work", async () => {
    const driver = { $transaction: jest.fn((operation) => operation({})) };
    const unit = new PostgresStorageUnitOfWork(
      driver as unknown as PrismaService,
    );
    await unit.run(async () => undefined);
    await unit.serializable(async () => undefined);
    expect(driver.$transaction.mock.calls).toEqual([
      [expect.any(Function), undefined],
      [expect.any(Function), { isolationLevel: "Serializable" }],
    ]);
  });

  it("rejects a failed commit after callback success and leaves captured methods expired", async () => {
    let append!: StorageScope["audit"]["record"];
    const driver = {
      $transaction: jest.fn(async (operation) => {
        await operation({});
        throw Object.assign(new Error("private commit details"), {
          code: "40001",
        });
      }),
    };
    const unit = new PostgresStorageUnitOfWork(
      driver as unknown as PrismaService,
    );
    await expect(
      unit.run(async (scope) => {
        append = scope.audit.record;
        return "uncommitted";
      }),
    ).rejects.toMatchObject({ kind: "serialization" });
    await expect(append({} as never)).rejects.toBeInstanceOf(
      StorageScopeExpiredError,
    );
    expect(driver.$transaction).toHaveBeenCalledTimes(1);
  });
});
