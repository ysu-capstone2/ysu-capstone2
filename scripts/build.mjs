import { cp, mkdir, rm } from 'node:fs/promises';
import { publicAssets } from '../config/site-assets.js';
const output = new URL('../public/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of publicAssets) await cp(new URL('../'+file, import.meta.url), new URL(file, output));
console.log(`Built ${publicAssets.length} public assets. Administrator HTML is served only after server authorization.`);
