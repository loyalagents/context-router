import type { LocalIdentityState } from "../../../src/modules/auth/local-identity-state.codec";

interface HeldIdentity {
  initialize(
    state: LocalIdentityState,
    afterValidation?: (outcome: "inserted" | "matched") => Promise<void>,
  ): Promise<"inserted" | "matched">;
  verify(
    state: LocalIdentityState,
    afterValidation?: () => Promise<void>,
  ): Promise<void>;
  assertHeld(): void;
  release(): Promise<void>;
}
export interface CoordinationFixture {
  state: LocalIdentityState;
  acquire(): Promise<HeldIdentity>;
  snapshot(): Promise<unknown>;
  createForeignPrincipal(): Promise<void>;
  changeEmailAndAttachIdentity(): Promise<void>;
  loseHeldConnection(): void;
  queryCount(): number;
  dispose(): Promise<void>;
}

export function localCoordinationContract(
  name: string,
  factory: () => Promise<CoordinationFixture>,
): void {
  describe(`${name}: reusable held identity coordination`, () => {
    let fixture: CoordinationFixture;
    beforeEach(async () => {
      fixture = await factory();
    });
    afterEach(async () => {
      await fixture?.dispose();
    });

    it("holds exclusive ownership through validation callbacks and releases for a fresh owner", async () => {
      const handle = await fixture.acquire();
      await expect(fixture.acquire()).rejects.toThrow();
      const before = await fixture.snapshot();
      let calls = 0;
      await expect(
        handle.initialize(fixture.state, async (outcome) => {
          calls++;
          expect(outcome).toBe("inserted");
          handle.assertHeld();
          expect(await fixture.snapshot()).toEqual(before);
          await expect(fixture.acquire()).rejects.toThrow();
        }),
      ).resolves.toBe("inserted");
      expect(calls).toBe(1);
      await handle.release();
      const replacement = await fixture.acquire();
      await expect(replacement.initialize(fixture.state)).resolves.toBe(
        "matched",
      );
      await replacement.release();
    });

    it("rolls back a callback failure and preserves its exact error object", async () => {
      const handle = await fixture.acquire();
      const before = await fixture.snapshot();
      const failure = new Error("application callback sentinel");
      await expect(
        handle.initialize(fixture.state, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await fixture.snapshot()).toEqual(before);
      await handle.release();
      const replacement = await fixture.acquire();
      await expect(replacement.initialize(fixture.state)).resolves.toBe(
        "inserted",
      );
      await replacement.release();
    });

    it("does not invoke cleanup callbacks on an ownership conflict", async () => {
      await fixture.createForeignPrincipal();
      const before = await fixture.snapshot();
      const handle = await fixture.acquire();
      const callback = jest.fn(async () => undefined);
      await expect(handle.initialize(fixture.state, callback)).rejects.toThrow(
        "state conflict",
      );
      await expect(handle.verify(fixture.state, callback)).rejects.toThrow(
        "state conflict",
      );
      expect(callback).not.toHaveBeenCalled();
      expect(await fixture.snapshot()).toEqual(before);
      await handle.release();
    });

    it("matches an exact owner without rewriting its changed email or attached identities", async () => {
      const first = await fixture.acquire();
      await first.initialize(fixture.state);
      await first.release();
      await fixture.changeEmailAndAttachIdentity();
      const before = await fixture.snapshot();
      const handle = await fixture.acquire();
      await expect(handle.initialize(fixture.state)).resolves.toBe("matched");
      await handle.verify(fixture.state);
      expect(await fixture.snapshot()).toEqual(before);
      await handle.release();
    });

    it("rejects work after release before issuing another query; release is idempotent", async () => {
      const handle = await fixture.acquire();
      await handle.release();
      const queries = fixture.queryCount();
      expect(() => handle.assertHeld()).toThrow();
      await expect(handle.initialize(fixture.state)).rejects.toThrow();
      await expect(handle.verify(fixture.state)).rejects.toThrow();
      await handle.release();
      expect(fixture.queryCount()).toBe(queries);
    });

    it("latches connection loss and never issues later work on the lost handle", async () => {
      const handle = await fixture.acquire();
      fixture.loseHeldConnection();
      const queries = fixture.queryCount();
      expect(() => handle.assertHeld()).toThrow();
      await expect(handle.initialize(fixture.state)).rejects.toThrow();
      await expect(handle.verify(fixture.state)).rejects.toThrow();
      await handle.release();
      expect(fixture.queryCount()).toBe(queries);
    });
  });
}
