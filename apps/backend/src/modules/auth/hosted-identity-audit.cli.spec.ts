import {
  executeHostedIdentityAuditCli,
  parseHostedIdentityAuditCliConfiguration,
} from "./hosted-identity-audit.cli";

describe("hosted identity audit CLI configuration", () => {
  it("accepts the first audit without requiring pre-existing link claims", () => {
    expect(
      parseHostedIdentityAuditCliConfiguration(["/private/audit/intent.json"], {
        DATABASE_URL: "postgresql://operator:secret@db.example.test/app",
        AUTH0_ISSUER: "https://tenant.auth0.com/",
        AUTH0_DOMAIN: "tenant.auth0.com",
        AUTH0_LEGACY_ISSUER: "https://tenant.auth0.com/",
      }),
    ).toEqual({
      intentPath: "/private/audit/intent.json",
      databaseUrl: "postgresql://operator:secret@db.example.test/app",
      issuer: "https://tenant.auth0.com/",
      domain: "tenant.auth0.com",
      legacyIssuer: "https://tenant.auth0.com/",
    });
  });

  it("rejects missing, extra, relative-path, database, and issuer inputs with fixed errors", () => {
    const environment = {
      DATABASE_URL: "postgresql://operator:secret@db.example.test/app",
      AUTH0_ISSUER: "https://tenant.auth0.com/",
      AUTH0_DOMAIN: "tenant.auth0.com",
    };
    for (const argv of [
      [],
      ["relative.json"],
      ["/private/a.json", "/private/b.json"],
    ]) {
      expect(() =>
        parseHostedIdentityAuditCliConfiguration(argv, environment),
      ).toThrow("Invalid hosted identity audit command");
    }
    expect(() =>
      parseHostedIdentityAuditCliConfiguration(["/private/a.json"], {
        ...environment,
        DATABASE_URL: "",
      }),
    ).toThrow("Invalid hosted identity audit configuration");
    expect(() =>
      parseHostedIdentityAuditCliConfiguration(["/private/a.json"], {
        ...environment,
        AUTH0_ISSUER: "http://tenant.auth0.com/",
      }),
    ).toThrow("Invalid hosted identity audit configuration");
  });

  it("maps command failures to fixed stderr without echoing configuration", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const secret = "database-password-canary";

    await expect(
      executeHostedIdentityAuditCli(
        ["relative.json"],
        {
          DATABASE_URL: `postgresql://operator:${secret}@db.example.test/app`,
          AUTH0_ISSUER: "https://tenant.auth0.com/",
          AUTH0_DOMAIN: "tenant.auth0.com",
        },
        {
          stdout: { write: (value) => stdout.push(value) },
          stderr: { write: (value) => stderr.push(value) },
        },
      ),
    ).resolves.toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(["Hosted identity audit failed\n"]);
    expect(stderr.join("")).not.toContain(secret);
  });
});
