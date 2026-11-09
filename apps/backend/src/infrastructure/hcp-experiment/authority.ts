import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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
}
/** Infrastructure-only synchronous capability. It never leaves the experiment store. */
export interface AuthorityKernel {
  read<T>(operation: (db: DatabaseSync) => T): T;
  write<T>(operation: (db: DatabaseSync) => T): T;
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
  constructor(
    private readonly kernel: AuthorityKernel,
    readonly configuration: AuthorizationConfiguration,
    human: string,
  ) {
    keys(configuration, ["issuer", "resource", "clients"]);
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
  private management(db: DatabaseSync, credential: string): void {
    if (typeof credential !== "string")
      throw new AuthorityError("unauthenticated");
    if (equal(String(settings(db).human_verifier), hash(credential))) return;
    const session = db
      .prepare("SELECT * FROM human_sessions WHERE id_hash=?")
      .get(hash(credential));
    if (
      !session?.authenticated ||
      Number(session.expires_at) <= this.kernel.now()
    )
      throw new AuthorityError("unauthenticated");
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
              d.categories.map((c: string) => `hcp:${c}:read`),
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
        const grant = assembled(row),
          reached = [
            ...new Set<string>(grant.access.flatMap((d: any) => d.categories)),
          ];
        if (
          deniedCategories(grant.client, reached, rules).length ===
          reached.length
        )
          this.revokeIn(db, grant.grantId, initiator);
      }
      return { rules, directives: policies(db, "directives") };
    });
  }
  audit(
    credential: string,
    options: { limit?: number; cursor?: string; grantId?: string } = {},
  ): any {
    keys(options, ["limit", "cursor", "grantId"]);
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
        grantId = options.grantId;
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
        ({ after, maximum, grantId } = cursor);
      }
      const rows = db
        .prepare(
          "SELECT sequence,event FROM audit_events WHERE sequence>? AND sequence<=? AND (? IS NULL OR json_extract(event,'$.grantId')=?) ORDER BY sequence LIMIT ?",
        )
        .all(after, maximum, grantId ?? null, grantId ?? null, limit + 1);
      let nextCursor: string | null = null;
      if (rows.length > limit) {
        rows.pop();
        const continuation = JSON.stringify({
          after: rows[rows.length - 1].sequence,
          maximum,
          grantId,
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
}
