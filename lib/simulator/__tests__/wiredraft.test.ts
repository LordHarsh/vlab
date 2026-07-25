/**
 * Drawing a wire by clicking: pin, turn, turn, pin.
 *
 * The gesture the owner described, and the one we did not have:
 *
 *   "First click to start a connection, then successive clicks to introduce
 *    turns and points in the empty space, then these turns continue until a
 *    click connects it to the other end device."
 *
 * WHY THIS FILE EXISTS RATHER THAN MORE GEOMETRY TESTS. wirepath.test.ts has 71
 * passing assertions about the shape of a `d`, and every one of them passed
 * while a student could not draw a bent wire at all. The break was never in the
 * maths — it was that `endGesture` cleared the draft on every pointerup, so a
 * click on a pin opened a route and the release a few milliseconds later threw
 * it away. Nothing that tests `wirePath(a, b, points)` can see that. So this
 * drives the STATE MACHINE through the real event order and then feeds what it
 * produces to the real reducer:
 *
 *   pressPin → releasePress → pressCanvas × n → pressPin
 *        → docReducer 'addWire' → wirePath → the rendered `d`
 *
 * Run: npx tsx lib/simulator/__tests__/wiredraft.test.ts
 */

import {
  DRAG_SLOP,
  beginDraft,
  pressCanvas,
  pressPin,
  releasePress,
  trackCursor,
  type WireDraft,
} from '../model/wire-draft'
import { wirePath } from '../model/wire-path'
import {
  docReducer,
  initialDocState,
  newId,
  pinPosition,
  resetIds,
  type DocState,
  type PinRef,
  type Point,
} from '../model/document'
import { EXPERIMENT_01 } from '../model/examples'
import { compile } from '../model/compile'

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

function p(x: number, y: number): Point {
  return { x, y }
}

/** The letters of `d`, so a shape can be asserted without the numbers. */
function ops(d: string): string {
  return (d.match(/[MLA]/g) ?? []).join('')
}

const A: PinRef = { partId: 'uno', pinId: 'D13' }
const B: PinRef = { partId: 'uno', pinId: 'GND.2' }

// ─── 1. Click a pin, click empty space twice, click a pin ────────────────────

{
  // Press and release without travelling: a CLICK. The draft must survive it.
  let step = pressPin(null, A, p(100, 100))
  check('pressing a pin opens a draft', step.draft !== null && step.draft.pressing)
  check('and commits nothing yet', step.commit === undefined)

  step = releasePress(step.draft!)
  check('THE OLD BUG: releasing a click does NOT throw the draft away', step.draft !== null)
  check('the draft has left the opening press behind', step.draft!.pressing === false)
  check('still nothing committed', step.commit === undefined)

  // Two turns in empty space.
  let draft: WireDraft = pressCanvas(step.draft!, p(154, 148))
  check('a click in empty space lays a turn', draft.points.length === 1)
  check('snapped to the grid', draft.points[0].x === 150 && draft.points[0].y === 150)
  draft = pressCanvas(draft, p(151, 243))
  check('a second click lays a second turn', draft.points.length === 2)
  check('in the order they were clicked', draft.points[1].y === 240)

  // Land it on the far pin.
  const done = pressPin(draft, B, p(300, 240))
  check('clicking a second pin finishes the wire', done.commit !== undefined)
  check('the draft is put down', done.draft === null)
  check('from the pin it started at', done.commit!.from === A)
  check('to the pin it was landed on', done.commit!.to === B)
  check('carrying both turns', done.commit!.waypoints.length === 2)
}

// ─── 2. The same route, all the way to a rendered path ───────────────────────

{
  resetIds()
  let state: DocState = docReducer(initialDocState, {
    type: 'load',
    doc: structuredClone(EXPERIMENT_01),
  })
  const wiresBefore = state.doc.wires.length
  const part = state.doc.parts.find((x) => x.type === 'arduino_uno')!
  const from: PinRef = { partId: part.id, pinId: 'D12' }
  const to: PinRef = { partId: part.id, pinId: 'D8' }
  const a = pinPosition(part, from.pinId)!
  const b = pinPosition(part, to.pinId)!

  // pin → release → two turns → pin, exactly as the canvas drives it.
  let step = pressPin(null, from, a)
  step = releasePress(step.draft!)
  let draft = pressCanvas(step.draft!, p(a.x + 60, a.y + 70))
  draft = pressCanvas(draft, p(b.x + 60, b.y + 140))
  const done = pressPin(draft, to, b)
  check('the route produced a wire to create', done.commit !== undefined)

  state = docReducer(state, {
    type: 'addWire',
    wire: {
      id: newId('w'),
      from: done.commit!.from,
      to: done.commit!.to,
      color: '#40B942',
      waypoints: done.commit!.waypoints,
    },
  })
  check('the wire count went up by one', state.doc.wires.length === wiresBefore + 1)

  const made = state.doc.wires[state.doc.wires.length - 1]
  check('the wire carries its turns', made.waypoints?.length === 2)

  const d = wirePath(a, b, made.waypoints)
  check(
    'THE WHOLE POINT: the drawn path is three legs with an arc fillet at each turn',
    ops(d) === 'MLALAL',
    d,
  )
  check('a straight wire between the same pins would be one leg', ops(wirePath(a, b)) === 'ML')

  // And one undo takes the whole wire back — the route is a single edit.
  const undone = docReducer(state, { type: 'undo' })
  check('one undo removes the routed wire', undone.doc.wires.length === wiresBefore)
}

