// The site ships as browser-native ES modules, so the production export is an exact copy
// of src/. There is no transpile step, and the build needs no installed dependencies.
import { cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src');
const target = join(root, 'dist');

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log('Built dist/ from src/');
