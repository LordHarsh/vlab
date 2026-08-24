// Bare specifiers, NOT the `node:` prefix. Turbopack's Node-file-trace pass
// walks this module (it is reachable from app/api/compile/route.ts) and cannot
// resolve a `node:`-prefixed builtin when it writes the .nft.json, which fails
// `next build` outright with:
//   FATAL: NftJsonAsset: cannot handle filepath node:crypto
// The bare form resolves to the same builtins at runtime. Note the sibling
// build-worker.mjs and scripts/build-avr-hex.mjs may keep `node:` — they are
// spawned as workers/CLI and never enter the bundle graph.
import { createHash } from 'crypto'
import path from 'path'
import { Worker } from 'worker_threads'
import { prepareSketch, parseDiagnostics, hasError, type Diagnostic } from './ino'
import type { BoardType } from '../model/parts'

/**
 * Compiling a student's sketch, server-side, with a stranger's input in mind.
 *
 * This module owns the three things that stop a compiler being a liability:
 * a HARD TIME LIMIT (the worker is terminated, not asked nicely), a
 * CONCURRENCY CAP (cc1plus peaks at ~41 MB of linear memory, so an unbounded
 * fan-out is an out-of-memory waiting to happen), and a CACHE keyed on the
 * exact bytes compiled, so a class of forty students pressing Run on the same
 * unmodified starter sketch costs one compile.
 *
 * It deliberately does NOT own authentication. That belongs to the route, which
 * has the request; putting it here would make this untestable from a script.
 */

/** Boards this can build. The Pico track has no compile step at all. */
export type CompileBoard = Extract<BoardType, 'arduino_uno' | 'arduino_mega'>

export function isCompileBoard(v: unknown): v is CompileBoard {
  return v === 'arduino_uno' || v === 'arduino_mega'
}

/**
 * 64 KB of source.
 *
 * The largest sketch this repository ships is under 1 KB, and the largest
 * plausible student program with comments is a few KB. 64 KB is roomy enough
 * that nobody will meet it by writing code and small enough that it cannot be
 * used to make the compiler chew on megabytes.
 */
export const MAX_SOURCE_BYTES = 64 * 1024

/**
 * 20 seconds.
 *
 * A cold Uno build measures ~0.35 s and a Mega — which recompiles the whole
 * Arduino core for avr6 — ~3.6 s on this machine. 20 s is therefore roughly 5×
 * the slowest legitimate build, which leaves room for a loaded server without
 * leaving room for a sketch that is trying to hang one.
 */
export const COMPILE_TIMEOUT_MS = 20_000

/** cc1plus peaks near 41 MB; four at once is ~164 MB, which is a sane ceiling. */
const MAX_CONCURRENT = 4

/** Compiles kept in memory. Each entry is a few KB of ASCII HEX. */
const CACHE_LIMIT = 64

export interface CompileSuccess {
  ok: true
  hex: string
  flashBytes: number
  flashLimit: number
  sha256: string
  /** Warnings only — an error would have made this a failure. */
  diagnostics: Diagnostic[]
  /** Milliseconds inside the toolchain. 0 when served from cache. */
  ms: number
  cached: boolean
  /** The prototypes prepareSketch() injected, so the UI can be honest about it. */
  prototypes: string[]
}

export interface CompileFailure {
  ok: false
  stage: 'compile' | 'assemble' | 'link' | 'objcopy' | 'size' | 'toolchain' | 'internal' | 'timeout'
  diagnostics: Diagnostic[]
  /** Raw compiler output, kept verbatim for the log pane. */
  raw: string[]
  ms: number
  cached: boolean
}

export type CompileResult = CompileSuccess | CompileFailure

/**
 * Warnings caused by OUR injection, not by the student's code.
 *
 * Hoisting `void beep(int n = 3)` into a prototype reproduces its default
 * argument, and repeating a default in a declaration and a definition draws
 * `default argument given for parameter 1 of 'void beep(int)' [-fpermissive]`.
 * Under `-fpermissive` that is a warning rather than an error, so the sketch
 * builds and runs — but the warning points at a line the student never wrote
 * and cannot see, and cannot be acted on. Showing it would be a small version
 * of exactly the failure docs/AVR_COMPILE_FINDINGS.md names as the risk of doing
 * this transformation at all: confusing messages about the student's own valid
 * code.
 *
 * Errors are NEVER filtered — only this one warning class, and only because we
 * generated the line it is about.
 */
