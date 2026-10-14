"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { localJson } from "@/lib/authenticated-fetch";
import { localClientId, usableClientName } from "@/lib/local-client-name";

type Names = { names: Record<string, string>; request: (id: string) => void };
const Context = createContext<Names | null>(null);

/** A cache owned by this authenticated page; never shared across sessions. */
export function ClientNamesProvider({ children }: { children: ReactNode }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const state = useRef({
    wanted: new Set<string>(),
    requested: new Set<string>(),
    epoch: 0,
    controllers: new Set<AbortController>(),
    queued: false,
    mounted: false,
  });
  const flush = useCallback(() => {
    const s = state.current;
    if (s.queued) return;
    s.queued = true;
    // All rows registering in one render contribute to the same bounded batches.
    queueMicrotask(() => {
      s.queued = false;
      if (!s.mounted) return;
      const ids = [...s.wanted].filter((id) => !s.requested.has(id));
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100),
          epoch = s.epoch;
        batch.forEach((id) => s.requested.add(id));
        const controller = new AbortController();
        s.controllers.add(controller);
        void localJson<{ items: { id: string; label: string }[] }>(
          "/api/local/mcp/labels",
          { ids: batch },
          controller.signal,
        )
          .then((data) => {
            if (controller.signal.aborted || epoch !== s.epoch || !s.mounted)
              return;
            const labels: Record<string, string> = {};
            for (const item of data.items)
              if (batch.includes(item.id) && usableClientName(item.label))
                labels[item.id] = item.label;
            setNames((previous) => ({ ...previous, ...labels }));
          })
          .catch(() => {
            if (!controller.signal.aborted && epoch === s.epoch && s.mounted)
              setFailed(true);
          })
          .finally(() => s.controllers.delete(controller));
      }
    });
  }, []);
  const request = useCallback(
    (id: string) => {
      state.current.wanted.add(id);
      flush();
    },
    [flush],
  );
  const invalidate = useCallback(() => {
    const s = state.current;
    s.epoch++;
    s.controllers.forEach((controller) => controller.abort());
    s.controllers.clear();
    s.requested.clear();
    setNames({});
    setFailed(false);
    flush();
  }, [flush]);
  useEffect(() => {
    const s = state.current;
    s.mounted = true;
    flush();
    const channel = new BroadcastChannel("context-router.mcp-management.v1");
    channel.onmessage = invalidate;
    window.addEventListener("focus", invalidate);
    window.addEventListener("pageshow", invalidate);
    window.addEventListener("context-router.client-names", invalidate);
    return () => {
      s.mounted = false;
      s.epoch++;
      s.controllers.forEach((controller) => controller.abort());
      s.wanted.clear();
      s.requested.clear();
      channel.close();
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("pageshow", invalidate);
      window.removeEventListener("context-router.client-names", invalidate);
    };
  }, [flush, invalidate]);
  return (
    <Context.Provider value={{ names, request }}>
      {failed && (
        <p role="status" className="px-10 pt-4">
          Client names unavailable; instance IDs remain visible.{" "}
          <button className="underline" onClick={invalidate}>
            Retry client names
          </button>
        </p>
      )}
      {children}
    </Context.Provider>
  );
}

/** Plain text is safe inside expandable row buttons; the complete key stays accessible. */
export function ClientName({
  clientKey,
  label,
  fullId = false,
}: {
  clientKey: string;
  label?: string;
  fullId?: boolean;
}) {
  const context = useContext(Context),
    id = localClientId(clientKey);
  const request = context?.request;
  useEffect(() => {
    if (id && request && label === undefined) request(id);
  }, [id, request, label]);
  const name = label === undefined ? id && context?.names[id] : label;
  if (!id || !usableClientName(name))
    return <span className="[overflow-wrap:anywhere]">{clientKey}</span>;
  return (
    <span title={clientKey} className="[overflow-wrap:anywhere]">
      <span>{name}</span> <code aria-hidden="true">· {id.slice(-8)}</code>
      <span className={fullId ? "block text-xs font-normal" : "sr-only"}>
        {" "}
        (instance {clientKey})
      </span>
    </span>
  );
}
