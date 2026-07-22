/**
 * Document/id regression tests.
 *
 * These exist because an independent review found the editor reporting more
 * wires than the canvas drew: newId() restarted at 0 each session and handed
 * back "w1", which EXPERIMENT_01 already used. React deduped the key, rendered
 * one of the pair, and the colliding id was autosaved anyway.
 *
 * Assertions here are about identity and structure only — the electrical side
 * is covered by solver.test.ts.
 *
 * Run: npx tsx lib/simulator/__tests__/document.test.ts
 */

import {
  adoptIds,
  docReducer,
  newId,
  resetIds,
  type CircuitDoc,
  type DocState,
} from '../model/document'
import { EXPERIMENT_01, EXAMPLES } from '../model/examples'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function idsOf(doc: CircuitDoc): string[] {
  return [...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)]
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const dupes = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id)
    seen.add(id)
  }
  return [...dupes]
}

function load(doc: CircuitDoc): DocState {
  return docReducer({ doc: { parts: [], wires: [] }, past: [], future: [] }, { type: 'load', doc })
}

// ── 1. The exact reported bug ────────────────────────────────────────────────
// Load the seeded experiment, draw a wire, and the new id must not collide.
{
  resetIds()
  let state = load(EXPERIMENT_01)
  const id = newId('w')
  check('1.1 new wire id does not collide with the authored document', !idsOf(state.doc).includes(id), `got ${id}`)

  state = docReducer(state, {
    type: 'addWire',
    wire: { id, from: { partId: 'uno', pinId: 'D2' }, to: { partId: 'bb', pinId: 'a1' }, color: '#000' },
  })
  check('1.2 wire was accepted', state.doc.wires.length === EXPERIMENT_01.wires.length + 1)
  check('1.3 no duplicate ids after the edit', duplicates(idsOf(state.doc)).length === 0, duplicates(idsOf(state.doc)).join(','))
}

// ── 2. It must survive a reload ──────────────────────────────────────────────
// A restored document still carries w1-w6 while a fresh module scope restarts
// the counter at 0 — this is what made the bug recur on every visit.
{
  resetIds() // simulates a fresh page load
  const restored: CircuitDoc = {
    parts: [...EXPERIMENT_01.parts],
    wires: [...EXPERIMENT_01.wires, { id: 'w7', from: { partId: 'uno', pinId: 'D2' }, to: { partId: 'bb', pinId: 'a1' }, color: '#000' }],
  }
  const state = load(restored)
  const id = newId('w')
  check('2.1 id clears the restored document too', !idsOf(state.doc).includes(id), `got ${id}`)
  check('2.2 id clears the highest existing suffix', id === 'w8', `got ${id}`)
}

// ── 3. Every authored example is internally consistent ───────────────────────
for (const [key, ex] of Object.entries(EXAMPLES)) {
  const dupes = duplicates(idsOf(ex.doc))
  check(`3.x EXAMPLES.${key} has no duplicate ids`, dupes.length === 0, dupes.join(','))

  const partIds = new Set(ex.doc.parts.map((p) => p.id))
  const dangling = ex.doc.wires.filter(
    (w) => !partIds.has(w.from.partId) || !partIds.has(w.to.partId),
  )
  check(`3.x EXAMPLES.${key} has no dangling wires`, dangling.length === 0, dangling.map((w) => w.id).join(','))
}

// ── 4. adoptIds is monotonic and idempotent ──────────────────────────────────
// React StrictMode invokes reducers twice in development; a non-idempotent
// implementation would skip ids or, worse, walk backwards.
{
  resetIds()
  adoptIds(EXPERIMENT_01)
  const first = newId('w')
  adoptIds(EXPERIMENT_01) // second invoke, same document
  const second = newId('w')
  check('4.1 counter never rewinds on a repeat adopt', second !== first, `${first} then ${second}`)

  resetIds()
  adoptIds({ parts: [], wires: [{ id: 'w99', from: { partId: 'a', pinId: '1' }, to: { partId: 'b', pinId: '1' }, color: '#000' }] })
  adoptIds({ parts: [], wires: [] }) // an emptier document must not lower it
  check('4.2 an empty document does not lower the counter', newId('w') === 'w100', 'counter regressed')
}

// ── 5. Ids that carry no trailing number are ignored, not crashed on ─────────
{
  resetIds()
  adoptIds({ parts: [{ id: 'uno', type: 'arduino_uno', x: 0, y: 0, rotation: 0, props: {} }], wires: [] })
  check('5.1 non-numeric ids are skipped', newId('w') === 'w1')
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`)
process.exit(failed ? 1 : 0)
