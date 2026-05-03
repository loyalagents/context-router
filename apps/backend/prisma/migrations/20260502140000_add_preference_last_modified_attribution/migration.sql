ALTER TABLE "user_preferences"
  ADD COLUMN "last_actor_type" "AuditActorType",
  ADD COLUMN "last_actor_client_key" TEXT,
  ADD COLUMN "last_origin" "AuditOrigin";
