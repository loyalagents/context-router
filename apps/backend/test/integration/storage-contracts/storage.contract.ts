/** Shared behavioral assertions: a future adapter supplies only the fixture below. */
export const mutationCases = [
  "set",
  "suggest",
  "accept",
  "reject",
  "delete",
  "definition-create",
  "definition-update",
  "definition-archive",
] as const;
export type MutationCase = (typeof mutationCases)[number];
export type ResetMode = "MEMORY_ONLY" | "DEMO_DATA" | "FULL_USER_DATA";
export type FailurePoint =
  | "audit"
  | "suggestion-delete"
  | "location-delete"
  | "grant-delete";
export interface HistoryPage {
  items: Array<{ id: string; userId: string; occurredAt: Date }>;
  nextCursor: string | null;
  hasNextPage: boolean;
}
export interface StorageContractFixture {
  prepareMutation(kind: MutationCase): Promise<() => Promise<unknown>>;
  snapshot(): Promise<unknown>;
  failAt(point: FailurePoint): Promise<void>;
  failureProof(): Promise<{ reached: boolean; mutationObserved: boolean }>;
  dispose(): Promise<void>;
  prepareReset(): Promise<{
    reset(mode: ResetMode): Promise<unknown>;
    identity(): Promise<unknown>;
  }>;
  evidence(
    value?: unknown,
  ): Promise<{ evidence: unknown; createdAt: Date; updatedAt: Date }>;
  definitionOptions(
    value: unknown,
    update: { options?: unknown },
  ): Promise<unknown>;
  archiveAndRecreate(): Promise<{
    oldId: string;
    newId: string;
    archivedAt: Date | null;
    visibleIds: string[];
  }>;
  concurrent(
    kind: "preference" | "definition" | "grant",
  ): Promise<{
    attempts: PromiseSettledResult<unknown>[];
    rows: number;
    audits?: number;
  }>;
  deleteUser(): Promise<{
    remainingOwnedRows: number;
    globalDefinitions: number;
    globalsBefore: unknown;
    globalsAfter: unknown;
  }>;
  appendJson(value?: unknown): Promise<{ audit: unknown; access: unknown }>;
  histories(): Promise<{
    audit(after?: string): Promise<HistoryPage>;
    access(after?: string): Promise<HistoryPage>;
    expectedIds: string[];
    userId: string;
  }>;
  ownership(): Promise<{
    forbidden: Array<() => Promise<unknown>>;
    visibleIds: string[];
    expectedVisibleIds: string[];
    allIds: string[];
    globalIds: string[];
    locationIds: string[];
  }>;
}

