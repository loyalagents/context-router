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
  const refresh = () => {
    void session?.refresh().catch(() => {});
  };
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
    refresh();
  };
  const cancel = () => {
    const active = current.current;
    active?.abort();
    current.current = null;
    setPending(false);
    if (active) refresh();
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
  return (
    <div className="space-y-2 text-sm my-3">
      <p role="status">
        AI: {capabilities.status.state}.{' '}
        {!operation.supported &&
          'This operation is not supported by the selected runtime. '}
        {!capabilities.status.configured &&
          'Start the launcher with a qualified model configuration to enable AI. '}
        Manual editing and literal search remain available.
      </p>
      {capabilities.status.configured &&
        capabilities.status.state === 'unavailable' && (
          <p>
            Check model setup. A cancelled model may require the documented
            stop, idle verification and manual session reset before reuse.
          </p>
        )}
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
