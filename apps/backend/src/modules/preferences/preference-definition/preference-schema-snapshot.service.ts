import { Injectable } from '@nestjs/common';
import { PreferenceDefinitionRepository } from './preference-definition.repository';
import { PermissionGrantService } from '@modules/permission-grant/permission-grant.service';

export interface PreferenceDefinitionSnapshot {
  slug: string;
  category: string;
  description: string;
  valueType: string;
  options?: string[];
  namespace: string;
  scope: string;
}

export interface PreferenceSchemaSnapshot {
  definitions: PreferenceDefinitionSnapshot[];
  promptJson: string;
}

export type PreferenceSlugAccessFilter = (slugs: string[]) => Promise<string[]>;

@Injectable()
export class PreferenceSchemaSnapshotService {
  constructor(
    private readonly defRepo: PreferenceDefinitionRepository,
    private readonly permissionGrantService: PermissionGrantService,
  ) {}

  async getSnapshot(
    userId: string,
    scope?: 'PERSONAL' | 'ALL',
  ): Promise<PreferenceSchemaSnapshot> {
    const resolvedScope = scope ?? 'ALL';

    const defs =
      resolvedScope === 'ALL'
        ? await this.defRepo.getAll(userId)
        : await this.defRepo.getByScope('PERSONAL', userId);

    const definitions: PreferenceDefinitionSnapshot[] = defs.map((def) => ({
      slug: def.slug,
      category: def.slug.split('.')[0],
      description: def.description,
      valueType: def.valueType,
      options: Array.isArray(def.options)
        ? (def.options as string[])
        : undefined,
      namespace: def.namespace,
      scope: def.scope,
    }));

    const promptJson = JSON.stringify(
      definitions.map(({ namespace: _, ...rest }) => rest),
      null,
      2,
    );

    return { definitions, promptJson };
  }

  async getGrantFilteredSnapshot(
    userId: string,
    clientKey: string,
    action: 'read' | 'write',
    scope?: 'PERSONAL' | 'ALL',
    filterAccessibleSlugs?: PreferenceSlugAccessFilter,
  ): Promise<PreferenceSchemaSnapshot> {
    const snapshot = await this.getSnapshot(userId, scope);
    const allSlugs = snapshot.definitions.map((definition) => definition.slug);
    const allowedSlugs = new Set(
      await (filterAccessibleSlugs
        ? filterAccessibleSlugs(allSlugs)
        : this.permissionGrantService.filterSlugsByAccess(
            userId,
            clientKey,
            action,
            allSlugs,
          )),
    );

    const definitions = snapshot.definitions.filter((definition) =>
      allowedSlugs.has(definition.slug),
    );
    const promptJson = JSON.stringify(
      definitions.map(({ namespace: _, ...rest }) => rest),
      null,
      2,
    );

    return { definitions, promptJson };
  }
}
