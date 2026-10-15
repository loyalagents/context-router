"use client";

import { useEffect, useRef, useState } from "react";
import { localJson, LocalRequestError } from "@/lib/authenticated-fetch";
import { ClientName } from "./ClientNames";

export type McpPolicy = {
  capabilities: string[];
  targets: string[];
  allowSensitive: boolean;
};
export type PermissionSummary = {
  total: number;
  level: string;
  ruleCount: number;
  counts: {
    blocked: number;
    read: number;
    suggest: number;
    write: number;
    define: number;
  };
};
type Client = {
  id: string;
  label: string;
  generation: number;
  revoked: boolean;
  policy: McpPolicy;
};
type Edit = { target: string; action: string; effect: string };
type Snapshot = {
  status: string;
  client: Client;
  grants?: (Edit & { id: string })[];
  revision?: string;
  adminRevision: string;
  catalogStatus: string;
  catalogRevision?: string;
  summary?: PermissionSummary;
};
type Preview = {
  previewKey: string;
  revision: string;
  catalogRevision: string;
  before: PermissionSummary;
  after: PermissionSummary;
  widening: string[];
  examples: {
    target: string;
    name: string;
    before: Record<string, boolean>;
    after: Record<string, boolean>;
  }[];
};
type Target = {
  kind: string;
  target: string;
  name: string;
  namespace?: string;
  sensitive?: boolean;
};
const button = "rounded border px-3 py-2 disabled:opacity-50";
const levels = ["Blocked", "Read", "Suggest changes", "Write"];
const capabilities = [
  "",
  "preferences:read",
  "preferences:suggest",
  "preferences:write",
];
export function maximumValueLevel(policy: McpPolicy) {
  return levels[
    policy.capabilities.includes("preferences:write")
      ? 3
      : policy.capabilities.includes("preferences:suggest")
        ? 2
        : policy.capabilities.includes("preferences:read")
          ? 1
          : 0
  ];
}
function validPolicy(value: unknown): value is McpPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as McpPolicy;
  return (
    Object.keys(p).sort().join() === "allowSensitive,capabilities,targets" &&
    Array.isArray(p.capabilities) &&
    p.capabilities.length <= 4 &&
    new Set(p.capabilities).size === p.capabilities.length &&
    p.capabilities.every((cap) =>
      [
        "preferences:read",
        "preferences:suggest",
        "preferences:write",
        "preferences:define",
      ].includes(cap),
    ) &&
    Array.isArray(p.targets) &&
    p.targets.length <= 64 &&
    new Set(p.targets).size === p.targets.length &&
    p.targets.every(
      (target) =>
        typeof target === "string" &&
        target.length <= 128 &&
        (target === "*" ||
          /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*(?:\.\*)?$/.test(target)),
    ) &&
    typeof p.allowSensitive === "boolean"
  );
}
function Summary({ value }: { value: PermissionSummary }) {
  return (
    <p>
      {value.level} across {value.total} current active field definitions in the
      allowed scope: {value.counts.blocked} blocked, {value.counts.read} read,{" "}
      {value.counts.suggest} suggest, {value.counts.write} write. Definition
      management allowed for {value.counts.define}.
    </p>
  );
}

