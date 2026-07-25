/**
 * Does every declared prop actually reach the SOLVER?
 *
 * propDeclarationProblems() in parts.ts already catches the other half of this
 * question — a prop that cannot be RENDERED honestly (no default, a select
 * default outside its own options, a knob on a prop that does not exist). It has
 * been clean for every part in the library since it was written.
 *
 * There was no equivalent guard for the half that has actually bitten this
 * project, twice:
 *
 *   - `led.color` shipped with a correct, fully commented datasheet table of
 *     forward voltages in parts.ts and a working <select> in the inspector,
 *     while compile.ts never passed the colour to createLED(). Every LED in
 *     every document solved as red. Nothing failed. Nothing said anything.
 *   - wire bending shipped with 71 passing geometry assertions over
 *     wire-hit.ts while the interaction that would have called them was not
 *     wired up at all.
 *
 * Both are the same shape: a declaration that is correct, tested and inert. The
 * inspector shows a control, the student turns it, the document records it, and
 * the physics never hears about it.
 *
 * ─── HOW THIS CATCHES IT ──────────────────────────────────────────────────────
 *
 * By DIFFERENCE, not by inspection. For every declared prop:
 *
 *   1. Build a probe document in which the part is fully wired up.
 *   2. compile() it twice, with the prop at two different declared values.
 *   3. Serialise the resulting Circuit both times and compare.
 *
 * If the two circuits are byte-identical, the prop changed nothing the solver
 * will ever see. No knowledge of what any particular prop is SUPPOSED to do is
 * needed, and none is encoded here — which is what makes this a guard rather
 * than a second copy of compile() that could agree with the first one's bug.
 *
 * ─── THE PROBE DOCUMENT ───────────────────────────────────────────────────────
 *
 * TWO COPIES of the part, pin i of one wired to pin i of the other.
 *
 * A single part on its own is not enough, and the relay board is why: compile()
 * only builds a relay channel when something is topologically ATTACHED to one of
 * its pins (`componentPins >= 2`), so a lone relay_4ch compiles to no channels
 * at all and its `activeLow` prop would look inert when it is not. Pairing the
 * part with a copy of itself puts two component terminals on every net without
 * needing to know anything about which pins matter — a breadboard or an Uno
 * would need a pin budget and a wiring plan per part.
 *
 * Only copy `a` carries the prop under test. Copy `b` stays at its defaults, so
 * anything that shows up in the difference came from the value being varied.
 *
 * ─── WHAT THIS DOES **NOT** COVER, AND WHY ────────────────────────────────────
 *
 * The twelve props on the seven tier-2 sensors do not reach the compiled circuit
 * at all, BY DESIGN, and no amount of cleverness here will make them: a DHT11's
 * `temperature` reaches a behavioural MODEL, and from there it reaches the wire
 * only when the host asks for a reading — which takes a CPU, a firmware and
 * 18 ms of simulated time. A guard that compiled two documents cannot produce
 * any of those.
 *
 * So this function classifies rather than judging: `reachesSolver` for the props
 * that move the matrix, `behavioural` for the props on a part whose model runs
 * in the engine. `problems` is populated only for a prop that is in NEITHER
 * category — declared on a part with no behavioural model and stamped into
 * nothing, which is the LED-colour bug exactly.
 *
 * The BEHAVIOURAL half is then closed by a source-level check in
 * compile.test.ts: every prop this function classifies as `behavioural` must
 * appear as a real `numProp(..., 'key', ...)` read in behavioural.ts. That check
 * needs the filesystem, so it cannot live in a module the browser bundles —
 * which is also why this whole guard is a separate module rather than a load-time
 * check inside parts.ts: parts.ts cannot import compile.ts, because compile.ts
 * imports parts.ts.
 */

import { compile } from './compile'
import type { CircuitDoc } from './document'
import { PART_LIBRARY, getPart, type PartDefinition, type PropSpec } from './parts'

/** How a prop was accounted for. */
export type PropReach =
  /** Changing it changes the circuit compile() stamps. */
  | 'solver'
  /** It does not, and the part has a behavioural model that could read it. */
  | 'behavioural'
  /** It does not, and there is no model to read it either. A dead control. */
  | 'unreachable'

export interface PropReachability {
  type: string
  key: string
  reach: PropReach
  /** The two values the probe compared, for a failure message. */
  probed: [string, string]
}

