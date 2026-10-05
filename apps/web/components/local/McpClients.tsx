'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localJson } from '@/lib/authenticated-fetch';

type Client = {
  id: string;
  label: string;
  generation: number;
  revoked: boolean;
  policy: {
    capabilities: string[];
    targets: string[];
    allowSensitive: boolean;
  };
};
type Grant = { id: string; target: string; action: string; effect: string };
type Snapshot = {
  status: 'AVAILABLE' | 'AUTHORITY_UNAVAILABLE';
  client: Client;
  revision?: string;
  grants?: Grant[];
  effective?: {
    target: string;
    knownDefinition: boolean;
    sensitive: boolean;
    read: boolean;
    suggest: boolean;
    write: boolean;
    define: boolean;
  }[];
};
const button = 'rounded border px-3 py-2 disabled:opacity-50';

export default function McpClients() {
  const [items, setItems] = useState<Client[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [next, setNext] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [targets, setTargets] = useState('profile.first_name');
  const [target, setTarget] = useState('*');
  const [action, setAction] = useState('READ');
  const [effect, setEffect] = useState('DENY');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [readError, setReadError] = useState('');
  const [generation, setGeneration] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const invalidate = useCallback(() => {
    revision.current++;
    pending.current?.abort();
    setSnapshot(null);
    setItems([]);
    setNext(null);
    // A background refresh cannot cancel an already submitted authority change.
    // Its settlement owns the next reload and the confirmed/uncertain outcome.
    if (mutation.current) return;
    setBusy(false);
    setGeneration((value) => value + 1);
  }, []);
  useEffect(() => {
    const listener = () => invalidate();
    const epoch = revision;
    channel.current = new BroadcastChannel('context-router.mcp-management.v1');
    channel.current.onmessage = listener;
    window.addEventListener('focus', listener);
    window.addEventListener('pageshow', listener);
    return () => {
      epoch.current++;
      pending.current?.abort();
      mutation.current?.abort();
      mutation.current = null;
      channel.current?.close();
      channel.current = null;
      window.removeEventListener('focus', listener);
      window.removeEventListener('pageshow', listener);
    };
  }, [invalidate]);
  useEffect(() => {
    if (mutation.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++revision.current;
    setBusy(true);
    setItems([]);
    setSnapshot(null);
    setReadError('');
    void localJson<{ items: Client[]; nextCursor: string | null }>(
      '/api/local/mcp/list',
      cursor ? { after: cursor } : {},
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted || current !== revision.current) return;
        setItems(data.items);
        setNext(data.nextCursor);
      })
      .catch(() => {
        if (!controller.signal.aborted && current === revision.current)
          setReadError('Unable to load client instances. Reload to continue.');
      })
      .finally(() => {
        if (!controller.signal.aborted && current === revision.current)
          setBusy(false);
      });
    return () => controller.abort();
  }, [cursor, generation]);
  async function inspect(id = selected) {
    if (mutation.current) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = ++revision.current;
    setSelected(id);
    setSnapshot(null);
    setReadError('');
    setBusy(true);
    try {
      const exactTargets = [
        ...new Set(targets.split(/[\s,]+/).filter(Boolean)),
      ];
      if (
        exactTargets.length > 32 ||
        exactTargets.some((value) => value.includes('*'))
      )
        throw new Error();
      const data = await localJson<Snapshot>(
        '/api/local/mcp/inspect',
        { id, targets: exactTargets },
        controller.signal,
      );
      if (current === revision.current && !controller.signal.aborted)
        setSnapshot(data);
    } catch {
      if (current === revision.current && !controller.signal.aborted)
        setReadError(
          'Authority could not be inspected. Use up to 32 exact slugs and reload before editing.',
        );
    } finally {
      if (current === revision.current && !controller.signal.aborted)
        setBusy(false);
    }
  }
  async function change(
    kind: 'grant' | 'revoke',
    grant?: { target: string; action: string; effect: string },
  ) {
    if (!snapshot || busy || mutation.current) return;
    if (
      kind === 'revoke' &&
      !window.confirm(
        `Revoke ${snapshot.client.label} (${snapshot.client.id})? Its token will stop working. Issuing a replacement requires the CLI.`,
      )
    )
      return;
    const captured = snapshot;
    revision.current++;
    pending.current?.abort();
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setSnapshot(null);
    setMessage('');
    setReadError('');
    try {
      const result = await localJson<{ changed?: boolean; reason?: string }>(
        `/api/local/mcp/${kind}`,
        {
          id: captured.client.id,
          generation: captured.client.generation,
          ...(kind === 'grant'
            ? { revision: captured.revision, ...grant }
            : {}),
        },
        controller.signal,
      );
      if (mutation.current === controller && !controller.signal.aborted)
        setMessage(
          result.reason === 'OUTSIDE_MAXIMUM'
            ? 'ALLOW was not saved: it provides no authority under this instance’s current CLI maximum.'
            : kind === 'revoke'
              ? 'Client instance revoked. Reload to inspect current authority.'
              : 'Grant saved. Reload to inspect current authority.',
        );
    } catch {
      if (mutation.current === controller && !controller.signal.aborted)
        setMessage(
          'Change was not confirmed. Authority may have changed. Reload and inspect before deciding whether to submit again.',
        );
    } finally {
      if (mutation.current === controller && !controller.signal.aborted) {
        mutation.current = null;
        channel.current?.postMessage('invalidate');
        invalidate();
      }
    }
  }
  return (
    <div className="space-y-6">
      <p>
        Each row is a separately issued client instance. Matching product labels
        do not share identity. Issue, rotate, or change maximum policy with the
        local MCP CLI.
      </p>
      <p>
        Database grants narrow the CLI maximum. ALLOW can override a less
        specific database DENY, but cannot expand that maximum. Write also
        requires read and suggest access.
      </p>
      {message && <p role="status">{message}</p>}
      {readError && <p role="alert">{readError}</p>}
      <div className="flex gap-3">
        <button className={button} disabled={busy} onClick={invalidate}>
          Reload clients
        </button>
        {cursor && (
          <button
            className={button}
            disabled={busy}
            onClick={() => { if (!mutation.current) setCursor(undefined); }}
          >
            First page
          </button>
        )}
        {next && (
          <button
            className={button}
            disabled={busy}
            onClick={() => { if (!mutation.current) setCursor(next); }}
          >
            Next page
          </button>
        )}
      </div>
      {busy && <p role="status">Loading current authority…</p>}
      {!busy && !items.length && <p>No client instances on this page.</p>}
      <ul className="space-y-3">
        {items.map((client) => (
          <li key={client.id} className="rounded border p-4">
            <div className="font-semibold">
              {client.label} {client.revoked && '(revoked)'}
            </div>
            <code className="break-all">{client.id}</code>
            <p>Generation {client.generation}</p>
            <button
              className={button}
              disabled={busy}
              onClick={() => void inspect(client.id)}
              aria-label={`Inspect ${client.id}`}
            >
              Inspect authority
            </button>
          </li>
        ))}
      </ul>
      <label className="block">
        Exact slugs to inspect (up to 32, separated by commas)
        <input
          className="block border rounded p-2 w-full"
          value={targets}
          maxLength={4128}
          onChange={(event) => setTargets(event.target.value)}
        />
      </label>
      {selected && (
        <button
          className={button}
          disabled={busy}
          onClick={() => void inspect()}
        >
          Inspect selected instance
        </button>
      )}
      {snapshot && (
        <section
          className="space-y-4 border-t pt-4"
          aria-label="Selected client authority"
        >
          <h2 className="text-xl font-semibold">{snapshot.client.label}</h2>
          <code>{snapshot.client.id}</code>
          <h3 className="font-semibold">CLI maximum policy</h3>
          <p>
            Capabilities:{' '}
            {snapshot.client.policy.capabilities.join(', ') || 'none'}. Targets:{' '}
            {snapshot.client.policy.targets.join(', ') || 'none'}. Sensitive
            values:{' '}
            {snapshot.client.policy.allowSensitive
              ? 'allowed by maximum'
              : 'blocked by maximum'}
            .
          </p>
          {snapshot.client.revoked && <p>Revoked: no effective access.</p>}
          {snapshot.status === 'AUTHORITY_UNAVAILABLE' ? (
            <p role="alert">
              Authority unavailable: the complete grant snapshot could not be
              safely inspected. Grant edits are disabled. Use the CLI to inspect
              or reduce grants; revocation remains available.
            </p>
          ) : (
            <>
              <h3 className="font-semibold">
                Effective access for requested slugs
              </h3>
              <p>
                This is a snapshot of current rules and definition sensitivity.
                Archived values receive an additional definition check during
                actual MCP requests; operations also require valid data and
                scope.
              </p>
              <table className="w-full text-left">
                <caption className="sr-only">Effective MCP authority</caption>
                <thead>
                  <tr>
                    {['Slug', 'Read', 'Suggest', 'Write', 'Define'].map(
                      (heading) => (
                        <th key={heading} scope="col">
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.effective?.map((row) => (
                    <tr key={row.target}>
                      <th scope="row" className="font-normal">
                        {row.target}
                        {!row.knownDefinition && ' (no active definition)'}
                        {row.sensitive && ' (sensitive)'}
                      </th>
                      {(['read', 'suggest', 'write', 'define'] as const).map(
                        (key) => (
                          <td key={key}>{row[key] ? 'Allowed' : 'Denied'}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="font-semibold">Database grants</h3>
              {!snapshot.grants?.length && (
                <p>No database grants; maximum policy applies.</p>
              )}
              <ul>
                {snapshot.grants?.map((grant) => (
                  <li key={grant.id} className="flex items-center gap-3 py-1">
                    <span>
                      {grant.target} · {grant.action} · {grant.effect}
                    </span>
                    <button
                      className={button}
                      disabled={busy || snapshot.client.revoked}
                      onClick={() =>
                        void change('grant', {
                          target: grant.target,
                          action: grant.action,
                          effect: 'REMOVE',
                        })
                      }
                    >
                      Remove grant
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex flex-wrap gap-3 items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  void change('grant', { target, action, effect });
                }}
              >
                <label>
                  Target
                  <input
                    required
                    maxLength={128}
                    className="block border rounded p-2"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  />
                </label>
                <label>
                  Action
                  <select
                    aria-label="Action"
                    className="block border p-2"
                    value={action}
                    onChange={(event) => setAction(event.target.value)}
                  >
                    {['READ', 'SUGGEST', 'WRITE', 'DEFINE'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Effect
                  <select
                    aria-label="Effect"
                    className="block border p-2"
                    value={effect}
                    onChange={(event) => setEffect(event.target.value)}
                  >
                    {['DENY', 'ALLOW'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <button
                  className={button}
                  disabled={busy || snapshot.client.revoked}
                >
                  Save grant
                </button>
              </form>
            </>
          )}
          <button
            className={`${button} text-red-700`}
            disabled={busy || snapshot.client.revoked}
            onClick={() => void change('revoke')}
          >
            Revoke this instance
          </button>
        </section>
      )}
    </div>
  );
}
