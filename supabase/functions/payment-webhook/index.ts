import { paymentWebhook } from '../_shared/handlers.js';
import { buildDeps } from '../_shared/deps.ts';

Deno.serve(paymentWebhook(buildDeps()));
