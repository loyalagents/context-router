/** Local schema history is independent of hosted Prisma migrations. Version 1 is immutable. */
export const SQLITE_APPLICATION_ID = 0x43525452;
export const SQLITE_SCHEMA_VERSION = 1;
export const SQLITE_TABLES = [
  "users",
  "external_identities",
  "locations",
  "preference_definitions",
  "user_preferences",
  "preference_audit_events",
  "mcp_access_events",
  "permission_grants",
] as const;
export const SQLITE_SCHEMA = `
CREATE TABLE local_metadata (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  target_id TEXT NOT NULL CHECK(length(target_id)=43)
);
CREATE TABLE users (
  user_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE external_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider TEXT NOT NULL, issuer TEXT NOT NULL, provider_user_id TEXT NOT NULL,
  metadata TEXT CHECK(metadata IS NULL OR json_valid(metadata)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(provider,issuer,provider_user_id)
);
CREATE INDEX external_identity_user ON external_identities(user_id);
CREATE TABLE locations (
  location_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('HOME','WORK','OTHER')),
  label TEXT NOT NULL, address TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX location_user_type ON locations(user_id,type);
CREATE TABLE preference_definitions (
  id TEXT PRIMARY KEY NOT NULL, namespace TEXT NOT NULL, slug TEXT NOT NULL,
  display_name TEXT, description TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK(value_type IN ('STRING','BOOLEAN','ENUM','ARRAY')),
  scope TEXT NOT NULL CHECK(scope IN ('GLOBAL','LOCATION')),
  options TEXT CHECK(options IS NULL OR json_valid(options)),
  is_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(is_sensitive IN (0,1)),
  is_core INTEGER NOT NULL DEFAULT 0 CHECK(is_core IN (0,1)),
  archived_at INTEGER,
  owner_user_id TEXT REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uniq_active_def_per_namespace_slug ON preference_definitions(namespace,slug) WHERE archived_at IS NULL;
CREATE INDEX definition_namespace_slug ON preference_definitions(namespace,slug);
CREATE INDEX definition_owner ON preference_definitions(owner_user_id);
CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  location_id TEXT REFERENCES locations(location_id) ON DELETE CASCADE ON UPDATE CASCADE,
  context_key TEXT NOT NULL,
  definition_id TEXT NOT NULL REFERENCES preference_definitions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  value TEXT NOT NULL CHECK(json_valid(value)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUGGESTED','REJECTED')),
  source_type TEXT NOT NULL DEFAULT 'USER' CHECK(source_type IN ('USER','INFERRED','IMPORTED','SYSTEM')),
  confidence REAL,
  evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)),
  last_actor_type TEXT CHECK(last_actor_type IN ('USER','MCP_CLIENT','SYSTEM','WORKFLOW','IMPORT')),
  last_actor_client_key TEXT,
  last_origin TEXT CHECK(last_origin IN ('GRAPHQL','MCP','DOCUMENT_ANALYSIS','WORKFLOW','SYSTEM')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(user_id,context_key,definition_id,status)
);
CREATE INDEX preference_definition ON user_preferences(definition_id);
CREATE TABLE preference_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  subject_slug TEXT NOT NULL, occurred_at INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('PREFERENCE','PREFERENCE_DEFINITION')),
  target_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('PREFERENCES_RESET','PREFERENCE_SET','PREFERENCE_SUGGESTED_UPSERTED','PREFERENCE_SUGGESTION_ACCEPTED','PREFERENCE_SUGGESTION_REJECTED','PREFERENCE_DELETED','DEFINITION_CREATED','DEFINITION_UPDATED','DEFINITION_ARCHIVED')),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('USER','MCP_CLIENT','SYSTEM','WORKFLOW','IMPORT')),
  actor_client_key TEXT,
  origin TEXT NOT NULL CHECK(origin IN ('GRAPHQL','MCP','DOCUMENT_ANALYSIS','WORKFLOW','SYSTEM')),
  correlation_id TEXT NOT NULL,
  before_state TEXT CHECK(before_state IS NULL OR json_valid(before_state)),
  after_state TEXT CHECK(after_state IS NULL OR json_valid(after_state)),
  metadata TEXT CHECK(metadata IS NULL OR json_valid(metadata))
);
CREATE INDEX audit_user_time ON preference_audit_events(user_id,occurred_at DESC,id DESC);
CREATE INDEX audit_subject_time ON preference_audit_events(user_id,subject_slug,occurred_at DESC);
CREATE INDEX audit_event_time ON preference_audit_events(user_id,event_type,occurred_at DESC);
CREATE INDEX audit_target_time ON preference_audit_events(target_type,target_id,occurred_at DESC);
CREATE INDEX audit_correlation ON preference_audit_events(correlation_id);
CREATE TABLE mcp_access_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  client_key TEXT NOT NULL, occurred_at INTEGER NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('TOOLS_CALL','RESOURCES_READ')),
  operation_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('SUCCESS','DENY','ERROR')),
  correlation_id TEXT NOT NULL, latency_ms INTEGER NOT NULL,
  request_metadata TEXT CHECK(request_metadata IS NULL OR json_valid(request_metadata)),
  response_metadata TEXT CHECK(response_metadata IS NULL OR json_valid(response_metadata)),
  error_metadata TEXT CHECK(error_metadata IS NULL OR json_valid(error_metadata))
);
CREATE INDEX access_user_time ON mcp_access_events(user_id,occurred_at DESC,id DESC);
CREATE INDEX access_client_time ON mcp_access_events(user_id,client_key,occurred_at DESC);
CREATE INDEX access_operation_time ON mcp_access_events(user_id,operation_name,occurred_at DESC);
CREATE INDEX access_outcome_time ON mcp_access_events(user_id,outcome,occurred_at DESC);
CREATE INDEX access_correlation ON mcp_access_events(correlation_id);
CREATE TABLE permission_grants (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  client_key TEXT NOT NULL, target TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('READ','SUGGEST','WRITE','DEFINE')),
  effect TEXT NOT NULL CHECK(effect IN ('ALLOW','DENY')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(user_id,client_key,target,action)
);
CREATE INDEX grant_user_client_action ON permission_grants(user_id,client_key,action);
`;
export const normalizeSchemaSql = (sql: string): string =>
  sql.trim().replace(/\s+/g, " ");
export const SQLITE_EXPECTED_SCHEMA = SQLITE_SCHEMA.split(";")
  .map(normalizeSchemaSql)
  .filter(Boolean)
  .sort();
