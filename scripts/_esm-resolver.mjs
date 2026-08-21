// Node ESM loader hook: append `.js` to extensionless relative imports so
// standalone scripts can import lib/ modules that use Next-style extensionless
// specifiers (e.g. `import x from '../contactPhone'`).
//   node --loader ./scripts/_esm-resolver.mjs scripts/<name>.mjs
export async function resolve(spec, ctx, next) {
  try {
    return await next(spec, ctx);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && !/\.[a-z]+$/.test(spec) && (spec.startsWith('./') || spec.startsWith('../'))) {
      return next(spec + '.js', ctx);
    }
    throw e;
  }
}
