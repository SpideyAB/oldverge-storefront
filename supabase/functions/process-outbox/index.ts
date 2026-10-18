import { processOutbox } from '../_shared/handlers.js';
import { buildDeps } from '../_shared/deps.ts';

Deno.serve(processOutbox(buildDeps()));
