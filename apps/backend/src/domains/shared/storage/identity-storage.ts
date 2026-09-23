import type { VerifiedHumanIdentityAssertion } from "../ports/verified-human-identity";
import type { User } from "./storage-types";

export type HumanIdentityKey = VerifiedHumanIdentityAssertion["key"];
/** Exact-key identity operations used within one serializable attempt. */
export interface IdentityTransaction {
  findExact(key: HumanIdentityKey): Promise<User | null>;
  createPrincipal(userId: string, email: string): Promise<User>;
  createVerifiedBinding(userId: string, key: HumanIdentityKey): Promise<void>;
  upsertM2MPrincipal(userId: string, email: string): Promise<User>;
  countBindings(userId: string): Promise<number>;
}

/** Root reads and best-effort, post-commit profile initialization. Never part of identity creation. */
export abstract class IdentityStorage {
  abstract findExact(key: HumanIdentityKey): Promise<User | null>;
  abstract findInitialProfileDefinitions(
    slugs: string[],
  ): Promise<Array<{ id: string; slug: string }>>;
  abstract hasInitialProfileValue(
    userId: string,
    definitionId: string,
  ): Promise<boolean>;
  abstract createInitialProfileValue(
    userId: string,
    definitionId: string,
    value: string,
  ): Promise<void>;
}
