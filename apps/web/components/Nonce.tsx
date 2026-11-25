'use client';

import { createContext, useContext } from 'react';

const NonceContext = createContext<string | undefined>(undefined);

/** Hands the page's CSP nonce (set by proxy.ts, read in the layout) to client components. */
export function NonceProvider({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  return <NonceContext.Provider value={nonce}>{children}</NonceContext.Provider>;
}

export const useNonce = () => useContext(NonceContext);
