import type { PrismaClient } from "../../prisma/generated-client";
import type {
  CatalogDefinitionData,
  CatalogStorage,
} from "../../../domains/shared/storage/catalog-storage";
import { postgresFailure } from "./postgres-client";

/** Operational seed assembly also runs through ts-node without application alias hooks. */
export class PostgresCatalogStorage implements CatalogStorage {
  constructor(
    private readonly client: Pick<PrismaClient, "preferenceDefinition">,
  ) {}
  findActiveGlobal(slug: string) {
    return this.call(() =>
      this.client.preferenceDefinition.findFirst({
        where: { namespace: "GLOBAL", slug, archivedAt: null },
      }),
    );
  }
  async updateGlobal(id: string, data: CatalogDefinitionData) {
    await this.call(() =>
      this.client.preferenceDefinition.update({ where: { id }, data }),
    );
  }
  countActivePersonalCollisions(slug: string) {
    return this.call(() =>
      this.client.preferenceDefinition.count({
        where: { namespace: { not: "GLOBAL" }, slug, archivedAt: null },
      }),
    );
  }
  async createGlobal(slug: string, data: CatalogDefinitionData) {
    await this.call(() =>
      this.client.preferenceDefinition.create({
        data: { namespace: "GLOBAL", slug, ownerUserId: null, ...data },
      }),
    );
  }
  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw postgresFailure(error);
    }
  }
}
