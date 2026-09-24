"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
module.exports.runLocalIdentityEntrypoint = async ({ argv }) => {
  try {
    const dist = process.env.LOCAL_DATABASE_RUNTIME_DIST;
    const { SqliteDatabase } = require(
      path.join(dist, "infrastructure/storage/sqlite/sqlite-database.js"),
    );
    const { decodeLocalIdentityState } = require(
      path.join(dist, "modules/auth/local-identity-state.codec.js"),
    );
    const databaseRoot = process.env.LOCAL_DATABASE_ROOT,
      identityRoot = process.env.LOCAL_IDENTITY_STATE_ROOT;
    const state = decodeLocalIdentityState(
      fs.readFileSync(path.join(identityRoot, "identity.json")),
    );
    const database = SqliteDatabase.open({
      databaseRoot,
      identityRoot,
      expectedTarget: state.databaseTargetId,
    });
    const c = database.connect();
    try {
      if (argv[0] === "seed") {
        const definition = c.get(
          "SELECT id FROM preference_definitions WHERE namespace='GLOBAL' AND slug='profile.first_name' AND archived_at IS NULL",
        );
        c.run(
          "INSERT INTO user_preferences(id,user_id,context_key,definition_id,value,status,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            randomUUID(),
            state.principalId,
            "__GLOBAL__",
            definition.id,
            JSON.stringify("local-smoke-value"),
            "ACTIVE",
            "USER",
            1,
            1,
          ],
        );
      } else if (argv[0] !== "inspect") throw new Error();
      const catalog = c.all(
        "SELECT id,namespace,slug,display_name,description,value_type,scope,options,is_sensitive,is_core FROM preference_definitions ORDER BY id",
      );
      const users = c.all("SELECT * FROM users ORDER BY user_id");
      if (
        users.length !== 1 ||
        users[0].user_id !== state.principalId ||
        c.get("SELECT count(*) n FROM external_identities").n !== 0
      )
        throw new Error();
      const preferences = c.all("SELECT * FROM user_preferences ORDER BY id");
      process.stdout.write(
        JSON.stringify({
          type: "context-router.local-database.probe",
          version: 1,
          target: database.targetId,
          principal: state.principalId,
          catalog: catalog.length,
          catalogDigest: digest(catalog),
          dataDigest: digest([users, preferences]),
          preferences: preferences.length,
          node: process.versions.node,
          sqlite: c.get("SELECT sqlite_version() version").version,
          sourceId: c.get("SELECT sqlite_source_id() source").source,
          compileOptionsDigest: digest(c.all("PRAGMA compile_options")),
        }) + "\n",
      );
    } finally {
      c.close();
    }
    return 0;
  } catch {
    process.stderr.write("Local database probe failed\n");
    return 1;
  }
};
