// Test doubles for the Edge Function dependencies. The database side is REAL: every rpc() runs the real SQL
// function in embedded PostgreSQL under the right API role, exactly as PostgREST would. Only the HTTP layer,
// Supabase Auth token verification and Storage are simulated.
import { newUuid } from './db.js';

const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`;

function wrapError(error) {
  return { message: error.message, details: error.detail ?? null, code: error.code };
}

async function callRpc(client, role, sub, fn, args = {}) {
  const names = Object.keys(args);
  const placeholders = names.map((name, index) => `${quoteIdent(name)} => $${index + 1}`).join(', ');
  // PostgREST receives JSON; the pg driver would turn JS arrays into Postgres array literals, so send JSON text.
  const values = names.map((name) => { const value = args[name]; return value !== null && typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value; });
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role, ...(sub ? { sub } : {}) })]);
    const meta = (await client.query("select proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1", [fn])).rows[0];
    let data;
    if (meta?.proretset) data = (await client.query(`select * from public.${fn}(${placeholders})`, values)).rows;
    else data = (await client.query(`select public.${fn}(${placeholders}) as data`, values)).rows[0].data;
    await client.query('commit');
    return { data, error: null };
  } catch (error) {
    await client.query('rollback');
    return { data: null, error: wrapError(error) };
  }
}

/** Tokens look like "test.<user uuid>.signature" so the fake auth can tell who the caller is. */
export const tokenFor = (userId) => `test.${userId}.signaturesignaturesignature`;

export function makeDeps(db, { env = {}, mailer = null } = {}) {
  const store = new Map();
  const storage = (bucket) => ({
    async upload(path, bytes) {
      const key = `${bucket}/${path}`;
      if (store.has(key)) return { error: { message: 'The resource already exists' } };
      store.set(key, bytes);
      // Mirror the object row the real Storage API creates, so database checks can see it.
      await db.main.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, path]);
      return { data: { path }, error: null };
    },
    async download(path) {
      const bytes = store.get(`${bucket}/${path}`);
      return bytes ? { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null } : { data: null, error: { message: 'not found' } };
    },
    async remove(paths) {
      paths.forEach((p) => store.delete(`${bucket}/${p}`));
      await db.main.query('delete from storage.objects where bucket_id = $1 and name = any($2)', [bucket, paths]);
      return { error: null };
    },
  });
  const environment = {
    TOKEN_SECRET: 'unit-test-token-secret-0123456789abcdef',
    ALLOWED_ORIGINS: 'https://oldverge-storefront.vercel.app',
    CRON_SECRET: 'unit-test-cron-secret-0123456789',
    ...env,
  };
  const userIdFromToken = (token) => /^test\.([0-9a-f-]{36})\./.exec(token || '')?.[1] ?? null;
  const base = {
    env: { get: (name) => (name in environment ? environment[name] : null) },
    mailer,
    store,
    admin: {
      rpc: (fn, args) => callRpc(db.main, 'service_role', null, fn, args),
      auth: {
        async getUser(token) {
          const id = userIdFromToken(token);
          return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } };
        },
      },
      storage: { from: storage },
    },
    userClient(token) {
      const sub = userIdFromToken(token);
      return {
        rpc: (fn, args) => callRpc(db.main, 'authenticated', sub, fn, args),
        from: (table) => ({
          select: () => ({
            eq: (column, value) => ({
              async maybeSingle() {
                await db.main.query('begin');
                try {
                  await db.main.query('set local role authenticated');
                  await db.main.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'authenticated', sub })]);
                  const { rows } = await db.main.query(`select * from public.${quoteIdent(table)} where ${quoteIdent(column)} = $1`, [value]);
                  await db.main.query('commit');
                  return { data: rows[0] ?? null, error: null };
                } catch (error) {
                  await db.main.query('rollback');
                  return { data: null, error: wrapError(error) };
                }
              },
            }),
          }),
        }),
      };
    },
  };
  return base;
}

export const jsonRequest = (url, body, { headers = {}, method = 'POST' } = {}) => new Request(url, {
  method,
  headers: { 'content-type': 'application/json', origin: 'https://oldverge-storefront.vercel.app', 'x-forwarded-for': headers['x-forwarded-for'] ?? `10.0.0.${Math.floor(Math.random() * 250) + 1}`, ...headers },
  body: method === 'POST' ? JSON.stringify(body) : undefined,
});

export const freshKey = () => `key-${newUuid().replaceAll('-', '')}`;
export const freshSecret = () => `secret-${newUuid().replaceAll('-', '')}${newUuid().replaceAll('-', '')}`;
