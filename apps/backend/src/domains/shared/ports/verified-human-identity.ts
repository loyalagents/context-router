export interface VerifiedHumanIdentityKey {
  provider: string;
  issuer: string;
  subject: string;
}

export interface VerifiedHumanIdentityProfileHints {
  verifiedEmail?: string;
  displayName?: string;
  givenName?: string;
  familyName?: string;
}

/**
 * Output of a credential-verifying edge adapter. This is not a raw token and
 * none of the profile hints are identity or authorization authority.
 */
export interface VerifiedHumanIdentityAssertion {
  key: VerifiedHumanIdentityKey;
  profileHints?: VerifiedHumanIdentityProfileHints;
}
