/**
 * Wire bending, along the path a real drag takes.
 *
 * wirepath.test.ts already proves the GEOMETRY: given bend points, the emitted
 * `d` has its fillets in the right places. All 71 of its assertions passed
 * while wire bending was completely broken in the running app, because nothing
 * exercised the step before it — deciding which wire a pointer is on. This file
 * is that missing half, and it walks the whole chain a drag walks:
 *
 *     resolveGrab  →  docReducer 'addWaypoint'  →  docReducer 'moveWaypoint'
 *                  →  wirePath                  →  the rendered `d`
 *
 * THE DEFECT IT EXISTS TO CATCH. Pins are painted after wires, so SVG handed
 * every press to the topmost shape — and a breadboard's tie points carry
 * invisible 5-unit targets on a 10-unit pitch, about 78% areal cover. Measured
 * on the shipped `ultrasonic-pir` starter in Chrome: of 59 points sampled along
 * `pw_gnd`, only 27 reached the wire; `pw_bridge_p` reached it at NONE of them.
 * The press went to a tie point, which began a wire draft that was discarded on
 * release, so the student saw nothing happen at all. Separately, that starter's
 * two bridge wires are exactly collinear, so the one drawn first was buried by
 * the one drawn second and took no press anywhere along its length.
 *
 * Both are asserted below against the REAL starter geometry, not a fixture
 * invented to suit the fix.
 *
 * Run: npx tsx lib/simulator/__tests__/wirehit.test.ts
 */

import {
  distToSegment,
  pinOutranks,
  resolveGrab,
  wireTargetAt,
  type GrabTolerance,
  type PinTarget,
  type WireRoute,
} from '../model/wire-hit'
import { wirePath } from '../model/wire-path'
import {
  docReducer,
  initialDocState,
  pinPosition,
  snap,
  type CircuitDoc,
  type DocState,
  type Point,
} from '../model/document'
import { getPart } from '../model/parts'
import { STARTER_ULTRASONIC_PIR } from '../model/examples'
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

/**
 * The canvas's own numbers, at the zoom a starter opens at.
 *
 * These mirror CircuitCanvas's WIRE_HIT/2, WAYPOINT_HIT and PIN_CORE. They are
 * restated rather than imported because importing a .tsx component into a node
 * test would drag React in; if they drift apart the browser behaviour is what
 * is authoritative, and every assertion below is about the RULE, which is
 * shared.
 */
const TOL: GrabTolerance = { body: 3.5, handle: 6, pinCore: 4 }

/** Every wire in `doc`, with its endpoints resolved — what the canvas builds. */
function routesOf(doc: CircuitDoc): WireRoute[] {
  const byId = new Map(doc.parts.map((part) => [part.id, part]))
  const out: WireRoute[] = []
  for (const w of doc.wires) {
    const pa = byId.get(w.from.partId)
    const pb = byId.get(w.to.partId)
    if (!pa || !pb) continue
    const a = pinPosition(pa, w.from.pinId)
    const b = pinPosition(pb, w.to.pinId)
    if (!a || !b) continue
    out.push({ id: w.id, a, b, waypoints: w.waypoints })
  }
  return out
}

/** Every pin on the board, in world units — what the canvas builds. */
function pinsOf(doc: CircuitDoc): PinTarget[] {
  const out: PinTarget[] = []
  for (const part of doc.parts) {
    for (const pin of getPart(part.type).pins) {
      const at = pinPosition(part, pin.id)
      if (at) out.push({ at, subtle: pin.subtle })
    }
  }
  return out
}

function midpoint(r: WireRoute): Point {
  return p((r.a.x + r.b.x) / 2, (r.a.y + r.b.y) / 2)
}

// ─── 1. distToSegment, which everything else rests on ────────────────────────

{
  check('a point on the segment is at distance zero', distToSegment(p(5, 0), p(0, 0), p(10, 0)) === 0)
  check('perpendicular distance is the offset', distToSegment(p(5, 3), p(0, 0), p(10, 0)) === 3)
  check(
    'past the end it measures to the endpoint, not the infinite line',
    distToSegment(p(14, 3), p(0, 0), p(10, 0)) === 5,
    String(distToSegment(p(14, 3), p(0, 0), p(10, 0))),
  )
  check('a degenerate segment is just its point', distToSegment(p(3, 4), p(0, 0), p(0, 0)) === 5)
}

