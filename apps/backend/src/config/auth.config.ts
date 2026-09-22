import { registerAs } from "@nestjs/config";
import {
  parseHostedIssuerConfiguration,
  parseIdentityLinkClaims,
} from "../modules/auth/hosted-identity-policy";

function parseHostedAudience(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid hosted audience configuration");
  }
  return value;
}

export function createAuthConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const issuerConfiguration = parseHostedIssuerConfiguration({
    issuer: environment.AUTH0_ISSUER,
    domain: environment.AUTH0_DOMAIN,
    legacyIssuer: environment.AUTH0_LEGACY_ISSUER,
  });
  const identityLinkClaims = parseIdentityLinkClaims(
    environment.AUTH0_IDENTITY_LINK_CLAIMS,
  );
  const audience = parseHostedAudience(environment.AUTH0_AUDIENCE);

  return {
    auth0: {
      domain: issuerConfiguration.domain,
      audience,
      issuer: issuerConfiguration.issuer,
      legacyIssuer: issuerConfiguration.legacyIssuer,
      clientId: environment.AUTH0_CLIENT_ID,
      clientSecret: environment.AUTH0_CLIENT_SECRET,
      managementApiAudience:
        environment.AUTH0_MANAGEMENT_API_AUDIENCE ||
        `https://${issuerConfiguration.domain}/api/v2/`,
      identityLinkClaims,
    },
    jwt: {
      secret: environment.JWT_SECRET,
      expiresIn: environment.JWT_EXPIRES_IN || "1h",
    },
    syncStrategy: environment.AUTH0_SYNC_STRATEGY || "ON_LOGIN",
  };
}

export function authConfigLoader(environment: NodeJS.ProcessEnv) {
  return registerAs("auth", () => createAuthConfiguration(environment));
}

export default registerAs("auth", () => createAuthConfiguration());
