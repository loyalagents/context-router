import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  AuditActorType,
  AuditOrigin,
  McpAccessOutcome,
  PreferenceScope,
  PreferenceValueType,
  SourceType,
} from '@infrastructure/prisma/generated-client';
import { PreferenceService } from '@modules/preferences/preference/preference.service';
import { PreferenceDefinitionService } from '@modules/preferences/preference-definition/preference-definition.service';
import { PreferenceDefinitionRepository } from '@modules/preferences/preference-definition/preference-definition.repository';
import { McpAuthorizationService } from '../auth/mcp-authorization.service';
import { McpAuthorizationError } from '../auth/mcp-authorization.service';
import { McpContext } from '../types/mcp-context.type';
import { McpToolExecutionResult } from '../access-log/access-log.types';
import { McpToolInterface } from './base/mcp-tool.interface';

const VALID_VALUE_TYPES = ['STRING', 'BOOLEAN', 'ENUM', 'ARRAY'] as const;
const VALID_SCOPES = ['GLOBAL', 'LOCATION'] as const;
const OPERATIONS = [
  'SUGGEST_PREFERENCE',
  'SET_PREFERENCE',
  'CREATE_DEFINITION',
  'UPDATE_DEFINITION',
  'ARCHIVE_DEFINITION',
  'DELETE_PREFERENCE',
] as const;

type MutatePreferenceOperation = (typeof OPERATIONS)[number];
type RequiredPermission = 'SUGGEST' | 'WRITE' | 'DEFINE';

interface PreferencePayload {
  id?: string;
  slug?: string;
  value?: string;
  locationId?: string;
  confidence?: number;
  evidence?: unknown;
}

interface DefinitionPayload {
  id?: string;
  slug?: string;
  displayName?: string;
  description?: string;
  valueType?: (typeof VALID_VALUE_TYPES)[number];
  scope?: (typeof VALID_SCOPES)[number];
  options?: unknown;
  isSensitive?: boolean;
}

interface MutatePreferencesParams {
  operation?: MutatePreferenceOperation;
  preference?: PreferencePayload;
  definition?: DefinitionPayload;
}

interface MutationEnvelope {
  success: boolean;
  changed: boolean;
  operation?: MutatePreferenceOperation;
  requiredPermission?: RequiredPermission;
  target?: string | null;
  code?: string;
  error?: string;
  preference?: unknown;
  definition?: unknown;
  audit?: {
    origin: 'MCP';
    actorClientKey: string;
    correlationId: string;
  };
}

@Injectable()
export class PreferenceMutateTool implements McpToolInterface {
  private readonly logger = new Logger(PreferenceMutateTool.name);

