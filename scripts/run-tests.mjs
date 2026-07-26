#!/usr/bin/env node
/**
 * Run every simulator test suite and summarise.
 *
 * The suites are standalone tsx scripts rather than a framework's, and each one
 * already prints its own table and exits non-zero on failure. What was missing
 * was anything that ran them ALL: `package.json` had no test script, there is no
 * CI, and there are no git hooks — so ~3,300 assertions, including the two
 * guards written after real production bugs, protected nothing unless a human
 * remembered an undocumented command.
 *
 * Deliberately not a test framework. These suites hand-derive their expected
 * values from theory and print comparison tables a human reads when something
 * drifts; wrapping them in a runner that swallowed that output would lose the
 * part that makes them useful. So: run each, stream failures, tally the rest.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'lib', 'simulator', '__tests__')

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()

if (files.length === 0) {
  console.error(`No test files found in ${path.relative(ROOT, DIR)}`)
  process.exit(1)
}

/** "231/231 passed" → [231, 231]. Null when a suite printed no tally at all. */
function tally(output) {
  const m = [...output.matchAll(/(\d+)\/(\d+) passed/g)].pop()
  return m ? [Number(m[1]), Number(m[2])] : null
}

let passed = 0
let total = 0
const failed = []
const started = Date.now()

for (const file of files) {
  const full = path.join(DIR, file)
  const run = spawnSync('npx', ['tsx', full], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const counts = tally(output)

  // A suite can fail in two different ways and both must be caught: assertions
  // that did not hold (non-zero exit, tally present), and a crash before it ever
  // printed a tally — which an exit-code check alone would report as "0 of 0".
  const crashed = counts === null
  const ok = run.status === 0 && !crashed && counts[0] === counts[1]

  if (counts) {
    passed += counts[0]
    total += counts[1]
  }

  const label = crashed ? 'CRASHED' : `${counts[0]}/${counts[1]}`
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${file.padEnd(26)} ${label}`)

  if (!ok) {
    failed.push(file)
    // Only failing suites print in full — the passing tables are long, and the
    // point of running everything is to find the one that broke.
    console.log(output.split('\n').map((l) => `      ${l}`).join('\n'))
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  `\n${files.length} suites · ${passed}/${total} assertions · ${secs}s` +
    (failed.length ? `\nFAILED: ${failed.join(', ')}` : ''),
)
process.exit(failed.length > 0 ? 1 : 0)
