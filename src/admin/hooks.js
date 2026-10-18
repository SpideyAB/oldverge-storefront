import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/** { gateway, role, email, signOut } for every page below the access check. */
export const AdminContext = createContext(null);
export const useAdmin = () => {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside the admin shell');
  return value;
};

/**
 * Loads data when the component mounts and whenever `deps` change. Previous data stays visible while a reload runs.
 * Returns { data, error, loading, reload }. Failures are kept (never replaced by empty data).
 */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  useEffect(() => { loaderRef.current = loader; });
  useEffect(() => {
    let live = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    Promise.resolve()
      .then(() => loaderRef.current())
      .then((data) => { if (live) setState({ loading: false, data, error: null }); },
        (error) => { if (live) setState({ loading: false, data: null, error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload };
}

/** A message area for results: { notice: {kind:'ok'|'error', text}|null, ok, fail, clear }. */
export function useNotice() {
  const [notice, setNotice] = useState(null);
  const ok = useCallback((text) => setNotice({ kind: 'ok', text }), []);
  const fail = useCallback((error) => setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) }), []);
  const clear = useCallback(() => setNotice(null), []);
  return useMemo(() => ({ notice, ok, fail, clear }), [notice, ok, fail, clear]);
}

/**
 * Runs one write at a time and reports the outcome in the page notice.
 * run(work, success) resolves { ok, result } or { ok: false, error } and never throws.
 */
export function useAction(notice) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (work, success) => {
    setBusy(true);
    notice.clear();
    try {
      const result = await work();
      if (success) notice.ok(typeof success === 'function' ? success(result) : success);
      return { ok: true, result };
    } catch (error) {
      notice.fail(error);
      return { ok: false, error };
    } finally {
      setBusy(false);
    }
  }, [notice]);
  return { busy, run };
}