const INJECTED_ARTIFACT = /default argument given for parameter/

/* ── cache ───────────────────────────────────────────────────────────────── */

const cache = new Map<string, CompileResult>()

/**
 * THE BOARD IS PART OF THE KEY, and it is not a detail.
 *
 * Keyed on the source alone, the same sketch would hit the cache across boards
 * and hand an ATmega328P image to a Mega. That does not error: it runs, and
 * moves whichever pads the 328P's register addresses happen to name on an
 * ATmega2560 — the silent-wrong-answer failure the firmware selector is
 * filtered by board specifically to prevent, reintroduced behind its back.
 * lib/simulator/__tests__/sketchbuild.test.ts group E asserts the miss.
 *
 * A space separates the two safely because the board names are a closed
 * two-value set and neither contains whitespace.
 */
function cacheKey(source: string, board: CompileBoard): string {
  return createHash('sha256').update(`${board} ${source}`).digest('hex')
}

/**
 * Insertion-ordered eviction, which for this workload is the right one.
 *
 * A Map preserves insertion order, so deleting the first key drops the oldest
 * entry. True LRU would need a re-insert on every hit; the access pattern here
 * is "a cohort compiles the same handful of sketches", where the difference
 * does not pay for the bookkeeping.
 */
function remember(key: string, value: CompileResult) {
  cache.set(key, value)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/* ── concurrency ─────────────────────────────────────────────────────────── */

let active = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  active += 1
}

function release() {
  active -= 1
  const next = waiting.shift()
  if (next) next()
}

/* ── the worker ──────────────────────────────────────────────────────────── */

interface WorkerResult {
  ok: boolean
  hex?: string
  flashBytes?: number
  flashLimit?: number
  sha256?: string
  stage?: CompileFailure['stage']
  diagnostics?: string[]
  ms?: number
}

/**
 * Where the worker and the toolchain live at run time.
 *
 * Both are resolved from `process.cwd()` rather than imported, and that is
 * load-bearing twice over: the toolchain is a 23 MB gitignored download that no
 * bundler should ever try to trace, and the worker must arrive as a file Node
 * can execute rather than as a module something has rewritten. A static
 * `new Worker(new URL('./build-worker.mjs', import.meta.url))` would invite
 * exactly that rewriting.
 */
function workerPath(): string {
  return path.join(process.cwd(), 'lib', 'simulator', 'avr', 'build-worker.mjs')
}

function cacheDir(): string {
  return path.join(process.cwd(), '.cache', 'avr')
}

function runWorker(cpp: string, board: CompileBoard): Promise<WorkerResult> {
  return new Promise((resolve) => {
    let settled = false
    const worker = new Worker(workerPath(), {
      workerData: { cpp, board, cacheDir: cacheDir() },
    })

    const finish = (result: WorkerResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // terminate() on an already-exited worker is a no-op, so this is safe on
      // every path and guarantees no thread outlives its result.
      void worker.terminate()
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        stage: 'timeout',
        diagnostics: [
          `compile timed out after ${COMPILE_TIMEOUT_MS / 1000} s and was stopped`,
        ],
        ms: COMPILE_TIMEOUT_MS,
      })
    }, COMPILE_TIMEOUT_MS)

    worker.on('message', (m: WorkerResult) => finish(m))
    worker.on('error', (e) =>
      finish({ ok: false, stage: 'internal', diagnostics: [String(e?.message ?? e)], ms: 0 }),
    )
    worker.on('exit', (code) => {
      // Only meaningful if it beat the message, which means it died.
      if (code !== 0) {
        finish({
          ok: false,
          stage: 'internal',
          diagnostics: [`compiler worker exited with code ${code}`],
          ms: 0,
        })
      }
    })
  })
}

/* ── the entry point ─────────────────────────────────────────────────────── */

