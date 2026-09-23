import { VerifiedHumanIdentityResolver } from "../../src/modules/auth/verified-human-identity.resolver";
import { StorageConflictError } from "../../src/domains/shared/storage/storage-errors";
import type {
  StorageScope,
  StorageUnitOfWork,
} from "../../src/domains/shared/storage/storage-unit-of-work";
import type { IdentityTransaction } from "../../src/domains/shared/storage/identity-storage";

/** Use-case fakes express only behavioral contracts; no generated delegate/query/error shape. */
describe("identity use cases with neutral storage fakes", () => {
  const key = {
    provider: "contract",
    issuer: "https://issuer.example.test/",
    subject: "exact-subject",
  };
  const user = {
    userId: "principal",
    email: "account@example.test",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const emptyProfile = () => ({
    findExact: jest.fn().mockResolvedValue(null),
    findInitialProfileDefinitions: jest.fn().mockResolvedValue([]),
    hasInitialProfileValue: jest.fn().mockResolvedValue(false),
    createInitialProfileValue: jest.fn().mockResolvedValue(undefined),
  });

  it("returns an existing exact principal without any creation or profile writes", async () => {
    const identity: IdentityTransaction = {
      findExact: jest.fn().mockResolvedValue(user),
      createPrincipal: jest.fn(),
      createVerifiedBinding: jest.fn(),
      upsertM2MPrincipal: jest.fn(),
      countBindings: jest.fn(),
    };
    const root = emptyProfile();
    const unit = {
      serializable: jest.fn(
        async (
          operation: (
            scope: Pick<StorageScope, "identity">,
          ) => Promise<unknown>,
        ) => operation({ identity }),
      ),
      run: jest.fn(),
    };
    const resolver = new VerifiedHumanIdentityResolver(
      unit as StorageUnitOfWork,
      root,
    );
    await expect(
      resolver.resolve({ key, profileHints: { displayName: "New hint" } }),
    ).resolves.toEqual(user);
    expect(identity.findExact).toHaveBeenCalledWith(key);
    expect(identity.createPrincipal).not.toHaveBeenCalled();
    expect(identity.createVerifiedBinding).not.toHaveBeenCalled();
    expect(root.findInitialProfileDefinitions).not.toHaveBeenCalled();
    expect(unit.run).not.toHaveBeenCalled();
  });

  it.each(["unique", "serialization"] as const)(
    "keeps five %s attempts and exact fallback only for unique exhaustion",
    async (kind) => {
      const root = emptyProfile();
      root.findExact.mockResolvedValue(user);
      const unit = {
        serializable: jest
          .fn()
          .mockRejectedValue(new StorageConflictError(kind)),
        run: jest.fn(),
      };
      const resolver = new VerifiedHumanIdentityResolver(unit, root);
      if (kind === "unique")
        await expect(resolver.resolve({ key })).resolves.toEqual(user);
      else
        await expect(resolver.resolve({ key })).rejects.toThrow(
          "Human identity resolution conflict",
        );
      expect(unit.serializable).toHaveBeenCalledTimes(5);
      expect(root.findExact).toHaveBeenCalledTimes(kind === "unique" ? 1 : 0);
      expect(unit.run).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid human authority before consulting either storage boundary", async () => {
    const root = emptyProfile();
    const unit = { serializable: jest.fn(), run: jest.fn() };
    const resolver = new VerifiedHumanIdentityResolver(unit, root);
    await expect(
      resolver.resolve({ key: { ...key, subject: " subject " } }),
    ).rejects.toThrow("Invalid verified human identity assertion");
    expect(unit.serializable).not.toHaveBeenCalled();
    expect(root.findExact).not.toHaveBeenCalled();
  });
});