/**
 * Two DIFFERENT declared values for a prop, or null when it has only one.
 *
 * Taken from the prop's own declaration rather than invented, so the probe can
 * never test a value the inspector would refuse: the ends of a `range`, the
 * first two `options` of a `select`, the first two `choices` of a `choice`, and
 * the declared bounds of a `number`.
 */
function probeValues(prop: PropSpec): [number | string, number | string] | null {
  if (prop.type === 'choice') {
    const values = (prop.choices ?? []).map((c) => c.value)
    return values.length >= 2 ? [values[0], values[1]] : null
  }
  if (prop.type === 'select') {
    const options = prop.options ?? []
    return options.length >= 2 ? [options[0], options[1]] : null
  }
  const min = prop.min
  const max = prop.max
  if (min === undefined || max === undefined || min === max) return null
  return [min, max]
}

/** The part, twice, with every pin of one wired to the same pin of the other. */
function probeDoc(type: string, def: PartDefinition, props: Record<string, number | string>): CircuitDoc {
  return {
    parts: [
      { id: 'a', type, x: 0, y: 0, rotation: 0, props },
      { id: 'b', type, x: 400, y: 0, rotation: 0, props: {} },
    ],
    wires: def.pins.map((pin, i) => ({
      id: `probe${i}`,
      from: { partId: 'a', pinId: pin.id },
      to: { partId: 'b', pinId: pin.id },
      color: '#000',
    })),
  }
}

/**
 * A fingerprint of everything compile() stamped.
 *
 * `JSON.stringify` over the Circuit reaches every device's own enumerable
 * fields — a Resistor's ohms, a Diode's saturation current, a Buzzer's passive
 * flag, which nets each one bridges — and reaches nothing on a prototype, so
 * getters and methods contribute nothing and cannot mask a difference. That is
 * exactly the surface a prop has to move to be electrically real.
 */
function fingerprint(doc: CircuitDoc): string {
  return JSON.stringify(compile(doc).circuit)
}

/** True when compile() would give this part a behavioural model of its own. */
function hasBehaviouralModel(def: PartDefinition): boolean {
  const kind = def.electrical.kind
  return (
    kind === 'sensor' ||
    kind === 'buzzer' ||
    kind === 'stepper' ||
    kind === 'relay_module'
  )
}

/** Every declared prop, and how it reaches the simulation. */
export function propReachability(): PropReachability[] {
  const out: PropReachability[] = []
  for (const [type, def] of Object.entries(PART_LIBRARY)) {
    for (const prop of def.props ?? []) {
      const values = probeValues(prop)
      if (values === null) {
        // A prop with only one declared value cannot be probed by difference —
        // and cannot be changed by a student either, so there is nothing for it
        // to fail to reach. propDeclarationProblems() already rejects the shapes
        // that get here by mistake (a select with no options, min === max).
        continue
      }
      const [v1, v2] = values
      const same =
        fingerprint(probeDoc(type, def, { [prop.key]: v1 })) ===
        fingerprint(probeDoc(type, def, { [prop.key]: v2 }))
      out.push({
        type,
        key: prop.key,
        reach: !same ? 'solver' : hasBehaviouralModel(def) ? 'behavioural' : 'unreachable',
        probed: [String(v1), String(v2)],
      })
    }
  }
  return out
}

/**
 * Every declared prop that reaches neither the solver nor a model, as
 * human-readable lines. Empty is the healthy state.
 *
 * Same contract as propDeclarationProblems(): it returns strings rather than
 * throwing, so a caller can decide whether this is a failed test or a loud
 * console line.
 */
export function propReachabilityProblems(): string[] {
  return propReachability()
    .filter((r) => r.reach === 'unreachable')
    .map(
      (r) =>
        `${r.type}.${r.key} is declared, rendered and stored — and reaches NOTHING. ` +
        `Compiling the part at ${r.probed[0]} and at ${r.probed[1]} produces an identical ` +
        `circuit, and ${r.type} has no behavioural model that could read it instead. ` +
        `A student can turn this control and the physics will never hear about it.`,
    )
}

/**
 * The part types whose props are checked here, for a test that wants to assert
 * the guard is actually looking at something rather than passing vacuously.
 */
export function probedPartTypes(): string[] {
  return Object.keys(PART_LIBRARY).filter((t) => (getPart(t).props ?? []).length > 0)
}
