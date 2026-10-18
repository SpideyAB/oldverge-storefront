import { adminUploadImage } from '../_shared/images.js';
import { buildDeps } from '../_shared/deps.ts';

Deno.serve(adminUploadImage(buildDeps()));
