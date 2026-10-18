// The admin data layer. Every read and write goes through the Supabase client as the signed-in user, so row-level security
// and the admin_* functions re-check admin membership on every call. This layer never decides who is an admin. It only
// turns failures into AdminError (a readable sentence plus flags) and tells the app when access may have been lost.
import { AdminError } from './errors.js';

const asAdminError = (error) => (error instanceof AdminError ? error : new AdminError(error));

/**
 * client: the Supabase client. callFunction: the Edge Function caller from src/lib/api.js.
 * onProblem(error): called when a failure means the user may no longer be an admin or signed in.
 */
export function createGateway({ client, callFunction, onProblem }) {
  const guard = async (work) => {
    try {
      return await work();
    } catch (raw) {
      const error = asAdminError(raw);
      if ((error.forbidden || error.recheck) && onProblem) onProblem(error);
      throw error;
    }
  };
  const unwrap = async (pending) => {
    const { data, error } = await pending;
    if (error) throw new AdminError(error);
    return data;
  };
  return {
    client,
    /** Calls a database function. Resolves with its result or throws AdminError. */
    rpc: (name, args) => guard(() => unwrap(client.rpc(name, args))),
    /** build(client) returns a query or storage call that resolves { data, error }. Resolves with data or throws AdminError. */
    query: (build) => guard(() => unwrap(build(client))),
    /** Calls an Edge Function. Resolves with the parsed body or throws AdminError. */
    fn: (name, body, options) => guard(async () => {
      const result = await callFunction(name, body, options);
      if (!result.ok) throw new AdminError({ status: result.status, ...(result.data && typeof result.data === 'object' ? result.data : {}) });
      return result.data;
    }),
  };
}