// ─── 2. THE BUG: a tie point must not swallow the wire lying across it ───────

{
  const doc = STARTER_ULTRASONIC_PIR
  const routes = routesOf(doc)
  const pins = pinsOf(doc)

  check('the starter still has the four wires this test was written against', routes.length === 4)

  // pw_bridge_p crosses the whole breadboard. In the browser it was reachable
  // at NONE of 59 sampled points; every one went to a tie point or to the wire
  // drawn after it.
  const bridge = routes.find((r) => r.id === 'pw_bridge_p')!
  check('pw_bridge_p is present', !!bridge)

  let onWire = 0
  let sampled = 0
  const blockedBy: string[] = []
  for (let i = 1; i < 40; i++) {
    const t = i / 40
    const at = p(bridge.a.x + (bridge.b.x - bridge.a.x) * t, bridge.a.y + (bridge.b.y - bridge.a.y) * t)
    sampled++
    const hit = resolveGrab(routes, pins, at, TOL)
    if (hit) onWire++
    else blockedBy.push(`${at.x.toFixed(0)},${at.y.toFixed(0)}`)
  }
  check(
    'every sampled point along a wire crossing a breadboard resolves to a wire',
    onWire === sampled,
    `${onWire}/${sampled}, blocked at ${blockedBy.slice(0, 4).join(' ')}`,
  )

  // And specifically: a point that IS inside a tie point's target still goes to
  // the wire. Find one, so the assertion cannot pass vacuously.
  const overATiePoint = (() => {
    for (let i = 1; i < 200; i++) {
      const t = i / 200
      const at = p(
        bridge.a.x + (bridge.b.x - bridge.a.x) * t,
        bridge.a.y + (bridge.b.y - bridge.a.y) * t,
      )
      const covered = pins.some(
        (pin) => pin.subtle && Math.hypot(at.x - pin.at.x, at.y - pin.at.y) <= 5,
      )
      if (covered) return at
    }
    return null
  })()
  check('the starter really does run a wire across tie points', overATiePoint !== null)
  if (overATiePoint) {
    const hit = resolveGrab(routes, pins, overATiePoint, TOL)
    check(
      'a press inside a breadboard tie point but on a wire grabs the WIRE',
      hit?.wireId === 'pw_bridge_p',
      JSON.stringify(hit),
    )
  }
}

// ─── 3. THE OTHER BUG: the nearest wire wins, not the one drawn last ─────────

{
  const doc = STARTER_ULTRASONIC_PIR
  const routes = routesOf(doc)
  const pins = pinsOf(doc)

  // The starter's two bridge wires share the column x=340 and overlap for
  // 135 units. Paint order gave every one of those to pw_bridge_n; measured in
  // Chrome, pw_bridge_p was topmost at none of 59 sampled points.
  const first = routes.find((r) => r.id === 'pw_bridge_p')!
  const second = routes.find((r) => r.id === 'pw_bridge_n')!
  const mid = midpoint(first)
  check(
    'the two bridge wires really do overlap, or this proves nothing',
    distToSegment(mid, second.a, second.b) <= TOL.body,
    `${distToSegment(mid, second.a, second.b).toFixed(2)} units apart`,
  )
  check(
    'pw_bridge_n is drawn AFTER pw_bridge_p, so paint order favoured it',
    doc.wires.findIndex((w) => w.id === 'pw_bridge_n') >
      doc.wires.findIndex((w) => w.id === 'pw_bridge_p'),
  )
  const buried = resolveGrab(routes, pins, mid, TOL)
  check(
    'the wire paint order buried is the one that now takes the press',
    buried?.wireId === 'pw_bridge_p' && buried.kind === 'body',
    JSON.stringify(buried),
  )

  // And where the two are NOT tied, the nearer centreline wins outright —
  // which is the rule, stated on a fixture that isolates it.
  const near: WireRoute = { id: 'near', a: p(0, 0), b: p(100, 0) }
  const far: WireRoute = { id: 'far', a: p(0, 5), b: p(100, 5) }
  const both = [near, far]
  check(
    'a press 1 unit from the first wire grabs it, though the second paints over it',
    wireTargetAt(both, p(50, 1), TOL)?.wireId === 'near',
  )
  check(
    'and a press 1 unit from the second grabs the second',
    wireTargetAt([near, far], p(50, 4), TOL)?.wireId === 'far',
  )
  check('a press clear of both grabs neither', wireTargetAt(both, p(50, 40), TOL) === null)
}

