import { createHash } from "crypto";

export const LEGACY_IDENTITY_ISSUER = "urn:context-router:legacy-issuer";
export const IDENTITY_LINK_CLAIM_METADATA_KEY =
  "contextRouterIdentityLinkClaim";

const LINK_CLAIMS_MAX_BYTES = 30 * 1024;
const LINK_CLAIMS_MAX_ENTRIES = 256;
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;
const EDGE_ASCII_WHITESPACE = /^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g;
const EMAIL_LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const LEGACY_MISSING_EMAIL =
  /^missing-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@unknown\.local$/i;

export interface HostedIssuerConfigurationInput {
  issuer?: string;
  domain?: string;
  legacyIssuer?: string;
}

export interface HostedIssuerConfiguration {
  issuer: string;
  domain: string;
  legacyIssuer?: string;
}

export interface IdentityLinkDenyDisposition {
  rowDigest: string;
  decision: "deny";
}

export interface IdentityLinkApprovalDisposition {
  rowDigest: string;
  decision: "link";
  identityDigest: string;
}

export type IdentityLinkDisposition =
  | IdentityLinkDenyDisposition
  | IdentityLinkApprovalDisposition;

export interface IdentityLinkClaims {
  version: 1;
  dispositions: IdentityLinkDisposition[];
  canonical: string;
  digest: string;
}

export interface IdentityEmailAssertion {
  email?: unknown;
  emailVerified?: unknown;
}

export function hasIdentityLinkClaimMetadata(metadata: unknown): boolean {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    Object.prototype.hasOwnProperty.call(
      metadata,
      IDENTITY_LINK_CLAIM_METADATA_KEY,
    )
  );
}

function invalidIssuer(): never {
  throw new Error("Invalid hosted issuer configuration");
}

function invalidLegacyIssuer(): never {
  throw new Error("Invalid hosted legacy issuer configuration");
}

function parseCanonicalHttpsIssuer(value: unknown): URL {
  if (typeof value !== "string" || value.length === 0) {
    return invalidIssuer();
  }

  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    return invalidIssuer();
  }

  if (
    issuer.protocol !== "https:" ||
    issuer.username !== "" ||
    issuer.password !== "" ||
    issuer.pathname !== "/" ||
    issuer.search !== "" ||
    issuer.hash !== "" ||
    issuer.href !== value ||
    issuer.hostname !== issuer.hostname.toLowerCase()
  ) {
    return invalidIssuer();
  }

  return issuer;
}

export function parseHostedIssuerConfiguration(
  input: HostedIssuerConfigurationInput,
): HostedIssuerConfiguration {
  const issuer = parseCanonicalHttpsIssuer(input.issuer);
  if (
    typeof input.domain !== "string" ||
    input.domain.length === 0 ||
    issuer.host !== input.domain
  ) {
    return invalidIssuer();
  }

  let legacyIssuer: string | undefined;
  if (input.legacyIssuer !== undefined) {
    if (input.legacyIssuer.length === 0) {
      return invalidLegacyIssuer();
    }

    let parsedLegacy: URL;
    try {
      parsedLegacy = parseCanonicalHttpsIssuer(input.legacyIssuer);
    } catch {
      return invalidLegacyIssuer();
    }
    if (parsedLegacy.href !== issuer.href) {
      return invalidLegacyIssuer();
    }
    legacyIssuer = parsedLegacy.href;
  }

  return {
    issuer: issuer.href,
    domain: issuer.host,
    legacyIssuer,
  };
}

export function assertLegacyIssuerAdmission(
  configuration: HostedIssuerConfiguration,
  sentinelRowCount: number,
): void {
  if (
    !Number.isSafeInteger(sentinelRowCount) ||
    sentinelRowCount < 0 ||
    (configuration.legacyIssuer !== undefined &&
      configuration.legacyIssuer !== configuration.issuer) ||
    (sentinelRowCount > 0 && configuration.legacyIssuer === undefined)
  ) {
    throw new Error("Hosted legacy issuer configuration is required");
  }
}

