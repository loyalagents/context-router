import type { LocalIdentityState } from "@modules/auth/local-identity-state.codec";

/** One dedicated, fail-latched owner held through state-file publication/cleanup, not an ordinary UoW. */
export interface LocalIdentitySession {
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
export interface LocalIdentityCoordination {
  /** Busy acquisition fails promptly. A held session never reconnects or reacquires silently. */
  acquire(): Promise<LocalIdentitySession>;
}
