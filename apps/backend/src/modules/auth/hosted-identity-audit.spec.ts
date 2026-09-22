import { execFileSync } from "child_process";
import {
  chmod,
  link as createHardLink,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  HostedIdentityAuditService,
  parseHostedIdentityAuditIntent,
  readHostedIdentityAuditIntentFile,
} from "./hosted-identity-audit";
import {
  IDENTITY_LINK_CLAIM_METADATA_KEY,
  computeIdentityLinkIdentityDigest,
  computeIdentityLinkRowDigest,
  parseIdentityLinkClaims,
} from "./hosted-identity-policy";

const ISSUER = "https://tenant.auth0.com/";

describe("hosted identity audit", () => {
  const canonicalIntent =
    '[{"userId":"user-1","email":"Alice@EXAMPLE.COM","decision":"deny"},{"userId":"user-2","email":"bob@example.com","decision":"link","issuer":"https://tenant.auth0.com/","subject":"auth0|bob"}]';

  it("parses only the exact canonical sorted intent array", () => {
    expect(parseHostedIdentityAuditIntent(canonicalIntent)).toEqual([
      {
        userId: "user-1",
        email: "Alice@EXAMPLE.COM",
        decision: "deny",
      },
      {
        userId: "user-2",
        email: "bob@example.com",
        decision: "link",
        issuer: ISSUER,
        subject: "auth0|bob",
      },
    ]);

    for (const invalid of [
      ` ${canonicalIntent}`,
      `${canonicalIntent}\n`,
      '[{"email":"Alice@EXAMPLE.COM","userId":"user-1","decision":"deny"}]',
      '[{"userId":"user-2","email":"bob@example.com","decision":"deny"},{"userId":"user-1","email":"Alice@EXAMPLE.COM","decision":"deny"}]',
      '[{"userId":"user-1","email":"Alice@EXAMPLE.COM","decision":"deny","subject":"extra"}]',
      '[{"userId":"user-1","email":"Alice@EXAMPLE.COM","decision":"link","issuer":"https://tenant.auth0.com/"}]',
    ]) {
      expect(() => parseHostedIdentityAuditIntent(invalid)).toThrow(
        "Invalid hosted identity audit intent",
      );
    }
  });

  it("rejects intent entry and byte limits before accepting canonical data", () => {
    const tooManyEntries = JSON.stringify(
      Array.from({ length: 257 }, (_, index) => ({
        userId: `limit-user-${index.toString().padStart(3, "0")}`,
        email: `limit-${index}@example.test`,
        decision: "deny",
      })),
    );
    expect(() => parseHostedIdentityAuditIntent(tooManyEntries)).toThrow(
      "Invalid hosted identity audit intent",
    );

    const oversizedCanonicalIntent = JSON.stringify([
      {
        userId: "oversized-user",
        email: "oversized@example.test",
        decision: "link",
        issuer: ISSUER,
        subject: `auth0|${"x".repeat(256 * 1024)}`,
      },
    ]);
    expect(() => JSON.parse(oversizedCanonicalIntent)).not.toThrow();
    const parse = jest.spyOn(JSON, "parse");
    try {
      expect(() =>
        parseHostedIdentityAuditIntent(oversizedCanonicalIntent),
      ).toThrow("Invalid hosted identity audit intent");
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("reads only an absolute no-follow owner-only 0600 file under an owner-only parent", async () => {
    const parent = await mkdtemp(join(tmpdir(), "hosted-identity-audit-"));
    try {
      await chmod(parent, 0o700);
      const canonicalParent = await realpath(parent);
      const path = join(canonicalParent, "intent.json");
      const link = join(canonicalParent, "intent-link.json");
      await writeFile(path, canonicalIntent, { mode: 0o600 });

      await expect(readHostedIdentityAuditIntentFile(path)).resolves.toEqual(
        parseHostedIdentityAuditIntent(canonicalIntent),
      );
      await expect(
        readHostedIdentityAuditIntentFile("relative-intent.json"),
      ).rejects.toThrow("Unsafe hosted identity audit intent file");

      await chmod(path, 0o644);
      await expect(readHostedIdentityAuditIntentFile(path)).rejects.toThrow(
        "Unsafe hosted identity audit intent file",
      );
      await chmod(path, 0o600);
      await symlink(path, link);
      await expect(readHostedIdentityAuditIntentFile(link)).rejects.toThrow(
        "Unsafe hosted identity audit intent file",
      );

      const hardLink = join(canonicalParent, "intent-hard-link.json");
      await createHardLink(path, hardLink);
      await expect(readHostedIdentityAuditIntentFile(hardLink)).rejects.toThrow(
        "Unsafe hosted identity audit intent file",
      );

      const fifo = join(canonicalParent, "intent.fifo");
      execFileSync("mkfifo", [fifo]);
      await chmod(fifo, 0o600);
      await expect(readHostedIdentityAuditIntentFile(fifo)).rejects.toThrow(
        "Unsafe hosted identity audit intent file",
      );

      const invalidUtf8 = join(canonicalParent, "invalid-utf8.json");
      await writeFile(invalidUtf8, Buffer.from([0xff]), { mode: 0o600 });
      await expect(
        readHostedIdentityAuditIntentFile(invalidUtf8),
      ).rejects.toThrow("Invalid hosted identity audit intent");

      const bom = join(canonicalParent, "bom.json");
      await writeFile(
        bom,
        Buffer.concat([
          Buffer.from([0xef, 0xbb, 0xbf]),
          Buffer.from(canonicalIntent),
        ]),
        { mode: 0o600 },
      );
      await expect(readHostedIdentityAuditIntentFile(bom)).rejects.toThrow(
        "Invalid hosted identity audit intent",
      );

      await chmod(parent, 0o755);
      await expect(readHostedIdentityAuditIntentFile(path)).rejects.toThrow(
        "Unsafe hosted identity audit intent file",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("retains a valid consumed marker without exposing its raw tuple", async () => {
    const userId = "consumed-user";
    const email = "consumed@example.com";
    const subject = "auth0|consumed";
    const rowDigest = computeIdentityLinkRowDigest(userId, email);
    const identityDigest = computeIdentityLinkIdentityDigest(ISSUER, subject);
    const repository = {
      readAuditSnapshot: jest.fn().mockResolvedValue({
        sentinelRowCount: 0,
        allUsers: [{ userId, email }],
        zeroIdentityUsers: [],
        markedIdentities: [
          {
            id: "consumed-identity",
            userId,
            provider: "auth0",
            issuer: ISSUER,
            providerUserId: subject,
            metadata: {
              [IDENTITY_LINK_CLAIM_METADATA_KEY]: {
                version: 1,
                rowDigest,
                identityDigest,
              },
            },
            email,
            identityCount: 1,
          },
        ],
        hostedIdentities: [
          {
            id: "consumed-identity",
            userId,
            issuer: ISSUER,
            providerUserId: subject,
          },
        ],
        conflictingSubjects: [],
      }),
    };

    const output = await new HostedIdentityAuditService(
      repository as never,
    ).audit([], { issuer: ISSUER, legacyIssuer: ISSUER });

    expect(output.counts).toEqual({
      pending: 0,
      consumed: 1,
      link: 1,
      deny: 0,
      total: 1,
    });
    expect(
      parseIdentityLinkClaims(output.identityLinkClaims).dispositions,
    ).toEqual([{ rowDigest, decision: "link", identityDigest }]);
    expect(JSON.stringify(output)).not.toContain(subject);
    expect(JSON.stringify(output)).not.toContain(email);
  });

  it("rejects a DB-wide ambiguity even when the duplicate already has an identity", async () => {
    const repository = {
      readAuditSnapshot: jest.fn().mockResolvedValue({
        sentinelRowCount: 0,
        allUsers: [
          { userId: "pending", email: "Alice@EXAMPLE.COM" },
          { userId: "occupied", email: "Alice@example.com" },
        ],
        zeroIdentityUsers: [{ userId: "pending", email: "Alice@EXAMPLE.COM" }],
        markedIdentities: [],
        hostedIdentities: [
          {
            id: "occupied-id",
            userId: "occupied",
            issuer: ISSUER,
            providerUserId: "auth0|other",
          },
        ],
        conflictingSubjects: [],
      }),
    };

    await expect(
      new HostedIdentityAuditService(repository as never).audit(
        [
          {
            userId: "pending",
            email: "Alice@EXAMPLE.COM",
            decision: "link",
            issuer: ISSUER,
            subject: "auth0|pending",
          },
        ],
        { issuer: ISSUER, legacyIssuer: ISSUER },
      ),
    ).rejects.toThrow("Ambiguous hosted identity email must be denied");
  });

  it("requires exact complete cohort coverage and emits only digest material", async () => {
    const repository = {
      readAuditSnapshot: jest.fn().mockResolvedValue({
        sentinelRowCount: 0,
        allUsers: [
          { userId: "user-1", email: "Alice@EXAMPLE.COM" },
          { userId: "user-2", email: "bob@example.com" },
          { userId: "reserved", email: "unknown@example.com" },
        ],
        zeroIdentityUsers: [
          { userId: "user-1", email: "Alice@EXAMPLE.COM" },
          { userId: "user-2", email: "bob@example.com" },
          { userId: "reserved", email: "unknown@example.com" },
        ],
        markedIdentities: [],
        hostedIdentities: [],
        conflictingSubjects: [],
      }),
    };
    const service = new HostedIdentityAuditService(repository as never);

    const output = await service.audit(
      parseHostedIdentityAuditIntent(canonicalIntent),
      { issuer: ISSUER, legacyIssuer: ISSUER },
    );

    expect(output).toEqual({
      version: 1,
      identityLinkClaims: expect.stringMatching(
        /^\{"version":1,"dispositions":\[/,
      ),
      counts: { pending: 2, consumed: 0, link: 1, deny: 1, total: 2 },
      digest: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    const serialized = JSON.stringify(output);
    for (const canary of [
      "user-1",
      "user-2",
      "Alice",
      "bob@example.com",
      "auth0|bob",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    expect(repository.readAuditSnapshot).toHaveBeenCalledWith(ISSUER, [
      "auth0|bob",
    ]);
  });

  it("rejects missing, extra, changed, ambiguous-link, and conflicting-subject intent", async () => {
    const snapshot = {
      sentinelRowCount: 0,
      allUsers: [
        { userId: "user-1", email: "Alice@EXAMPLE.COM" },
        { userId: "user-2", email: "Alice@example.com" },
      ],
      zeroIdentityUsers: [
        { userId: "user-1", email: "Alice@EXAMPLE.COM" },
        { userId: "user-2", email: "Alice@example.com" },
      ],
      markedIdentities: [],
      hostedIdentities: [],
      conflictingSubjects: [],
    };
    const repository = {
      readAuditSnapshot: jest.fn().mockResolvedValue(snapshot),
    };
    const service = new HostedIdentityAuditService(repository as never);

    await expect(
      service.audit(
        [
          {
            userId: "user-1",
            email: "Alice@EXAMPLE.COM",
            decision: "link",
            issuer: ISSUER,
            subject: "auth0|alice",
          },
          {
            userId: "user-2",
            email: "Alice@example.com",
            decision: "deny",
          },
        ],
        { issuer: ISSUER, legacyIssuer: ISSUER },
      ),
    ).rejects.toThrow("Ambiguous hosted identity email must be denied");

    await expect(
      service.audit(
        [
          {
            userId: "user-1",
            email: "changed@example.com",
            decision: "deny",
          },
        ],
        { issuer: ISSUER, legacyIssuer: ISSUER },
      ),
    ).rejects.toThrow("Hosted identity audit cohort mismatch");

    repository.readAuditSnapshot.mockResolvedValue({
      ...snapshot,
      conflictingSubjects: ["auth0|alice"],
    });
    await expect(
      service.audit(
        [
          {
            userId: "user-1",
            email: "Alice@EXAMPLE.COM",
            decision: "link",
            issuer: ISSUER,
            subject: "auth0|alice",
          },
          {
            userId: "user-2",
            email: "Alice@example.com",
            decision: "deny",
          },
        ],
        { issuer: ISSUER, legacyIssuer: ISSUER },
      ),
    ).rejects.toThrow("Hosted identity audit subject conflict");
  });
});