function invalidLinkClaims(): never {
  throw new Error("Invalid identity link claims");
}

export function isCanonicalIdentityDigest(value: unknown): value is string {
  if (typeof value !== "string" || !SHA256_BASE64URL.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } catch {
    return false;
  }
}

export function parseIdentityLinkClaims(
  value: string | undefined,
): IdentityLinkClaims {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > LINK_CLAIMS_MAX_BYTES ||
    !/^[\x00-\x7f]*$/.test(value)
  ) {
    return invalidLinkClaims();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalidLinkClaims();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return invalidLinkClaims();
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.dispositions) ||
    candidate.dispositions.length > LINK_CLAIMS_MAX_ENTRIES
  ) {
    return invalidLinkClaims();
  }

  const dispositions: IdentityLinkDisposition[] = [];
  const tuples: string[][] = [];
  const identityDigests = new Set<string>();
  let previousRowDigest: string | undefined;

  for (const entry of candidate.dispositions) {
    if (!Array.isArray(entry) || !isCanonicalIdentityDigest(entry[0])) {
      return invalidLinkClaims();
    }

    const rowDigest = entry[0];
    if (previousRowDigest !== undefined && previousRowDigest >= rowDigest) {
      return invalidLinkClaims();
    }
    previousRowDigest = rowDigest;

    if (entry.length === 2 && entry[1] === "deny") {
      dispositions.push({ rowDigest, decision: "deny" });
      tuples.push([rowDigest, "deny"]);
      continue;
    }

    if (
      entry.length === 3 &&
      entry[1] === "link" &&
      isCanonicalIdentityDigest(entry[2]) &&
      !identityDigests.has(entry[2])
    ) {
      const identityDigest = entry[2];
      identityDigests.add(identityDigest);
      dispositions.push({ rowDigest, decision: "link", identityDigest });
      tuples.push([rowDigest, "link", identityDigest]);
      continue;
    }

    return invalidLinkClaims();
  }

  const canonical = JSON.stringify({ version: 1, dispositions: tuples });
  if (canonical !== value) {
    return invalidLinkClaims();
  }

  return {
    version: 1,
    dispositions,
    canonical,
    digest: createHash("sha256").update(canonical, "utf8").digest("base64url"),
  };
}

function appendLengthFramed(
  hash: ReturnType<typeof createHash>,
  value: string,
): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 0xffffffff) {
    throw new Error("Identity digest input is too large");
  }
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function computeLengthFramedDigest(label: string, fields: string[]): string {
  const hash = createHash("sha256");
  appendLengthFramed(hash, label);
  for (const field of fields) {
    appendLengthFramed(hash, field);
  }
  return hash.digest("base64url");
}

export function computeIdentityLinkRowDigest(
  userId: string,
  canonicalEmail: string,
): string {
  return computeLengthFramedDigest("context-router/auth0-link-row/v1", [
    userId,
    canonicalEmail,
  ]);
}

export function computeIdentityLinkIdentityDigest(
  issuer: string,
  subject: string,
): string {
  return computeLengthFramedDigest("context-router/auth0-link-identity/v1", [
    "auth0",
    issuer,
    subject,
  ]);
}

function invalidEmailAssertion(): never {
  throw new Error("Invalid identity email assertion");
}

export function canonicalizeIdentityLinkEmail(value: unknown): string {
  if (typeof value !== "string") {
    return invalidEmailAssertion();
  }

  const email = value.replace(EDGE_ASCII_WHITESPACE, "");
  if (
    email.length === 0 ||
    email.length > 254 ||
    !/^[\x21-\x7e]+$/.test(email)
  ) {
    return invalidEmailAssertion();
  }

  const separator = email.indexOf("@");
  if (separator <= 0 || separator !== email.lastIndexOf("@")) {
    return invalidEmailAssertion();
  }

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (
    localPart.length > 64 ||
    !EMAIL_LOCAL_PART.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    domain.length === 0 ||
    domain.length > 253 ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return invalidEmailAssertion();
  }

  const labels = domain.split(".");
  if (labels.some((label) => !EMAIL_DOMAIN_LABEL.test(label))) {
    return invalidEmailAssertion();
  }

  return `${localPart}@${domain.toLowerCase()}`;
}

