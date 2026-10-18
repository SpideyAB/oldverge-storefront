// Starts one embedded PostgreSQL (real Postgres, not a mock), builds a template database from the
// shim + every migration, and shares the connection details with the test files.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../migrations');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  server.on('error', reject);
});

export async function setup(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldverge-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false,
    postgresFlags: ['-c', 'max_connections=60', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'],
    onLog: () => {}, onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('template_oldverge');

  const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'template_oldverge' });
  await client.connect();
  await client.query(fs.readFileSync(path.join(here, 'shim.sql'), 'utf8'));
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    } catch (error) {
      await client.end();
      await server.stop();
      throw new Error(`Migration ${file} failed: ${error.message}${error.where ? `\n${error.where}` : ''}`, { cause: error });
    }
  }
  await client.end();

  project.provide('pgPort', port);
  project.provide('migrationFiles', files);
  return async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
