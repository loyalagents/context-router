import { generateKeyPairSync } from "node:crypto";
import { AuthorizationRepository, random } from "./authority";
import {
  ACCESS_TYPE,
  CATEGORIES,
  denied,
  scopeAccess,
  validateAccess,
} from "./policy";
// Node 24's synchronous ESM loader; this module is qualified in native child tests.
const { Provider, interactionPolicy, errors } = require("oidc-provider");

export function authorizationProvider(authority: AuthorizationRepository): any {
  const { issuer, resource, clients } = authority.configuration;
  const scopes = Object.keys(CATEGORIES).map((c) => `hcp:${c}:read`);
  const material = authority.protocolSecrets(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    return {
      jwks: {
        keys: [
          {
            ...privateKey.export({ format: "jwk" }),
            kid: random(),
            use: "sig",
            alg: "RS256",
          },
        ],
      },
      cookies: [random(), random()],
    };
  });
  const policy = interactionPolicy.base();
  policy.get("consent").checks.clear();
  policy
    .get("consent")
    .checks.add(
      new interactionPolicy.Check(
        "affirmative_consent",
        "A new explicit approval is required",
        (ctx: any) => !ctx.oidc.result?.consent?.grantId,
      ),
    );
  const projected = (id: string, clientId: string) =>
    authority.ownGrant(id, clientId).grants[0];
  const remaining = (grant: any, max: number) => {
    const seconds = Math.min(
      max,
      Math.floor(Date.parse(grant.expiresAt) / 1000) -
        Math.floor(Date.now() / 1000),
    );
    if (seconds <= 0) denied();
    return seconds;
  };
  class Adapter {
    constructor(private model: string) {}
    async upsert(id: string, payload: any, expiresIn: number) {
      authority.protocolUpsert(this.model, id, payload, expiresIn);
    }
    async find(id: string) {
      return authority.protocolFind(this.model, id);
    }
    async findByUid(uid: string) {
      return authority.protocolFind(this.model, uid, true);
    }
    async consume(id: string) {
      try {
        authority.protocolConsume(this.model, id);
      } catch {
        throw new errors.InvalidGrant("Grant source unavailable");
      }
    }
    async destroy(id: string) {
      authority.protocolDestroy(this.model, id);
    }
    async revokeByGrantId(id: string) {
      authority.protocolRevoke(id);
    }
  }
  const provider = new Provider(issuer, {
    adapter: Adapter,
    jwks: material.jwks,
    clients: clients.map((c) => ({
      client_id: c.id,
      client_name: c.name,
      redirect_uris: [c.redirectUri],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "none",
      authorization_details_types: [ACCESS_TYPE],
    })),
    scopes: [],
    responseTypes: ["code"],
    clientAuthMethods: ["none"],
    clockTolerance: 0,
    allowOmittingSingleRegisteredRedirectUri: false,
    enableHttpPostMethods: false,
    // The native refresh predicate is false: no refresh grant registration or offline_access.
    // Overriding that predicate makes v9 advertise a refresh grant even when it always returns false.
    pkce: { required: () => true },
    expiresWithSession: () => false,
    cookies: {
      keys: material.cookies,
      long: { secure: true, httpOnly: true, sameSite: "lax" },
      short: { secure: true, httpOnly: true, sameSite: "lax" },
    },
    interactions: {
      policy,
      url: (_ctx: any, interaction: any) => `/interaction/${interaction.uid}`,
    },
    findAccount: (_ctx: any, id: string) =>
      id === authority.accountId()
        ? { accountId: id, claims: async () => ({ sub: id }) }
        : undefined,
    loadExistingGrant: async (ctx: any) =>
      ctx.oidc.result?.consent?.grantId
        ? provider.Grant.find(ctx.oidc.result.consent.grantId)
        : undefined,
    ttl: {
      Grant: (_ctx: any, token: any) =>
        remaining(projected(token.jti, token.clientId), 86400),
      AuthorizationCode: 60,
      AccessToken: 3600,
      Session: 12 * 3600,
      Interaction: 600,
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      requestObjects: { enabled: false },
      registration: { enabled: false },
      registrationManagement: { enabled: false },
      clientIdMetadataDocument: { enabled: false },
      deviceFlow: { enabled: false },
      clientCredentials: { enabled: false },
      ciba: { enabled: false },
      introspection: { enabled: false },
      revocation: { enabled: false },
      dPoP: { enabled: false },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => {
          throw new errors.InvalidTarget();
        },
        useGrantedResource: () => false,
        getResourceServerInfo: (_ctx: any, indicator: string) => {
          if (indicator !== resource) throw new errors.InvalidTarget();
          return {
            scope: scopes.join(" "),
            audience: resource,
            accessTokenFormat: "opaque",
            accessTokenTTL: 3600,
          };
        },
      },
      richAuthorizationRequests: {
        enabled: true,
        types: {
          [ACCESS_TYPE]: {
            validate: (_ctx: any, detail: any) => {
              validateAccess([detail], true);
            },
          },
        },
        authorizationDetailsForGrantSource: (_ctx: any, source: any) => {
          const grant = projected(source.grantId, source.clientId);
          source.scope = grant.scopes.join(" ");
          source.expiresIn = remaining(grant, 60);
          source.exp = Math.floor(Date.now() / 1000) + source.expiresIn;
          return grant.access;
        },
        authorizationDetailsForAccessToken: (ctx: any, token: any) => {
          const allowed = [
            "grant_type",
            "client_id",
            "code",
            "code_verifier",
            "redirect_uri",
            "resource",
          ];
          if (
            Object.keys(ctx.oidc.body).some(
              (k) =>
                !allowed.includes(k) || typeof ctx.oidc.body[k] !== "string",
            ) ||
            ctx.oidc.body.resource !== resource ||
            ctx.oidc.body.grant_type !== "authorization_code"
          )
            throw new errors.InvalidRequest();
          const grant = projected(token.grantId, token.clientId);
          token.scope = grant.scopes.join(" ");
          token.expiresIn = remaining(grant, 3600);
          token.exp = Math.floor(Date.now() / 1000) + token.expiresIn;
          return grant.access;
        },
      },
    },
    renderError: (ctx: any) => {
      ctx.type = "application/json";
      ctx.body = { error: "invalid_request" };
    },
  });
  // Never let library diagnostics serialize credentials or request/response context.
  provider.on("server_error", () => {});
  provider.use(async (ctx: any, next: () => Promise<void>) => {
    await next();
    if (
      ctx.path === "/.well-known/oauth-authorization-server" &&
      ctx.status === 200
    ) {
      ctx.body.response_modes_supported = ["form_post"];
      ctx.body.scopes_supported = scopes;
    }
    if (ctx.path === "/token" && ctx.status === 200) {
      const token = authority.protocolFind(
        "AccessToken",
        ctx.body?.access_token,
      );
      if (!token) {
        ctx.status = 400;
        ctx.body = { error: "invalid_grant" };
      } else
        ctx.body.expires_in = Math.min(
          ctx.body.expires_in,
          token.exp - Math.ceil(Date.now() / 1000),
        );
    }
  });
  return provider;
}

export function validateAuthorization(
  params: URLSearchParams,
  authority: AuthorizationRepository,
): void {
  const allowed = [
    "client_id",
    "redirect_uri",
    "response_type",
    "response_mode",
    "resource",
    "state",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "authorization_details",
  ];
  for (const key of params.keys())
    if (!allowed.includes(key) || params.getAll(key).length !== 1)
      throw new errors.InvalidRequest();
  const client = authority.configuration.clients.find(
    (c) => c.id === params.get("client_id"),
  );
  if (
    !client ||
    params.get("redirect_uri") !== client.redirectUri ||
    params.get("resource") !== authority.configuration.resource ||
    params.get("response_type") !== "code" ||
    params.get("response_mode") !== "form_post" ||
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "") ||
    !/^[A-Za-z0-9_-]{22,128}$/.test(params.get("state") ?? "")
  )
    throw new errors.InvalidRequest();
  if (params.has("scope") === params.has("authorization_details"))
    throw new errors.InvalidRequest();
  if (params.has("authorization_details"))
    validateAccess(JSON.parse(params.get("authorization_details")!), true);
  else scopeAccess(params.get("scope"));
}
