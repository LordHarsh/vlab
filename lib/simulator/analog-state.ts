/**
 * Reported state for the parts that have no behavioural model.
 *
 * A tier-2 part publishes its own state through `BehaviouralContext.report` —
 * that is what a DHT11, a relay board and a stepper do. The purely ANALOG parts
 * have no such model: a capacitor is a stamp in a matrix, a potentiometer is two
 * resistors, and neither has anywhere to say what it is doing. So a student
 * charging a capacitor could watch the Measurements panel show the current
 * decaying and had no way at all to read the voltage that current was building
 * — the one number the whole exercise is about.
 *
 * This is where that comes from. Everything here is READ OUT of a solve that has
 * already happened: the solved node voltages, the branch current a reactive
 * element reports for the step just advanced, and the document's own props. No
 * value is invented and nothing is re-derived by a second route — the pot's two
 * legs and the LDR's resistance come from the SAME functions in parts.ts that
 * compile.ts stamped, so the panel cannot describe a divider the solver is not
 * solving.
 *
 * Shared by both engines. The AVR and RP2040 engines are separate classes with
 * separate run loops, and duplicating this in each was the standing invitation
 * for the two to drift — a capacitor that reports its voltage on an Uno and not
 * on a Pico is a bug nobody would find for months.
 */

import type { ReactiveDevice } from './devices'
import type { DeviceState } from './behavioural'
import type { CompiledNet } from './model/compile'
import type { CircuitDoc } from './model/document'
import { pinKeyOf } from './model/document'
import { getPart, potentiometerLegs, variableResistorOhms } from './model/parts'
import type { NetId } from './types'

/**
 * The current below which a reactive element is called settled, amps.
 *
 * 1 nA. Well above the solver's gmin leakage (order 1e-12 A) and well below any
 * current a student's circuit carries, so "steady" means the transient has
 * genuinely finished rather than "the number is small".
 */
const SETTLED_AMPS = 1e-9

/**
 * The voltage below which an inductor's current is called steady, volts.
 *
 * An inductor's rate of change is v/L, so it is the VOLTAGE across it that says
 * whether its current is still moving. 1 µV is far below any node voltage the
 * solver resolves meaningfully and far above its numerical floor.
 */
const SETTLED_VOLTS = 1e-6

export interface AnalogStateInputs {
  doc: CircuitDoc
  /** pinKey → solver net id, from the compile the voltages came out of. */
  netOf: Map<string, NetId>
  /** Every derived net, so a lead that reaches nothing can be told from one that does. */
  nets: CompiledNet[]
  /** Solved node voltages. Index 0 is ground and is always 0. */
  voltages: Float64Array
  /** Part id → its capacitor or inductor, from the same compile. */
  reactive: Map<string, ReactiveDevice>
  /** True while the engine is integrating in time rather than solving DC. */
  transient: boolean
}

/**
 * The nets current could actually flow on: two or more component terminals, so
 * there is a way in and a way out.
 *
 * WITHOUT THIS, "connected" WOULD ALWAYS BE TRUE and the readout would lie.
 * compile() gives a net to any root carrying a discrete-component pin —
 * `nonMcuPins >= 1` — precisely so a lone capacitor still appears in the matrix,
 * so `netOf.get(...)` is defined for both leads of a capacitor sitting in the
 * component tray with no wires on it at all. The panel would then report
 * "0.000 V · charging" over a part that is not in a circuit, which is
 * indistinguishable from a discharged one that is.
 *
 * The rule is compile()'s own (`componentPins >= 2`, the test its dangling-lead
 * detection uses), recovered from the nets it published rather than recomputed
 * from the document — so the two cannot disagree about what "wired up" means.
 */
function liveNets(inp: AnalogStateInputs): Set<NetId> {
  const kindOf = new Map<string, string>()
  for (const part of inp.doc.parts) kindOf.set(part.id, getPart(part.type).electrical.kind)

  const live = new Set<NetId>()
  for (const net of inp.nets) {
    if (net.id < 0) continue
    let components = 0
    for (const pin of net.pins) {
      if (kindOf.get(pin.partId) !== 'breadboard') components++
      if (components >= 2) break
    }
    if (components >= 2) live.add(net.id)
  }
  return live
}

/**
 * A net's solved voltage, or undefined when the lead reaches nothing.
 *
 * "Reaches nothing" covers both shapes: a pin with no net at all, and a pin
 * whose net is a dead end. Both are the same thing to a student.
 */
function voltageOf(
  inp: AnalogStateInputs,
  live: Set<NetId>,
  partId: string,
  pinId: string,
): number | undefined {
  const n = inp.netOf.get(pinKeyOf({ partId, pinId }))
  if (n === undefined || !live.has(n)) return undefined
  return n < inp.voltages.length ? inp.voltages[n] : 0
}

/**
 * Reported state for every analog part in the document.
 *
 * Walked from the DOCUMENT rather than from the compile, so a part that reached
 * no net at all still reports — as `connected: false`, which is the honest
 * answer and the one a student who has forgotten a wire needs. A part that
 * silently vanishes from the panel looks like a broken simulator.
 */
