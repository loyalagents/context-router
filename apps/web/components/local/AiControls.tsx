'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocalSession } from './LocalSession';

export function useAiOperation(operation: 'analysis' | 'formFill' | 'search') {
  const session = useLocalSession();
  const [seconds, setSeconds] = useState(180);
  const [pending, setPending] = useState(false);
  const current = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      current.current?.abort();
      current.current = null;
    },
    [],
  );
  const supported =
    !session ||
    (operation === 'search'
      ? session.capabilities.operations.search
      : session.capabilities.operations[operation].mimeTypes.length > 0);
  const available =
    supported &&
    (!session || session.capabilities.status.state === 'available');
  const begin = () => {
    if (current.current || !available)
      throw new Error('AI is not ready. Check model status.');
    const controller = new AbortController();
    current.current = controller;
    setPending(true);
    const headers: Record<string, string> = session?.capabilities.capabilities
      .strictExecutionControls
      ? { 'x-context-router-timeout-ms': String(seconds * 1000) }
      : {};
    return {
      controller,
      signal: session
        ? AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(seconds * 1000),
          ])
        : controller.signal,
      headers,
    };
  };
  const isCurrent = (controller: AbortController) =>
    current.current === controller && !controller.signal.aborted;
  const finish = (controller: AbortController) => {
    if (current.current !== controller) return;
    current.current = null;
    setPending(false);
  };
  const cancel = () => {
    const active = current.current;
    active?.abort();
    current.current = null;
    setPending(false);
  };
  return {
    session,
    seconds,
    setSeconds,
    pending,
    supported,
    available,
    begin,
    isCurrent,
    finish,
    cancel,
  };
}

export function AiControls({
  operation,
  onCancel,
}: {
  operation: ReturnType<typeof useAiOperation>;
  onCancel?: () => void;
}) {
  const [error, setError] = useState('');
  if (!operation.session) return null;
  const { capabilities } = operation.session;
  const { status, runtime } = capabilities;
  const installed = runtime?.launcher === 'native';
  const needsSetup = !status.configured;
  const unavailable = status.configured && status.state === 'unavailable';
  return (
    <div className="space-y-2 text-sm my-3">
      <p role="status">
        AI: {capabilities.status.state} (last checked).{' '}
        {!operation.supported &&
          'This operation is not supported by the selected runtime. '}
        You can still view and edit saved preferences and use literal search
        without AI.
      </p>
      {needsSetup && (
        <p>
          AI is not enabled for this session.{' '}
          {installed ? (
            runtime.mode === 'demo' ? (
              <>To set up AI, choose CR → Return to personal mode… in the Mac menu
                bar. Use CR → Download Qwen3.5 9B model… there if needed. After
                download, choose CR → Enter demo mode… to use it in demo.
                Switching modes interrupts dashboard
                and MCP connections; open the current dashboard and unlock again.</>
            ) : (
              <>If you have not downloaded the model, choose CR → Download
                Qwen3.5 9B model… in the Mac menu bar. After the download finishes,
                or if you already downloaded it, choose CR → Restart local runtime…
                to enable AI.</>
            )
          ) : runtime?.launcher === 'terminal' ? (
            <>Start the terminal launcher with a qualified model configuration;
              follow docs/useful/LOCAL_UI.md and docs/useful/LOCAL_MODEL.md.</>
          ) : (
            <>Follow the model setup instructions for your launcher.</>
          )}
        </p>
      )}
      {status.state === 'busy' && (
        <p>AI was busy when last checked. Wait for the current operation to finish,
          then choose Check model status.</p>
      )}
      {status.state === 'unsupported' && (
        <p>This runtime does not support AI readiness checks.</p>
      )}
      {unavailable && (
        <p>
          The status does not identify why AI is unavailable.{' '}
          {installed ? (
            <>If the CR menu says AI is loading, wait for loading to finish, then
              choose Check model status. If the menu says a restart is required,
              or AI stays unavailable, choose CR → Restart local runtime….</>
          ) : runtime?.launcher === 'terminal' ? (
            <>Check model setup. If recovery is needed, stop both the backend and
              inference processes and wait for their exits, then create a fresh
              model session with new credentials as described in
              docs/useful/LOCAL_MODEL.md.</>
          ) : (
            <>Check your launcher for startup progress or recovery instructions.</>
          )}
        </p>
      )}
      {installed && (unavailable || (needsSetup && runtime.mode !== 'demo')) && (
        <p>
          Restart interrupts dashboard and MCP connections and signs out browser
          sessions. When ready, use CR → Open dashboard and CR → New unlock code…
          to unlock again. An older tab may have an outdated address.
        </p>
      )}
      <p>Check model status checks readiness only; it does not download or start a
        model, restart the runtime or retry your work.</p>
      <button
        type="button"
        disabled={operation.pending}
        className="underline"
        onClick={async () => {
          setError('');
          try {
            await operation.session?.refresh();
          } catch {
            setError('Model status could not be checked.');
          }
        }}
      >
        Check model status
      </button>
      {capabilities.capabilities.strictExecutionControls && (
        <label className="block">
          Operation deadline{' '}
          <select
            aria-label="Operation deadline"
            value={operation.seconds}
            disabled={operation.pending}
            onChange={(e) => operation.setSeconds(Number(e.target.value))}
            className="border rounded ml-2"
          >
            <option value={5}>5 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={180}>3 minutes</option>
          </select>
        </label>
      )}
      {operation.pending && (
        <button
          type="button"
          className="underline text-red-700"
          onClick={() => {
            operation.cancel();
            onCancel?.();
          }}
        >
          Cancel operation
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
