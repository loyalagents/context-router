import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { insertFixtures } from "./seed";
import * as conflicts from "./conflict-graph";
import { relationships } from "./relationships";
import { controlledProposal } from "./producer";
import {
  applyMutation,
  assertNewPurpose,
  canDiscloseMutation,
  COMPLETION_ONLY,
  invalidateResponses,
  mutationDocument,
  mutationPurpose,
  permissionRevision,
  storedEntry,
  WriteConflict,
  type WriteOperation,
} from "./writes";
import {
  readRequest,
  selectRead,
  readDirectives,
  validity,
  project,
  type ReadRequest,
} from "./disclosure";
import {
  ACCESS_TYPE,
  PURPOSES,
  AuthorityError,
  categories,
  denied,
  deniedCategories,
  evaluateEntry,
  invalid,
  keys,
  matchingDirectives,
  privateId,
  scopeAccess,
  strings,
  uri,
  validateAccess,
  validatePolicy,
} from "./policy";
export { ACCESS_TYPE, PURPOSES, AuthorityError } from "./policy";

export interface ClientRegistration {
  id: string;
  name: string;
  operator: { id: string; name: string };
  redirectUri: string;
  claims?: string[];
}
export interface AuthorizationConfiguration {
  issuer: string;
  resource: string;
  clients: ClientRegistration[];
  copyLifetimeMs?: number;
}
/** Infrastructure-only synchronous capability. It never leaves the experiment store. */
export interface AuthorityKernel {
  read<T>(operation: (db: DatabaseSync) => T): T;
  write<T>(operation: (db: DatabaseSync) => T, beforeCommit?: () => void): T;
  now(): number;
  append(db: DatabaseSync, event: any): void;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const random = () => randomBytes(24).toString("base64url");
const uuid = () => `urn:uuid:${randomUUID()}`;
const iso = (n: number) => new Date(n).toISOString();
const parse = (value: any) => JSON.parse(String(value));
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const settings = (db: DatabaseSync): any =>
  db.prepare("SELECT * FROM authorization_settings").get();
const metadata = (db: DatabaseSync): any =>
  db.prepare("SELECT * FROM store_metadata").get();
function assembled(row: any): any {
  return { ...parse(row.document), status: row.status };
}
function grantRow(db: DatabaseSync, id: string): any {
  return db.prepare("SELECT * FROM grants WHERE id=?").get(id);
}
function entrySequence(db: DatabaseSync, id: string): number {
  return Number(
    db
      .prepare(
        `SELECT coalesce(max(sequence),0) n FROM audit_events
    WHERE json_extract(event,'$.entryId')=? OR json_extract(event,'$.relatedEntryId')=?
      OR EXISTS (SELECT 1 FROM json_each(audit_events.event,'$.data.relatedTransitions') t WHERE json_extract(t.value,'$.id')=?)`,
      )
      .get(id, id, id).n,
  );
}
function policies(db: DatabaseSync, kind: string): any[] {
  return db
    .prepare("SELECT document FROM policies WHERE kind=? ORDER BY id")
    .all(kind)
    .map((r) => parse(r.document));
}
function clientDocument(client: ClientRegistration) {
  return {
    id: client.id,
    name: client.name,
    operator: client.operator,
    ...(client.claims ? { claims: client.claims } : {}),
  };
}
function event(
  db: DatabaseSync,
  eventType: string,
  now: number,
  grant: any,
  initiator: any,
  data = {},
): any {
  const meta = metadata(db);
  return {
    eventId: uuid(),
    eventType,
    timestamp: iso(now),
    participants: {
      initiator,
      provider: { id: meta.provider_id },
      // §3.9 also requires this correlation identifier on non-disclosure grant events.
      ...(grant
        ? {
            authorizingPrincipal: { id: meta.subject_id },
            requestingParty: { id: meta.subject_id },
            retrievalId: uuid(),
          }
        : {}),
      ...(initiator.role === "context-client"
        ? { clientOperator: grant.client.operator }
        : {}),
      ...(initiator.role === "management-client"
        ? { clientOperator: { id: "https://example.test/operators/synthetic" } }
        : {}),
    },
    entryId: null,
    relatedEntryId: null,
    grantId: grant?.grantId ?? null,
    data,
  };
}
export function expireGrants(
  db: DatabaseSync,
  now: number,
  append: (event: any) => void,
): void {
  for (const row of db
    .prepare(
      "SELECT * FROM grants WHERE status='active' AND expires_at<=? ORDER BY id",
    )
    .all(now)) {
    const grant = assembled(row);
    db.prepare("UPDATE grants SET status='expired' WHERE id=?").run(row.id);
    invalidateResponses(db, String(row.id));
    append(
      event(
        db,
        "grant.expired",
        now,
        grant,
        { role: "authorization-service", id: metadata(db).provider_id },
        { reason: "expiresAt", effectiveAt: grant.expiresAt },
      ),
    );
  }
}

export class AuthorizationRepository {
  private readonly writes = new WeakMap<
    object,
    {
      credential: string;
      grantId: string;
      original: boolean;
      binding: any;
      response: { status: number; bytes: string };
    }
  >();
  private readonly reads = new WeakMap<
    object,
    {
      credential: string;
      request: ReadRequest;
      revision: number;
      copyUntil: number;
      selected: string;
    }
  >();
  private readonly copyLifetimeMs: number;
  constructor(
    private readonly kernel: AuthorityKernel,
    readonly configuration: AuthorizationConfiguration,
    human: string,
  ) {
    keys(configuration, ["issuer", "resource", "clients", "copyLifetimeMs"]);
    this.copyLifetimeMs = configuration.copyLifetimeMs ?? 3600_000;
    if (
      !Number.isSafeInteger(this.copyLifetimeMs) ||
      this.copyLifetimeMs < 1 ||
      this.copyLifetimeMs > 3600_000
    )
      invalid();
    const issuer = new URL(configuration.issuer);
    if (
      issuer.protocol !== "https:" ||
      issuer.hostname !== "as.hcp.test" ||
      issuer.origin !== configuration.issuer ||
      configuration.resource !== configuration.issuer ||
      !Array.isArray(configuration.clients) ||
      configuration.clients.length !== 2 ||
      typeof human !== "string" ||
      !/^[A-Za-z0-9_-]{43,}$/.test(human)
    )
      invalid();
    for (const client of configuration.clients) {
      keys(client, ["id", "name", "operator", "redirectUri", "claims"]);
      keys(client.operator, ["id", "name"]);
      if (
        !["a", "b"].includes(client.id) ||
        !client.name?.trim() ||
        !client.operator.name?.trim() ||
        !uri(client.operator.id)
      )
        invalid();
      const callback = new URL(client.redirectUri);
      if (
        callback.protocol !== "https:" ||
        callback.hostname !== `client-${client.id}.hcp.test` ||
        callback.username ||
        callback.password ||
        callback.hash ||
        callback.search
      )
        invalid();
      if (
        client.claims !== undefined &&
        (!strings(client.claims, 0) || client.claims.length)
      )
        invalid(); // no directive-following claims in this experiment
    }
    if (new Set(configuration.clients.map((c) => c.id)).size !== 2) invalid();
    this.configuration = structuredClone(configuration);
    const existing = kernel.read(settings);
    if (existing) {
      if (
        existing.configuration !== JSON.stringify(this.configuration) ||
        !equal(String(existing.human_verifier), hash(human))
      )
        denied();
    } else
      kernel.write((db) => {
        db.prepare("INSERT INTO authorization_settings VALUES(1,?,?,?,0)").run(
          JSON.stringify(this.configuration),
          hash(human),
          JSON.stringify({ cursorKey: random() }),
        );
        for (const client of this.configuration.clients)
          db.prepare("INSERT INTO client_subjects VALUES(?,?)").run(
            client.id,
            uuid(),
          );
      });
  }
  private management(db: DatabaseSync, credential: string): number {
    if (typeof credential !== "string")
      throw new AuthorityError("unauthenticated");
    if (equal(String(settings(db).human_verifier), hash(credential)))
      return Infinity;
    const session = db
      .prepare("SELECT * FROM human_sessions WHERE id_hash=?")
      .get(hash(credential));
    if (
      !session?.authenticated ||
      Number(session.expires_at) <= this.kernel.now()
    )
      throw new AuthorityError("unauthenticated");
    return Number(session.expires_at);
  }
  isManagement(credential: string): boolean {
    return this.kernel.read((db) => {
      try {
        this.management(db, credential);
        return true;
      } catch (e) {
        if (e instanceof AuthorityError) return false;
        throw e;
      }
    });
  }
  accountId(): string {
    return this.kernel.read((db) => String(metadata(db).subject_id));
  }
  entryReadEnabled(): boolean {
    return this.kernel.read((db) => {
      const row = db.prepare("SELECT mode,state FROM fixture_bootstrap").get();
      return row.mode === "approved" && row.state === "closed";
    });
  }
  bootstrapPending(): boolean {
    return this.kernel.read(
      (db) =>
        db.prepare("SELECT state FROM fixture_bootstrap").get().state ===
        "pending",
    );
  }
  reviewBootstrap(credential: string): any {
    return this.kernel.write((db) => {
      this.management(db, credential);
      const row = db.prepare("SELECT * FROM fixture_bootstrap").get();
      if (row.mode !== "approved" || row.state !== "pending") denied();
      const reviewId = random(),
        digest = hash(String(row.bundle));
      db.prepare(
        "UPDATE fixture_bootstrap SET review_id=?,review_digest=?,review_expires=?",
      ).run(reviewId, digest, this.kernel.now() + 300_000);
      return {
        reviewId,
        digest,
        fixtures: parse(row.bundle),
        notice:
          "Approve these synthetic persona statements and the explicitly simulated lifecycle/version test setup. This is not Lucas's personal data.",
      };
    });
  }
  approveBootstrap(credential: string, reviewId: string, digest: string): void {
    this.kernel.write((db) => {
      this.management(db, credential);
      const row = db.prepare("SELECT * FROM fixture_bootstrap").get(),
        now = this.kernel.now();
      if (
        row.mode !== "approved" ||
        row.state !== "pending" ||
        !row.review_id ||
        row.review_id !== reviewId ||
        row.review_digest !== digest ||
        Number(row.review_expires) <= now
      )
        denied();
      const fixtures = parse(row.bundle),
        client = {
          id: "urn:context-router:synthetic-initializer",
          name: "Authenticated synthetic fixture initializer",
          operator: {
            id: "https://example.test/operators/synthetic",
            name: "Synthetic fixture operator",
          },
        };
      const pseudonym = { id: uuid() };
      const grant = {
        grantId: uuid(),
        subject: pseudonym,
        authorizingPrincipal: pseudonym,
        requestingParty: {
          type: "person",
          id: pseudonym.id,
          name: "Synthetic context subject",
        },
        client,
        access: [
          {
            type: ACCESS_TYPE,
            actions: ["write"],
            categories: [
              ...new Set(
                fixtures.flatMap((f: any) => f.classification.categories),
              ),
            ],
            purposes: [
              {
                code: "urn:context-router:purpose:synthetic-bootstrap",
                description:
                  "Initialize exactly the reviewed synthetic statements",
              },
            ],
          },
        ],
        scopes: [],
        grantType: "temporary",
        issuedAt: iso(now),
        expiresAt: iso(Number(row.review_expires)),
        status: "active",
      };
      db.prepare("INSERT INTO client_subjects VALUES(?,?)").run(
        client.id,
        pseudonym.id,
      );
      db.prepare("INSERT INTO grants VALUES(?,?,?,'active',?)").run(
        grant.grantId,
        client.id,
        row.review_expires,
        JSON.stringify(grant),
      );
      this.kernel.append(
        db,
        event(
          db,
          "grant.issued",
          now,
          grant,
          { role: "authorization-service", id: this.configuration.issuer },
          {
            access: grant.access,
            grantType: grant.grantType,
            expiresAt: grant.expiresAt,
            modality: "private-fixture-initializer",
            acr: "urn:context-router:acr:local-credential",
            fixtureDigest: digest,
          },
        ),
      );
      insertFixtures(
        db,
        fixtures,
        () => this.kernel.now(),
        (e) => this.kernel.append(db, e),
        { grant, at: now },
      );
      this.revokeIn(db, grant.grantId, {
        role: "management-client",
        id: client.id,
      });
      db.prepare(
        "UPDATE fixture_bootstrap SET state='closed',authority_id=?",
      ).run(grant.grantId);
    });
  }
  private newSession(db: DatabaseSync, authenticated: boolean): any {
    const token = random(),
      csrf = random();
    db.prepare("INSERT INTO human_sessions VALUES(?,?,?,?)").run(
      hash(token),
      csrf,
      this.kernel.now() + (authenticated ? 12 * 3600_000 : 600_000),
      authenticated ? 1 : 0,
    );
    return { token, csrf, authenticated };
  }
  beginBrowserSession(): any {
    return this.kernel.write((db) => this.newSession(db, false));
  }
  browserSession(token: string, csrf?: string): any {
    return this.kernel.read((db) => {
      const s: any =
        typeof token === "string" &&
        db
          .prepare("SELECT * FROM human_sessions WHERE id_hash=?")
          .get(hash(token));
      if (
        !s ||
        s.expires_at <= this.kernel.now() ||
        (csrf !== undefined && !equal(s.csrf, csrf))
      )
        denied();
      return { csrf: s.csrf, authenticated: !!s.authenticated };
    });
  }
  loginBrowser(token: string, csrf: string, credential: string): any {
    this.browserSession(token, csrf);
    return this.kernel.write((db) => {
      // Login accepts only the provisioned human credential, never another session/token.
      if (
        typeof credential !== "string" ||
        !equal(String(settings(db).human_verifier), hash(credential))
      )
        denied();
      const s: any = db
        .prepare("SELECT * FROM human_sessions WHERE id_hash=?")
        .get(hash(token));
      if (!s || s.expires_at <= this.kernel.now() || !equal(s.csrf, csrf))
        denied();
      db.prepare("DELETE FROM human_sessions WHERE id_hash=?").run(hash(token));
      return this.newSession(db, true);
    });
  }
  /** Keys and library objects are protocol processing state in the same owned store. */
  protocolSecrets(create: () => any): any {
    return this.kernel.write((db) => {
      const value = parse(settings(db).secrets);
      if (!value.protocol) {
        value.protocol = create();
        db.prepare("UPDATE authorization_settings SET secrets=?").run(
          JSON.stringify(value),
        );
      }
      return value.protocol;
    });
  }
  private protocolBinding(
    db: DatabaseSync,
    model: string,
    id: string,
    p: any,
  ): void {
    if (
      ![
        "Grant",
        "AuthorizationCode",
        "AccessToken",
        "Session",
        "Interaction",
      ].includes(model) ||
      p.kind !== model ||
      p.jti !== id
    )
      invalid();
    if (!["Grant", "AuthorizationCode", "AccessToken"].includes(model)) return;
    const g = this.active(db, model === "Grant" ? id : p.grantId, p.clientId);
    if (
      p.accountId !== metadata(db).subject_id ||
      p.clientId !== g.client.id ||
      !Number.isSafeInteger(p.exp) ||
      p.exp * 1000 > Date.parse(g.expiresAt)
    )
      denied();
    const details = this.publicGrant(db, g).access;
    if (JSON.stringify(p.rar) !== JSON.stringify(details)) denied();
    const scope = g.scopes.join(" ");
    if (model === "Grant") {
      if (
        JSON.stringify(p.resources) !==
          JSON.stringify({ [this.configuration.resource]: scope }) ||
        p.openid
      )
        denied();
    } else {
      if (p.scope !== scope) denied();
      if (model === "AuthorizationCode") {
        const resource =
          Array.isArray(p.resource) && p.resource.length === 1
            ? p.resource[0]
            : p.resource;
        if (
          resource !== this.configuration.resource ||
          p.redirectUri !==
            this.configuration.clients.find((c) => c.id === g.client.id)!
              .redirectUri ||
          p.codeChallengeMethod !== "S256" ||
          typeof p.codeChallenge !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(p.codeChallenge)
        )
          denied();
      } else if (
        p.aud !== this.configuration.resource ||
        p.exp * 1000 > this.kernel.now() + 3600_000
      )
        denied();
    }
  }
  protocolUpsert(
    model: string,
    id: string,
    payload: any,
    expiresIn: number,
  ): void {
    this.kernel.write((db) => {
      this.protocolBinding(db, model, id, payload);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) denied();
      const expires = Math.min(
        this.kernel.now() + expiresIn * 1000,
        payload.exp * 1000,
      );
      if (!Number.isSafeInteger(expires) || expires <= this.kernel.now())
        denied();
      // Never revive consumed protocol state during an update.
      db.prepare(
        `INSERT INTO protocol_objects VALUES(?,?,?,?,?,NULL,?) ON CONFLICT(model,id_hash)
        DO UPDATE SET expires_at=excluded.expires_at, document=excluded.document, uid=excluded.uid`,
      ).run(
        model,
        hash(id),
        expires,
        model === "Grant" ? id : (payload.grantId ?? null),
        payload.uid ?? null,
        JSON.stringify(payload),
      );
    });
    // The durable write may cross an expiry boundary. No authority is released from an expired record.
    if (!this.protocolFind(model, id)) denied();
  }
  protocolFind(model: string, id: string, byUid = false): any {
    return this.kernel.read((db) => {
      const row: any = db
        .prepare(
          `SELECT * FROM protocol_objects WHERE model=? AND ${byUid ? "uid" : "id_hash"}=?`,
        )
        .get(model, byUid ? id : hash(id));
      if (!row || row.expires_at <= this.kernel.now()) return undefined;
      const p = parse(row.document);
      try {
        this.protocolBinding(db, model, p.jti, p);
      } catch (e) {
        if (e instanceof AuthorityError) return undefined;
        throw e;
      }
      return {
        ...p,
        ...(row.consumed !== null ? { consumed: row.consumed } : {}),
      };
    });
  }
  protocolConsume(model: string, id: string): void {
    const consumed = this.kernel.write((db) => {
      const row: any = db
        .prepare("SELECT * FROM protocol_objects WHERE model=? AND id_hash=?")
        .get(model, hash(id));
      if (!row || row.expires_at <= this.kernel.now()) denied();
      this.protocolBinding(db, model, id, parse(row.document));
      if (row.consumed !== null) {
        // Native callers may hold a pre-consumption snapshot. Commit the replay
        // revocation before reporting failure; throwing here would roll it back.
        this.revokeIn(db, row.grant_id, {
          role: "authorization-service",
          id: this.configuration.issuer,
        });
        db.prepare("DELETE FROM protocol_objects WHERE grant_id=?").run(
          row.grant_id,
        );
        return false;
      }
      const result = db
        .prepare(
          "UPDATE protocol_objects SET consumed=? WHERE model=? AND id_hash=? AND consumed IS NULL",
        )
        .run(Math.floor(this.kernel.now() / 1000), model, hash(id));
      if (result.changes !== 1) denied();
      return true;
    });
    if (!consumed) denied();
  }
  protocolDestroy(model: string, id: string): void {
    if (model === "Grant") {
      this.protocolRevoke(id);
      return;
    }
    this.kernel.write((db) =>
      db
        .prepare("DELETE FROM protocol_objects WHERE model=? AND id_hash=?")
        .run(model, hash(id)),
    );
  }
  protocolRevoke(id: string): void {
    this.kernel.write((db) => {
      if (grantRow(db, id))
        this.revokeIn(db, id, {
          role: "authorization-service",
          id: this.configuration.issuer,
        });
      db.prepare("DELETE FROM protocol_objects WHERE grant_id=?").run(id);
    });
  }
  private active(db: DatabaseSync, id: string, clientId?: string): any {
    const row = grantRow(db, id);
    if (
      !row ||
      row.status !== "active" ||
      row.expires_at <= this.kernel.now() ||
      (clientId !== undefined && row.client_id !== clientId)
    )
      denied();
    return assembled(row);
  }
  private publicGrant(db: DatabaseSync, grant: any): any {
    const result = structuredClone(grant);
    for (const detail of result.access) {
      if (detail.narrowedTo !== undefined) {
        // Never omit unknown persisted restrictions. Unknown forms cannot authorize an entry.
        if (
          !Object.keys(detail.narrowedTo).every((key) => key === "entryIds") ||
          !Array.isArray(detail.narrowedTo.entryIds)
        )
          denied();
        detail.narrowedTo.entryIds = detail.narrowedTo.entryIds.map(
          (id: string) => {
            const row = db
              .prepare(
                "SELECT ref FROM grant_refs WHERE grant_id=? AND entry_id=?",
              )
              .get(grant.grantId, id);
            if (!row) denied();
            return row.ref;
          },
        );
      }
    }
    return result;
  }
  review(
    credential: string,
    request: any,
    selection: any,
    binding: string,
  ): any {
    keys(request, ["interactionId", "clientId", "resource", "access", "scope"]);
    keys(selection, ["durationSeconds", "purposes", "categories", "entryIds"]);
    if (
      typeof request.interactionId !== "string" ||
      !request.interactionId ||
      request.resource !== this.configuration.resource ||
      typeof binding !== "string" ||
      !binding
    )
      invalid();
    const client = this.configuration.clients.find(
      (c) => c.id === request.clientId,
    );
    if (!client) invalid();
    if (request.access !== undefined && request.scope !== undefined) invalid();
    const access =
      request.access !== undefined
        ? validateAccess(request.access, true)
        : scopeAccess(request.scope);
    const duration = selection.durationSeconds ?? 4 * 3600;
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 86400)
      invalid();
    if (selection.categories !== undefined) {
      categories(selection.categories);
      if (
        selection.categories.some(
          (c: string) => !access.some((d) => d.categories.includes(c)),
        )
      )
        invalid();
    }
    if (selection.purposes !== undefined && !strings(selection.purposes))
      invalid();
    if (
      selection.entryIds !== undefined &&
      (!strings(selection.entryIds, 0) || !selection.entryIds.every(privateId))
    )
      invalid();
    return this.kernel.write((db) => {
      this.management(db, credential);
      const prior = db
        .prepare("SELECT consumed FROM consent_reviews WHERE interaction_id=?")
        .get(request.interactionId);
      if (prior?.consumed) denied();
      const rules = policies(db, "rules"),
        exclusions: string[] = [],
        granted: any[] = [];
      for (const original of access) {
        const d = structuredClone(original);
        const selected = selection.categories
          ? d.categories.filter((c: string) => selection.categories.includes(c))
          : d.categories;
        const excluded = deniedCategories(
          clientDocument(client),
          selected,
          rules,
        );
        exclusions.push(...excluded);
        d.categories = selected.filter((c: string) => !excluded.includes(c));
        if (!d.categories.length) continue;
        if (d.purposes === undefined) {
          if (
            !selection.purposes ||
            selection.purposes.some(
              (code: string) => !PURPOSES.some((p) => p.code === code),
            )
          )
            invalid();
          d.purposes = PURPOSES.filter((p) =>
            selection.purposes.includes(p.code),
          );
        } else if (selection.purposes) {
          if (
            selection.purposes.some(
              (code: string) => !d.purposes.some((p: any) => p.code === code),
            )
          )
            invalid();
          d.purposes = d.purposes.filter((p: any) =>
            selection.purposes.includes(p.code),
          );
        }
        if (selection.entryIds !== undefined) {
          if (
            d.narrowedTo &&
            selection.entryIds.some(
              (id: string) => !d.narrowedTo.entryIds.includes(id),
            )
          )
            invalid();
          d.narrowedTo = { entryIds: selection.entryIds };
        }
        if (d.narrowedTo)
          for (const id of d.narrowedTo.entryIds) {
            if (!db.prepare("SELECT id FROM entries WHERE id=?").get(id))
              invalid();
          }
        granted.push(d);
      }
      // Even fully denied requests get an explanatory view, but cannot be approved.
      if (granted.length) validateAccess(granted);
      const reviewId = random(),
        csrf = random(),
        now = this.kernel.now();
      const document = {
        client: clientDocument(client),
        access: granted,
        exclusions: [...new Set(exclusions)],
        expiresAt: iso(now + duration * 1000),
        policyRevision: settings(db).policy_revision,
        request: structuredClone(request),
      };
      db.prepare(
        "DELETE FROM consent_reviews WHERE interaction_id=? AND consumed=0",
      ).run(request.interactionId);
      db.prepare(
        "INSERT INTO consent_reviews(id,interaction_id,binding_hash,csrf_hash,expires_at,document) VALUES(?,?,?,?,?,?)",
      ).run(
        reviewId,
        request.interactionId,
        hash(binding),
        hash(csrf),
        Math.min(now + 600_000, Date.parse(document.expiresAt)),
        JSON.stringify(document),
      );
      return { reviewId, csrf, ...document };
    });
  }
  approve(
    credential: string,
    reviewId: string,
    csrf: string,
    binding: string,
    modality: "browser" | "synthetic-test-driver",
  ): any {
    return this.kernel.write((db) => {
      this.management(db, credential);
      const row: any = db
          .prepare("SELECT * FROM consent_reviews WHERE id=?")
          .get(reviewId),
        now = this.kernel.now();
      if (
        !row ||
        row.consumed ||
        row.expires_at <= now ||
        !equal(row.binding_hash, hash(binding)) ||
        !equal(row.csrf_hash, hash(csrf))
      )
        denied();
      const reviewed = parse(row.document);
      if (reviewed.policyRevision !== settings(db).policy_revision) denied();
      validateAccess(reviewed.access);
      const subject = {
        id: db
          .prepare("SELECT pseudonym FROM client_subjects WHERE client_id=?")
          .get(reviewed.client.id).pseudonym,
      };
      const grant = {
        grantId: uuid(),
        subject,
        authorizingPrincipal: subject,
        client: reviewed.client,
        requestingParty: {
          type: "person",
          id: subject.id,
          name: "Synthetic context subject",
        },
        access: reviewed.access,
        scopes: [
          ...new Set(
            reviewed.access.flatMap((d: any) =>
              d.categories.flatMap((c: string) =>
                d.actions.map((action: string) => `hcp:${c}:${action}`),
              ),
            ),
          ),
        ],
        grantType: "temporary",
        issuedAt: iso(now),
        expiresAt: reviewed.expiresAt,
        status: "active",
      };
      db.prepare("INSERT INTO grants VALUES(?,?,?,'active',?)").run(
        grant.grantId,
        grant.client.id,
        Date.parse(grant.expiresAt),
        JSON.stringify(grant),
      );
      for (const id of new Set<string>(
        grant.access.flatMap((d: any) => d.narrowedTo?.entryIds ?? []),
      ))
        db.prepare("INSERT INTO grant_refs VALUES(?,?,?)").run(
          grant.grantId,
          id,
          "r_" + random(),
        );
      db.prepare("UPDATE consent_reviews SET consumed=1 WHERE id=?").run(
        reviewId,
      );
      this.kernel.append(
        db,
        event(
          db,
          "grant.issued",
          now,
          grant,
          { role: "authorization-service", id: this.configuration.issuer },
          {
            access: grant.access,
            grantType: grant.grantType,
            expiresAt: grant.expiresAt,
            modality,
            acr: "urn:context-router:acr:local-credential",
          },
        ),
      );
      return grant;
    });
  }
  listGrants(credential: string, status = "active"): any[] {
    if (!["all", "active", "expired", "revoked"].includes(status)) invalid();
    return this.kernel.read((db) => {
      this.management(db, credential);
      return db
        .prepare(
          "SELECT * FROM grants WHERE ?='all' OR status=? ORDER BY rowid",
        )
        .all(status, status)
        .map(assembled);
    });
  }
  ownGrant(id: string, clientId: string): any {
    return this.kernel.read((db) => {
      const grant = this.active(db, id, clientId);
      return {
        grants: [this.publicGrant(db, grant)],
        directives: matchingDirectives(grant, policies(db, "directives")),
      };
    });
  }
  private readAuthority(
    db: DatabaseSync,
    credential: string,
  ): { grant: any; tokenUntil: number } {
    const bootstrap = db
      .prepare("SELECT mode,state FROM fixture_bootstrap")
      .get();
    if (bootstrap.mode !== "approved" || bootstrap.state !== "closed") denied();
    const row: any = db
      .prepare(
        "SELECT * FROM protocol_objects WHERE model='AccessToken' AND id_hash=?",
      )
      .get(hash(credential));
    if (!row || row.consumed !== null || row.expires_at <= this.kernel.now())
      throw new AuthorityError("unauthenticated");
    const token = parse(row.document);
    try {
      this.protocolBinding(db, "AccessToken", token.jti, token);
    } catch (error) {
      if (error instanceof AuthorityError)
        throw new AuthorityError("unauthenticated");
      throw error;
    }
    return {
      grant: this.active(db, token.grantId, token.clientId),
      tokenUntil: Math.min(Number(row.expires_at), token.exp * 1000),
    };
  }
  /** Commit before returning this private, one-use original-channel capability. */
  stageSyntheticProposal(
    credential: string,
    clientId: string,
    input: any,
  ): any {
    let until = Infinity;
    return this.kernel.write(
      (db) => {
        until = this.management(db, credential);
        if (!this.configuration.clients.some((c) => c.id === clientId))
          denied();
        const document = controlledProposal(input, this.kernel.now()),
          id = uuid();
        db.prepare(
          "INSERT INTO staged_proposals VALUES(?,?,?,'pending',NULL)",
        ).run(id, clientId, JSON.stringify(document));
        return { id, clientId, state: "pending", ...document };
      },
      () => {
        if (this.kernel.now() >= until) denied();
      },
    );
  }
  stagedProposals(credential: string): any[] {
    return this.kernel.read((db) => {
      this.management(db, credential);
      return db
        .prepare("SELECT * FROM staged_proposals ORDER BY id")
        .all()
        .map((row) => ({
          id: row.id,
          clientId: row.client_id,
          state: row.state,
          ...parse(row.document),
        }));
    });
  }
  declineSyntheticProposal(credential: string, id: string): void {
    let until = Infinity;
    this.kernel.write(
      (db) => {
        until = this.management(db, credential);
        if (
          !privateId(id) ||
          !db
            .prepare(
              "SELECT id FROM staged_proposals WHERE id=? AND state='pending'",
            )
            .get(id)
        )
          denied();
        db.prepare(
          "UPDATE staged_proposals SET state='declined' WHERE id=?",
        ).run(id);
      },
      () => {
        if (this.kernel.now() >= until) denied();
      },
    );
  }
  applySyntheticProposal(credential: string, id: string, key: string): object {
    if (!privateId(id) || typeof key !== "string" || !key) invalid();
    const input = this.kernel.read((db) => {
      const { grant } = this.readAuthority(db, credential);
      const proposal = db
        .prepare("SELECT * FROM staged_proposals WHERE id=?")
        .get(id);
      if (
        !proposal ||
        proposal.client_id !== grant.client.id ||
        proposal.state === "declined"
      )
        denied();
      return { ...parse(proposal.document).request, subject: grant.subject };
    });
    return this.commitMutation(
      credential,
      "create",
      input,
      JSON.stringify(input),
      key,
      undefined,
      undefined,
      id,
    );
  }
  commitWrite(
    credential: string,
    operation: WriteOperation,
    input: any,
    raw: string,
    key?: string,
    ref?: string,
  ): object {
    return this.commitMutation(credential, operation, input, raw, key, ref);
  }
  commitPersonWrite(
    credential: string,
    capability: string,
    operation: WriteOperation,
    input: any,
    raw: string,
    key?: string,
    entryId?: string,
  ): object {
    return this.commitMutation(
      credential,
      operation,
      input,
      raw,
      key,
      entryId,
      { idHash: hash(capability) },
    );
  }
  private commitMutation(
    credential: string,
    operation: WriteOperation,
    input: any,
    raw: string,
    key?: string,
    ref?: string,
    capability?: { idHash: string },
    proposalId?: string,
  ): object {
    if (
      !["create", "revise", "withdraw"].includes(operation) ||
      typeof raw !== "string" ||
      (key !== undefined &&
        (typeof key !== "string" || !/^[\x21-\x7e]{1,200}$/.test(key)))
    )
      invalid();
    try {
      const decoded = JSON.parse(raw);
      if (JSON.stringify(decoded) !== JSON.stringify(input)) invalid();
      input = decoded;
    } catch (error) {
      if (error instanceof SyntaxError) invalid();
      throw error;
    }
    let commitUntil = Infinity;
    const committed = this.kernel.write(
      (db) => {
        const now = this.kernel.now();
        let grant: any, tokenUntil: number, cap: any;
        const capacity = capability === undefined ? "context" : "management";
        if (capability === undefined)
          ({ grant, tokenUntil } = this.readAuthority(db, credential));
        else {
          tokenUntil = this.management(db, credential);
          cap = db
            .prepare("SELECT * FROM person_write_capabilities WHERE id_hash=?")
            .get(capability.idHash);
          if (!cap) denied();
          grant = this.active(db, cap.grant_id);
        }
        const proposal: any =
          proposalId &&
          db
            .prepare("SELECT * FROM staged_proposals WHERE id=?")
            .get(proposalId);
        if (
          proposalId &&
          (!proposal ||
            proposal.client_id !== grant.client.id ||
            proposal.state === "declined" ||
            operation !== "create" ||
            JSON.stringify({
              ...parse(proposal.document).request,
              subject: grant.subject,
            }) !== raw)
        )
          denied();
        let current: any;
        if (operation !== "create") {
          const row =
            capacity === "management"
              ? { entry_id: ref }
              : db
                  .prepare(
                    "SELECT entry_id FROM grant_refs WHERE grant_id=? AND ref=?",
                  )
                  .get(grant.grantId, ref ?? "");
          if (!row) denied();
          current = storedEntry(db, String(row.entry_id));
          if (!current) denied();
        }
        const purpose = mutationPurpose(
          grant,
          current?.classification ?? input?.classification,
          capacity === "management" ? [] : policies(db, "rules"),
          current,
        );
        const fingerprint = createHmac(
          "sha256",
          parse(settings(db).secrets).cursorKey,
        )
          .update(raw)
          .digest("hex");
        const keyHash =
          key === undefined
            ? undefined
            : createHmac("sha256", parse(settings(db).secrets).cursorKey)
                .update(JSON.stringify([capacity, grant.client.id, key]))
                .digest("hex");
        const target = operation === "create" ? "collection" : ref;
        if (cap) {
          const permitted = parse(cap.document);
          if (
            permitted.operation !== operation ||
            permitted.target !== target ||
            permitted.fingerprint !== fingerprint
          )
            denied();
        }
        const existing: any =
          keyHash &&
          db
            .prepare("SELECT * FROM mutation_receipts WHERE key_hash=?")
            .get(keyHash);
        if (existing) {
          if (existing.grant_id !== grant.grantId) denied();
          const binding = parse(existing.binding);
          if (existing.invalidated || !existing.response) denied();
          this.writeRepresentation(
            db,
            credential,
            grant.grantId,
            binding,
            false,
          );
          if (
            binding.operation !== operation ||
            binding.target !== target ||
            binding.fingerprint !== fingerprint ||
            (binding.proposalId ?? null) !== (proposalId ?? null)
          )
            throw new WriteConflict("idempotency-conflict");
          const response = parse(existing.response);
          return {
            credential,
            grantId: grant.grantId,
            original: false,
            binding,
            response,
          };
        }
        if (cap?.consumed) denied();
        if (
          cap &&
          current &&
          parse(cap.document).snapshot !==
            this.confirmationSnapshot(db, current.id)
        )
          denied();
        if (proposal && proposal.state !== "pending") denied();
        if (
          current &&
          operation !== "withdraw" &&
          !["active", "conflicted", "expired", "deprecated"].includes(
            current.record.status,
          )
        )
          denied();
        if (
          capacity === "context" &&
          current &&
          operation === "revise" &&
          current.record.provenance.confirmations.at(-1)?.disposition ===
            "rejected"
        )
          denied();
        const document = mutationDocument(
          db,
          grant,
          operation,
          input,
          now,
          current,
          capacity === "management",
        );
        assertNewPurpose(document, purpose);
        if (
          operation === "revise" &&
          input.expectedVersion !== current.record.version
        )
          throw new WriteConflict("version-conflict");
        const assertions =
          operation === "withdraw"
            ? []
            : relationships(
                db,
                grant,
                document,
                input,
                purpose,
                capacity === "management" ? [] : policies(db, "rules"),
                now,
                capacity === "management",
              );
        const relationshipTargetsBefore = [
          ...new Set<string>(
            [...assertions, ...(current?.record.relationships ?? [])].map(
              (r) => r.target,
            ),
          ),
        ].map((id) => ({
          id,
          before: storedEntry(db, id)?.record.status ?? null,
        }));
        applyMutation(db, operation, document, current);
        const graphActor = {
          role: "hcp-provider",
          id: metadata(db).provider_id,
        };
        const graphChanges: any[] = [];
        const graphEmit = (change: any) => {
          if (change.eventType)
            this.appendConflict(db, change, now, graphActor, grant);
          else graphChanges.push(change);
        };
        conflicts.evaluateWrite(
          db,
          (document ?? current).id,
          current,
          now,
          graphActor,
          graphEmit,
        );
        const assertionActor = {
          role:
            capacity === "management" ? "management-client" : "context-client",
          id: grant.client.id,
        };
        conflicts.assertRelationships(
          db,
          (document ?? current).id,
          assertions,
          now,
          assertionActor,
          (change) => {
            if (change.eventType)
              this.appendConflict(db, change, now, assertionActor, grant);
            else graphChanges.push(change);
          },
        );
        const written = storedEntry(db, (document ?? current).id);
        db.prepare(
          "INSERT INTO grant_refs VALUES(?,?,?) ON CONFLICT(grant_id,entry_id) DO NOTHING",
        ).run(grant.grantId, written.id, "r_" + random());
        const resultRef = String(
          db
            .prepare(
              "SELECT ref FROM grant_refs WHERE grant_id=? AND entry_id=?",
            )
            .get(grant.grantId, written.id).ref,
        );
        const copyUntil = Math.min(
          now + this.copyLifetimeMs,
          written.assertion.validUntil == null
            ? Infinity
            : Date.parse(written.assertion.validUntil),
        );
        const response = {
          status: operation === "withdraw" ? 200 : 201,
          bytes: JSON.stringify(
            operation === "withdraw"
              ? { ref: resultRef, status: "deleted", timestamp: iso(now) }
              : capacity === "management"
                ? written
                : project(
                    {
                      entry: written,
                      current: written,
                      categories: written.classification.categories,
                    },
                    new Map([[written.id, resultRef]]),
                    copyUntil,
                  ),
          ),
        };
        const binding = {
          operation,
          capacity,
          target,
          fingerprint,
          entryId: written.id,
          version: written.record.version,
          purpose,
          copyUntil,
          permissionRevision: permissionRevision(db, grant.grantId),
          resultStatus: written.record.status,
          causalSequence: 0,
          proposalId: proposalId ?? null,
        };
        const audit = event(
          db,
          operation === "create"
            ? "context.created"
            : operation === "revise"
              ? "context.revised"
              : "context.withdrawn",
          now,
          grant,
          {
            role:
              capacity === "management"
                ? "management-client"
                : "context-client",
            id: grant.client.id,
          },
          {
            version: written.record.version,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            previousStatus: current?.record.status ?? null,
            status:
              operation === "withdraw" ? "deleted" : written.record.status,
            release: "attempted",
            receipt: "unconfirmed",
            relationships: {
              before: current?.record.relationships ?? [],
              after: written.record.relationships,
            },
            relatedTransitions: [
              ...relationshipTargetsBefore.map((t) => ({
                ...t,
                after: storedEntry(db, t.id)?.record.status ?? null,
              })),
              ...conflicts.causalTransitions(graphChanges),
            ],
            graphChanges,
            ...(proposalId ? { stagedProposal: proposalId } : {}),
          },
        );
        audit.entryId = written.id;
        audit.categories = written.classification.categories;
        audit.purpose = purpose;
        if (
          operation !== "withdraw" &&
          written.assertion.declarationType === "model-inferred"
        )
          audit.participants.model = {
            id: written.record.provenance.assertedBy.id,
          };
        if (operation !== "withdraw" && capacity === "context")
          audit.disclosed = [
            {
              entryId: written.id,
              version: written.record.version,
              useUntil: iso(copyUntil),
            },
          ];
        this.kernel.append(db, audit);
        binding.causalSequence = entrySequence(db, written.id);
        if (proposalId)
          db.prepare(
            "UPDATE staged_proposals SET state='applied',grant_id=? WHERE id=?",
          ).run(grant.grantId, proposalId);
        if (cap)
          db.prepare(
            "UPDATE person_write_capabilities SET consumed=1 WHERE id_hash=?",
          ).run(capability!.idHash);
        if (keyHash)
          db.prepare("INSERT INTO mutation_receipts VALUES(?,?,?,?,?,0)").run(
            keyHash,
            grant.client.id,
            grant.grantId,
            JSON.stringify(binding),
            JSON.stringify(response),
          );
        if (
          this.kernel.now() >= Math.min(tokenUntil, Date.parse(grant.expiresAt))
        )
          throw new AuthorityError("unauthenticated");
        if (
          operation !== "withdraw" &&
          document.assertion.validUntil != null &&
          this.kernel.now() >= Date.parse(document.assertion.validUntil)
        )
          denied();
        commitUntil = Math.min(
          tokenUntil,
          Date.parse(grant.expiresAt),
          operation !== "withdraw" && document.assertion.validUntil != null
            ? Date.parse(document.assertion.validUntil)
            : Infinity,
        );
        return {
          credential,
          grantId: grant.grantId,
          original: true,
          binding,
          response,
        };
      },
      () => {
        if (this.kernel.now() >= commitUntil)
          throw new AuthorityError("unauthenticated");
      },
    );
    const ticket = Object.freeze({});
    this.writes.set(ticket, committed);
    return ticket;
  }
  private writeRepresentation(
    db: DatabaseSync,
    credential: string,
    grantId: string,
    binding: any,
    original: boolean,
  ): number {
    const managed = binding.capacity === "management";
    const { grant, tokenUntil } = managed
      ? {
          tokenUntil: this.management(db, credential),
          grant: this.active(db, grantId),
        }
      : this.readAuthority(db, credential);
    const now = this.kernel.now();
    if (
      grant.grantId !== grantId ||
      permissionRevision(db, grantId) !== binding.permissionRevision
    )
      denied();
    const current = storedEntry(db, binding.entryId),
      selected = storedEntry(db, binding.entryId, binding.version);
    if (!current || !selected) denied();
    if (managed) return Math.min(tokenUntil, Date.parse(grant.expiresAt));
    if (binding.operation !== "withdraw") {
      // Only this transaction's immediate result may survive its own quarantine.
      const ownQuarantine =
        original &&
        binding.resultStatus === "conflicted" &&
        current.record.version === binding.version &&
        current.record.status === "conflicted" &&
        entrySequence(db, binding.entryId) === binding.causalSequence;
      for (const entry of [current, selected])
        if (
          !canDiscloseMutation(
            grant,
            entry,
            binding.purpose,
            policies(db, "rules"),
            now,
            binding.operation,
            ownQuarantine,
          )
        )
          denied();
      if (original && binding.copyUntil <= now) denied();
      const covered = grant.access
        .filter(
          (d: any) =>
            d.actions.includes("read") &&
            d.purposes.some((p: any) => p.code === binding.purpose) &&
            (!d.narrowedTo || d.narrowedTo.entryIds.includes(binding.entryId)),
        )
        .flatMap((d: any) => d.categories);
      if (
        selected.classification.categories.some(
          (c: string) => !covered.includes(c),
        )
      )
        denied();
    } else {
      // The withdrawal acknowledgement describes a historical operation, not a context read.
      if (
        !canDiscloseMutation(
          grant,
          current,
          binding.purpose,
          policies(db, "rules"),
          now,
          "withdraw",
        )
      )
        denied();
    }
    return Math.min(
      tokenUntil,
      Date.parse(grant.expiresAt),
      ...(binding.operation === "withdraw"
        ? []
        : [current, selected].map((e) =>
            e.assertion.validUntil == null
              ? Infinity
              : Date.parse(e.assertion.validUntil),
          )),
      original && binding.operation !== "withdraw"
        ? binding.copyUntil
        : Infinity,
    );
  }
  releaseWrite(
    ticket: object,
    handoff: (status: number, bytes: string) => void,
  ): void {
    const committed = this.writes.get(ticket);
    if (!committed) denied();
    this.writes.delete(ticket);
    let bytes = committed.response.bytes;
    try {
      const until = this.kernel.read((db) =>
        this.writeRepresentation(
          db,
          committed.credential,
          committed.grantId,
          committed.binding,
          committed.original,
        ),
      );
      if (this.kernel.now() >= until)
        throw new AuthorityError("unauthenticated");
    } catch (error) {
      if (!committed.original) throw error;
      bytes = COMPLETION_ONLY;
    }
    handoff(committed.response.status, bytes);
  }
  /** Private preparation ticket; HTTP may await here, but never inside releaseRead. */
  prepareRead(
    credential: string,
    kind: "query" | "get",
    input: any,
    ref?: string,
  ): object {
    const request = readRequest(kind, input, ref);
    return this.kernel.read((db) => {
      const { grant } = this.readAuthority(db, credential),
        now = this.kernel.now();
      const selected = selectRead(
        db,
        grant,
        request,
        policies(db, "rules"),
        now,
      );
      const ticket = Object.freeze({});
      this.reads.set(ticket, {
        credential,
        request,
        revision: Number(settings(db).policy_revision),
        copyUntil: now + this.copyLifetimeMs,
        selected: JSON.stringify(
          selected.entries.map((e) => [e.entry.id, e.entry.record.version]),
        ),
      });
      return ticket;
    });
  }
  /** One owner + synchronous SQLite serializes authority changes through handoff.
   * Pre-serialize inside the transaction. After commit only clock comparisons and
   * the transport's synchronous end(bytes) are permitted; never await drain. */
  releaseRead(ticket: object, handoff: (bytes: string) => void): void {
    const prepared = this.reads.get(ticket);
    if (!prepared) denied();
    this.reads.delete(ticket);
    const result = this.kernel.write((db) => {
      const { grant, tokenUntil } = this.readAuthority(db, prepared.credential),
        now = this.kernel.now();
      if (
        Number(settings(db).policy_revision) !== prepared.revision ||
        prepared.copyUntil <= now
      )
        denied();
      const selected = selectRead(
        db,
        grant,
        prepared.request,
        policies(db, "rules"),
        now,
      );
      if (
        JSON.stringify(
          selected.entries.map((e) => [e.entry.id, e.entry.record.version]),
        ) !== prepared.selected
      )
        denied();
      const refs = new Map<string, string>();
      for (const item of selected.entries) {
        db.prepare(
          "INSERT INTO grant_refs VALUES(?,?,?) ON CONFLICT(grant_id,entry_id) DO NOTHING",
        ).run(grant.grantId, item.entry.id, "r_" + random());
        refs.set(
          item.entry.id,
          String(
            db
              .prepare(
                "SELECT ref FROM grant_refs WHERE grant_id=? AND entry_id=?",
              )
              .get(grant.grantId, item.entry.id).ref,
          ),
        );
      }
      const useUntil = selected.entries.map((e) =>
        Math.min(prepared.copyUntil, validity(e)),
      );
      const entries = selected.entries.map((e, i) =>
        project(e, refs, useUntil[i]),
      );
      const directives = readDirectives(
        grant,
        selected.entries,
        policies(db, "directives"),
      );
      const audit = event(
        db,
        "context.read",
        now,
        grant,
        { role: "context-client", id: grant.client.id },
        {
          release: "attempted",
          receipt: "unconfirmed",
          directives: directives.map((d) => d.directiveId),
          ...(prepared.request.kind === "query"
            ? {
                categoriesSearched: selected.categories,
                maxEntries: prepared.request.maxEntries,
              }
            : {}),
        },
      );
      audit.purpose = prepared.request.purpose;
      if (prepared.request.purposeDescription !== undefined)
        audit.purposeDescription = prepared.request.purposeDescription;
      audit.disclosed = selected.entries.map((e, i) => ({
        entryId: e.entry.id,
        version: e.entry.record.version,
        useUntil: iso(useUntil[i]),
      }));
      const bytes = JSON.stringify({
        ...(prepared.request.kind === "query"
          ? { entries, categoriesSearched: selected.categories }
          : { entry: entries[0] }),
        retrievalId: audit.participants.retrievalId,
        timestamp: iso(now),
        directives,
        minimization: {
          method: prepared.request.kind === "query" ? "lexical" : "none",
        },
      });
      this.kernel.append(db, audit);
      return {
        bytes,
        authorityUntil: Math.min(tokenUntil, Date.parse(grant.expiresAt)),
        copyUntil: Math.min(prepared.copyUntil, ...useUntil),
      };
    });
    // A disk commit may cross a deadline. Its immutable attempted-read event stays
    // in history even when the successful response is withheld here.
    const now = this.kernel.now();
    if (now >= result.authorityUntil)
      throw new AuthorityError("unauthenticated");
    if (now >= result.copyUntil) denied();
    handoff(result.bytes);
  }
  /** Internal eligibility only. C3 must add its audited transport release boundary. */
  allowsEntry(
    id: string,
    clientId: string,
    entryId: string,
    purpose: string,
  ): boolean {
    return this.kernel.read((db) => {
      let grant: any;
      try {
        grant = this.active(db, id, clientId);
      } catch (error) {
        if (error instanceof AuthorityError) return false;
        throw error;
      }
      const row: any = db
        .prepare(
          `SELECT e.classification,e.status,v.document FROM entries e JOIN entry_versions v
        ON v.entry_id=e.id AND v.version=e.current_version WHERE e.id=?`,
        )
        .get(entryId);
      if (!row) return false;
      const document = parse(row.document);
      return evaluateEntry(
        grant,
        {
          ...document,
          classification: parse(row.classification),
          record: { ...document.record, status: row.status },
        },
        purpose,
        policies(db, "rules"),
        this.kernel.now(),
      );
    });
  }
  private revokeIn(db: DatabaseSync, id: string, initiator: any): void {
    const row = grantRow(db, id);
    if (!row) denied();
    if (row.status !== "active") return;
    db.prepare("UPDATE grants SET status='revoked' WHERE id=?").run(id);
    invalidateResponses(db, id);
    this.kernel.append(
      db,
      event(db, "grant.revoked", this.kernel.now(), assembled(row), initiator),
    );
  }
  revoke(credential: string, id: string): void {
    this.kernel.write((db) => {
      this.management(db, credential);
      this.revokeIn(db, id, {
        role: "management-client",
        id: "urn:context-router:synthetic-management",
      });
    });
  }
  relinquish(presentedId: string, clientId: string, requestedId: string): void {
    this.kernel.write((db) => {
      this.active(db, presentedId, clientId);
      if (presentedId !== requestedId) denied();
      this.revokeIn(db, presentedId, { role: "context-client", id: clientId });
    });
  }
  replacePolicy(credential: string, input: any): any {
    const next = validatePolicy(input);
    return this.kernel.write((db) => {
      this.management(db, credential);
      const now = this.kernel.now(),
        initiator = {
          role: "management-client",
          id: "urn:context-router:synthetic-management",
        };
      const previousRules = policies(db, "rules");
      const previousDirectives = policies(db, "directives");
      for (const kind of ["rules", "directives"]) {
        for (const p of policies(db, kind))
          this.kernel.append(
            db,
            event(
              db,
              kind === "rules" ? "rule.removed" : "directive.removed",
              now,
              null,
              initiator,
              p,
            ),
          );
        db.prepare("DELETE FROM policies WHERE kind=?").run(kind);
        for (const p of next[kind]) {
          const id = uuid(),
            item = {
              ...p,
              ...(kind === "rules"
                ? { ruleId: id, effect: "deny" }
                : { directiveId: id }),
              setBy: "context-subject",
              createdAt: iso(now),
            };
          db.prepare("INSERT INTO policies VALUES(?,?,?)").run(
            id,
            kind,
            JSON.stringify(item),
          );
          this.kernel.append(
            db,
            event(
              db,
              kind === "rules" ? "rule.set" : "directive.set",
              now,
              null,
              initiator,
              item,
            ),
          );
        }
      }
      db.exec(
        "UPDATE authorization_settings SET policy_revision=policy_revision+1",
      );
      const rules = policies(db, "rules");
      for (const row of db
        .prepare("SELECT * FROM grants WHERE status='active'")
        .all()) {
        const grant = assembled(row);
        // Standing rules govern Context Clients, not the person's own governance capacity.
        if (grant.client.id === "urn:context-router:synthetic-management")
          continue;
        const reached = [
          ...new Set<string>(grant.access.flatMap((d: any) => d.categories)),
        ];
        const signature = (rules: any[], directives: any[]) =>
          JSON.stringify({
            denied: deniedCategories(grant.client, reached, rules).sort(),
            directives: matchingDirectives(grant, directives).map(
              ({ directiveId, createdAt, setBy, ...d }: any) => d,
            ),
          });
        if (
          signature(previousRules, previousDirectives) !==
          signature(rules, policies(db, "directives"))
        )
          invalidateResponses(db, grant.grantId);
        if (
          deniedCategories(grant.client, reached, rules).length ===
          reached.length
        )
          this.revokeIn(db, grant.grantId, initiator);
      }
      return { rules, directives: policies(db, "directives") };
    });
  }
  private appendConflict(
    db: DatabaseSync,
    change: any,
    now: number,
    actor: any,
    grant: any = null,
  ): void {
    const audit = event(db, change.eventType, now, grant, actor, change.data);
    audit.entryId = change.entryId;
    audit.relatedEntryId = change.relatedEntryId;
    audit.categories = [
      ...new Set(
        [change.entryId, change.relatedEntryId].flatMap(
          (id) => storedEntry(db, id)?.classification.categories ?? [],
        ),
      ),
    ];
    this.kernel.append(db, audit);
  }
  managementEntries(credential: string): any[] {
    return this.kernel.read((db) => {
      this.management(db, credential);
      return db
        .prepare("SELECT id FROM entries ORDER BY id")
        .all()
        .map((row) => storedEntry(db, String(row.id)));
    });
  }
  managementEntry(credential: string, id: string, version?: number): any {
    if (
      !privateId(id) ||
      (version !== undefined && (!Number.isSafeInteger(version) || version < 1))
    )
      invalid();
    return this.kernel.read((db) => {
      this.management(db, credential);
      const entry = storedEntry(db, id, version),
        current = storedEntry(db, id);
      if (!entry || !current) denied();
      return {
        entry,
        currentVersion: current.record.version,
        conflicts: conflicts.snapshot(db, id),
        versions: db
          .prepare(
            "SELECT version FROM entry_versions WHERE entry_id=? ORDER BY version",
          )
          .all(id)
          .map((row) => Number(row.version)),
        historyLabel:
          "Selected content version with current lifecycle and classification",
      };
    });
  }
  confirmEntry(credential: string, id: string, input: any): any {
    let authorityUntil = Infinity,
      entryUntil = Infinity;
    const committed = this.kernel.write(
      (db) => {
        authorityUntil = this.management(db, credential);
        entryUntil = this.confirmationDeadline(db, id);
        const result = this.confirmEntryIn(db, id, input);
        return result;
      },
      () => {
        if (this.kernel.now() >= authorityUntil)
          throw new AuthorityError("unauthenticated");
        if (this.kernel.now() >= entryUntil) denied();
      },
    );
    return this.kernel.now() >= authorityUntil
      ? JSON.parse(COMPLETION_ONLY)
      : committed;
  }
  private confirmationInput(id: string, input: any): void {
    keys(input, ["expectedVersion", "disposition"]);
    if (
      !privateId(id) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !["confirmed", "rejected"].includes(input.disposition)
    )
      invalid();
  }
  private confirmEntryIn(db: DatabaseSync, id: string, input: any): any {
    this.confirmationInput(id, input);
    const current = storedEntry(db, id);
    if (!current) denied();
    if (current.record.version !== input.expectedVersion)
      throw new WriteConflict("version-conflict");
    if (!["active", "conflicted"].includes(current.record.status)) denied();
    const relatedBefore = current.record.relationships.map((r: any) => ({
      id: r.target,
      before: storedEntry(db, r.target)?.record.status ?? null,
    }));
    const now = this.kernel.now(),
      confirmation = {
        disposition: input.disposition,
        confirmedBy: { id: metadata(db).subject_id },
        confirmedAt: iso(now),
      };
    db.prepare(
      "INSERT INTO confirmations(entry_id,version,document) VALUES(?,?,?)",
    ).run(id, current.record.version, JSON.stringify(confirmation));
    const initiator = {
      role: "management-client",
      id: "urn:context-router:synthetic-management",
    };
    const graphChanges: any[] = [];
    conflicts.resolveEntry(
      db,
      id,
      input.disposition,
      now,
      initiator,
      (change) => {
        if (change.eventType) this.appendConflict(db, change, now, initiator);
        else graphChanges.push(change);
      },
      current,
    );
    const audit = event(db, "context.confirmed", now, null, initiator, {
      version: current.record.version,
      ...confirmation,
      previousStatus: current.record.status,
      status: storedEntry(db, id).record.status,
      relationships: {
        before: current.record.relationships,
        after: storedEntry(db, id).record.relationships,
      },
      relatedTransitions: [
        ...relatedBefore.map((t: any) => ({
          ...t,
          after: storedEntry(db, t.id)?.record.status ?? null,
        })),
        ...conflicts.causalTransitions(graphChanges),
      ],
      graphChanges,
    });
    audit.entryId = id;
    audit.categories = current.classification.categories;
    this.kernel.append(db, audit);
    if (input.disposition === "rejected") {
      db.prepare("UPDATE entries SET status='deleted' WHERE id=?").run(id);
      if (current.record.status !== "conflicted") {
        const withdrawal = event(
          db,
          "context.withdrawn",
          now,
          null,
          initiator,
          {
            version: current.record.version,
            reason: "Person chose Reject and withdraw",
            previousStatus: current.record.status,
            status: "deleted",
          },
        );
        withdrawal.entryId = id;
        withdrawal.categories = current.classification.categories;
        this.kernel.append(db, withdrawal);
      }
    }
    return storedEntry(db, id);
  }
  private confirmationSnapshot(db: DatabaseSync, id: string): string {
    const current = storedEntry(db, id);
    if (!current) denied();
    return hash(
      JSON.stringify({ entry: current, conflicts: conflicts.snapshot(db, id) }),
    );
  }
  private confirmationDeadline(db: DatabaseSync, id: string): number {
    const current = storedEntry(db, id);
    if (!current) denied();
    // A live peer expiring changes the reviewed graph. Already-expired retained
    // causes remain resolvable after reconciliation and must not block forever.
    return Math.min(
      Infinity,
      ...[current, ...conflicts.snapshot(db, id).map((r) => r.peer)]
        .filter((e) => ["active", "conflicted"].includes(e.record.status))
        .map((e) =>
          e.assertion.validUntil == null
            ? Infinity
            : Date.parse(e.assertion.validUntil),
        ),
    );
  }
  private personGrant(
    db: DatabaseSync,
    input: any,
    target: any,
    expiresAt: number,
  ): any {
    const subject = { id: metadata(db).subject_id };
    const categories =
      target?.classification.categories ?? input.classification?.categories;
    return {
      grantId: uuid(),
      subject,
      authorizingPrincipal: subject,
      requestingParty: {
        type: "person",
        id: subject.id,
        name: "Synthetic context subject",
      },
      client: {
        id: "urn:context-router:synthetic-management",
        name: "Synthetic person editor",
        operator: {
          id: "https://example.test/operators/synthetic",
          name: "Synthetic fixture operator",
        },
      },
      access: [
        {
          type: ACCESS_TYPE,
          actions: ["read", "write"],
          categories,
          purposes: [PURPOSES[0]],
          ...(target ? { narrowedTo: { entryIds: [target.id] } } : {}),
        },
      ],
      scopes: (categories ?? []).flatMap((c: string) =>
        ["read", "write"].map((action) => `hcp:${c}:${action}`),
      ),
      grantType: "temporary",
      issuedAt: iso(this.kernel.now()),
      expiresAt: iso(expiresAt),
      status: "active",
    };
  }
  reviewPersonWrite(
    credential: string,
    operation: "create" | "revise",
    input: any,
    target: string | undefined,
    binding: string,
  ): any {
    if (
      !["create", "revise"].includes(operation) ||
      typeof binding !== "string" ||
      !binding ||
      (operation === "create" ? target !== undefined : !privateId(target))
    )
      invalid();
    return this.kernel.write((db) => {
      this.management(db, credential);
      const current = target ? storedEntry(db, target) : undefined;
      if (target && !current) denied();
      if (
        current &&
        (!["active", "conflicted", "expired", "deprecated"].includes(
          current.record.status,
        ) ||
          input.expectedVersion !== current.record.version)
      )
        denied();
      const expiresAt = this.kernel.now() + 600_000,
        grant = this.personGrant(db, input, current, expiresAt);
      const document = mutationDocument(
        db,
        grant,
        operation,
        input,
        this.kernel.now(),
        current,
        true,
      );
      assertNewPurpose(
        document,
        mutationPurpose(grant, document.classification, [], current),
      );
      const reviewId = random(),
        csrf = random(),
        reviewed = {
          kind: "person-write",
          operation,
          input,
          target: target ?? null,
          snapshot: target ? this.confirmationSnapshot(db, target) : null,
        };
      db.prepare(
        "INSERT INTO management_reviews(id,binding_hash,csrf_hash,expires_at,document,consumed) VALUES(?,?,?,?,?,0)",
      ).run(
        reviewId,
        hash(binding),
        hash(csrf),
        expiresAt,
        JSON.stringify(reviewed),
      );
      return {
        reviewId,
        csrf,
        request: structuredClone(input),
        operation,
        target,
        expiresAt: iso(expiresAt),
      };
    });
  }
  approvePersonWrite(
    credential: string,
    reviewId: string,
    csrf: string,
    binding: string,
  ): string {
    let authorityUntil = Infinity,
      commitUntil = Infinity;
    return this.kernel.write(
      (db) => {
        authorityUntil = this.management(db, credential);
        const row: any = db
          .prepare("SELECT * FROM management_reviews WHERE id=?")
          .get(reviewId);
        if (
          !row ||
          row.consumed ||
          row.expires_at <= this.kernel.now() ||
          !equal(row.csrf_hash, hash(csrf)) ||
          !equal(row.binding_hash, hash(binding))
        )
          denied();
        const reviewed = parse(row.document);
        if (
          reviewed.kind !== "person-write" ||
          (reviewed.target &&
            reviewed.snapshot !==
              this.confirmationSnapshot(db, reviewed.target))
        )
          denied();
        const current = reviewed.target
          ? storedEntry(db, reviewed.target)
          : undefined;
        const grant = this.personGrant(
          db,
          reviewed.input,
          current,
          Number(row.expires_at),
        );
        const document = mutationDocument(
          db,
          grant,
          reviewed.operation,
          reviewed.input,
          this.kernel.now(),
          current,
          true,
        );
        commitUntil = Math.min(
          authorityUntil,
          Number(row.expires_at),
          document.assertion.validUntil == null
            ? Infinity
            : Date.parse(document.assertion.validUntil),
        );
        assertNewPurpose(
          document,
          mutationPurpose(grant, document.classification, [], current),
        );
        db.prepare("INSERT INTO grants VALUES(?,?,?,'active',?)").run(
          grant.grantId,
          grant.client.id,
          row.expires_at,
          JSON.stringify(grant),
        );
        this.kernel.append(
          db,
          event(
            db,
            "grant.issued",
            this.kernel.now(),
            grant,
            { role: "management-client", id: grant.client.id },
            {
              access: grant.access,
              grantType: grant.grantType,
              expiresAt: grant.expiresAt,
              modality: "explicit-person-write-review",
              acr: "urn:context-router:acr:local-credential",
            },
          ),
        );
        const capability = random();
        const fingerprint = createHmac(
          "sha256",
          parse(settings(db).secrets).cursorKey,
        )
          .update(JSON.stringify(reviewed.input))
          .digest("hex");
        db.prepare("INSERT INTO person_write_capabilities VALUES(?,?,?,0)").run(
          hash(capability),
          grant.grantId,
          JSON.stringify({
            operation: reviewed.operation,
            target: reviewed.target ?? "collection",
            fingerprint,
            snapshot: reviewed.snapshot,
          }),
        );
        db.prepare(
          "UPDATE management_reviews SET consumed=1,approved_capability=? WHERE id=?",
        ).run(hash(capability), reviewId);
        return capability;
      },
      () => {
        if (this.kernel.now() >= authorityUntil)
          throw new AuthorityError("unauthenticated");
        if (this.kernel.now() >= commitUntil) denied();
      },
    );
  }
  commitReviewedPersonWrite(
    credential: string,
    reviewId: string,
    csrf: string,
    binding: string,
    key: string,
  ): object {
    const reviewed = this.kernel.read((db) => {
      this.management(db, credential);
      const row = db
        .prepare("SELECT * FROM management_reviews WHERE id=?")
        .get(reviewId);
      if (
        !row ||
        Number(row.expires_at) <= this.kernel.now() ||
        !equal(String(row.csrf_hash), hash(csrf)) ||
        !equal(String(row.binding_hash), hash(binding))
      )
        denied();
      const document = parse(row.document);
      if (document.kind !== "person-write") denied();
      return { ...document, approvedCapability: row.approved_capability };
    });
    const idHash =
      reviewed.approvedCapability ??
      hash(this.approvePersonWrite(credential, reviewId, csrf, binding));
    return this.commitMutation(
      credential,
      reviewed.operation,
      reviewed.input,
      JSON.stringify(reviewed.input),
      key,
      reviewed.target ?? undefined,
      { idHash },
    );
  }
  reviewConfirmation(
    credential: string,
    id: string,
    input: any,
    binding: string,
  ): any {
    this.confirmationInput(id, input);
    if (typeof binding !== "string" || !binding) invalid();
    return this.kernel.write((db) => {
      this.management(db, credential);
      const entry = storedEntry(db, id);
      if (!entry) denied();
      if (entry.record.version !== input.expectedVersion)
        throw new WriteConflict("version-conflict");
      if (!["active", "conflicted"].includes(entry.record.status)) denied();
      const reviewId = random(),
        csrf = random(),
        expiresAt = this.kernel.now() + 600_000;
      const document = {
        kind: "confirmation",
        id,
        input,
        snapshot: this.confirmationSnapshot(db, id),
      };
      db.prepare(
        "INSERT INTO management_reviews(id,binding_hash,csrf_hash,expires_at,document,consumed) VALUES(?,?,?,?,?,0)",
      ).run(
        reviewId,
        hash(binding),
        hash(csrf),
        expiresAt,
        JSON.stringify(document),
      );
      return {
        reviewId,
        csrf,
        entry,
        conflicts: conflicts.snapshot(db, id),
        disposition: input.disposition,
        expiresAt: iso(expiresAt),
      };
    });
  }
  reviewKeepBoth(credential: string, relationId: string, binding: string): any {
    if (!privateId(relationId) || typeof binding !== "string" || !binding)
      invalid();
    return this.kernel.write((db) => {
      this.management(db, credential);
      const snapshot = conflicts.keepBothSnapshot(db, relationId);
      const reviewId = random(),
        csrf = random(),
        expiresAt = this.kernel.now() + 600_000;
      const document = {
        kind: "keep-both",
        relationId,
        snapshot: hash(JSON.stringify(snapshot)),
      };
      db.prepare(
        "INSERT INTO management_reviews(id,binding_hash,csrf_hash,expires_at,document,consumed) VALUES(?,?,?,?,?,0)",
      ).run(
        reviewId,
        hash(binding),
        hash(csrf),
        expiresAt,
        JSON.stringify(document),
      );
      return { reviewId, csrf, ...snapshot, expiresAt: iso(expiresAt) };
    });
  }
  approveKeepBoth(
    credential: string,
    reviewId: string,
    csrf: string,
    binding: string,
  ): any {
    let authorityUntil = Infinity,
      commitUntil = Infinity;
    const result = this.kernel.write(
      (db) => {
        authorityUntil = this.management(db, credential);
        const row: any = db
          .prepare("SELECT * FROM management_reviews WHERE id=?")
          .get(reviewId);
        if (
          !row ||
          row.consumed ||
          row.expires_at <= this.kernel.now() ||
          !equal(row.csrf_hash, hash(csrf)) ||
          !equal(row.binding_hash, hash(binding))
        )
          denied();
        const reviewed = parse(row.document);
        if (reviewed.kind !== "keep-both") denied();
        const snapshot = conflicts.keepBothSnapshot(db, reviewed.relationId);
        if (reviewed.snapshot !== hash(JSON.stringify(snapshot))) denied();
        const now = this.kernel.now(),
          actor = {
            role: "management-client",
            id: "urn:context-router:synthetic-management",
          };
        conflicts.dismiss(db, reviewed.relationId, now, actor, (change) =>
          this.appendConflict(db, change, now, actor),
        );
        db.prepare("UPDATE management_reviews SET consumed=1 WHERE id=?").run(
          reviewId,
        );
        commitUntil = Math.min(
          authorityUntil,
          Number(row.expires_at),
          ...[snapshot.entry, snapshot.conflict.peer].map((e) =>
            e.assertion.validUntil == null
              ? Infinity
              : Date.parse(e.assertion.validUntil),
          ),
        );
        return { id: snapshot.entry.id };
      },
      () => {
        if (this.kernel.now() >= commitUntil) denied();
      },
    );
    return this.kernel.now() >= authorityUntil
      ? JSON.parse(COMPLETION_ONLY)
      : result;
  }
  approveConfirmation(
    credential: string,
    reviewId: string,
    csrf: string,
    binding: string,
  ): any {
    let authorityUntil = Infinity,
      reviewUntil = Infinity,
      entryUntil = Infinity;
    const committed = this.kernel.write(
      (db) => {
        authorityUntil = this.management(db, credential);
        const row: any = db
          .prepare("SELECT * FROM management_reviews WHERE id=?")
          .get(reviewId);
        if (
          !row ||
          row.consumed ||
          row.expires_at <= this.kernel.now() ||
          !equal(row.csrf_hash, hash(csrf)) ||
          !equal(row.binding_hash, hash(binding))
        )
          denied();
        const reviewed = parse(row.document);
        if (
          reviewed.kind !== "confirmation" ||
          reviewed.snapshot !== this.confirmationSnapshot(db, reviewed.id)
        )
          denied();
        entryUntil = this.confirmationDeadline(db, reviewed.id);
        const result = this.confirmEntryIn(db, reviewed.id, reviewed.input);
        reviewUntil = Number(row.expires_at);
        db.prepare("UPDATE management_reviews SET consumed=1 WHERE id=?").run(
          reviewId,
        );
        return result;
      },
      () => {
        if (this.kernel.now() >= authorityUntil)
          throw new AuthorityError("unauthenticated");
        if (this.kernel.now() >= Math.min(reviewUntil, entryUntil)) denied();
      },
    );
    return this.kernel.now() >= authorityUntil
      ? JSON.parse(COMPLETION_ONLY)
      : committed;
  }
  audit(
    credential: string,
    options: {
      limit?: number;
      cursor?: string;
      grantId?: string;
      entryId?: string;
    } = {},
  ): any {
    keys(options, ["limit", "cursor", "grantId", "entryId"]);
    if (options.entryId !== undefined && !privateId(options.entryId)) invalid();
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) invalid();
    return this.kernel.write((db) => {
      this.management(db, credential);
      let after = 0,
        maximum = Number(
          db
            .prepare("SELECT coalesce(max(sequence),0) n FROM audit_events")
            .get().n,
        ),
        grantId = options.grantId,
        entryId = options.entryId;
      if (options.cursor) {
        const row = db
          .prepare(
            "SELECT * FROM audit_cursors WHERE id_hash=? AND expires_at>?",
          )
          .get(hash(options.cursor), this.kernel.now());
        if (!row) invalid();
        const cursor = parse(row.document);
        if (options.grantId !== undefined && options.grantId !== cursor.grantId)
          invalid();
        if (options.entryId !== undefined && options.entryId !== cursor.entryId)
          invalid();
        ({ after, maximum, grantId, entryId } = cursor);
      }
      const rows = db
        .prepare(
          "SELECT sequence,event FROM audit_events WHERE sequence>? AND sequence<=? AND (? IS NULL OR json_extract(event,'$.grantId')=?) AND (? IS NULL OR json_extract(event,'$.entryId')=? OR json_extract(event,'$.relatedEntryId')=? OR EXISTS (SELECT 1 FROM json_each(audit_events.event,'$.data.relatedTransitions') t WHERE json_extract(t.value,'$.id')=?)) ORDER BY sequence LIMIT ?",
        )
        .all(
          after,
          maximum,
          grantId ?? null,
          grantId ?? null,
          entryId ?? null,
          entryId ?? null,
          entryId ?? null,
          entryId ?? null,
          limit + 1,
        );
      let nextCursor: string | null = null;
      if (rows.length > limit) {
        rows.pop();
        const continuation = JSON.stringify({
          after: rows[rows.length - 1].sequence,
          maximum,
          grantId,
          entryId,
        });
        // A keyed digest reveals neither the sequence nor the size of the snapshot.
        nextCursor = createHmac("sha256", parse(settings(db).secrets).cursorKey)
          .update(continuation)
          .digest("base64url");
        db.prepare(
          "INSERT INTO audit_cursors VALUES(?,?,?) ON CONFLICT(id_hash) DO UPDATE SET expires_at=excluded.expires_at",
        ).run(hash(nextCursor), this.kernel.now() + 600_000, continuation);
      }
      return { events: rows.map((r) => parse(r.event)), nextCursor };
    });
  }
  lastPossibleCopyUseUntil(credential: string, grantId: string): string | null {
    return this.kernel.read((db) => {
      this.management(db, credential);
      const row = db
        .prepare(
          `SELECT max(json_extract(d.value,'$.useUntil')) deadline
        FROM audit_events a, json_each(a.event,'$.disclosed') d
        WHERE json_extract(a.event,'$.eventType') IN ('context.read','context.created','context.revised') AND json_extract(a.event,'$.grantId')=?`,
        )
        .get(grantId);
      return row.deadline === null ? null : String(row.deadline);
    });
  }
}