// ─── 3. A press that TRAVELS is a drag, and still makes a wire ───────────────

{
  let draft = beginDraft(A, p(100, 100))
  check('a fresh draft has not moved', !draft.moved)

  draft = trackCursor(draft, p(100 + DRAG_SLOP - 1, 100))
  check('inside the slop it is still a click', !draft.moved)

  draft = trackCursor(draft, p(100 + DRAG_SLOP + 2, 100))
  check('past the slop it is a drag', draft.moved)
  check('and the live end follows the cursor', draft.x === 100 + DRAG_SLOP + 2)

  const onPin = releasePress(draft, B)
  check('a drag released on a pin makes the wire', onPin.commit !== undefined)
  check('with no turns, because none were clicked', onPin.commit!.waypoints.length === 0)

  const inSpace = releasePress(draft)
  check('a drag released over empty space is abandoned', inSpace.draft === null)
  check('and creates nothing', inSpace.commit === undefined)
}

// ─── 4. The escape hatches ───────────────────────────────────────────────────

{
  let step = pressPin(null, A, p(100, 100))
  step = releasePress(step.draft!)
  const routing = pressCanvas(step.draft!, p(150, 150))

  const back = pressPin(routing, A, p(100, 100))
  check('clicking the pin it started from cancels the route', back.draft === null)
  check('and creates no wire', back.commit === undefined)

  // Escape is the canvas's, not the machine's — but the machine must not stand
  // in its way: dropping the draft is all cancelling is.
  check('a cancelled route leaves nothing behind', back.draft === null && !back.commit)

  // A release while routing is not the opening press and must change nothing.
  const idle = releasePress(routing)
  check('a release mid-route is ignored', idle.draft === routing && idle.commit === undefined)
}

// ─── 5. Degenerate routes ────────────────────────────────────────────────────

{
  let step = pressPin(null, A, p(100, 100))
  step = releasePress(step.draft!)
  let draft = pressCanvas(step.draft!, p(150, 150))
  const same = pressCanvas(draft, p(152, 148))
  check(
    'a turn clicked onto the previous one is dropped, not stacked',
    same.points.length === 1,
    JSON.stringify(same.points),
  )

  // A route with many turns renders one arc per turn that actually turns.
  draft = pressCanvas(draft, p(150, 250))
  draft = pressCanvas(draft, p(250, 180))
  const done = pressPin(draft, B, p(350, 250))
  check('three turns survive to the commit', done.commit!.waypoints.length === 3)
  const d = wirePath(p(100, 100), p(350, 250), done.commit!.waypoints)
  check('and render as four legs with three arcs', ops(d) === 'MLALALAL', d)

  // A turn that does not turn — three points in a line — carries no fillet,
  // which is wire-path.ts's rule and not something routing should paper over.
  const flat = wirePath(p(0, 0), p(300, 0), [p(100, 0), p(200, 0)])
  check('a collinear turn renders as a plain leg', ops(flat) === 'MLLL', flat)
}

// ─── 6. Routing turns are cosmetic: the netlist never sees them ──────────────

{
  resetIds()
  const doc = structuredClone(EXPERIMENT_01)
  const part = doc.parts.find((x) => x.type === 'arduino_uno')!
  const straight = structuredClone(doc)
  straight.wires.push({
    id: 'wDirect',
    from: { partId: part.id, pinId: 'D12' },
    to: { partId: part.id, pinId: 'D8' },
    color: '#40B942',
  })
  const routed = structuredClone(doc)
  routed.wires.push({
    id: 'wDirect',
    from: { partId: part.id, pinId: 'D12' },
    to: { partId: part.id, pinId: 'D8' },
    color: '#40B942',
    waypoints: [p(120, 300), p(220, 340), p(320, 300)],
  })

  const x = compile(straight)
  const y = compile(routed)
  const netMap = (r: typeof x) => JSON.stringify([...r.netOf.entries()].sort())
  check('a routed wire connects exactly what a straight one does', netMap(x) === netMap(y))
  check('and derives the same number of nets', x.nets.length === y.nets.length)
}

console.log('='.repeat(passed))
console.log(`${passed}/${passed + failed} passed`)
if (failed > 0) process.exit(1)
