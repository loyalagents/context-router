import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../app.module";
import { startHostedApplication } from "../../bootstrap/hosted-bootstrap";
import { Auth0Service } from "../../infrastructure/auth0/auth0.service";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { HostedIdentityAdmissionService } from "./hosted-identity-admission.service";
import { parseIdentityLinkClaims } from "./hosted-identity-policy";
import { HostedIdentityRepository } from "./hosted-identity.repository";
import { AuthModule } from "./auth.module";

const ISSUER = "https://tenant.auth0.com/";
const claims = parseIdentityLinkClaims('{"version":1,"dispositions":[]}');
const values: Record<string, unknown> = {
  "auth.auth0.domain": "tenant.auth0.com",
  "auth.auth0.audience": "urn:context-router:admission-test",
  "auth.auth0.issuer": ISSUER,
  "auth.auth0.legacyIssuer": ISSUER,
  "auth.auth0.identityLinkClaims": claims,
};

const configService = {
  get: (key: string) => values[key],
  getOrThrow: (key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error("missing test value");
    return value;
  },
};

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: configService },
    { provide: PrismaService, useValue: {} },
    { provide: Auth0Service, useValue: {} },
  ],
  exports: [ConfigService, PrismaService, Auth0Service],
})
class AdmissionDependenciesModule {}

@Module({ imports: [AdmissionDependenciesModule, AuthModule] })
class AdmissionLifecycleRootModule {}

describe("HostedIdentityAdmissionService bootstrap", () => {
  it("fails the production start path before listen or readiness when admission rejects", async () => {
    expect(
      AppModule.register({ port: 0, host: "127.0.0.1", corsOrigins: [] }, {})
        .imports,
    ).toContain(AuthModule);

    const repository = {
      readAdmissionSnapshot: jest.fn().mockResolvedValue({
        sentinelRowCount: 0,
        allUsers: [{ userId: "pending-user", email: "pending@example.test" }],
        zeroIdentityUsers: [
          { userId: "pending-user", email: "pending@example.test" },
        ],
        markedIdentities: [],
        hostedIdentities: [],
      }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AdmissionLifecycleRootModule],
    })
      .overrideProvider(HostedIdentityRepository)
      .useValue(repository)
      .compile();
    const admission = moduleRef.get(HostedIdentityAdmissionService, {
      strict: false,
    });
    expect(admission).toBeInstanceOf(HostedIdentityAdmissionService);

    const app = moduleRef.createNestApplication({ logger: false });
    const server = app.getHttpServer();
    const nativeListen = jest.spyOn(server, "listen");
    const readiness = jest.fn();

    try {
      await expect(
        startHostedApplication(
          app as never,
          { port: 0, host: "127.0.0.1", corsOrigins: [] },
          readiness,
        ),
      ).rejects.toThrow("Hosted identity admission cohort mismatch");
      expect(repository.readAdmissionSnapshot).toHaveBeenCalledWith(ISSUER);
      expect(nativeListen).not.toHaveBeenCalled();
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
      expect(readiness).not.toHaveBeenCalled();
    } finally {
      nativeListen.mockRestore();
      await app.close().catch(() => undefined);
    }
  });
});