/** Ephemeral editor: its owning authenticated page remounts on session replacement. */
export default function McpPermissionsEditor({
  client,
  onClose,
  onChanged,
}: {
  client: Client;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [policy, setPolicy] = useState<McpPolicy | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{
    kind: "confirmed" | "conflict" | "uncertain";
    message: string;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Target[]>([]);
  const [searchError, setSearchError] = useState("");
  const [more, setMore] = useState(false);
  const [scopeTarget, setScopeTarget] = useState("*");
  const [scopeLevel, setScopeLevel] = useState("Read");
  const [advancedTarget, setAdvancedTarget] = useState("*");
  const [advancedAction, setAdvancedAction] = useState("READ");
  const [advancedEffect, setAdvancedEffect] = useState("DENY");
  const [customTarget, setCustomTarget] = useState("");
  const life = useRef({
    mounted: false,
    version: 0,
    read: 0,
    search: 0,
    submitting: false,
    controllers: new Set<AbortController>(),
  });
  const title = useRef<HTMLHeadingElement>(null);
  const draft = useRef<{ policy: McpPolicy | null; edits: Edit[] }>({
    policy: null,
    edits: [],
  });
  const outcomeRef = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  const valid =
    snapshot?.status === "AVAILABLE" &&
    snapshot.catalogStatus === "AVAILABLE" &&
    !snapshot.client.revoked;
  function controller() {
    const c = new AbortController();
    life.current.controllers.add(c);
    return c;
  }
  function change(nextPolicy: McpPolicy, nextEdits = edits) {
    life.current.version++;
    draft.current = { policy: nextPolicy, edits: nextEdits };
    setPolicy(nextPolicy);
    setEdits(nextEdits);
    setPreview(null);
    setError("");
  }
  async function readCurrent(initial = false) {
    const s = life.current;
    if (!s.mounted) return;
    const read = ++s.read,
      c = controller();
    setBusy(true);
    setError("");
    setPreview(null);
    setStale(true);
    try {
      const data = await localJson<Snapshot>(
        "/api/local/mcp/inspect",
        { id: client.id },
        c.signal,
      );
      if (!s.mounted || c.signal.aborted || read !== s.read) return;
      if (
        data.client?.id !== client.id ||
        typeof data.adminRevision !== "string"
      )
        throw new Error();
      setSnapshot(data);
      setStale(false);
      life.current.version++;
      if (initial || !draft.current.policy) {
        draft.current = { policy: data.client.policy, edits: [] };
        setPolicy(data.client.policy);
        setEdits([]);
      }
    } catch {
      if (s.mounted && !c.signal.aborted && read === s.read)
        setError(
          "Current permissions could not be read. Retry the read; no change is retried.",
        );
    } finally {
      s.controllers.delete(c);
      if (s.mounted && read === s.read) setBusy(false);
    }
  }
  useEffect(() => {
    const s = life.current;
    s.mounted = true;
    title.current?.focus();
    void readCurrent(true);
    const invalidate = () => {
      s.version++;
      setPreview(null);
      setStale(true);
    };
    const activity = () => {
      if (s.submitting) interacted.current = true;
    };
    const channel = new BroadcastChannel("context-router.mcp-management.v1");
    channel.onmessage = invalidate;
    window.addEventListener("focus", invalidate);
    window.addEventListener("pageshow", invalidate);
    for (const event of ["pointerdown", "keydown", "input", "focusin"])
      document.addEventListener(event, activity, true);
    return () => {
      s.mounted = false;
      s.version++;
      s.read++;
      s.search++;
      s.controllers.forEach((c) => c.abort());
      s.controllers.clear();
      draft.current = { policy: null, edits: [] };
      channel.close();
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("pageshow", invalidate);
      for (const event of ["pointerdown", "keydown", "input", "focusin"])
        document.removeEventListener(event, activity, true);
    };
    // This component is keyed to a single captured client identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!valid) return;
    const s = life.current,
      sequence = ++s.search,
      c = controller();
    setResults([]);
    setSearchError("");
    const timer = setTimeout(() => {
      void localJson<{ items: Target[]; hasMore: boolean }>(
        "/api/local/mcp/targets",
        { id: client.id, query },
        c.signal,
      )
        .then((data) => {
          if (s.mounted && !c.signal.aborted && sequence === s.search) {
            setResults(data.items);
            setMore(data.hasMore);
          }
        })
        .catch(() => {
          if (s.mounted && !c.signal.aborted && sequence === s.search)
            setSearchError(
              "Target search unavailable. Try another search or use advanced targets.",
            );
        })
        .finally(() => s.controllers.delete(c));
    }, 150);
    return () => {
      clearTimeout(timer);
      c.abort();
      s.controllers.delete(c);
    };
  }, [query, valid, client.id]);
  function setRule(edit: Edit) {
    if (!policy) return;
    const next = edits.filter(
      (row) => row.target !== edit.target || row.action !== edit.action,
    );
    next.push({
      target: edit.target,
      action: edit.action,
      effect: edit.effect,
    });
    change(policy, next);
  }
  function preset() {
    if (!policy) return;
    const rank = levels.indexOf(scopeLevel);
    const next = edits.filter(
      (row) =>
        row.target !== scopeTarget ||
        !["READ", "SUGGEST", "WRITE"].includes(row.action),
    );
    ["READ", "SUGGEST", "WRITE"].forEach((action, index) =>
      next.push({
        target: scopeTarget,
        action,
        effect: rank > index ? "ALLOW" : "DENY",
      }),
    );
    change(policy, next);
  }
  function proposedBody() {
    return {
      id: client.id,
      generation: snapshot!.client.generation,
      revision: snapshot!.revision,
      catalogRevision: snapshot!.catalogRevision,
      policy: draft.current.policy,
      edits: draft.current.edits,
    };
  }
  async function inspectDraft() {
    const s = life.current;
    if (!valid || stale || busy || s.submitting || !policy) return;
    const version = s.version,
      c = controller(),
      body = proposedBody();
    setBusy(true);
    setPreview(null);
    setError("");
    try {
      const result = await localJson<Preview>(
        "/api/local/mcp/preview",
        body,
        c.signal,
      );
      if (s.mounted && !c.signal.aborted && version === s.version) {
        if (
          !/^[a-f0-9]{64}$/.test(result.previewKey) ||
          result.revision !== body.revision ||
          result.catalogRevision !== body.catalogRevision
        )
          throw new Error();
        setPreview(result);
      }
    } catch (err) {
      if (s.mounted && !c.signal.aborted && version === s.version) {
        setError(
          err instanceof LocalRequestError && err.status === 409
            ? "Authority or catalog changed. Read current permissions, then preview your preserved draft."
            : "Preview unavailable. Check the maximum and rule changes; a new ALLOW must fit the proposed maximum.",
        );
        if (err instanceof LocalRequestError && err.status === 409)
          setStale(true);
      }
    } finally {
      s.controllers.delete(c);
      if (s.mounted) setBusy(false);
    }
  }
  async function save() {
    const s = life.current;
    if (!preview || stale || busy || s.submitting || !valid) return;
    const body = { ...proposedBody(), previewKey: preview.previewKey },
      c = controller();
    s.submitting = true;
    interacted.current = false;
    setSaving(true);
    setPreview(null);
    setOutcome(null);
    setError("");
    try {
      const result = await localJson<{
        changed: boolean;
        client: Client;
        revision: string;
      }>("/api/local/mcp/save", body, c.signal);
      if (!s.mounted || c.signal.aborted) return;
      if (
        result.changed !== true ||
        result.client?.id !== client.id ||
        !/^[a-f0-9]{64}$/.test(result.revision) ||
        !validPolicy(result.client.policy) ||
        !Number.isSafeInteger(result.client.generation) ||
        result.client.generation < 1 ||
        typeof result.client.label !== "string" ||
        typeof result.client.revoked !== "boolean"
      )
        throw new Error();
      draft.current = { policy: result.client.policy, edits: [] };
      setPolicy(result.client.policy);
      setEdits([]);
      setOutcome({
        kind: "confirmed",
        message:
          "Permissions saved. The server acknowledged the complete change. A separate read checks current authority.",
      });
    } catch (err) {
      if (s.mounted && !c.signal.aborted)
        setOutcome(
          err instanceof LocalRequestError && err.status === 409
            ? {
                kind: "conflict",
                message:
                  "Permissions were not saved because authority or the catalog changed. Your draft is preserved. Read current permissions and preview again before deciding to save.",
              }
            : {
                kind: "uncertain",
                message:
                  "Save was not confirmed. It may have committed or may still settle. No change will be retried. Reading current state cannot establish what happened to this request.",
              },
        );
    } finally {
      s.controllers.delete(c);
      s.submitting = false;
      if (s.mounted && !c.signal.aborted) {
        setSaving(false);
        setStale(true);
        s.version++;
        onChanged();
        await readCurrent();
        if (s.mounted && !interacted.current) {
          outcomeRef.current?.focus({ preventScroll: true });
          outcomeRef.current?.scrollIntoView({ block: "nearest" });
        }
      }
    }
  }
  const rules = [...(snapshot?.grants ?? [])];
  for (const edit of edits) {
    const index = rules.findIndex(
      (row) => row.target === edit.target && row.action === edit.action,
    );
    if (index >= 0) rules.splice(index, 1);
    if (edit.effect !== "REMOVE")
      rules.push({ ...edit, id: "draft:" + edit.target + edit.action });
  }
  return (
    <section
      aria-label="Edit permissions"
      className="space-y-5 rounded-xl border-2 border-blue-200 bg-white p-5 shadow-sm"
    >
      <h2 ref={title} tabIndex={-1} className="text-xl font-semibold">
        Edit permissions —{" "}
        <ClientName clientKey={`local:${client.id}`} label={client.label} />
      </h2>
      <p className="text-xs break-all">
        Instance {client.id}. One Save applies the maximum and all drafted rules
        together.
      </p>
      {outcome && (
        <div
          ref={outcomeRef}
          tabIndex={-1}
          role={outcome.kind === "confirmed" ? "status" : "alert"}
          className={`rounded border-2 p-3 ${outcome.kind === "confirmed" ? "border-green-600 bg-green-50" : "border-amber-600 bg-amber-50"}`}
        >
          <strong>
            {outcome.kind === "confirmed"
              ? "Permissions saved"
              : outcome.kind === "conflict"
                ? "Permissions conflict"
                : "Save not confirmed"}
          </strong>
          <p>{outcome.message}</p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <div className="rounded bg-slate-50 p-3">
          <h3 className="font-semibold">
            {stale ? "Last read authority (stale)" : "Current saved authority"}
          </h3>
          <p>
            Maximum: {maximumValueLevel(snapshot.client.policy)}. Scope:{" "}
            {snapshot.client.policy.targets.join(", ") || "No targets"}.
            Sensitive:{" "}
            {snapshot.client.policy.allowSensitive ? "allowed" : "blocked"}.
          </p>
          {snapshot.summary ? (
            <Summary value={snapshot.summary} />
          ) : (
            <p>
              {snapshot.catalogStatus === "CATALOG_UNAVAILABLE"
                ? "Catalog unavailable"
                : "Authority unavailable"}{" "}
              — complete effective access cannot be shown; editing is disabled.
              CLI administration and revocation remain available.
            </p>
          )}
        </div>
      )}
      {stale && (
        <p role="status">
          The saved snapshot needs a fresh read. Your draft is preserved
          separately.
        </p>
      )}
      <button
        type="button"
        className={button}
        disabled={busy || saving}
        onClick={() => void readCurrent()}
      >
        Read current permissions
      </button>
      {policy && (
        <fieldset disabled={!valid || saving} className="space-y-4">
          <legend className="font-semibold">Proposed maximum</legend>
          <label className="block">
            Maximum value access
            <select
              className="ml-3 rounded border p-2"
              value={maximumValueLevel(policy)}
              onChange={(event) => {
                const cap = capabilities[levels.indexOf(event.target.value)];
                change({
                  ...policy,
                  capabilities: [
                    ...(cap ? [cap] : []),
                    ...policy.capabilities.filter(
                      (value) => value === "preferences:define",
                    ),
                  ],
                });
              }}
            >
              {levels.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
          </label>
          <p className="text-sm">
            Write includes Suggest changes and Read; Suggest changes includes
            Read. This is a ceiling. More specific rules can make current access
            Mixed.
          </p>
          <label className="block">
            <input
              type="checkbox"
              checked={policy.capabilities.includes("preferences:define")}
              onChange={(event) =>
                change({
                  ...policy,
                  capabilities: event.target.checked
                    ? [...policy.capabilities, "preferences:define"]
                    : policy.capabilities.filter(
                        (cap) => cap !== "preferences:define",
                      ),
                })
              }
            />{" "}
            Allow definition management (DEFINE)
          </label>
          <p className="text-sm">
            Create, update and archive field definitions within the allowed
            scope and rules. Independent of value access.
          </p>
          <label className="block">
            <input
              type="checkbox"
              checked={policy.allowSensitive}
              onChange={(event) =>
                change({ ...policy, allowSensitive: event.target.checked })
              }
            />{" "}
            Allow sensitive data
          </label>
          <p className="text-sm">
            Sensitivity follows the actual stored definition, including archived
            definitions. Global and personal fields sharing a slug use the same
            rules.
          </p>
          <h3 className="font-semibold">Allowed scope</h3>
          <div className="flex flex-wrap gap-2">
            {policy.targets.map((target) => (
              <span
                key={target}
                className="rounded border bg-slate-50 p-2 break-all"
              >
                {target}{" "}
                <button
                  aria-label={`Remove maximum target ${target}`}
                  onClick={() =>
                    change({
                      ...policy,
                      targets: policy.targets.filter(
                        (value) => value !== target,
                      ),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {!policy.targets.length && <p>No targets allowed.</p>}
          </div>
          <label className="block">
            Search categories or fields
            <input
              className="block w-full rounded border p-2"
              maxLength={128}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="For example: work, first name, profile.*"
            />
          </label>
          {searchError && <p role="status">{searchError}</p>}
          <ul className="max-h-56 overflow-auto divide-y rounded border">
            {results.map((item, index) => (
              <li
                key={item.kind + item.target + index}
                className="flex flex-wrap items-center justify-between gap-2 p-2"
              >
                <span>
                  {item.name}
                  <small className="block text-slate-600 break-all">
                    {item.target} ·{" "}
                    {item.kind === "category"
                      ? "slug prefix"
                      : item.namespace === "GLOBAL"
                        ? "global field"
                        : "personal field"}
                    {item.sensitive ? " · sensitive" : ""}
                  </small>
                </span>
                <span className="flex gap-2">
                  <button
                    className={button}
                    disabled={
                      policy.targets.includes(item.target) ||
                      policy.targets.length >= 64
                    }
                    aria-label={`Allow target ${item.target} ${index}`}
                    onClick={() =>
                      change({
                        ...policy,
                        targets: [...policy.targets, item.target],
                      })
                    }
                  >
                    Add to scope
                  </button>
                  <button
                    className={button}
                    onClick={() => setScopeTarget(item.target)}
                  >
                    Use for default
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {more && (
            <p className="text-sm">
              Showing 32 matches. Refine your search to find more.
            </p>
          )}
          <p className="text-sm">
            A prefix such as work.* includes future matching fields. Categories
            are explicit slug prefixes, not a promise that every field has
            identical effective access. Existing custom targets are retained.
          </p>
          <h3 className="font-semibold">Scope default with exceptions</h3>
          <p className="text-sm">
            Set a value default at the selected target. More-specific exceptions
            and definition permissions are preserved.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label>
              Default target
              <input
                className="block max-w-full rounded border p-2"
                value={scopeTarget}
                maxLength={128}
                onChange={(event) => setScopeTarget(event.target.value)}
              />
            </label>
            <label>
              Scope value default
              <select
                className="block rounded border p-2"
                value={scopeLevel}
                onChange={(event) => setScopeLevel(event.target.value)}
              >
                {levels.map((level) => (
                  <option key={level}>{level}</option>
                ))}
              </select>
            </label>
            <button className={button} onClick={preset}>
              Add scope change
            </button>
          </div>
          <p className="text-sm">
            Reducing the maximum preserves ALLOW exceptions, even when inert.
            Expanding the maximum or allowing sensitive data can reactivate
            them.
          </p>
          <details>
            <summary className="cursor-pointer font-semibold">
              Advanced rules and custom targets ({rules.length} rules;{" "}
              {edits.length} drafted changes)
            </summary>
            <div className="mt-3 space-y-3">
              <label className="block">
                Custom maximum target
                <input
                  className="ml-2 rounded border p-2"
                  maxLength={128}
                  value={customTarget}
                  onChange={(event) => setCustomTarget(event.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={
                  !customTarget ||
                  policy.targets.includes(customTarget) ||
                  policy.targets.length >= 64
                }
                onClick={() => {
                  change({
                    ...policy,
                    targets: [...policy.targets, customTarget],
                  });
                  setCustomTarget("");
                }}
              >
                Add custom target
              </button>
              <ul>
                {rules.map((rule) => (
                  <li
                    key={rule.target + rule.action}
                    className="flex flex-wrap items-center gap-2 py-1"
                  >
                    <code className="break-all">
                      {rule.target} · {rule.action} · {rule.effect}
                    </code>
                    <button
                      className={button}
                      aria-label={`Inherit ${rule.target} ${rule.action}`}
                      onClick={() => setRule({ ...rule, effect: "REMOVE" })}
                    >
                      Remove rule / inherit
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <label>
                  Advanced target
                  <input
                    className="block rounded border p-2"
                    maxLength={128}
                    value={advancedTarget}
                    onChange={(event) => setAdvancedTarget(event.target.value)}
                  />
                </label>
                <label>
                  Advanced action
                  <select
                    className="block border p-2"
                    value={advancedAction}
                    onChange={(event) => setAdvancedAction(event.target.value)}
                  >
                    {["READ", "SUGGEST", "WRITE", "DEFINE"].map((action) => (
                      <option key={action}>{action}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Advanced effect
                  <select
                    className="block border p-2"
                    value={advancedEffect}
                    onChange={(event) => setAdvancedEffect(event.target.value)}
                  >
                    {["ALLOW", "DENY", "REMOVE"].map((effect) => (
                      <option key={effect}>{effect}</option>
                    ))}
                  </select>
                </label>
                <button
                  className={button}
                  onClick={() =>
                    setRule({
                      target: advancedTarget,
                      action: advancedAction,
                      effect: advancedEffect,
                    })
                  }
                >
                  Add rule change
                </button>
              </div>
              <p>
                Removing a rule inherits more general rules, or the maximum when
                none matches. It can widen access.
              </p>
            </div>
          </details>
        </fieldset>
      )}
      {preview && (
        <div
          className="space-y-2 rounded border bg-blue-50 p-4"
          role="region"
          aria-label="Resulting access preview"
        >
          <h3 className="font-semibold">Resulting access</h3>
          <p>Before</p>
          <Summary value={preview.before} />
          <p>After</p>
          <Summary value={preview.after} />
          {preview.widening.length ? (
            <>
              <h4 className="font-semibold">Access widening</h4>
              <ul className="list-disc pl-5">
                {preview.widening.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>No access widening found for this proposal.</p>
          )}
          <details>
            <summary>Illustrative changed fields (up to 32)</summary>
            <ul>
              {preview.examples.map((row, index) => (
                <li key={row.target + index}>
                  {row.name} ({row.target}):{" "}
                  {["read", "suggest", "write", "define"]
                    .filter((action) => row.before[action])
                    .join(", ") || "blocked"}{" "}
                  →{" "}
                  {["read", "suggest", "write", "define"]
                    .filter((action) => row.after[action])
                    .join(", ") || "blocked"}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          className={button}
          disabled={!valid || busy || saving || stale}
          onClick={() => void inspectDraft()}
        >
          Preview resulting access
        </button>
        <button
          className={`${button} bg-blue-700 text-white`}
          disabled={!preview || busy || saving || stale || !valid}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save permissions"}
        </button>
        <button className={button} disabled={saving} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}
