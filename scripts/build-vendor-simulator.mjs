#!/usr/bin/env node
/**
 * Build the vendored colleague simulator (vendor/simulator) into public/vendor-sim.
 *
 * NOT public/sim — that directory already holds this app's own compiled AVR
 * firmware (blink.hex, dht11.hex, pot.hex, traffic-mega.hex), which the
 * firmware picker in CircuitEditor.tsx loads by URL. An earlier draft of this
 * script pointed OUT at public/sim and would have deleted all four on its
 * first successful run.
 *
 * THE POINT OF THIS SCRIPT IS THAT vendor/simulator IS NEVER MODIFIED.
 *
 * It is an upstream snapshot of https://github.com/Shivam-s07/simulator at
 * commit 1a1eb78, and the brief was to integrate it as-is so their work keeps
 * working and stays re-syncable. So the two adaptations that mounting it under
 * a sub-path unavoidably requires are applied to a THROWAWAY COPY in a temp
 * directory, and the vendored tree stays byte-identical to upstream. Re-syncing
 * is then a fresh export over the top, with no merge.
 *
 * Both adaptations are deployment concerns, not behaviour:
 *
 *  1. `--base=/sim/` so the emitted asset URLs resolve under the sub-path.
 *     A build flag; touches no source.
 *
 *  2. `<BrowserRouter>` → `<BrowserRouter basename="/sim">`. This one edits a
 *     single line of App.tsx in the copy, and it is not optional: BrowserRouter
 *     reads `window.location.pathname`, so served from /sim/ it would look for a
 *     route literally called "/sim/simulator/3", match none of `/`, `/dashboard`
 *     or `/simulator/:id`, and render an empty page. The alternative that needs
 *     no edit at all is hosting it on its own origin or subdomain, where the
 *     pathname really is "/" — worth doing if this is ever more than an embed.
 *
 * Their .env is deliberately NOT vendored: it is committed to their public
 * repository and carries a live Supabase URL and anon key. Supply the two
 * VITE_ variables from this app's own environment instead. supabaseClient.ts
 * THROWS at module load if they are missing, so a build without them produces a
 * bundle that dies on first paint — hence the explicit check below rather than
 * letting it fail confusingly at runtime.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'vendor', 'simulator')
const OUT = path.join(ROOT, 'public', 'vendor-sim')
const BASE = '/vendor-sim/'

const log = (m) => console.log(`[vendor-sim] ${m}`)

if (!fs.existsSync(path.join(SRC, 'package.json'))) {
  console.error(`[vendor-sim] no vendored simulator at ${path.relative(ROOT, SRC)}`)
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) {
  console.error(
    '[vendor-sim] refusing to build without Supabase env.\n' +
      '  supabaseClient.ts throws at module load when VITE_SUPABASE_URL or\n' +
      '  VITE_SUPABASE_ANON_KEY is absent, so the bundle would fail on first\n' +
      '  paint rather than here. Set VITE_SUPABASE_* (or NEXT_PUBLIC_SUPABASE_*,\n' +
      '  which this script forwards) and re-run.',
  )
  process.exit(1)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-sim-'))
log(`copying upstream snapshot to ${work}`)
fs.cpSync(SRC, work, { recursive: true })

// ── Adaptation 2: the router basename. Asserted, not assumed — if upstream
// changes how the router is mounted, this must fail loudly rather than silently
// produce a blank page.
const appPath = path.join(work, 'src', 'App.tsx')
const app = fs.readFileSync(appPath, 'utf8')
if (!app.includes('<BrowserRouter>')) {
  console.error(
    '[vendor-sim] could not find `<BrowserRouter>` in src/App.tsx.\n' +
      '  Upstream changed how the router is mounted. Do NOT skip this patch —\n' +
      '  without a basename the app renders nothing when served from /sim/.',
  )
  process.exit(1)
}
fs.writeFileSync(appPath, app.replace('<BrowserRouter>', `<BrowserRouter basename="${BASE.replace(/\/$/, '')}">`))
log('patched BrowserRouter basename (in the copy only)')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: work,
    stdio: 'inherit',
    // shell on Windows: npm is npm.cmd there, which CreateProcess cannot spawn
    // directly — execFileSync fails with ENOENT/EINVAL before running anything.
    shell: process.platform === 'win32',
    env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anon },
  })

log('installing upstream dependencies')
run(npm, ['ci', '--no-audit', '--no-fund'])

log(`building with base=${BASE}`)
// `vite build` directly rather than `npm run build`: their script is
// `tsc -b && vite build`, and their TypeScript version is not ours. Typechecking
// their code is their repository's job, not this build's.
run(npm, ['exec', '--', 'vite', 'build', `--base=${BASE}`])

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.cpSync(path.join(work, 'dist'), OUT, { recursive: true })
fs.rmSync(work, { recursive: true, force: true })

const bytes = fs
  .readdirSync(OUT, { recursive: true })
  .map((f) => path.join(OUT, String(f)))
  .filter((f) => fs.statSync(f).isFile())
  .reduce((n, f) => n + fs.statSync(f).size, 0)

log(`done — ${path.relative(ROOT, OUT)} (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