export function analogDeviceStates(inp: AnalogStateInputs): Record<string, DeviceState> {
  const out: Record<string, DeviceState> = {}
  const live = liveNets(inp)

  for (const part of inp.doc.parts) {
    const def = getPart(part.type)
    const el = def.electrical

    if (el.kind === 'reactive') {
      const device = inp.reactive.get(part.id)
      const va = voltageOf(inp, live, part.id, '1')
      const vb = voltageOf(inp, live, part.id, '2')
      const connected = device !== undefined && va !== undefined && vb !== undefined
      const volts = connected ? (va as number) - (vb as number) : 0
      const amps = connected ? device.current : 0

      /**
       * The trend is EXACT PHYSICS, not a heuristic over successive samples.
       *
       *   capacitor  i = C·dv/dt, so the current's sign IS the sign of dv/dt.
       *              Same sign as the voltage already across it → |v| is growing
       *              → charging. Opposite → discharging. At v = 0 the product is
       *              zero and any current is charging it up from empty, which is
       *              what `>= 0` gives.
       *   inductor   v = L·di/dt, so it is the VOLTAGE that says whether the
       *              current is moving, and the same sign test applies one term
       *              along.
       *
       * Doing it by comparing two snapshots would be a difference over a window
       * the engine does not control — snapshots land twenty times a second over
       * a transient that can be finished in microseconds.
       */
      const isCap = el.element === 'capacitor'
      const moving = isCap ? Math.abs(amps) > SETTLED_AMPS : Math.abs(volts) > SETTLED_VOLTS
      const growing = volts * amps >= 0
      const trend = !moving
        ? 'steady'
        : isCap
          ? growing
            ? 'charging'
            : 'discharging'
          : growing
            ? 'rising'
            : 'falling'

      out[part.id] = {
        element: el.element,
        connected,
        transient: inp.transient,
        volts,
        amps,
        trend,
        // The declared size, so the readout can name the part it is describing
        // without a second lookup — and from the document, so it is the figure
        // compile.ts stamped rather than one the panel chose.
        value: isCap
          ? Number(part.props.microfarads ?? 1)
          : Number(part.props.millihenries ?? 1),
      }
      continue
    }

    if (el.kind === 'potentiometer') {
      const position = Number(part.props.position ?? 50)
      const totalOhms = Number(part.props.totalOhms ?? el.totalOhms)
      const { lower, upper } = potentiometerLegs(totalOhms, position)
      const wiper = voltageOf(inp, live, part.id, '2')
      const end1 = voltageOf(inp, live, part.id, '1')
      const end3 = voltageOf(inp, live, part.id, '3')
      out[part.id] = {
        position,
        totalOhms,
        lowerOhms: lower,
        upperOhms: upper,
        connected: wiper !== undefined,
        wiperVolts: wiper ?? 0,
        // Both ends, because a divider only means anything against what is at
        // its ends — and a pot wired as a RHEOSTAT has one end open, which this
        // is how the readout can say.
        endsWired: end1 !== undefined && end3 !== undefined,
        acrossVolts: end1 !== undefined && end3 !== undefined ? end1 - end3 : 0,
      }
      continue
    }

    if (el.kind === 'variable_resistor') {
      const light = Number(part.props.light ?? 60)
      const ohms = variableResistorOhms(el.minOhms, el.maxOhms, light)
      const a = voltageOf(inp, live, part.id, '1')
      const b = voltageOf(inp, live, part.id, '2')
      const connected = a !== undefined && b !== undefined
      const volts = connected ? (a as number) - (b as number) : 0
      out[part.id] = {
        light,
        ohms,
        connected,
        volts,
        // Ohm's law on the two numbers above rather than a second meter: the
        // element is a plain Resistor in the matrix, so this IS its current.
        amps: connected && ohms > 0 ? volts / ohms : 0,
      }
      continue
    }

    if (el.kind === 'diode') {
      const a = voltageOf(inp, live, part.id, 'A')
      const c = voltageOf(inp, live, part.id, 'C')
      const connected = a !== undefined && c !== undefined
      const volts = connected ? (a as number) - (c as number) : 0
      out[part.id] = {
        connected,
        volts,
        // A silicon junction is not "on" at any particular threshold — it
        // conducts exponentially — so the word is about which WAY it is biased,
        // which is the thing a student wired it backwards to discover.
        biased: volts > 0 ? 'forward' : volts < 0 ? 'reverse' : 'none',
      }
      continue
    }

    if (el.kind === 'button') {
      const a = voltageOf(inp, live, part.id, '1a')
      const b = voltageOf(inp, live, part.id, '2a')
      const connected = a !== undefined && b !== undefined
      out[part.id] = {
        pressed: Number(part.props.pressed ?? 0) >= 0.5,
        connected,
        volts: connected ? (a as number) - (b as number) : 0,
      }
      continue
    }
  }

  return out
}
