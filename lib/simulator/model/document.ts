/**
 * The circuit document, and the reducer that edits it.
 *
 * Serialises to the shape SIMULATOR_ARCHITECTURE.md §7 stores in
 * circuits.graph: parts[] + wires[], with nets DERIVED rather than stored.
 * Never persist nets — they are a pure function of parts and wires, and a
 * stored copy is a copy that can disagree.
 */

import { getPart, PITCH } from './parts'

export interface PinRef {
  partId: string
  pinId: string
}

export interface Point {
  x: number
  y: number
}

export interface PlacedPart {
  id: string
  type: string
  x: number
  y: number
  rotation: 0 | 90 | 180 | 270
  props: Record<string, number | string>
}

export interface DocWire {
  id: string
  from: PinRef
  to: PinRef
  color: string
  /**
   * Optional bend points the drawn wire is routed through, in canvas units.
   *
   * COSMETIC ONLY. The netlist is derived from `from`/`to` alone (compile.ts
   * unions exactly those two pin keys), so a bend can never change what is
   * connected to what — it only lets a student drape a lead around a board
   * instead of tunnelling through it.
   *
   * Optional on purpose: every document authored or autosaved before this
   * existed has no `waypoints`, and must keep loading and rendering as the
   * direct route it always was. Never assume the array is present.
   */
  waypoints?: Point[]
}

export interface CircuitDoc {
  parts: PlacedPart[]
  wires: DocWire[]
}

export const EMPTY_DOC: CircuitDoc = { parts: [], wires: [] }

export const WIRE_COLORS = ['#e04a4a', '#111827', '#2f7d32', '#2563eb', '#eab308', '#7c3aed']

export function pinKeyOf(ref: PinRef): string {
  return `${ref.partId} ${ref.pinId}`
}

export function samePin(a: PinRef, b: PinRef): boolean {
  return a.partId === b.partId && a.pinId === b.pinId
}

/** Absolute canvas position of a pin, accounting for the part's rotation. */
export function pinPosition(part: PlacedPart, pinId: string): { x: number; y: number } | null {
  const def = getPart(part.type)
  const pin = def.pins.find((p) => p.id === pinId)
  if (!pin) return null

  const { width: w, height: h } = def
  let { x, y } = pin
  switch (part.rotation) {
    case 90:
      ;[x, y] = [h - y, x]
      break
    case 180:
      ;[x, y] = [w - x, h - y]
      break
    case 270:
      ;[x, y] = [y, w - x]
      break
  }
  return { x: part.x + x, y: part.y + y }
}

export function partBounds(part: PlacedPart): { w: number; h: number } {
  const def = getPart(part.type)
  const swapped = part.rotation === 90 || part.rotation === 270
  return swapped ? { w: def.height, h: def.width } : { w: def.width, h: def.height }
}

