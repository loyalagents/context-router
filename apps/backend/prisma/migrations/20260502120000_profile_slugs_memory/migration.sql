-- Add core profile memory definitions, migrate existing account profile columns
-- into ACTIVE preference rows, then collapse users to account identity only.

INSERT INTO "preference_definitions" (
  "id",
  "namespace",
  "slug",
  "display_name",
  "description",
  "value_type",
  "scope",
  "options",
  "is_sensitive",
  "is_core",
  "owner_user_id",
  "archived_at",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::TEXT,
  'GLOBAL',
  profile_def."slug",
  profile_def."display_name",
  profile_def."description",
  'STRING'::"PreferenceValueType",
  'GLOBAL'::"PreferenceScope",
  NULL,
  profile_def."is_sensitive",
  TRUE,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('profile.full_name', 'Full Name', 'The user''s preferred full name for addressing them and filling forms.', FALSE),
    ('profile.first_name', 'First Name', 'The user''s preferred first or given name.', FALSE),
    ('profile.last_name', 'Last Name', 'The user''s preferred last or family name.', FALSE),
    ('profile.email', 'Contact Email', 'The user''s preferred contact email for forms and communication.', TRUE),
    ('profile.badge_name', 'Badge Name', 'The name the user prefers on badges, labels, or short-form introductions.', FALSE),
    ('profile.company', 'Company', 'The user''s current organization or company for profile and form filling.', FALSE),
    ('profile.title', 'Title', 'The user''s current role, title, or job function for profile and form filling.', FALSE)
) AS profile_def("slug", "display_name", "description", "is_sensitive")
WHERE NOT EXISTS (
  SELECT 1
  FROM "preference_definitions" existing
  WHERE existing."namespace" = 'GLOBAL'
    AND existing."slug" = profile_def."slug"
    AND existing."archived_at" IS NULL
);

WITH migrated_profile_values AS (
  SELECT
    u."user_id",
    'profile.full_name' AS "slug",
    BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(u."first_name"), ''), NULLIF(BTRIM(u."last_name"), ''))) AS "value"
  FROM "users" u
  UNION ALL
  SELECT u."user_id", 'profile.first_name', BTRIM(u."first_name")
  FROM "users" u
  UNION ALL
  SELECT u."user_id", 'profile.last_name', BTRIM(u."last_name")
  FROM "users" u
  UNION ALL
  SELECT u."user_id", 'profile.email', BTRIM(u."email")
  FROM "users" u
)
INSERT INTO "user_preferences" (
  "id",
  "user_id",
  "location_id",
  "context_key",
  "definition_id",
  "value",
  "status",
  "sourceType",
  "confidence",
  "evidence",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::TEXT,
  migrated."user_id",
  NULL,
  'GLOBAL',
  definition."id",
  to_jsonb(migrated."value"),
  'ACTIVE'::"PreferenceStatus",
  'IMPORTED'::"SourceType",
  NULL,
  '{"source":"profile_column_migration"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM migrated_profile_values migrated
JOIN "preference_definitions" definition
  ON definition."namespace" = 'GLOBAL'
 AND definition."slug" = migrated."slug"
 AND definition."archived_at" IS NULL
WHERE migrated."value" <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "user_preferences" existing
    WHERE existing."user_id" = migrated."user_id"
      AND existing."context_key" = 'GLOBAL'
      AND existing."definition_id" = definition."id"
      AND existing."status" = 'ACTIVE'
  );

ALTER TABLE "users" DROP COLUMN "first_name";
ALTER TABLE "users" DROP COLUMN "last_name";
