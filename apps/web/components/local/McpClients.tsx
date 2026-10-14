'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { localJson, LocalRequestError } from '@/lib/authenticated-fetch';
import { ClientName } from './ClientNames';
import { usableClientName } from '@/lib/local-client-name';

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
type ChangeOutcome = {
  client: { id: string; label: string };
  kind: 'grant' | 'revoke' | 'rename';
  newName?: string;
  grant?: Omit<Grant, 'id'>;
  status: 'confirmed' | 'rejected' | 'uncertain';
  message: string;
};
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
  const [outcome, setOutcome] = useState<ChangeOutcome | null>(null);
  const outcomePanel = useRef<HTMLDivElement | null>(null);
  const handledOutcome = useRef<ChangeOutcome | null>(null);
  const pendingOutcomeFocus = useRef<{ interacted: boolean } | null>(null);
  const [readError, setReadError] = useState('');
  const [renameDraft, setRenameDraft] = useState<{ client: Client; name: string; needsRead: boolean; currentName?: string } | null>(null);
  const [renameError, setRenameError] = useState('');
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const cancelledRename = useRef<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    if (renameDraft || !cancelledRename.current) return;
    // The form has unmounted and the captured instance's button is enabled again.
    renameButtons.current.get(cancelledRename.current)?.focus();
    cancelledRename.current = null;
  }, [renameDraft]);
  useEffect(() => {
    const interaction = (event: Event) => {
      if (
        event.type === 'focusin' &&
        (event.target === document.body || event.target === document.documentElement)
      ) return;
      if (pendingOutcomeFocus.current)
        pendingOutcomeFocus.current.interacted = true;
    };
    const events = ['focusin', 'pointerdown', 'keydown', 'input'];
    events.forEach((event) => document.addEventListener(event, interaction, true));
    return () => {
      events.forEach((event) => document.removeEventListener(event, interaction, true));
      pendingOutcomeFocus.current = null;
    };
  }, []);
  useEffect(() => {
    // Wait for the list to settle so its rows cannot push the result offscreen.
    // Later reads must not steal focus back to an already presented outcome.
    if (!outcome || busy || handledOutcome.current === outcome) return;
    handledOutcome.current = outcome;
    const interacted = pendingOutcomeFocus.current?.interacted;
    pendingOutcomeFocus.current = null;
    // Preserve activity since submission, including typing without moving focus.
    // An untouched input may retain focus when Safari clicks a submit button.
    if (interacted) return;
    outcomePanel.current?.focus({ preventScroll: true });
    outcomePanel.current?.scrollIntoView({ block: 'nearest' });
  }, [outcome, busy]);
  const invalidate = useCallback(() => {
    revision.current++;
    pending.current?.abort();
    setSnapshot(null);
    setItems([]);
    setNext(null);
    // A background refresh cannot cancel an already submitted authority change.
    // Its settlement owns the next reload and the confirmed/uncertain outcome.
    if (mutation.current) return;
    // Stay busy until the replacement list settles, before outcome focus/scroll.
    setBusy(true);
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
    const attempted = {
      client: { id: captured.client.id, label: captured.client.label },
      kind,
      grant,
    };
    // The initiating pointer/key event has already run; track only later activity.
    pendingOutcomeFocus.current = { interacted: false };
    revision.current++;
    pending.current?.abort();
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true);
    setSnapshot(null);
    setOutcome(null);
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
        setOutcome({
          ...attempted,
          status: result.reason === 'OUTSIDE_MAXIMUM' ? 'rejected' : 'confirmed',
          message: result.reason === 'OUTSIDE_MAXIMUM'
            ? 'ALLOW was not saved: it provides no authority under this instance’s current CLI maximum. Reload and inspect before editing again.'
            : kind === 'revoke'
              ? 'Client instance revoked. Reload to inspect current authority.'
              : grant?.effect === 'REMOVE'
                ? 'Grant removed. Reload to inspect current authority.'
                : 'Grant saved. Reload to inspect current authority.',
        });
    } catch {
      if (mutation.current === controller && !controller.signal.aborted)
        setOutcome({
          ...attempted,
          status: 'uncertain',
          message: 'Change was not confirmed. Authority may have changed. Reload and inspect before deciding whether to submit again.',
        });
    } finally {
      if (mutation.current === controller && !controller.signal.aborted) {
        mutation.current = null;
        channel.current?.postMessage('invalidate');
        invalidate();
      }
    }
  }
  async function readCurrentName() {
    if (!renameDraft || busy || mutation.current) return;
    const captured = renameDraft;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const current = ++revision.current;
    setBusy(true); setRenameError('');
    try {
      const data = await localJson<Snapshot>('/api/local/mcp/inspect', {id: captured.client.id}, controller.signal);
      if (!controller.signal.aborted && current === revision.current)
        setRenameDraft(latest => latest?.client.id === captured.client.id
          ? {...latest,client:data.client,needsRead:false,currentName:data.client.label}
          : latest);
    } catch {
      if (!controller.signal.aborted && current === revision.current) setRenameError('Unable to read the current name. Try the read again before saving.');
    } finally {
      if (!controller.signal.aborted && current === revision.current) setBusy(false);
    }
  }
  async function rename() {
    if (!renameDraft || busy || mutation.current || renameDraft.needsRead) return;
    if (!usableClientName(renameDraft.name)) {setRenameError('Enter a name of 1–64 characters without control characters.');return;}
    const captured = renameDraft;
    const attempted = {client:{id:captured.client.id,label:captured.client.label},kind:'rename' as const,newName:captured.name.trim()};
    pendingOutcomeFocus.current = {interacted:false};
    revision.current++; pending.current?.abort();
    const controller = new AbortController(); mutation.current = controller;
    setBusy(true); setSnapshot(null); setOutcome(null); setRenameError('');
    try {
      await localJson('/api/local/mcp/rename', {id:captured.client.id,label:captured.name,expectedLabel:captured.client.label,generation:captured.client.generation},controller.signal);
      if (mutation.current === controller && !controller.signal.aborted) {
        setRenameDraft(null);
        setOutcome({...attempted,status:'confirmed',message:'Client name saved. Existing tokens and permissions continue unchanged.'});
        window.dispatchEvent(new Event('context-router.client-names'));
      }
    } catch (error) {
      if (mutation.current === controller && !controller.signal.aborted) {
        setRenameDraft({...captured,needsRead:true});
        setOutcome({...attempted,status:error instanceof LocalRequestError && error.status === 409 ? 'rejected' : 'uncertain',
          message:error instanceof LocalRequestError && error.status === 409
            ? 'Name was not saved because the instance changed. Read its current name before deciding whether to save again.'
            : 'Change was not confirmed. The name may have been saved. Read its current name before deciding whether to submit again.'});
      }
    } finally {
      if (mutation.current === controller && !controller.signal.aborted) {
        mutation.current = null; channel.current?.postMessage('invalidate'); invalidate();
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
      {renameDraft && <form className="space-y-3 rounded border p-4" aria-label="Rename client" onSubmit={event=>{event.preventDefault();void rename();}}>
        <p>Rename <ClientName clientKey={`local:${renameDraft.client.id}`} label={renameDraft.client.label} /></p>
        <p className="text-xs break-all">Instance ID: <code>{renameDraft.client.id}</code></p>
        <label className="block">Client name
          <input autoFocus required maxLength={64} className="block rounded border p-2 w-full" value={renameDraft.name} disabled={!!mutation.current}
            onChange={event=>setRenameDraft({...renameDraft,name:event.target.value})} />
        </label>
        {renameError && <p role="alert">{renameError}</p>}
        {renameDraft.currentName !== undefined && <p role="status">Current name: {renameDraft.currentName}</p>}
        {renameDraft.needsRead && <p>A new read is required before saving again. It shows the present name, not whether an earlier unconfirmed request committed.</p>}
        <div className="flex gap-3">
          <button className={button} disabled={busy || renameDraft.needsRead}>Save name</button>
          <button type="button" className={button} disabled={busy} onClick={()=>void readCurrentName()}>Read current name</button>
          <button type="button" className={button} disabled={busy} onClick={()=>{cancelledRename.current=renameDraft.client.id;setRenameDraft(null);setRenameError('');}}>Cancel rename</button>
        </div>
      </form>}
      <ul className="space-y-3">
        {items.map((client) => (
          <li key={client.id} className="rounded border p-4">
            <div className="font-semibold">
              <ClientName clientKey={`local:${client.id}`} label={client.label} /> {client.revoked && '(revoked)'}
            </div>
            <code className="break-all">{client.id}</code>
            <p>Generation {client.generation}</p>
            <button ref={element=>{if(element)renameButtons.current.set(client.id,element);else renameButtons.current.delete(client.id);}} className={button} disabled={busy || !!renameDraft} aria-label={`Rename ${client.id}`} onClick={()=>{setRenameDraft({client,name:client.label,needsRead:false});setRenameError('');}}>Rename</button>
            {' '}<a className={button} href={`/dashboard/history#mcp-client=${client.id}`} aria-label={`View activity ${client.id}`}>View activity</a>{' '}

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
      {outcome && (
        <div
          ref={outcomePanel}
          role={outcome.status === 'confirmed' ? 'status' : 'alert'}
          aria-atomic="true"
          aria-labelledby="mcp-change-title"
          aria-describedby="mcp-change-context mcp-change-message"
          tabIndex={-1}
          className={`space-y-2 rounded border-2 p-4 [overflow-wrap:anywhere] focus:outline focus:outline-2 focus:outline-offset-2 ${
            outcome.status === 'rejected'
              ? 'border-red-700 bg-red-50 text-red-950'
              : outcome.status === 'uncertain'
                ? 'border-amber-700 bg-amber-50 text-amber-950'
                : 'border-green-700 bg-green-50 text-green-950'
          }`}
        >
          <h2 id="mcp-change-title" className="text-lg font-semibold">
            {outcome.status === 'rejected'
              ? outcome.kind === 'rename' ? 'Name not saved' : 'Grant not saved'
              : outcome.status === 'uncertain'
                ? 'Change not confirmed'
                : outcome.kind === 'rename' ? 'Client name saved'
                : outcome.kind === 'revoke'
                  ? 'Client instance revoked'
                  : outcome.grant?.effect === 'REMOVE'
                    ? 'Grant removed'
                    : 'Grant saved'}
          </h2>
          <div id="mcp-change-context">
            <p>Client: <strong><ClientName clientKey={`local:${outcome.client.id}`} label={outcome.client.label} /></strong></p>
            <p>Instance ID: <code>{outcome.client.id}</code></p>
            {outcome.grant ? (
              <p>
                Attempted grant: <code>{outcome.grant.target}</code>
                {' · '}{outcome.grant.action}{' · '}{outcome.grant.effect}
              </p>
            ) : outcome.kind === 'rename' ? (
              <p>Attempted name: <strong>{outcome.newName}</strong></p>
            ) : (
              <p>Attempted action: Revoke this instance</p>
            )}
          </div>
          <p id="mcp-change-message">{outcome.message}</p>
        </div>
      )}
      {snapshot && (
        <section
          className="space-y-4 border-t pt-4"
          aria-label="Selected client authority"
        >
          <h2 className="text-xl font-semibold"><ClientName clientKey={`local:${snapshot.client.id}`} label={snapshot.client.label} /></h2>
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
