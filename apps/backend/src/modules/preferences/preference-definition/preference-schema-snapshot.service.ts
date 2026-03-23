import { Injectable } from '@nestjs/common';
import { PreferenceDefinitionRepository } from './preference-definition.repository';

export interface PreferenceDefinitionSnapshot {
  slug: string;
  category: string;
  description: string;
  valueType: string;
  options?: string[];
  namespace: string;
}

export interface PreferenceSchemaSnapshot {
  definitions: PreferenceDefinitionSnapshot[];
  promptJson: string;
}

@Injectable()
export class PreferenceSchemaSnapshotService {
  constructor(private readonly defRepo: PreferenceDefinitionRepository) {}

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
    }));

    const promptJson = JSON.stringify(
      definitions.map(({ namespace: _, ...rest }) => rest),
      null,
      2,
    );

    return { definitions, promptJson };
  }
}
