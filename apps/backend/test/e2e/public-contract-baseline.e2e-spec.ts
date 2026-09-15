import { INestApplication } from "@nestjs/common";
import request from "supertest";
import contract from "../contracts/fixtures/http-contracts.v1.json";
import { getDocumentUploadConfig } from "../../src/config/document-upload.config";
import { getFormFillConfig } from "../../src/config/form-fill.config";
import { createTestApp, createTestUser } from "../setup/test-app";

describe("Hosted HTTP public contract baseline (e2e)", () => {
  let app: INestApplication;
  let productionGuardApp: INestApplication;
  let setTestUser: (user: Awaited<ReturnType<typeof createTestUser>>) => void;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    productionGuardApp = (
      await createTestApp({ overrideGraphqlAuthGuards: false })
    ).app;
  });

  beforeEach(async () => {
    setTestUser(await createTestUser());
  });

  afterAll(async () => {
    await app.close();
    await productionGuardApp.close();
  });

  it("pins the health and public GraphQL transport envelopes", async () => {
    const health = await request(app.getHttpServer())
      .get(contract.routes.health.path)
      .expect(contract.routes.health.success.status);
    expect(Object.keys(health.body).sort()).toEqual(
      [...contract.routes.health.success.required].sort(),
    );
    expect(health.body.status).toBe(
      contract.routes.health.success.constants.status,
    );
    expect(Number.isNaN(Date.parse(health.body.timestamp))).toBe(false);

    const graphql = await request(app.getHttpServer())
      .post(contract.routes.graphql.path)
      .send({ query: contract.routes.graphql.publicProbe.query })
      .expect(contract.routes.graphql.success.status);
    expect(graphql.body).toEqual({
      data: { __typename: contract.routes.graphql.publicProbe.root },
    });
  });

  it("records anonymous preferenceCatalog as rejected by production guards", async () => {
    const response = await request(productionGuardApp.getHttpServer())
      .post("/graphql")
      .send({ query: "{ preferenceCatalog { slug } }" })
      .expect(200);
    expect(response.body.data ?? null).toBeNull();
    expect(response.body.errors?.[0]?.message).toMatch(/Unauthorized/i);
    expect(contract.routes.graphql.catalogAnonymousAccess).toBe(
      "observed-not-promised-class-guard-rejects",
    );
  });

  it("pins upload limits, MIME sets, multipart errors, and field-policy parsing", async () => {
    expect(getDocumentUploadConfig()).toMatchObject({
      maxFileSizeBytes: contract.routes.documentAnalysis.maxFileSizeBytes,
      allowedMimeTypes: contract.routes.documentAnalysis.allowedMimeTypes,
    });
    expect(getFormFillConfig()).toMatchObject({
      maxFileSizeBytes: contract.routes.formFill.maxFileSizeBytes,
      allowedMimeTypes: contract.routes.formFill.allowedMimeTypes,
    });

    for (const path of [
      contract.routes.documentAnalysis.path,
      contract.routes.formFill.path,
    ]) {
      const missing = await request(app.getHttpServer()).post(path).expect(400);
      expect(missing.body).toEqual(
        expect.objectContaining({
          statusCode: 400,
          message: expect.any(String),
        }),
      );
    }

    const invalidPolicy = await request(app.getHttpServer())
      .post(contract.routes.formFill.path)
      .field("fieldPolicies", "{not-json")
      .attach("file", Buffer.from("%PDF-invalid-but-controller-readable"), {
        filename: "form.pdf",
        contentType: "application/pdf",
      })
      .expect(400);
    expect(invalidPolicy.body.message).toBe("fieldPolicies must be valid JSON");
  });

  it("pins GET /mcp method refusal and OAuth metadata headers", async () => {
    const mcp = await request(app.getHttpServer())
      .get(contract.routes.mcpGet.path)
      .expect(contract.routes.mcpGet.response.status);
    expect(mcp.headers.allow).toBe(
      contract.routes.mcpGet.response.headers.Allow,
    );
    expect(mcp.body).toEqual(contract.routes.mcpGet.response.body);

    for (const path of contract.routes.oauthMetadata.paths) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.headers["cache-control"]).toBe("public, max-age=3600");
      expect(response.type).toMatch(/json/);
    }
  });
});
