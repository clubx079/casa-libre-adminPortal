// Node ESM loader for running server-side lib/ code as a standalone CLI:
//   node --loader ./scripts/_run-loader.mjs scripts/<name>.mjs
// 1. Neutralizes the `server-only` / `client-only` import guards (empty module).
// 2. Redirects `next/headers` to a CLI shim (see _shim-next-headers.mjs).
// 3. Appends `.js` to extensionless relative imports (Next-style specifiers).
const NEXT_HEADERS = new URL('./_shim-next-headers.mjs', import.meta.url).href;
const EMPTY = 'data:text/javascript,export%20%7B%7D'; // "export {}"

export async function resolve(spec, ctx, next) {
  if (spec === 'server-only' || spec === 'client-only') return { url: EMPTY, shortCircuit: true };
  if (spec === 'next/headers') return { url: NEXT_HEADERS, shortCircuit: true };
  try {
    return await next(spec, ctx);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && !/\.[a-z]+$/.test(spec) && (spec.startsWith('./') || spec.startsWith('../'))) {
      return next(spec + '.js', ctx);
    }
    throw e;
  }
}
