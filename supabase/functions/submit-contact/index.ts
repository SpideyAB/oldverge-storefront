import { submitContact } from '../_shared/handlers.js';
import { buildDeps } from '../_shared/deps.ts';

Deno.serve(submitContact(buildDeps()));