/**
 * Compile one sketch.
 *
 * `source` is the student's `.ino` EXACTLY as they typed it — the `#include
 * <Arduino.h>`, the hoisted prototypes and the `#line` bookkeeping are added
 * here so that every diagnostic that comes back names a line the student can
 * actually see in their editor.
 *
 * Failure is a RESULT, not an exception. A student writing bad C++ is the
 * normal case on a teaching platform, and modelling it as a thrown error would
 * push every caller toward a generic "compilation failed" — which is precisely
 * the message that teaches nobody anything.
 */
export async function compileSketch(
  source: string,
  board: CompileBoard,
): Promise<CompileResult> {
  const key = cacheKey(source, board)
  const hit = cache.get(key)
  if (hit) return { ...hit, cached: true }

  const { cpp, prototypes } = prepareSketch(source)

  await acquire()
  let raw: WorkerResult
  try {
    raw = await runWorker(cpp, board)
  } finally {
    release()
  }

  const rawLines = raw.diagnostics ?? []
  const diagnostics = parseDiagnostics(rawLines)

  if (raw.ok && raw.hex) {
    const result: CompileSuccess = {
      ok: true,
      hex: raw.hex,
      flashBytes: raw.flashBytes ?? 0,
      flashLimit: raw.flashLimit ?? 0,
      sha256: raw.sha256 ?? '',
      diagnostics: diagnostics.filter(
        (d) => d.severity !== 'error' && !INJECTED_ARTIFACT.test(d.message),
      ),
      ms: raw.ms ?? 0,
      cached: false,
      prototypes,
    }
    remember(key, result)
    return result
  }

  const stage = raw.stage ?? 'internal'
  const result: CompileFailure = {
    ok: false,
    stage,
    /**
     * A failing stage that produced no parseable diagnostic still has to say
     * something. The linker's "undefined reference to `attachInterrupt'" parses
     * as nothing (it names an object file, not `file:line: error:`), and a
     * student who saw an empty error list would reasonably conclude the tool
     * was broken rather than their code.
     */
    diagnostics: hasError(diagnostics)
      ? diagnostics
      : [...diagnostics, ...fallbackDiagnostic(stage, rawLines)],
    raw: rawLines,
    ms: raw.ms ?? 0,
    cached: false,
  }
  // A deterministic failure is worth caching too: a student who presses Run
  // twice on the same broken sketch should not pay for it twice. `internal` and
  // `timeout` are excluded — those may be transient and must be retryable.
  if (stage !== 'internal' && stage !== 'timeout' && stage !== 'toolchain') {
    remember(key, result)
  }
  return result
}

/**
 * Something honest to show when the toolchain failed without saying where.
 *
 * Each of these is a real failure mode with a real cause, named in the terms
 * the student can act on rather than in the toolchain's.
 */
function fallbackDiagnostic(stage: CompileFailure['stage'], rawLines: string[]): Diagnostic[] {
  const undefinedRef = rawLines
    .map((l) => /undefined reference to [`'"]([^`'"]+)/.exec(l)?.[1])
    .find(Boolean)

  const message =
    stage === 'link' && undefinedRef
      ? `'${undefinedRef}' could not be found when linking. Either it is misspelled, or it is part of the Arduino core this simulator does not provide yet (attachInterrupt is the known example).`
      : stage === 'link'
        ? 'The sketch compiled but could not be linked. Something it refers to does not exist.'
        : stage === 'toolchain'
          ? 'The compiler is not installed on the server. Run `node scripts/build-avr-hex.mjs --board uno --sketch scripts/sketches/blink-fast.cpp --out /tmp/x.hex` once to download it.'
          : stage === 'timeout'
            ? `Compiling took longer than ${COMPILE_TIMEOUT_MS / 1000} seconds and was stopped.`
            : stage === 'size'
              ? (rawLines[0] ?? 'The compiled sketch is too big for this board.')
              : (rawLines[0] ?? 'The compiler failed without saying why.')

  return [{ line: null, column: null, severity: 'error', message, raw: message }]
}

/** Test seam: how many entries the cache is holding. */
export function cacheSize(): number {
  return cache.size
}
