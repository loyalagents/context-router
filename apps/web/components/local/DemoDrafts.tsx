'use client';

import { createContext, useContext, useEffect, useRef } from 'react';

export type DraftState = { active: boolean; pending: boolean };
export const DemoDraftContext = createContext<((id: symbol, state: DraftState) => void) | null>(null);

/** Presentation guard only. Lock and authentication expiry always clear private UI. */
export function useDemoDraft(active: boolean, pending = false) {
  const register = useContext(DemoDraftContext);
  const id = useRef(Symbol('demo draft'));
  useEffect(() => {
    const key = id.current;
    register?.(key, { active, pending });
    return () => register?.(key, { active: false, pending: false });
  }, [register, active, pending]);
}
