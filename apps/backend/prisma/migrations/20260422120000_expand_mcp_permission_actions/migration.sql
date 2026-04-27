-- Demo cutover: old WRITE grants had broader semantics than the new action set.
DELETE FROM "permission_grants";

ALTER TYPE "GrantAction" ADD VALUE IF NOT EXISTS 'SUGGEST';
ALTER TYPE "GrantAction" ADD VALUE IF NOT EXISTS 'DEFINE';
