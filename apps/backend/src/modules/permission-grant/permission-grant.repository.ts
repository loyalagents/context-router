import type {
  PermissionGrant,
  GrantAction,
  GrantEffect,
} from "@/domains/shared/storage/storage-types";
/** Application-owned persistence behavior, independent of database and transport types. */
export abstract class PermissionGrantRepository {
  abstract upsert(
    userId: string,
    clientKey: string,
    target: string,
    action: GrantAction,
    effect: GrantEffect,
  ): Promise<PermissionGrant>;
  abstract remove(
    userId: string,
    clientKey: string,
    target: string,
    action: GrantAction,
  ): Promise<void>;
  abstract findByUserAndClient(
    userId: string,
    clientKey: string,
  ): Promise<PermissionGrant[]>;
  abstract findByUserClientAction(
    userId: string,
    clientKey: string,
    action: GrantAction,
  ): Promise<PermissionGrant[]>;
  abstract findByUser(userId: string): Promise<PermissionGrant[]>;
  abstract findMatchingGrants(
    userId: string,
    clientKey: string,
    action: GrantAction,
    prefixChain: string[],
  ): Promise<PermissionGrant[]>;
}
