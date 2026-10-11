// Test-only resolver: maps the '@/' alias and swaps the database / next modules for in-memory stubs.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stubs = {
  'next/server': 'next-server.mjs',
  'next/cache': 'next-cache.mjs',
  '@/lib/links': 'links.mjs',
  '@/lib/api-key': 'api-key.mjs',
};
export async function resolve(specifier, context, next) {
  if (stubs[specifier]) return { url: pathToFileURL(path.join(root, 'tests/helpers/stubs', stubs[specifier])).href, shortCircuit: true };
  if (specifier.startsWith('@/')) return next(pathToFileURL(path.join(root, specifier.slice(2) + (specifier.endsWith('.js') ? '' : '.js'))).href, context);
  return next(specifier, context);
}
