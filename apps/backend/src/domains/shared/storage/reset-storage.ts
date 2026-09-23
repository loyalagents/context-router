/** Mode policy and ordering belong to the reset use case; these are transaction-bound operations. */
export interface ResetStorage {
  deletePreferences(userId: string): Promise<number>;
  appendMemoryResetAudit(
    userId: string,
    mode: string,
    preferencesDeleted: number,
    correlationId: string,
  ): Promise<void>;
  deleteAuditEvents(userId: string): Promise<number>;
  deleteAccessEvents(userId: string): Promise<number>;
  findOwnedDefinitionIds(userId: string): Promise<string[]>;
  hasForeignDefinitionReference(
    userId: string,
    definitionIds: string[],
  ): Promise<boolean>;
  deleteDefinitions(definitionIds: string[]): Promise<number>;
  deleteLocations(userId: string): Promise<number>;
  deleteGrants(userId: string): Promise<number>;
}
