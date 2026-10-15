import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { safeError } from './files.mjs';
const require = createRequire(new URL('../../package.json', import.meta.url));
export function backend() {
  require('reflect-metadata');
  return {
    ...require('@nestjs/core'),
    ...require('./dist/composition/local-mcp-application.module.js'),
    ...require('./dist/bootstrap/local-mcp.js'),
    ...require('./dist/infrastructure/storage/sqlite/sqlite-database.js'),
    ...require('./dist/infrastructure/storage/sqlite/sqlite-mcp-credentials.js'),
    ...require('./dist/infrastructure/storage/sqlite/sqlite-local-runtime.js'),
    ...require('./dist/modules/preferences/preference/preference.service.js'),
    ...require('./dist/modules/preferences/preference-definition/preference-definition.repository.js'),
    ...require('./dist/modules/preferences/audit/preference-audit-query.service.js'),
    ...require('./dist/mcp/access-log/mcp-access-log-query.service.js'),
  };
}

export async function history(application, service, principalId, filter = {}) {
  const result = []; let after;
  do {
    const page = await application.get(service).getHistory(principalId, { ...filter, first: 100, ...(after ? { after } : {}) });
    result.push(...page.items); after = page.nextCursor;
    if (result.length > 50000) throw safeError('Demo history exceeds verification bound.');
  } while (after);
  return result;
}

export async function verifyApplication(application, principalId, plan, { strict = false, importerId } = {}) {
  const b = backend();
  const rows = await application.get(b.PreferenceService).getActivePreferences(principalId);
  const definitions = await application.get(b.PreferenceDefinitionRepository).getAll(principalId);
  const bySlug = new Map(rows.map(row => [row.slug, row])), defs = new Map(definitions.map(def => [def.slug, def]));
  const audits = await history(application, b.PreferenceAuditQueryService, principalId);
  const modified = [];
  if (rows.length !== plan.entries.length) throw safeError('Verification mismatch: active membership.');
  const ownedDefs = definitions.filter(d => d.ownerUserId === principalId);
  if (ownedDefs.length !== plan.entries.length) throw safeError('Verification mismatch: definition membership.');
  for (const entry of plan.entries) {
    const row = bySlug.get(entry.definition.slug), def = defs.get(entry.definition.slug);
    if (!row || def?.ownerUserId !== principalId || !def.isSensitive || def.valueType !== 'STRING' || def.scope !== 'GLOBAL' ||
        def.description !== entry.definition.description || def.displayName !== entry.definition.displayName ||
        (strict && (row.confidence != null || row.sourceType !== 'INFERRED')) || !row.lastModifiedBy) throw safeError('Verification mismatch: schema, ownership, source type or attribution.');
    const imported = audits.find(a => a.subjectSlug === row.slug && a.actorClientKey === `local:${importerId}` && a.origin === 'MCP' && isDeepStrictEqual(a.afterState?.evidence, entry.preference.evidence));
    if (!imported || imported.afterState.value !== JSON.parse(entry.preference.value) || imported.afterState.confidence != null || imported.afterState.sourceType !== 'INFERRED') throw safeError('Verification mismatch: retained import audit evidence.');
    const latest = audits.find(a => a.subjectSlug === row.slug && a.targetType === 'PREFERENCE');
    if (!latest || latest.afterState?.value !== row.value || !isDeepStrictEqual(latest.afterState.evidence, row.evidence) || !isDeepStrictEqual(latest.afterState.lastModifiedBy, row.lastModifiedBy)) throw safeError('Verification mismatch: current attribution or audited state.');
    if (row.value !== JSON.parse(entry.preference.value) || !isDeepStrictEqual(row.evidence, entry.preference.evidence)) {
      if (strict) throw safeError('Verification mismatch: imported value or evidence.');
      modified.push({ slug: row.slug, valueChanged: row.value !== JSON.parse(entry.preference.value), evidenceChanged: !isDeepStrictEqual(row.evidence, entry.preference.evidence) });
    }
  }
  return { active: rows.length, importAuditsVerified: plan.entries.length, modified };
}