// ─── 4. A pin core still outranks a wire, so a header pin stays reachable ────

{
  const doc = STARTER_ULTRASONIC_PIR
  const pins = pinsOf(doc)
  const routes = routesOf(doc)
  const fiveVolt = routes.find((r) => r.id === 'pw_5v')!

  // pw_5v ends ON the Uno's 5V header pin. Pressing that pin must start a new
  // wire, not grab the one already there, or a student cannot fan out a rail.
  check(
    'a press on the header pin a wire ends at is left to the pin',
    resolveGrab(routes, pins, fiveVolt.a, TOL) === null,
  )
  check('...and that is the pin core doing it', pinOutranks(pins, fiveVolt.a, TOL.pinCore))
  // 15 units along that lead is clear of every header pin's core — the nearest
  // is uno.3.3V at 6.08 — so it belongs to the wire again.
  const len = Math.hypot(fiveVolt.b.x - fiveVolt.a.x, fiveVolt.b.y - fiveVolt.a.y)
  const away = p(
    fiveVolt.a.x + ((fiveVolt.b.x - fiveVolt.a.x) * 15) / len,
    fiveVolt.a.y + ((fiveVolt.b.y - fiveVolt.a.y) * 15) / len,
  )
  check('the sample point is genuinely clear of every pin core', !pinOutranks(pins, away, TOL.pinCore))
  check(
    'but a press clear of the core belongs to the wire again',
    resolveGrab(routes, pins, away, TOL)?.wireId === 'pw_5v',
    JSON.stringify(resolveGrab(routes, pins, away, TOL)),
  )
  // The two halves of the rule are separable: the wire is there either way,
  // and it is the pin core alone that hands the press back.
  check(
    'wireTargetAt alone does see the wire under the pin',
    wireTargetAt(routes, fiveVolt.a, TOL)?.wireId === 'pw_5v',
  )
  // A breadboard tie point has no core at all.
  const tie = pins.find((pin) => pin.subtle)!
  check('a subtle tie point never outranks', !pinOutranks(pins, tie.at, TOL.pinCore))
}

// ─── 5. The full drag: resolve → addWaypoint → moveWaypoint → rendered d ─────

