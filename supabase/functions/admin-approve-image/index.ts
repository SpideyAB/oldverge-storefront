import { adminApproveImage } from '../_shared/images.js';
import { buildDeps } from '../_shared/deps.ts';

Deno.serve(adminApproveImage(buildDeps()));
