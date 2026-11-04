// Serves dist/ under /preview/ so relative URLs are exercised the way an IPFS gateway subpath
// exercises them. Usage: node scripts/preview.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.argv[2] ?? 4173);
const prefix = '/preview/';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Starts the preview server and resolves once it is listening.
 * @param {number} listenPort
 */
export function startPreview(listenPort) {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (!path.startsWith(prefix)) {
      response.writeHead(302, { Location: prefix }).end();
      return;
    }
    const relative = path.slice(prefix.length) || 'index.html';
    const file = normalize(join(root, relative));
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(listenPort, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startPreview(port);
  console.log(`Preview at http://127.0.0.1:${port}${prefix}`);
}