export function isReservedIdentityLinkEmail(email: string): boolean {
  const canonical = canonicalizeIdentityLinkEmail(email);
  const lower = canonical.toLowerCase();
  const domain = lower.slice(lower.lastIndexOf("@") + 1);
  return (
    lower === "unknown@example.com" ||
    lower === "john.doe@example.com" ||
    lower === "jane.smith@example.com" ||
    domain === "m2m.local" ||
    domain === "invalid" ||
    domain.endsWith(".invalid") ||
    LEGACY_MISSING_EMAIL.test(lower)
  );
}

interface NormalizedEmailAssertion {
  email: string;
  verified: boolean;
  reserved: boolean;
}

function normalizeEmailAssertion(
  assertion: IdentityEmailAssertion | undefined,
): NormalizedEmailAssertion | undefined {
  if (assertion === undefined) {
    return undefined;
  }
  if (assertion.email === undefined || assertion.email === null) {
    if (assertion.emailVerified !== undefined) {
      return invalidEmailAssertion();
    }
    return undefined;
  }
  if (
    assertion.emailVerified !== undefined &&
    typeof assertion.emailVerified !== "boolean"
  ) {
    return invalidEmailAssertion();
  }
  const email = canonicalizeIdentityLinkEmail(assertion.email);
  return {
    email,
    verified: assertion.emailVerified === true,
    reserved: isReservedIdentityLinkEmail(email),
  };
}

export function reconcileVerifiedEmailAssertions(
  jwt: IdentityEmailAssertion | undefined,
  management: IdentityEmailAssertion | undefined,
): string | null {
  const jwtAssertion = normalizeEmailAssertion(jwt);
  const managementAssertion = normalizeEmailAssertion(management);

  if (
    jwtAssertion &&
    managementAssertion &&
    (jwtAssertion.email !== managementAssertion.email ||
      jwtAssertion.verified !== managementAssertion.verified)
  ) {
    throw new Error("Conflicting identity email assertions");
  }

  const assertion = jwtAssertion ?? managementAssertion;
  if (!assertion || !assertion.verified || assertion.reserved) {
    return null;
  }
  return assertion.email;
}

export function createSyntheticPrincipalEmail(principalId: string): string {
  const digest = createHash("sha256").update(principalId, "utf8").digest("hex");
  return `${digest}@principal.invalid`;
}

export interface IdentityLinkClaimMarker {
  version: 1;
  rowDigest: string;
  identityDigest: string;
}

export function parseIdentityLinkClaimMarker(
  metadata: unknown,
): IdentityLinkClaimMarker {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    Object.keys(metadata).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(
      metadata,
      IDENTITY_LINK_CLAIM_METADATA_KEY,
    )
  ) {
    throw new Error("Invalid identity link claim marker");
  }
  const marker = (metadata as Record<string, unknown>)[
    IDENTITY_LINK_CLAIM_METADATA_KEY
  ];
  if (
    typeof marker !== "object" ||
    marker === null ||
    Array.isArray(marker) ||
    Object.keys(marker).length !== 3
  ) {
    throw new Error("Invalid identity link claim marker");
  }
  const value = marker as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !isCanonicalIdentityDigest(value.rowDigest) ||
    !isCanonicalIdentityDigest(value.identityDigest)
  ) {
    throw new Error("Invalid identity link claim marker");
  }
  return {
    version: 1,
    rowDigest: value.rowDigest,
    identityDigest: value.identityDigest,
  };
}
