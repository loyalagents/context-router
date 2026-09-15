import {
  ExecutionContext,
  HttpException,
  INestApplication,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import contract from "../contracts/fixtures/http-contracts.v1.json";
import { getDocumentUploadConfig } from "../../src/config/document-upload.config";
import { getFormFillConfig } from "../../src/config/form-fill.config";
import { createTestApp, createTestUser } from "../setup/test-app";
import { DcrRateLimitGuard } from "../../src/mcp/auth/dcr-rate-limit.guard";
import { DcrShimController } from "../../src/mcp/auth/dcr-shim.controller";
import { DocumentAnalysisService } from "../../src/modules/preferences/document-analysis/document-analysis.service";
import {
  AnalysisStatus,
  DocumentAnalysisResult,
} from "../../src/modules/preferences/document-analysis/dto/document-analysis-result.dto";
import { FormFillService } from "../../src/modules/preferences/form-fill/form-fill.service";
import { FormFillResponse } from "../../src/modules/preferences/form-fill/form-fill.types";

describe("Hosted HTTP public contract baseline (e2e)", () => {
  let app: INestApplication;
  let productionGuardApp: INestApplication;
  let configService: ConfigService;
  let setTestUser: (user: Awaited<ReturnType<typeof createTestUser>>) => void;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    configService = testApp.module.get<ConfigService>(ConfigService);
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
      .post(contract.routes.graphql.path)
      .send({ query: "{ preferenceCatalog { slug } }" })
      .expect(contract.routes.graphql.applicationError.status);
    for (const key of contract.routes.graphql.applicationError.required) {
      expect(response.body).toHaveProperty(key);
    }
    for (const key of contract.routes.graphql.applicationError.errorRequired) {
      expect(response.body.errors?.[0]).toHaveProperty(key);
    }
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

    for (const [path, expected] of [
      [
        contract.routes.documentAnalysis.path,
        contract.routes.documentAnalysis.errors.missingOrInvalidUpload,
      ],
      [
        contract.routes.formFill.path,
        contract.routes.formFill.errors.missingInvalidOrPolicy,
      ],
    ] as const) {
      const missing = await request(app.getHttpServer())
        .post(path)
        .expect(expected.status);
      for (const key of expected.required) {
        expect(missing.body).toHaveProperty(key);
      }
    }

    for (const [route, expected] of [
      [
        contract.routes.documentAnalysis,
        contract.routes.documentAnalysis.errors.missingOrInvalidUpload,
      ],
      [
        contract.routes.formFill,
        contract.routes.formFill.errors.missingInvalidOrPolicy,
      ],
    ] as const) {
      const unsupported = await request(app.getHttpServer())
        .post(route.path)
        .attach("file", Buffer.from("unsupported contract probe"), {
          filename: "probe.bin",
          contentType: "application/octet-stream",
        })
        .expect(expected.status);
      for (const key of expected.required) {
        expect(unsupported.body).toHaveProperty(key);
      }
      expect(unsupported.body.message).toMatch(
        /^Unsupported file type: application\/octet-stream\. Allowed types: /,
      );
      expect(unsupported.body.message).toContain(
        route.allowedMimeTypes.join(", "),
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

  it("pins successful upload envelopes and form summary against fixtures", async () => {
    const analysisService = app.get(DocumentAnalysisService);
    const analysisResult = {
      analysisId: "contract-analysis-id",
      suggestions: [],
      filteredSuggestions: [],
      documentSummary: "Contract summary",
      status: AnalysisStatus.SUCCESS,
      filteredCount: 0,
    } satisfies DocumentAnalysisResult;
    const analysisSpy = jest
      .spyOn(analysisService, "analyzeDocument")
      .mockResolvedValue(analysisResult);
    const formFillService = app.get(FormFillService);
    const formResult = {
      fillId: "contract-fill-id",
      status: "success" as const,
      originalFilename: "form.pdf",
      outputFilename: "form-filled.pdf",
      outputMimeType: "application/pdf" as const,
      filledPdfBase64: Buffer.from("contract-pdf").toString("base64"),
      summary: {
        totalFields: 1,
        filledCount: 1,
        skippedCount: 0,
        filledFields: [],
        skippedFields: [],
        warnings: [],
      },
    } satisfies FormFillResponse;
    const formSpy = jest
      .spyOn(formFillService, "fillPdfForm")
      .mockResolvedValue(formResult);
    try {
      const analysis = await request(app.getHttpServer())
        .post(contract.routes.documentAnalysis.path)
        .attach("file", Buffer.from("deterministic contract text"), {
          filename: "contract.txt",
          contentType: "text/plain",
        })
        .expect(contract.routes.documentAnalysis.success.status);
      for (const key of contract.routes.documentAnalysis.success.required) {
        expect(analysis.body).toHaveProperty(key);
      }
      expect(contract.routes.documentAnalysis.success.statuses).toContain(
        analysis.body.status,
      );
      expect(analysis.body).toEqual(analysisResult);

      const form = await request(app.getHttpServer())
        .post(contract.routes.formFill.path)
        .attach("file", Buffer.from("%PDF-1.4 deterministic contract"), {
          filename: "form.pdf",
          contentType: "application/pdf",
        })
        .expect(contract.routes.formFill.success.status);
      for (const key of contract.routes.formFill.success.required) {
        expect(form.body).toHaveProperty(key);
      }
      for (const key of contract.routes.formFill.success.summaryRequired) {
        expect(form.body.summary).toHaveProperty(key);
      }
      expect(contract.routes.formFill.success.statuses).toContain(
        form.body.status,
      );
      expect(form.body.outputMimeType).toBe(
        contract.routes.formFill.success.outputMimeType,
      );
      expect(form.body).toEqual(formResult);
    } finally {
      analysisSpy.mockRestore();
      formSpy.mockRestore();
    }
  });

  it("pins production bearer rejection for both upload routes", async () => {
    for (const [route, contentType, filename] of [
      [contract.routes.documentAnalysis, "text/plain", "notes.txt"],
      [contract.routes.formFill, "application/pdf", "form.pdf"],
    ] as const) {
      const response = await request(productionGuardApp.getHttpServer())
        .post(route.path)
        .attach("file", Buffer.from("contract probe"), {
          filename,
          contentType,
        })
        .expect(route.errors.missingBearer.status);
      for (const key of route.errors.missingBearer.required) {
        expect(response.body).toHaveProperty(key);
      }
    }
  });

  it("pins the real multipart 413 envelope for both upload routes", async () => {
    for (const [route, contentType, filename] of [
      [contract.routes.documentAnalysis, "text/plain", "oversized.txt"],
      [contract.routes.formFill, "application/pdf", "oversized.pdf"],
    ] as const) {
      const response = await request(app.getHttpServer())
        .post(route.path)
        .attach("file", Buffer.alloc(route.maxFileSizeBytes + 1, "x"), {
          filename,
          contentType,
        })
        .expect(route.errors.oversizedMultipart.status);
      for (const key of route.errors.oversizedMultipart.required) {
        expect(response.body).toHaveProperty(key);
      }
    }
  });

  it("pins DCR success, rejection, envelope keys, and cache/CORS headers", async () => {
    const success = await request(app.getHttpServer())
      .post(contract.routes.dcr.path)
      .send({ redirect_uris: ["http://localhost:8081/callback"] })
      .expect(contract.routes.dcr.success.status);
    for (const key of contract.routes.dcr.success.required) {
      expect(success.body).toHaveProperty(key);
    }
    expect(success.body).toEqual({
      client_id: expect.any(String),
      ...contract.routes.dcr.success.constants,
      redirect_uris: ["http://localhost:8081/callback"],
    });

    const rejectionCases = [
      [contract.routes.dcr.errors.emptyRedirect, {}],
      [
        contract.routes.dcr.errors.invalidRedirect,
        { redirect_uris: ["https://invalid.example/callback"] },
      ],
      [
        contract.routes.dcr.errors.mixedRedirect,
        {
          redirect_uris: [
            "http://localhost:8081/callback",
            "http://127.0.0.1:8082/callback",
          ],
        },
      ],
    ] as const;
    const responses = [success];
    for (const [expected, body] of rejectionCases) {
      const response = await request(app.getHttpServer())
        .post(contract.routes.dcr.path)
        .send(body)
        .expect(expected.status);
      expect(response.body).toEqual(expected.body);
      responses.push(response);
    }

    for (const response of responses) {
      for (const [header, value] of Object.entries(
        contract.routes.dcr.headers,
      )) {
        expect(response.headers[header.toLowerCase()]).toBe(value);
      }
    }
  });

  it("pins the exact DCR missing-client configuration error", () => {
    const controller = new DcrShimController({
      resolveForDcr: () => ({
        status: "ok",
        client: { key: "claude", oauth: { redirectUris: [] } },
      }),
    } as never);
    let thrown: unknown;
    try {
      controller.registerClient(
        { redirect_uris: ["http://localhost:8081/callback"] },
        { headers: {}, ip: "127.0.0.1", socket: {} } as never,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(
      contract.routes.dcr.errors.missingConfiguredClientId.status,
    );
    expect((thrown as HttpException).getResponse()).toEqual(
      contract.routes.dcr.errors.missingConfiguredClientId.body,
    );
  });

  it("pins the exact DCR rate-limit envelope and retry calculation", () => {
    const guard = new DcrRateLimitGuard({
      get: (key: string, fallback: number) =>
        key === "mcp.oauth.rateLimit.maxRequests"
          ? 30
          : key === "mcp.oauth.rateLimit.windowMs"
            ? 60_000
            : fallback,
    } as ConfigService);
    const dateSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { "x-forwarded-for": "192.0.2.10" },
          ip: "127.0.0.1",
          socket: {},
        }),
      }),
    } as ExecutionContext;
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        expect(guard.canActivate(context)).toBe(true);
      }
      let thrown: unknown;
      try {
        guard.canActivate(context);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(
        contract.routes.dcr.errors.rateLimit.status,
      );
      expect((thrown as HttpException).getResponse()).toEqual(
        contract.routes.dcr.errors.rateLimit.body,
      );
    } finally {
      dateSpy.mockRestore();
      guard.onModuleDestroy();
    }
  });

  it("pins the real DCR rate-limit transport headers", async () => {
    const headers = { "x-forwarded-for": "192.0.2.123" };
    for (
      let attempt = 0;
      attempt < contract.routes.dcr.errors.rateLimit.maxRequests;
      attempt += 1
    ) {
      await request(app.getHttpServer())
        .post(contract.routes.dcr.path)
        .set(headers)
        .send({ redirect_uris: ["http://localhost:8081/callback"] })
        .expect(contract.routes.dcr.success.status);
    }
    const denied = await request(app.getHttpServer())
      .post(contract.routes.dcr.path)
      .set(headers)
      .send({ redirect_uris: ["http://localhost:8081/callback"] })
      .expect(contract.routes.dcr.errors.rateLimit.status);
    expect(denied.body).toEqual(contract.routes.dcr.errors.rateLimit.body);
    for (const [header, expected] of Object.entries(
      contract.routes.dcr.errors.rateLimit.headers,
    )) {
      const actual = denied.headers[header.toLowerCase()];
      if (header.toLowerCase() === "content-type") {
        expect(actual).toMatch(/^application\/json(?:;|$)/);
      } else {
        expect(actual ?? null).toBe(expected);
      }
    }
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
      const response = await request(app.getHttpServer())
        .get(path)
        .expect(contract.routes.oauthMetadata.status);
      expect(response.headers["access-control-allow-origin"]).toBe(
        contract.routes.oauthMetadata.headers["Access-Control-Allow-Origin"],
      );
      expect(response.headers["cache-control"]).toBe(
        contract.routes.oauthMetadata.headers["Cache-Control"],
      );
      expect(response.type).toMatch(/json/);
    }
  });

  it("pins disabled POST /mcp to the exact 503 envelope", async () => {
    const originalGet = configService.get.bind(configService);
    const getSpy = jest
      .spyOn(configService, "get")
      .mockImplementation(((key: string, fallback?: unknown) =>
        key === "mcp.httpTransport.enabled"
          ? false
          : originalGet(key, fallback)) as never);
    try {
      const response = await request(app.getHttpServer())
        .post(contract.routes.mcpPost.path)
        .set("Content-Type", contract.routes.mcpPost.contentType)
        .set("Accept", contract.routes.mcpPost.accept)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
        .expect(contract.routes.mcpPost.disabled.status);
      expect(response.body).toEqual(contract.routes.mcpPost.disabled.body);
    } finally {
      getSpy.mockRestore();
    }
  });
});
