import { useEffect } from 'react';
import { isBackend } from '../lib/config.js';
import { useCatalog } from '../data/catalog.js';
import { useSite } from '../data/site.js';
import { useStore } from '../store.js';
import { useAuth } from '../lib/auth.js';

/** Starts loading the store content once and re-checks the bag against the catalogue when it arrives (backend mode). */
export function useBackendBootstrap() {
  useEffect(() => {
    if (!isBackend) return;
    useAuth.getState().init();
    useSite.getState().load();
    useCatalog.getState().load().then(() => {
      if (useCatalog.getState().status === 'ready') useStore.getState().reconcileCart();
    });
  }, []);
}

/**
 * Wraps pages that need the catalogue and store settings. In demo mode it renders its children straight away.
 * In backend mode it shows a loading state, or an honest error with a retry: it never shows sample data instead.
 */
export default function BackendGate({ children }) {
  const catalog = useCatalog((state) => state.status);
  const site = useSite((state) => state.status);
  if (!isBackend) return children;
  if (catalog === 'error' || site === 'error') {
    return <main id="main-content" className="ov-backend-state" role="alert">
      <h1>We could not load the store.</h1>
      <p>Something went wrong while loading the collection. Nothing has been lost. Please check your connection and try again.</p>
      <button type="button" className="ov-button ov-button-dark" onClick={() => {
        useSite.getState().load({ force: true });
        useCatalog.getState().load({ force: true }).then(() => useStore.getState().reconcileCart());
      }}>Try again</button>
    </main>;
  }
  if (catalog !== 'ready' || site !== 'ready') {
    return <main id="main-content" className="ov-backend-state" aria-busy="true"><p role="status">Loading the collection…</p></main>;
  }
  return children;
}