export function snap(v: number): number {
  return Math.round(v / PITCH) * PITCH
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type DocAction =
  | { type: 'addPart'; part: PlacedPart }
  | { type: 'movePart'; id: string; x: number; y: number }
  | { type: 'rotatePart'; id: string }
  | { type: 'removePart'; id: string }
  | { type: 'setProp'; id: string; key: string; value: number | string }
  | { type: 'addWire'; wire: DocWire }
  | { type: 'removeWire'; id: string }
  | { type: 'addWaypoint'; id: string; index: number; point: Point }
  | {
      type: 'moveWaypoint'
      id: string
      index: number
      x: number
      y: number
      /**
       * Set on every frame of a drag except the first. A drag streams one
       * action per pointermove; without this each frame would land its own
       * undo entry and a single bend would cost twenty presses to undo.
       */
      transient?: boolean
    }
  | { type: 'removeWaypoint'; id: string; index: number }
  // Replace the whole document AND reset history. The initial mount and an
  // IndexedDB/server restore use this: there is nothing before them to undo.
  | { type: 'load'; doc: CircuitDoc }
  // Replace the whole document but keep it UNDOABLE. The "Starter circuits"
  // buttons use this so a mis-click that swaps out a student's build can be
  // taken back with one press.
  | { type: 'loadInto'; doc: CircuitDoc }
  | { type: 'undo' }
  | { type: 'redo' }

export interface DocState {
  doc: CircuitDoc
  past: CircuitDoc[]
  future: CircuitDoc[]
}

export const initialDocState: DocState = { doc: EMPTY_DOC, past: [], future: [] }

/** Actions that should not create an undo entry of their own. */
const TRANSIENT = new Set(['undo', 'redo', 'load'])

const HISTORY_LIMIT = 100

/**
 * Whether this edit is swallowed by the undo stack.
 *
 * Two sources: the fixed set above, and the per-action `transient` flag a drag
 * sets on its continuation frames. The first frame of a drag records history
 * (so undo lands on the state before the gesture); every frame after it is
 * marked transient and rides on that one entry.
 */
function isTransient(action: DocAction): boolean {
  if (TRANSIENT.has(action.type)) return true
  return action.type === 'moveWaypoint' && action.transient === true
}

export function docReducer(state: DocState, action: DocAction): DocState {
  if (action.type === 'undo') {
    const prev = state.past[state.past.length - 1]
    if (!prev) return state
    return {
      doc: prev,
      past: state.past.slice(0, -1),
      future: [state.doc, ...state.future].slice(0, HISTORY_LIMIT),
    }
  }

  if (action.type === 'redo') {
    const next = state.future[0]
    if (!next) return state
    return {
      doc: next,
      past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
    }
  }

  if (action.type === 'load' || action.type === 'loadInto') {
    // Every document that becomes editor state passes through here — the
    // authored examples, an IndexedDB restore, and a server load. Claiming its
    // ids before the first edit is what stops newId() colliding with them.
    adoptIds(action.doc)
    return {
      doc: action.doc,
      // A 'loadInto' is a student-initiated swap (the "Starter circuits"
      // buttons): it must be undoable, so the outgoing document is pushed onto
      // the past like any other edit. A 'load' is the mount restore or a server
      // load — nothing precedes it, so history is wiped and a fresh page has no
      // spurious undo entry.
      past: action.type === 'loadInto' ? [...state.past, state.doc].slice(-HISTORY_LIMIT) : [],
      // A new load always invalidates any redo branch.
      future: [],
    }
  }

  const doc = applyEdit(state.doc, action)
  if (doc === state.doc) return state

  return {
    doc,
    past: isTransient(action) ? state.past : [...state.past, state.doc].slice(-HISTORY_LIMIT),
    // Any new edit invalidates the redo branch.
    future: [],
  }
}

/**
 * Replace one wire in place.
 *
 * Returning the SAME doc when `edit` declines (unknown id, index out of range,
 * a move that does not actually move) is load-bearing: docReducer bails on an
 * unchanged doc, so a declined edit costs no undo entry and no re-render.
 */
function editWire(
  doc: CircuitDoc,
  id: string,
  edit: (w: DocWire) => DocWire | null,
): CircuitDoc {
  const i = doc.wires.findIndex((w) => w.id === id)
  if (i < 0) return doc
  const next = edit(doc.wires[i])
  if (!next || next === doc.wires[i]) return doc
  const wires = doc.wires.slice()
  wires[i] = next
  return { ...doc, wires }
}

/** The waypoint list of `w`, treated as empty when the field is absent. */
function pointsOf(w: DocWire): Point[] {
  return w.waypoints ?? []
}

function applyEdit(doc: CircuitDoc, action: DocAction): CircuitDoc {
  switch (action.type) {
    case 'addPart':
      return { ...doc, parts: [...doc.parts, action.part] }

    case 'movePart': {
      const parts = doc.parts.map((p) =>
        p.id === action.id ? { ...p, x: action.x, y: action.y } : p,
      )
      return { ...doc, parts }
    }

    case 'rotatePart': {
      const parts = doc.parts.map((p) =>
        p.id === action.id ? { ...p, rotation: (((p.rotation + 90) % 360) as PlacedPart['rotation']) } : p,
      )
      return { ...doc, parts }
    }

    case 'removePart':
      return {
        parts: doc.parts.filter((p) => p.id !== action.id),
        // Wires to a deleted part would dangle, so they go with it.
        wires: doc.wires.filter(
          (w) => w.from.partId !== action.id && w.to.partId !== action.id,
        ),
      }

    case 'setProp': {
      const parts = doc.parts.map((p) =>
        p.id === action.id ? { ...p, props: { ...p.props, [action.key]: action.value } } : p,
      )
      return { ...doc, parts }
    }

    case 'addWire': {
      // Reject self-loops and exact duplicates; both are pure noise in the netlist.
      if (samePin(action.wire.from, action.wire.to)) return doc
      const dup = doc.wires.some(
        (w) =>
          (samePin(w.from, action.wire.from) && samePin(w.to, action.wire.to)) ||
          (samePin(w.from, action.wire.to) && samePin(w.to, action.wire.from)),
      )
      if (dup) return doc
      return { ...doc, wires: [...doc.wires, action.wire] }
    }

    case 'removeWire':
      return { ...doc, wires: doc.wires.filter((w) => w.id !== action.id) }

    case 'addWaypoint':
      return editWire(doc, action.id, (w) => {
        const pts = [...pointsOf(w)]
        // `index` is the segment that was grabbed, so it is also the slot the
        // new bend belongs in — clamped, because a stale index from a wire
        // edited under the pointer must not throw the list out of order.
        const at = Math.max(0, Math.min(action.index, pts.length))
        pts.splice(at, 0, { x: action.point.x, y: action.point.y })
        return { ...w, waypoints: pts }
      })

    case 'moveWaypoint':
      return editWire(doc, action.id, (w) => {
        const pts = pointsOf(w)
        const p = pts[action.index]
        if (!p) return null
        // Snapped drags spend most of their frames inside one grid cell.
        if (p.x === action.x && p.y === action.y) return null
        const next = pts.slice()
        next[action.index] = { x: action.x, y: action.y }
        return { ...w, waypoints: next }
      })

    case 'removeWaypoint':
      return editWire(doc, action.id, (w) => {
        const pts = pointsOf(w)
        if (!pts[action.index]) return null
        const next = pts.filter((_, i) => i !== action.index)
        if (next.length > 0) return { ...w, waypoints: next }
        // Last bend gone: drop the key rather than leave an empty array, so
        // the wire is once again identical to one authored before waypoints
        // existed — including when it is autosaved and reloaded.
        const bare = { ...w }
        delete bare.waypoints
        return bare
      })

    default:
      return doc
  }
}

// ─── Ids ──────────────────────────────────────────────────────────────────────

let counter = 0

/**
 * Deterministic within a session. Deliberately not crypto.randomUUID: ids end
 * up in saved documents and in test fixtures, and short readable ids make both
 * diffable.
 */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}${counter}`
}

export function resetIds(): void {
  counter = 0
}

/**
 * Raise the id counter above every numeric id already present in `doc`.
 *
 * Without this, a fresh session starts at zero and newId('w') hands back "w1"
 * — which EXAMPLES already uses. The duplicate key made React render only the
 * first of the pair, so the header counted a wire the canvas had silently
 * dropped, and the colliding id was then autosaved. Anything keyed by wire id
 * (delete, in particular) would also hit the wrong one.
 *
 * Reloading did not clear it: a restored document still carries w1-w6 while
 * the module-level counter restarts at 0, so the collision recurs every visit.
 *
 * Monotonic and idempotent, so React StrictMode's double-invoke of the reducer
 * is harmless.
 */
export function adoptIds(doc: CircuitDoc): void {
  let max = counter
  const consider = (id: string) => {
    // Ids are `${prefix}${n}` — take the trailing run of digits.
    const m = /(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  for (const p of doc.parts) consider(p.id)
  for (const w of doc.wires) consider(w.id)
  counter = max
}