  readonly descriptor: Tool = {
    name: 'mutatePreferences',
    description: [
      'Mutate the authenticated user preference system. Use exactly one operation per call.',
      'SUGGEST_PREFERENCE requires SUGGEST and preference.slug, preference.value as a JSON string, and preference.confidence. Use it to create a reviewable suggestion.',
      'SET_PREFERENCE requires WRITE and preference.slug plus preference.value as a JSON string. Optional preference.confidence and structured preference.evidence are recorded as MCP write provenance.',
      'CREATE_DEFINITION requires DEFINE and definition.slug, definition.description, definition.valueType, and definition.scope. Use it for a user-owned slug that does not exist yet.',
      'UPDATE_DEFINITION requires DEFINE and definition.id or definition.slug plus the fields to change. Only active user-owned definitions can be updated.',
      'ARCHIVE_DEFINITION requires DEFINE and definition.id or definition.slug. Only active user-owned definitions can be archived.',
      'DELETE_PREFERENCE requires WRITE and preference.id. The tool resolves the preference slug before authorizing the delete.',
      'Do not JSON-encode preference.evidence; pass it as a structured object.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [...OPERATIONS],
          description: 'Mutation operation to perform.',
        },
        preference: {
          type: 'object',
          description:
            'Preference payload for SUGGEST_PREFERENCE, SET_PREFERENCE, and DELETE_PREFERENCE.',
          properties: {
            id: {
              type: 'string',
              description: 'Preference id. Required for DELETE_PREFERENCE.',
            },
            slug: {
              type: 'string',
              description:
                'Preference slug. Required for SUGGEST_PREFERENCE and SET_PREFERENCE.',
            },
            value: {
              type: 'string',
              description:
                'Preference value as a JSON string. Examples: \'["nuts"]\', \'"concise"\', \'true\'.',
            },
            locationId: {
              type: 'string',
              description:
                'Optional location id for location-scoped preferences.',
            },
            confidence: {
              type: 'number',
              description:
                'Confidence between 0 and 1. Required for SUGGEST_PREFERENCE and optional for SET_PREFERENCE.',
            },
            evidence: {
              type: 'object',
              description:
                'Optional structured evidence object. Do not JSON-encode this field.',
            },
          },
        },
        definition: {
          type: 'object',
          description:
            'Definition payload for CREATE_DEFINITION, UPDATE_DEFINITION, and ARCHIVE_DEFINITION.',
          properties: {
            id: {
              type: 'string',
              description:
                'Definition id. Required for id-based UPDATE_DEFINITION or ARCHIVE_DEFINITION.',
            },
            slug: {
              type: 'string',
              description:
                'Definition slug. Required for CREATE_DEFINITION, or for slug-based update/archive.',
            },
            displayName: { type: 'string' },
            description: { type: 'string' },
            valueType: {
              type: 'string',
              enum: [...VALID_VALUE_TYPES],
            },
            scope: {
              type: 'string',
              enum: [...VALID_SCOPES],
            },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for ENUM definitions.',
            },
            isSensitive: { type: 'boolean' },
          },
        },
      },
      required: ['operation'],
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };

  readonly requiresAuth = true;
  readonly requiredAccess = [
    { resource: 'preferences', action: 'suggest' },
    { resource: 'preferences', action: 'write' },
    { resource: 'preferences', action: 'define' },
  ] as const;
  readonly accessLogPolicy = 'always' as const;

  constructor(
    private readonly preferenceService: PreferenceService,
    private readonly definitionService: PreferenceDefinitionService,
    private readonly definitionRepository: PreferenceDefinitionRepository,
    private readonly authorizationService: McpAuthorizationService,
  ) {}

  async execute(
    args: unknown,
    context?: McpContext,
  ): Promise<McpToolExecutionResult> {
    const params = (args ?? {}) as MutatePreferencesParams;
    const correlationId = context?.correlationId ?? randomUUID();
    const operation = params.operation;
    let target: string | null = null;
    let requiredPermission: RequiredPermission | undefined;

    try {
      if (!context) {
        return this.toExecutionResult(
          this.failure({
            operation,
            requiredPermission,
            target,
            code: 'INTERNAL_ERROR',
            error: 'Authentication context not available',
          }),
          McpAccessOutcome.ERROR,
        );
      }

      if (!operation || !OPERATIONS.includes(operation)) {
        return this.toExecutionResult(
          this.failure({
            operation,
            requiredPermission,
            target,
            code: 'INVALID_MUTATION_OPERATION',
            error: `Invalid operation: ${String(operation)}`,
          }),
          McpAccessOutcome.ERROR,
        );
      }

      requiredPermission = this.requiredPermissionFor(operation);
      target = await this.resolveTarget(operation, params, context.user.userId);

      const result = await this.executeOperation(
        params,
        operation,
        requiredPermission,
        target,
        context,
        correlationId,
      );

      return this.toExecutionResult(result);
    } catch (error) {
      const mapped = this.mapError(error, {
        operation,
        requiredPermission,
        target,
      });
      return this.toExecutionResult(mapped.envelope, mapped.outcome);
    }
  }

  private async executeOperation(
    params: MutatePreferencesParams,
    operation: MutatePreferenceOperation,
    requiredPermission: RequiredPermission,
    target: string | null,
    context: McpContext,
    correlationId: string,
  ): Promise<MutationEnvelope> {
    switch (operation) {
      case 'SUGGEST_PREFERENCE':
        return this.suggestPreference(
          this.requirePreference(params),
          context,
          correlationId,
          target,
        );
      case 'SET_PREFERENCE':
        return this.setPreference(
          this.requirePreference(params),
          context,
          correlationId,
          target,
        );
      case 'CREATE_DEFINITION':
        return this.createDefinition(
          this.requireDefinition(params),
          context,
          correlationId,
          target,
        );
      case 'UPDATE_DEFINITION':
        return this.updateDefinition(
          this.requireDefinition(params),
          context,
          correlationId,
          target,
        );
      case 'ARCHIVE_DEFINITION':
        return this.archiveDefinition(
          this.requireDefinition(params),
          context,
          correlationId,
          target,
        );
      case 'DELETE_PREFERENCE':
        return this.deletePreference(
          this.requirePreference(params),
          context,
          correlationId,
          target,
        );
      default:
        return this.failure({
          operation,
          requiredPermission,
          target,
          code: 'INVALID_MUTATION_OPERATION',
          error: `Unsupported operation: ${operation}`,
        });
    }
  }

  private async suggestPreference(
    preference: PreferencePayload,
    context: McpContext,
    correlationId: string,
    target: string | null,
  ): Promise<MutationEnvelope> {
    const slug = this.requireString(preference.slug, 'preference.slug');
    const value = this.parseJsonValue(
      this.requireString(preference.value, 'preference.value'),
      'preference.value',
    );
    const confidence = this.requireConfidence(preference.confidence);

    await this.assertTarget(context, 'suggest', slug);

    const suggested = await this.preferenceService.suggestPreference(
      context.user.userId,
      {
        slug,
        value,
        locationId: preference.locationId,
        confidence,
        evidence: preference.evidence,
      },
      this.buildMutationContext(context, correlationId, SourceType.INFERRED, {
        confidence,
        evidence: preference.evidence,
      }),
    );

    if (!suggested) {
      return {
        success: true,
        changed: false,
        operation: 'SUGGEST_PREFERENCE',
        requiredPermission: 'SUGGEST',
        target,
        code: 'SUGGESTION_SUPPRESSED',
        preference: null,
        audit: this.auditMetadata(context, correlationId),
      };
    }

    return {
      success: true,
      changed: true,
      operation: 'SUGGEST_PREFERENCE',
      requiredPermission: 'SUGGEST',
      target,
      preference: this.formatPreference(suggested),
      audit: this.auditMetadata(context, correlationId),
    };
  }

  private async setPreference(
    preference: PreferencePayload,
    context: McpContext,
    correlationId: string,
    target: string | null,
  ): Promise<MutationEnvelope> {
    const slug = this.requireString(preference.slug, 'preference.slug');
    const value = this.parseJsonValue(
      this.requireString(preference.value, 'preference.value'),
      'preference.value',
    );
    const confidence = this.optionalConfidence(preference.confidence);

    await this.assertTarget(context, 'write', slug);

    const active = await this.preferenceService.setPreference(
      context.user.userId,
      {
        slug,
        value,
        locationId: preference.locationId,
      },
      this.buildMutationContext(context, correlationId, SourceType.INFERRED, {
        confidence,
        evidence: preference.evidence,
      }),
    );

    return {
      success: true,
      changed: true,
      operation: 'SET_PREFERENCE',
      requiredPermission: 'WRITE',
      target,
      preference: this.formatPreference(active),
      audit: this.auditMetadata(context, correlationId),
    };
  }

  private async createDefinition(
    definition: DefinitionPayload,
    context: McpContext,
    correlationId: string,
    target: string | null,
  ): Promise<MutationEnvelope> {
    const slug = this.requireString(definition.slug, 'definition.slug');
    this.validateDefinitionPayload(definition, true);

    await this.assertTarget(context, 'define', slug);

    const created = await this.definitionService.create(
      {
        slug,
        displayName: definition.displayName,
        description: this.requireString(
          definition.description,
          'definition.description',
        ),
        valueType: definition.valueType as PreferenceValueType,
        scope: definition.scope as PreferenceScope,
        options: definition.options,
        isSensitive: definition.isSensitive ?? false,
        isCore: false,
      },
      context.user.userId,
      this.buildMutationContext(context, correlationId, SourceType.USER),
    );

    return {
      success: true,
      changed: true,
      operation: 'CREATE_DEFINITION',
      requiredPermission: 'DEFINE',
      target,
      definition: this.formatDefinition(created),
      audit: this.auditMetadata(context, correlationId),
    };
  }

  private async updateDefinition(
    definition: DefinitionPayload,
    context: McpContext,
    correlationId: string,
    target: string | null,
  ): Promise<MutationEnvelope> {
    this.validateDefinitionPayload(definition, false);
    const existing = await this.resolveOwnedDefinition(
      definition,
      context.user.userId,
    );

    await this.assertTarget(context, 'define', existing.slug);

    const updated = await this.definitionService.update(
      existing.id,
      {
        displayName: definition.displayName,
        description: definition.description,
        valueType: definition.valueType as PreferenceValueType | undefined,
        scope: definition.scope as PreferenceScope | undefined,
        options: definition.options,
        isSensitive: definition.isSensitive,
      },
      context.user.userId,
      this.buildMutationContext(context, correlationId, SourceType.USER),
    );

    return {
      success: true,
      changed: true,
      operation: 'UPDATE_DEFINITION',
      requiredPermission: 'DEFINE',
      target,
      definition: this.formatDefinition(updated),
      audit: this.auditMetadata(context, correlationId),
    };
  }

  private async archiveDefinition(
    definition: DefinitionPayload,
    context: McpContext,
    correlationId: string,
    target: string | null,
  ): Promise<MutationEnvelope> {
    const existing = await this.resolveOwnedDefinition(
      definition,
      context.user.userId,
    );

    await this.assertTarget(context, 'define', existing.slug);

    const archived = await this.definitionService.archiveDefinition(
      existing.id,
      context.user.userId,
      this.buildMutationContext(context, correlationId, SourceType.USER),
    );

    return {
      success: true,
      changed: true,
      operation: 'ARCHIVE_DEFINITION',
      requiredPermission: 'DEFINE',
      target,
      definition: this.formatDefinition({
        ...archived,
        category: archived.slug.split('.')[0],
      }),
      audit: this.auditMetadata(context, correlationId),
    };
  }

  private async deletePreference(
    preference: PreferencePayload,
    context: McpContext,
    correlationId: string,
    target: string | null,
  ): Promise<MutationEnvelope> {
    const id = this.requireString(preference.id, 'preference.id');
    const existing = await this.preferenceService.getPreference(
      id,
      context.user.userId,
    );

    await this.assertTarget(context, 'write', existing.slug);

    const deleted = await this.preferenceService.deletePreference(
      id,
      context.user.userId,
      this.buildMutationContext(context, correlationId, SourceType.INFERRED),
    );

    return {
      success: true,
      changed: true,
      operation: 'DELETE_PREFERENCE',
      requiredPermission: 'WRITE',
      target: existing.slug,
      preference: this.formatPreference(deleted),
      audit: this.auditMetadata(context, correlationId),
    };
  }

  private async resolveTarget(
    operation: MutatePreferenceOperation,
    params: MutatePreferencesParams,
    userId: string,
  ): Promise<string | null> {
    if (operation === 'DELETE_PREFERENCE') {
      const id = params.preference?.id;
      if (!id) return null;
      const preference = await this.preferenceService.getPreference(id, userId);
      return preference.slug;
    }

    if (operation === 'SUGGEST_PREFERENCE' || operation === 'SET_PREFERENCE') {
      return params.preference?.slug ?? null;
    }

    if (operation === 'CREATE_DEFINITION') {
      return params.definition?.slug ?? null;
    }

    if (
      operation === 'UPDATE_DEFINITION' ||
      operation === 'ARCHIVE_DEFINITION'
    ) {
      const definition = params.definition;
      if (!definition) return null;
      if (definition.slug) return definition.slug;
      if (definition.id) {
        const existing = await this.definitionRepository.getDefinitionById(
          definition.id,
        );
        return existing?.slug ?? null;
      }
    }

    return null;
  }

  private async resolveOwnedDefinition(
    definition: DefinitionPayload,
    userId: string,
  ) {
    let existing;
    if (definition.id) {
      existing = await this.definitionRepository.getDefinitionById(
        definition.id,
      );
    } else if (definition.slug) {
      existing =
        await this.definitionRepository.getUserDefinitionBySlugIncludingArchived(
          definition.slug,
          userId,
        );
      if (!existing) {
        const visible = await this.definitionRepository.getDefinitionBySlug(
          definition.slug,
          userId,
        );
        if (visible) {
          throw this.domainError(
            'PREFERENCE_DEFINITION_NOT_OWNED',
            `Preference definition "${definition.slug}" is not user-owned`,
          );
        }
      }
    } else {
      throw this.domainError(
        'INVALID_MUTATION_INPUT',
        'definition.id or definition.slug is required',
      );
    }

    if (!existing) {
      throw this.domainError(
        'PREFERENCE_DEFINITION_NOT_FOUND',
        'Preference definition not found',
      );
    }
    if (existing.ownerUserId !== userId) {
      throw this.domainError(
        'PREFERENCE_DEFINITION_NOT_OWNED',
        `Preference definition "${existing.slug}" is not user-owned`,
      );
    }
    if (existing.archivedAt) {
      throw this.domainError(
        'PREFERENCE_DEFINITION_ARCHIVED',
        `Preference definition "${existing.slug}" is archived`,
      );
    }

    return existing;
  }

  private async assertTarget(
    context: McpContext,
    action: 'suggest' | 'write' | 'define',
    slug: string,
  ) {
    await this.authorizationService.assertAccessTarget(
      context.client,
      { resource: 'preferences', action },
      context.grants,
      context.user.userId,
      'tools/call',
      { slug },
    );
  }

  private buildMutationContext(
    context: McpContext,
    correlationId: string,
    sourceType: SourceType,
    extras: { confidence?: number; evidence?: unknown } = {},
  ) {
    return {
      actorType: AuditActorType.MCP_CLIENT,
      actorClientKey: context.client.key,
      origin: AuditOrigin.MCP,
      correlationId,
      sourceType,
      confidence: extras.confidence,
      evidence: extras.evidence,
    };
  }

  private requiredPermissionFor(
    operation: MutatePreferenceOperation,
  ): RequiredPermission {
    if (operation === 'SUGGEST_PREFERENCE') return 'SUGGEST';
    if (
      operation === 'CREATE_DEFINITION' ||
      operation === 'UPDATE_DEFINITION' ||
      operation === 'ARCHIVE_DEFINITION'
    ) {
      return 'DEFINE';
    }
    return 'WRITE';
  }

  private requirePreference(
    params: MutatePreferencesParams,
  ): PreferencePayload {
    if (!params.preference || typeof params.preference !== 'object') {
      throw this.domainError(
        'INVALID_MUTATION_INPUT',
        'preference payload is required for this operation',
      );
    }
    return params.preference;
  }

  private requireDefinition(
    params: MutatePreferencesParams,
  ): DefinitionPayload {
    if (!params.definition || typeof params.definition !== 'object') {
      throw this.domainError(
        'INVALID_MUTATION_INPUT',
        'definition payload is required for this operation',
      );
    }
    return params.definition;
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw this.domainError('INVALID_MUTATION_INPUT', `${field} is required`);
    }
    return value;
  }

  private parseJsonValue(value: string, field: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      throw this.domainError(
        'INVALID_MUTATION_INPUT',
        `Invalid JSON in ${field}`,
      );
    }
  }

  private requireConfidence(value: unknown): number {
    const confidence = this.optionalConfidence(value);
    if (confidence === undefined) {
      throw this.domainError(
        'INVALID_MUTATION_INPUT',
        'preference.confidence is required',
      );
    }
    return confidence;
  }

  private optionalConfidence(value: unknown): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (
      typeof value !== 'number' ||
      Number.isNaN(value) ||
      value < 0 ||
      value > 1
    ) {
      throw this.domainError(
        'INVALID_MUTATION_INPUT',
        'preference.confidence must be a number between 0 and 1',
      );
    }
    return value;
  }

  private validateDefinitionPayload(
    definition: DefinitionPayload,
    create: boolean,
  ): void {
    if (create) {
      this.requireString(definition.description, 'definition.description');
      if (!definition.valueType) {
        throw this.domainError(
          'INVALID_PREFERENCE_DEFINITION',
          'definition.valueType is required',
        );
      }
      if (!definition.scope) {
        throw this.domainError(
          'INVALID_PREFERENCE_DEFINITION',
          'definition.scope is required',
        );
      }
    }

    if (
      definition.valueType !== undefined &&
      !VALID_VALUE_TYPES.includes(definition.valueType)
    ) {
      throw this.domainError(
        'INVALID_PREFERENCE_DEFINITION',
        `Invalid valueType: ${definition.valueType}`,
      );
    }
    if (
      definition.scope !== undefined &&
      !VALID_SCOPES.includes(definition.scope)
    ) {
      throw this.domainError(
        'INVALID_PREFERENCE_DEFINITION',
        `Invalid scope: ${definition.scope}`,
      );
    }

    const valueType = definition.valueType;
    if (valueType === 'ENUM') {
      if (
        !definition.options ||
        !Array.isArray(definition.options) ||
        definition.options.length === 0 ||
        !definition.options.every((option) => typeof option === 'string')
      ) {
        throw this.domainError(
          'INVALID_PREFERENCE_DEFINITION',
          'ENUM definitions require non-empty string options',
        );
      }
    } else if (definition.options !== undefined && valueType !== undefined) {
      throw this.domainError(
        'INVALID_PREFERENCE_DEFINITION',
        `options is only valid for ENUM definitions`,
      );
    }
  }

  private formatPreference(pref: any) {
    return {
      id: pref.id,
      slug: pref.slug,
      value: pref.value,
      status: pref.status,
      sourceType: pref.sourceType,
      confidence: pref.confidence,
      locationId: pref.locationId,
      category: pref.category ?? pref.slug?.split('.')[0],
      description: pref.description,
    };
  }

  private formatDefinition(def: any) {
    return {
      id: def.id,
      slug: def.slug,
      category: def.category ?? def.slug?.split('.')[0],
      displayName: def.displayName ?? null,
      description: def.description,
      valueType: def.valueType,
      scope: def.scope,
      options: def.options ?? null,
      isSensitive: def.isSensitive,
      visibility: def.ownerUserId ? 'USER' : 'GLOBAL',
      archivedAt: def.archivedAt ?? null,
    };
  }

  private auditMetadata(context: McpContext, correlationId: string) {
    return {
      origin: 'MCP' as const,
      actorClientKey: context.client.key,
      correlationId,
    };
  }

  private toExecutionResult(
    envelope: MutationEnvelope,
    outcome?: McpAccessOutcome,
  ): McpToolExecutionResult {
    return {
      result: {
        content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        isError: !envelope.success,
      },
      outcome,
      accessLog: {
        requestMetadata: {
          operation: envelope.operation ?? null,
          target: envelope.target ?? null,
          requiredPermission: envelope.requiredPermission ?? null,
        },
        responseMetadata: envelope.success
          ? {
              success: true,
              changed: envelope.changed,
              code: envelope.code ?? null,
              preferenceId: this.safeId(envelope.preference),
              definitionId: this.safeId(envelope.definition),
            }
          : undefined,
        errorMetadata: !envelope.success
          ? {
              source:
                outcome === McpAccessOutcome.DENY
                  ? 'AUTHORIZATION'
                  : 'TOOL_RESULT',
              code: envelope.code,
              message: envelope.error,
            }
          : undefined,
      },
    };
  }

  private safeId(value: unknown): string | null {
    return typeof value === 'object' && value !== null && 'id' in value
      ? String((value as { id?: unknown }).id ?? '')
      : null;
  }

  private failure(params: {
    operation?: MutatePreferenceOperation;
    requiredPermission?: RequiredPermission;
    target?: string | null;
    code: string;
    error: string;
  }): MutationEnvelope {
    return {
      success: false,
      changed: false,
      operation: params.operation,
      requiredPermission: params.requiredPermission,
      target: params.target ?? null,
      code: params.code,
      error: params.error,
    };
  }

  private mapError(
    error: unknown,
    context: {
      operation?: MutatePreferenceOperation;
      requiredPermission?: RequiredPermission;
      target?: string | null;
    },
  ): { envelope: MutationEnvelope; outcome: McpAccessOutcome } {
    if (error instanceof McpAuthorizationError) {
      return {
        outcome: McpAccessOutcome.DENY,
        envelope: this.failure({
          ...context,
          code: 'MCP_PERMISSION_DENIED',
          error: error.message,
        }),
      };
    }

    if (this.isDomainError(error)) {
      return {
        outcome: McpAccessOutcome.ERROR,
        envelope: this.failure({
          ...context,
          code: error.code,
          error: error.message,
        }),
      };
    }

    const mapped = this.mapNestError(error);
    if (mapped.code === 'INTERNAL_ERROR') {
      this.logger.error(
        `mutatePreferences failed: ${mapped.error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return {
      outcome: McpAccessOutcome.ERROR,
      envelope: this.failure({
        ...context,
        code: mapped.code,
        error: mapped.error,
      }),
    };
  }

  private mapNestError(error: unknown): { code: string; error: string } {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof ConflictException) {
      return { code: 'PREFERENCE_DEFINITION_CONFLICT', error: message };
    }
    if (error instanceof NotFoundException) {
      if (message.toLowerCase().includes('definition')) {
        return { code: 'PREFERENCE_DEFINITION_NOT_FOUND', error: message };
      }
      return { code: 'PREFERENCE_NOT_FOUND', error: message };
    }
    if (error instanceof ForbiddenException) {
      if (message.toLowerCase().includes('definition')) {
        return { code: 'PREFERENCE_DEFINITION_NOT_OWNED', error: message };
      }
      return { code: 'PREFERENCE_NOT_OWNED', error: message };
    }
    if (error instanceof BadRequestException) {
      if (message.includes('Unknown preference slug')) {
        return { code: 'UNKNOWN_PREFERENCE_SLUG', error: message };
      }
      if (message.includes('Invalid value')) {
        return { code: 'INVALID_PREFERENCE_VALUE', error: message };
      }
      if (
        message.toLowerCase().includes('definition') ||
        message.includes('Invalid slug format')
      ) {
        return { code: 'INVALID_PREFERENCE_DEFINITION', error: message };
      }
      return { code: 'INVALID_MUTATION_INPUT', error: message };
    }

    return { code: 'INTERNAL_ERROR', error: message };
  }

  private domainError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  }

  private isDomainError(error: unknown): error is Error & { code: string } {
    return (
      error instanceof Error &&
      typeof (error as Error & { code?: unknown }).code === 'string'
    );
  }
}
