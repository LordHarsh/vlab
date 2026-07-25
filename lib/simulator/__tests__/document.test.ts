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
  type DocWire,
} from '../model/document'
import { compile } from '../model/compile'
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

// ── 6. Wire waypoints ────────────────────────────────────────────────────────
// Waypoints are cosmetic bends. Two things must hold forever: a document
// written before they existed must keep loading and drawing as the direct
// route it always was, and no bend may ever reach the netlist.
{
  const wireOf = (s: DocState, id: string): DocWire =>
    s.doc.wires.find((w) => w.id === id) as DocWire

  // 6a. Backward compatibility — the authored documents carry no waypoints.
  {
    resetIds()
    const state = load(structuredClone(EXPERIMENT_01))
    const w1 = wireOf(state, 'w1')
    check('6.1 a wire with no waypoints still loads', w1 !== undefined)
    check('6.2 load does not invent a waypoints field', !('waypoints' in w1))
    check('6.3 the loaded wire is otherwise unchanged',
      JSON.stringify(state.doc.wires) === JSON.stringify(EXPERIMENT_01.wires))
  }

  // 6b. add / move / remove produce the expected array.
  {
    resetIds()
    let s = load(structuredClone(EXPERIMENT_01))

    s = docReducer(s, { type: 'addWaypoint', id: 'w1', index: 0, point: { x: 120, y: 200 } })
    check('6.4 addWaypoint creates the array',
      JSON.stringify(wireOf(s, 'w1').waypoints) === '[{"x":120,"y":200}]',
      JSON.stringify(wireOf(s, 'w1').waypoints))
    check('6.5 other wires are untouched', wireOf(s, 'w2').waypoints === undefined)

    // Index is the grabbed segment, so it is also the slot: segment 1 sits
    // between the first waypoint and the far pin.
    s = docReducer(s, { type: 'addWaypoint', id: 'w1', index: 1, point: { x: 160, y: 220 } })
    s = docReducer(s, { type: 'addWaypoint', id: 'w1', index: 0, point: { x: 90, y: 180 } })
    check('6.6 addWaypoint inserts at the given slot',
      JSON.stringify(wireOf(s, 'w1').waypoints) ===
        '[{"x":90,"y":180},{"x":120,"y":200},{"x":160,"y":220}]',
      JSON.stringify(wireOf(s, 'w1').waypoints))

    s = docReducer(s, { type: 'moveWaypoint', id: 'w1', index: 1, x: 300, y: 400 })
    check('6.7 moveWaypoint moves only its own point',
      JSON.stringify(wireOf(s, 'w1').waypoints) ===
        '[{"x":90,"y":180},{"x":300,"y":400},{"x":160,"y":220}]',
      JSON.stringify(wireOf(s, 'w1').waypoints))

    s = docReducer(s, { type: 'removeWaypoint', id: 'w1', index: 1 })
    check('6.8 removeWaypoint drops the right one',
      JSON.stringify(wireOf(s, 'w1').waypoints) === '[{"x":90,"y":180},{"x":160,"y":220}]',
      JSON.stringify(wireOf(s, 'w1').waypoints))

    s = docReducer(s, { type: 'removeWaypoint', id: 'w1', index: 0 })
    s = docReducer(s, { type: 'removeWaypoint', id: 'w1', index: 0 })
    check('6.9 the last removal leaves no empty array behind',
      !('waypoints' in wireOf(s, 'w1')),
      JSON.stringify(wireOf(s, 'w1')))
    check('6.10 and the wire is byte-identical to the authored one',
      JSON.stringify(wireOf(s, 'w1')) === JSON.stringify(EXPERIMENT_01.wires[0]),
      JSON.stringify(wireOf(s, 'w1')))
  }

  // 6c. Edits that cannot apply must not churn state — an unchanged doc is
  // what stops docReducer pushing a pointless undo entry.
  {
    resetIds()
    const s = load(structuredClone(EXPERIMENT_01))
    check('6.11 moveWaypoint on a wire with none is a no-op',
      docReducer(s, { type: 'moveWaypoint', id: 'w1', index: 0, x: 1, y: 1 }) === s)
    check('6.12 addWaypoint on an unknown wire is a no-op',
      docReducer(s, { type: 'addWaypoint', id: 'nope', index: 0, point: { x: 1, y: 1 } }) === s)
    check('6.13 removeWaypoint out of range is a no-op',
      docReducer(s, { type: 'removeWaypoint', id: 'w1', index: 3 }) === s)
  }

  // 6d. Undo. A drag streams an action per pointermove; only the first of them
  // records history, so one press must undo the whole gesture.
  {
    resetIds()
    let s = load(structuredClone(EXPERIMENT_01))
    const depth = s.past.length

    s = docReducer(s, { type: 'addWaypoint', id: 'w1', index: 0, point: { x: 100, y: 100 } })
    check('6.14 addWaypoint records history', s.past.length === depth + 1)

    s = docReducer(s, { type: 'moveWaypoint', id: 'w1', index: 0, x: 110, y: 110 })
    check('6.15 the first move of a drag records history', s.past.length === depth + 2)
    const afterFirst = s.past.length

    s = docReducer(s, { type: 'moveWaypoint', id: 'w1', index: 0, x: 120, y: 120, transient: true })
    s = docReducer(s, { type: 'moveWaypoint', id: 'w1', index: 0, x: 130, y: 130, transient: true })
    check('6.16 the rest of the drag does not', s.past.length === afterFirst, `${s.past.length}`)
    check('6.17 but the document did follow the pointer',
      JSON.stringify(wireOf(s, 'w1').waypoints) === '[{"x":130,"y":130}]')

    s = docReducer(s, { type: 'undo' })
    check('6.18 undo restores the position from before the drag',
      JSON.stringify(wireOf(s, 'w1').waypoints) === '[{"x":100,"y":100}]',
      JSON.stringify(wireOf(s, 'w1').waypoints))

    s = docReducer(s, { type: 'undo' })
    check('6.19 a second undo removes the bend entirely', !('waypoints' in wireOf(s, 'w1')))

    s = docReducer(s, { type: 'redo' })
    check('6.20 redo puts it back',
      JSON.stringify(wireOf(s, 'w1').waypoints) === '[{"x":100,"y":100}]')

    // A move that never leaves its grid cell changes nothing, so it must not
    // consume an undo entry either.
    const before = s.past.length
    s = docReducer(s, { type: 'moveWaypoint', id: 'w1', index: 0, x: 100, y: 100 })
    check('6.21 a move to the same spot records nothing', s.past.length === before)
  }

  // 6e. Ids and persistence still behave with waypoints in the document.
  {
    resetIds()
    const bent: CircuitDoc = {
      parts: structuredClone(EXPERIMENT_01.parts),
      wires: [
        ...structuredClone(EXPERIMENT_01.wires),
        {
          id: 'w9',
          from: { partId: 'uno', pinId: 'D2' },
          to: { partId: 'bb', pinId: 'a1' },
          color: '#000',
          waypoints: [{ x: 40, y: 60 }],
        },
      ],
    }
    const s = load(bent)
    check('6.22 adoptIds still claims ids on a bent document', newId('w') === 'w10')
    check('6.23 the waypoints survived the load',
      JSON.stringify(s.doc.wires[6].waypoints) === '[{"x":40,"y":60}]')
    // Autosave hands the document to structuredClone (IndexedDB) and to JSON
    // (the server action); neither may drop the field.
    check('6.24 waypoints survive a JSON round trip',
      JSON.stringify(JSON.parse(JSON.stringify(s.doc)).wires[6].waypoints) === '[{"x":40,"y":60}]')
  }

  // 6f. THE constraint: a bend is cosmetic and may never reach the netlist.
  {
    resetIds()
    const plain = load(structuredClone(EXPERIMENT_01))
    const bent = docReducer(
      docReducer(plain, { type: 'addWaypoint', id: 'w1', index: 0, point: { x: 500, y: 900 } }),
      { type: 'addWaypoint', id: 'w6', index: 0, point: { x: -200, y: -50 } },
    )
    const a = compile(plain.doc)
    const b = compile(bent.doc)
    check('6.25 waypoints do not change the matrix size', a.unknowns === b.unknowns)
    check('6.26 waypoints do not change any pin assignment',
      JSON.stringify([...a.netOf.entries()].sort()) ===
        JSON.stringify([...b.netOf.entries()].sort()))
    check('6.27 waypoints do not change the derived nets',
      JSON.stringify(a.nets) === JSON.stringify(b.nets))
  }
}

