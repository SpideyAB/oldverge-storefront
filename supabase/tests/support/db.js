import pg from 'pg';
import { inject } from 'vitest';
import crypto from 'node:crypto';

const baseConfig = () => ({ host: '127.0.0.1', port: inject('pgPort'), user: 'postgres', password: 'postgres' });

let counter = 0;

/** Creates an isolated copy of the migrated template database for one test file. */
export async function createTestDatabase() {
  const name = `t_${process.pid}_${Date.now()}_${counter += 1}`;
  const admin = new pg.Client({ ...baseConfig(), database: 'postgres' });
  await admin.connect();
  await admin.query(`create database ${name} template template_oldverge`);
  await admin.end();
  const clients = [];
  const connect = async () => {
    const client = new pg.Client({ ...baseConfig(), database: name });
    await client.connect();
    clients.push(client);
    return client;
  };
  const main = await connect();
  return {
    name,
    main,
    connect,
    async close() {
      await Promise.allSettled(clients.map((client) => client.end()));
      const cleaner = new pg.Client({ ...baseConfig(), database: 'postgres' });
      await cleaner.connect();
      await cleaner.query(`drop database if exists ${name} with (force)`);
      await cleaner.end();
    },
  };
}

/**
 * Runs fn(client) inside a transaction as an API role with JWT claims, the way PostgREST does
 * (SET LOCAL ROLE + request.jwt.claims). Commits on success, rolls back on error.
 */
export async function runAs(client, { role, sub, claims = {} }, fn) {
  await client.query('begin');
  try {
    await client.query(`set local role ${role}`);
    const payload = { role, ...(sub ? { sub } : {}), ...claims };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(payload)]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

export const asAnon = (client, fn) => runAs(client, { role: 'anon' }, fn);
export const asUser = (client, sub, fn, claims) => runAs(client, { role: 'authenticated', sub, claims }, fn);
export const asService = (client, fn) => runAs(client, { role: 'service_role' }, fn);

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest();
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const newUuid = () => crypto.randomUUID();

/** Extracts the "ov_error:<code>" a function raised, or the raw message for anything else. */
export function errorCode(error) {
  const match = /ov_error:([a-z_0-9]+)/.exec(error?.message || '');
  return match ? match[1] : error?.message;
}

export async function expectOvError(promise, code) {
  try {
    await promise;
  } catch (error) {
    if (errorCode(error) !== code) throw new Error(`expected ov_error:${code}, got: ${error.message}`, { cause: error });
    return error;
  }
  throw new Error(`expected ov_error:${code}, but the call succeeded`);
}

export async function expectDenied(promise) {
  try {
    await promise;
  } catch (error) {
    if (!/permission denied|violates row-level security|ov_error:(forbidden|owner_only)|must be owner|does not exist/i.test(error.message)) {
      throw new Error(`expected a permission failure, got: ${error.message}`, { cause: error });
    }
    return error;
  }
  throw new Error('expected a permission failure, but the call succeeded');
}
