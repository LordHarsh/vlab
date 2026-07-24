# Build notes

## `npm run build` uses `--webpack`, deliberately

Next 16 defaults to Turbopack. We pass `--webpack` because Turbopack cannot
build this app: it dies while writing the Node-file-trace manifest for the
compile route.

```
FATAL: An unexpected Turbopack error occurred.
Error [TurbopackInternalError]: NftJsonAsset: cannot handle filepath node:crypto
```

**It is a Turbopack bug, not our code.** Isolated by running the same tree both
ways: `next build --webpack` compiles in 17.4 s and generates all 22 static
pages; `next build` (Turbopack) panics every time.

### What triggers it

`app/api/compile/route.ts` (the server-side AVR compiler) reaches
`lib/simulator/avr/build.ts`, which needs real Node builtins — `crypto` for the
content-hash cache key, `worker_threads` to run `cc1plus` off the event loop.
Turbopack walks that graph to emit the route's `.nft.json` and then fails to
serialise a builtin specifier as a file path.

Rewriting `node:crypto` → `crypto` does not help. The error simply becomes
`cannot handle filepath crypto`: Turbopack is treating the builtin as a file to
trace either way. Both `build.ts` and `build-worker.mjs` now use bare
specifiers, which is harmless and resolves identically at runtime, but it is
**not** the fix — `--webpack` is.

### Do not "fix" this by removing the imports

The route is correctly declared `runtime = 'nodejs'` and `dynamic =
'force-dynamic'`. It genuinely needs a worker thread (`mod.callMain()` is
synchronous WebAssembly — on the request thread it would block the whole server
until `cc1plus` returned) and it genuinely needs a hash for the compile cache.
Neither import is incidental.

### When to revisit

Try dropping `--webpack` after any Turbopack upgrade. If `next build` succeeds,
delete the flag and this file. Turbopack is faster and is where Next is going;
we are only stepping around a defect.

### Deployment prerequisite, unrelated to the above

`.cache/avr/` holds the ~23 MB WASM toolchain and is gitignored, so a clean
deploy has no compiler. Run `node scripts/build-avr-hex.mjs` once as part of the
build to fetch it. Without it the compile route returns a clear, actionable
error rather than a stack trace — but students cannot compile. **This is not yet
wired into any deploy step.**