// ── 7. Loading a starter circuit is undoable; the mount restore is not ────────
// The right-rail "Starter circuits" buttons dispatch `loadInto`: a mis-click
// that swaps out a student's build must be recoverable, so the outgoing work is
// pushed onto `past`. The on-mount / IndexedDB / server restore dispatches
// `load`, which replaces history wholesale — a freshly loaded page must have
// nothing to undo (the Undo button is disabled while `past` is empty).
{
  resetIds()

  // A student opens the experiment and builds on it.
  let s = load(structuredClone(EXPERIMENT_01))
  check('7.1 a fresh load leaves nothing to undo', s.past.length === 0, `past=${s.past.length}`)

  s = docReducer(s, {
    type: 'addPart',
    part: { id: 'r_new', type: 'resistor', x: 100, y: 100, rotation: 0, props: { ohms: 220 } },
  })
  const built = s.doc
  check('7.2 the build has the added part', built.parts.length === EXPERIMENT_01.parts.length + 1)

  // A mis-click on a "Starter circuits" button.
  s = docReducer(s, { type: 'loadInto', doc: EXAMPLES.pot.doc })
  check('7.3 loadInto swaps in the starter circuit', s.doc === EXAMPLES.pot.doc)
  check('7.4 loadInto pushes the outgoing build onto past',
    s.past[s.past.length - 1] === built, `past=${s.past.length}`)

  // Undo brings the whole build back — nothing is lost.
  s = docReducer(s, { type: 'undo' })
  check('7.5 undo after a starter load restores the build', s.doc === built)
  check('7.6 ... with the added part intact', s.doc.parts.some((p) => p.id === 'r_new'))

  // Redo re-applies the starter.
  s = docReducer(s, { type: 'redo' })
  check('7.7 redo re-applies the starter circuit', s.doc === EXAMPLES.pot.doc)

  // The on-mount / server restore replaces history: no bogus undo entry, so on
  // a fresh page there is nothing to undo.
  const restore = docReducer(
    { doc: built, past: [], future: [] },
    { type: 'load', doc: EXAMPLES.pot.doc },
  )
  check('7.8 the mount load records no undo entry', restore.past.length === 0, `past=${restore.past.length}`)
}

console.log(`\n${passed}/${passed + failed} passed${failed ? `, ${failed} FAILED` : ''}`)
process.exit(failed ? 1 : 0)