{
  let state: DocState = docReducer(initialDocState, {
    type: 'load',
    doc: structuredClone(STARTER_ULTRASONIC_PIR),
  })

  const before = (() => {
    const r = routesOf(state.doc).find((x) => x.id === 'pw_bridge_p')!
    return wirePath(r.a, r.b, r.waypoints)
  })()
  check('a wire with no bends renders as one moveto and one lineto', ops(before) === 'ML', before)

  // Press on the wire where it crosses the board — the case that was dead.
  const route = routesOf(state.doc).find((x) => x.id === 'pw_bridge_p')!
  const grab = midpoint(route)
  const target = resolveGrab(routesOf(state.doc), pinsOf(state.doc), grab, TOL)
  check('the press resolves to the wire body', target?.kind === 'body' && target.wireId === 'pw_bridge_p')

  // The first move past the slop mints the bend, exactly as the canvas does.
  state = docReducer(state, {
    type: 'addWaypoint',
    id: target!.wireId,
    index: target!.index,
    point: p(snap(grab.x), snap(grab.y)),
  })
  const afterAdd = state.doc.wires.find((w) => w.id === 'pw_bridge_p')!
  check('addWaypoint put one bend on the wire', afterAdd.waypoints?.length === 1)

  // Every later frame of the same gesture moves it.
  state = docReducer(state, {
    type: 'moveWaypoint',
    id: 'pw_bridge_p',
    index: 0,
    x: snap(grab.x - 60),
    y: snap(grab.y + 10),
    transient: true,
  })
  const moved = state.doc.wires.find((w) => w.id === 'pw_bridge_p')!
  const bend = moved.waypoints?.[0]
  check('moveWaypoint moved that bend', bend?.x === snap(grab.x - 60))
  check('the bend is on the grid', bend !== undefined && bend.x % 10 === 0 && bend.y % 10 === 0)

  const after = (() => {
    const r = routesOf(state.doc).find((x) => x.id === 'pw_bridge_p')!
    return wirePath(r.a, r.b, r.waypoints)
  })()
  check(
    'THE WHOLE POINT: a drag renders an arc and a second leg',
    ops(after) === 'MLAL',
    `${before}  →  ${after}`,
  )
  check('the drawn path actually changed', after !== before)

  // One undo entry for the whole gesture: the add records history, the
  // transient move rides on it.
  const undone = docReducer(state, { type: 'undo' })
  check(
    'one undo takes the whole gesture back to a straight wire',
    undone.doc.wires.find((w) => w.id === 'pw_bridge_p')?.waypoints === undefined,
  )

  // ── the bend is now a handle, and grabbing it moves that bend only ─────────
  state = docReducer(state, {
    type: 'addWaypoint',
    id: 'pw_bridge_p',
    index: 1,
    point: p(snap(grab.x + 20), snap(grab.y + 40)),
  })
  const two = state.doc.wires.find((w) => w.id === 'pw_bridge_p')!
  check('a second drag adds a second bend', two.waypoints?.length === 2)
  const twoD = (() => {
    const r = routesOf(state.doc).find((x) => x.id === 'pw_bridge_p')!
    return wirePath(r.a, r.b, r.waypoints)
  })()
  check('two bends render two arcs and three legs', ops(twoD) === 'MLALAL', twoD)

  const handleAt = two.waypoints![0]
  const onHandle = resolveGrab(routesOf(state.doc), pinsOf(state.doc), handleAt, TOL)
  check(
    'a press on a bend grabs the HANDLE, not the body beside it',
    onHandle?.kind === 'handle' && onHandle.index === 0,
    JSON.stringify(onHandle),
  )

  const other = { ...two.waypoints![1] }
  state = docReducer(state, {
    type: 'moveWaypoint',
    id: 'pw_bridge_p',
    index: onHandle!.index,
    x: handleAt.x - 30,
    y: handleAt.y,
  })
  const shifted = state.doc.wires.find((w) => w.id === 'pw_bridge_p')!
  check('dragging a handle moves that bend', shifted.waypoints?.[0].x === handleAt.x - 30)
  check(
    'and leaves the other one exactly where it was',
    shifted.waypoints?.[1].x === other.x && shifted.waypoints?.[1].y === other.y,
  )

  // ── double-click removes just that bend, and the wire survives ─────────────
  const beforeCount = state.doc.wires.length
  state = docReducer(state, { type: 'removeWaypoint', id: 'pw_bridge_p', index: 0 })
  const trimmed = state.doc.wires.find((w) => w.id === 'pw_bridge_p')!
  check('removeWaypoint drops one bend', trimmed.waypoints?.length === 1)
  check('and does not touch the wire itself', state.doc.wires.length === beforeCount)
  state = docReducer(state, { type: 'removeWaypoint', id: 'pw_bridge_p', index: 0 })
  const bare = state.doc.wires.find((w) => w.id === 'pw_bridge_p')!
  check('the last bend leaves no empty array behind', bare.waypoints === undefined)
  check('the wire is still there', state.doc.wires.length === beforeCount)
}

// ─── 6. Bends stay cosmetic: the netlist never sees them ─────────────────────

{
  const straight = structuredClone(STARTER_ULTRASONIC_PIR)
  const bent = structuredClone(STARTER_ULTRASONIC_PIR)
  for (const w of bent.wires) {
    w.waypoints = [p(snap(Math.random() * 400), snap(Math.random() * 400))]
  }

  const a = compile(straight)
  const b = compile(bent)
  const netMap = (r: typeof a) => JSON.stringify([...r.netOf.entries()].sort())
  check('a bend changes no pin-to-net assignment', netMap(a) === netMap(b))
  check('a bend changes no net count', a.nets.length === b.nets.length, `${a.nets.length} vs ${b.nets.length}`)
  check('a bend changes no MCU port', a.mcuPorts.size === b.mcuPorts.size)
  check('a bend changes no metered device', a.meters.size === b.meters.size)
  check(
    'a bend changes no analog net',
    JSON.stringify([...a.analogNets.entries()].sort()) ===
      JSON.stringify([...b.analogNets.entries()].sort()),
  )
}

console.log('='.repeat(passed))
console.log(`${passed}/${passed + failed} passed`)
if (failed > 0) process.exit(1)