export function storageContract(
  name: string,
  factory: () => Promise<StorageContractFixture>,
): void {
  describe(`${name}: reusable storage contract`, () => {
    let fixture: StorageContractFixture;
    beforeEach(async () => {
      fixture = await factory();
    });
    afterEach(async () => {
      await fixture?.dispose();
    });

    it.each(mutationCases)(
      "%s and its audit roll back together on audit failure",
      async (kind) => {
        const mutate = await fixture.prepareMutation(kind);
        const before = await fixture.snapshot();
        await fixture.failAt("audit");
        await expect(mutate()).rejects.toThrow();
        expect(await fixture.failureProof()).toEqual({
          reached: true,
          mutationObserved: true,
        });
        // Includes consumed suggestions, previous values, timestamps, attribution and all audits.
        expect(await fixture.snapshot()).toEqual(before);
      },
    );

    it("reject restores suggestion, tombstone and audit when the final delete fails", async () => {
      const reject = await fixture.prepareMutation("reject");
      const before = await fixture.snapshot();
      await fixture.failAt("suggestion-delete");
      await expect(reject()).rejects.toThrow();
      expect(await fixture.failureProof()).toEqual({
        reached: true,
        mutationObserved: true,
      });
      expect(await fixture.snapshot()).toEqual(before);
    });

    it.each([
      ["MEMORY_ONLY", "audit"],
      ["DEMO_DATA", "location-delete"],
      ["FULL_USER_DATA", "grant-delete"],
    ] as const)(
      "%s rolls back even after earlier reset deletes succeed",
      async (mode, failure) => {
        const reset = await fixture.prepareReset();
        const before = await fixture.snapshot();
        await fixture.failAt(failure);
        await expect(reset.reset(mode)).rejects.toThrow();
        expect(await fixture.failureProof()).toEqual({
          reached: true,
          mutationObserved: true,
        });
        expect(await fixture.snapshot()).toEqual(before);
      },
    );

    it.each(["MEMORY_ONLY", "DEMO_DATA", "FULL_USER_DATA"] as const)(
      "%s preserves exact principal and external identity rows",
      async (mode) => {
        const reset = await fixture.prepareReset();
        const before = await reset.identity();
        await reset.reset(mode);
        expect(await reset.identity()).toEqual(before);
      },
    );

    it.each([undefined, null, [], {}, { nested: [null, true, 1, "value"] }])(
      "round trips preference evidence %j and Date values",
      async (evidence) => {
        const row = await fixture.evidence(evidence);
        expect(row.evidence).toEqual(evidence ?? null);
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.updatedAt).toBeInstanceOf(Date);
        expect(Number.isFinite(row.updatedAt.getTime())).toBe(true);
      },
    );
    it("definition options distinguish omitted updates, explicit null and empty JSON", async () => {
      expect(await fixture.definitionOptions(["old"], {})).toEqual(["old"]);
      expect(
        await fixture.definitionOptions(["old"], { options: null }),
      ).toBeNull();
      expect(await fixture.definitionOptions(null, { options: [] })).toEqual(
        [],
      );
      expect(await fixture.definitionOptions({}, { options: {} })).toEqual({});
    });

    it.each([undefined, null, [], {}, { nested: [null, true, "text"] }])(
      "round trips optional history JSON %j",
      async (value) => {
        const rows = await fixture.appendJson(value);
        expect(rows.audit).toEqual(value ?? null);
        expect(rows.access).toEqual(value ?? null);
      },
    );

    it.each(["audit", "access"] as const)(
      "%s history combines owner and inclusive filters with stable tied cursors",
      async (kind) => {
        const history = await fixture.histories();
        const first = await history[kind]();
        expect(first.items.map((row) => row.id)).toEqual(
          history.expectedIds.slice(0, 2),
        );
        expect(
          first.items.every(
            (row) =>
              row.userId === history.userId && row.occurredAt instanceof Date,
          ),
        ).toBe(true);
        expect(first.hasNextPage).toBe(true);
        expect(first.nextCursor).toEqual(expect.any(String));
        const second = await history[kind](first.nextCursor!);
        expect(second.items.map((row) => row.id)).toEqual(
          history.expectedIds.slice(2),
        );
        expect(second.hasNextPage).toBe(false);
        expect(second.nextCursor).toBeNull();
        await expect(history[kind]("invalid cursor")).rejects.toThrow("cursor");
      },
    );

    it("enforces ownership and preserves null/omitted location selection and definition-ID merge", async () => {
      const scenario = await fixture.ownership();
      const before = await fixture.snapshot();
      for (const forbidden of scenario.forbidden)
        await expect(forbidden()).rejects.toThrow();
      expect(await fixture.snapshot()).toEqual(before);
      expect(scenario.visibleIds).toEqual(scenario.expectedVisibleIds);
      expect(scenario.allIds.sort()).toEqual(
        [...scenario.globalIds, ...scenario.locationIds].sort(),
      );
      expect(scenario.globalIds).toHaveLength(2);
      expect(scenario.locationIds).toHaveLength(1);
    });

    it("archive retains the old row and frees the active namespace/slug", async () => {
      const result = await fixture.archiveAndRecreate();
      expect(result.archivedAt).toBeInstanceOf(Date);
      expect(result.newId).not.toBe(result.oldId);
      expect(result.visibleIds).toContain(result.newId);
      expect(result.visibleIds).not.toContain(result.oldId);
    });

    it.each(["preference", "definition", "grant"] as const)(
      "concurrent %s writes preserve the exact unique key without promising every caller success",
      async (kind) => {
        const result = await fixture.concurrent(kind);
        const successes = result.attempts.filter(
          (attempt) => attempt.status === "fulfilled",
        ).length;
        expect(successes).toBeGreaterThanOrEqual(1);
        expect(result.rows).toBe(1);
        if (result.audits !== undefined) expect(result.audits).toBe(successes);
      },
    );

    it("user deletion cascades owned data while preserving the global catalog", async () => {
      await fixture.prepareReset();
      const result = await fixture.deleteUser();
      expect(result.remainingOwnedRows).toBe(0);
      expect(result.globalDefinitions).toBeGreaterThan(0);
      expect(result.globalsAfter).toEqual(result.globalsBefore);
    });
  });
}
