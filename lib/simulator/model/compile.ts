/**
 * Document → netlist → solvable circuit.
 *
 * Runs on every edit. The netlist is always derived, never stored (§7).
 */

import { Circuit } from '../solver'
import {
  Diode as DiodeDevice,
  DIODE_1N4148,
  NortonPort,
  Resistor,
  VoltageSource,
  createLED,
  type Diode,
} from '../devices'
import type { NetId } from '../types'
import { getPart } from './parts'
import { pinKeyOf, type CircuitDoc, type PinRef } from './document'

export interface CompiledNet {
  id: NetId
  pins: PinRef[]
  /** True if this net carries at least one non-breadboard pin. */
  active: boolean
}

/**
 * An MCU pin wired DIRECTLY to ground — a dead short the solver cannot see.
 *
 * Once shorted, the pin's net IS net 0, so there is no node to solve for and no
 * branch current to check: the source or port would be stamped from ground to
 * ground and contribute nothing. The old code simply skipped such pins, so the
 * most destructive thing a student can do to a board was modelled as nothing at
 * all and reported as a healthy circuit.
 *
 * Note what this is NOT: a pin pulled to ground THROUGH a part keeps its own
 * net (the part's two pins are separate nodes), so a pull-down resistor or a
 * closed button never appears here. Only a wire straight to GND does.
 */
export interface ShortedPin {
  /** Device id for the fault, e.g. "uno.5V". */
  deviceId: string
  /** Board pin id, e.g. "5V" or "D13". */
  pinId: string
  /**
   * `supply` — a rail is destroyed the instant it is wired to GND, so the fault
   * is unconditional. `io` — a pin is only destroyed while it is DRIVING, which
   * is runtime state the compiler does not have; the engine gates on it.
   */
  role: 'supply' | 'io'
  /** Rail voltage, or the logic-high voltage an I/O pin would drive. */
  volts: number
}

export interface CompileResult {
  circuit: Circuit
  /** pinKey → solver net id. Ground is 0. */
  netOf: Map<string, NetId>
  /** Every derived net, including inert breadboard-only ones. */
  nets: CompiledNet[]
  /** MCU pin id (e.g. "D13") → its Norton port, for the PinBridge. */
  mcuPorts: Map<string, NortonPort>
  /** Part id → its LED diode, for current readout. */
  leds: Map<string, Diode>
  /**
   * Part id → any device whose current is worth showing (LEDs, buzzers, motors,
   * resistors). Read after a solve; the value updates via Device.readback.
   */
  meters: Map<string, { readonly id: string; current: number }>
  /** Analog pin name (A0…A5) → the net it reads, for the ADC. */
  analogNets: Map<string, NetId>
  /** Every MCU pin name → its net, so solved voltages can be fed back as inputs. */
  pinNets: Map<string, NetId>
  /**
   * Parts needing a behavioural model, with the nets they drive. The engine
   * instantiates these; the compiler only wires up their electrical side.
   */
  behavioural: Array<{ partId: string; protocol: string; port: NortonPort; net: NetId }>
  /**
   * Honest statement of what the DC engine cannot do for this circuit.
   * §2.3: the failure mode must be a refusal, never a wrong number.
   */
  limitations: string[]
  /** Human-readable problems to surface in the editor before solving. */
  problems: string[]
  /** MCU pins wired straight to ground. See ShortedPin. */
  shortedPins: ShortedPin[]
  /** Matrix unknowns — the budget the architecture caps at ~15. */
  unknowns: number
}

/**
 * A breadboard tie-point id → which half-column bank it is on, and its column.
 *
 * Rows a–e are the LOWER bank, f–j the UPPER bank, and the two are separated by
 * the centre channel: a5 and j5 are the same COLUMN but are NOT the same net.
 * Power rails (tp/tn/bp/bn…) span the whole board and belong to no column, so
 * they return null — a lead on a rail is never a channel-crossing mistake.
 */
function bankCol(pinId: string): { bank: 'lower' | 'upper'; col: number } | null {
  const m = /^([a-j])(\d+)$/.exec(pinId)
  if (!m) return null
  return { bank: 'abcde'.includes(m[1]) ? 'lower' : 'upper', col: Number(m[2]) }
}

/** A component/pin lead that is the only terminal on its net — see compile(). */
interface DeadLead {
  partId: string
  pinId: string
  /** A human name for the lead: the pin name for the MCU, else the part label. */
  label: string
  isMcu: boolean
  /** Breadboard holes this lead reaches, for channel-crossing detection. */
  coords: Array<{ bank: 'lower' | 'upper'; col: number; hole: string }>
}

class DSU {
  private parent = new Map<string, string>()
  find(a: string): string {
    const p = this.parent.get(a)
    if (p === undefined) {
      this.parent.set(a, a)
      return a
    }
    if (p === a) return a
    const root = this.find(p)
    this.parent.set(a, root)
    return root
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

export function compile(doc: CircuitDoc): CompileResult {
  const dsu = new DSU()
  const problems: string[] = []

  const partById = new Map(doc.parts.map((p) => [p.id, p]))

  // Seed pins and union internal buses.
  for (const part of doc.parts) {
    const def = getPart(part.type)
    for (const pin of def.pins) dsu.find(pinKeyOf({ partId: part.id, pinId: pin.id }))
    for (const bus of def.buses ?? []) {
      for (let i = 1; i < bus.length; i++) {
        dsu.union(
          pinKeyOf({ partId: part.id, pinId: bus[0] }),
          pinKeyOf({ partId: part.id, pinId: bus[i] }),
        )
      }
    }
  }

  // Union wires.
  for (const w of doc.wires) {
    if (!partById.has(w.from.partId) || !partById.has(w.to.partId)) continue
    dsu.union(pinKeyOf(w.from), pinKeyOf(w.to))
  }

  // Collapse all ground pins onto one root.
  let groundRoot: string | null = null
  for (const part of doc.parts) {
    for (const pin of getPart(part.type).pins) {
      if (pin.type !== 'gnd') continue
      const k = pinKeyOf({ partId: part.id, pinId: pin.id })
      if (groundRoot === null) groundRoot = dsu.find(k)
      else dsu.union(k, groundRoot)
    }
  }

  // Group pins by root, counting what kind of pins each net carries.
  const byRoot = new Map<string, PinRef[]>()
  const componentPins = new Map<string, number>() // non-breadboard pins per net
  const nonMcuPins = new Map<string, number>() // discrete-component pins per net
  for (const part of doc.parts) {
    const def = getPart(part.type)
    const kind = def.electrical.kind
    for (const pin of def.pins) {
      const ref = { partId: part.id, pinId: pin.id }
      const root = dsu.find(pinKeyOf(ref))
      const list = byRoot.get(root)
      if (list) list.push(ref)
      else byRoot.set(root, [ref])
      if (kind !== 'breadboard') {
        componentPins.set(root, (componentPins.get(root) ?? 0) + 1)
        if (kind !== 'mcu') nonMcuPins.set(root, (nonMcuPins.get(root) ?? 0) + 1)
      }
    }
  }

  /**
   * A net earns a matrix row only if current could actually flow on it:
   * either it joins two component pins, or it touches a discrete component.
   *
   * This prunes two large sources of dead unknowns. A breadboard alone
   * contributes ~450 tie points, and an Uno header contributes 25 pins that are
   * mostly unconnected — an unconnected MCU pin has no electrical effect, but
   * naively stamping every one of them put this circuit at 27 unknowns against
   * an architecture budget of ~15.
   */
  const rootIsActive = new Set<string>()
  for (const root of byRoot.keys()) {
    const comps = componentPins.get(root) ?? 0
    if (comps >= 2 || (nonMcuPins.get(root) ?? 0) >= 1) rootIsActive.add(root)
  }

  // A breadboard alone contributes ~450 pins. Giving every empty tie point a
  // matrix row would put the solver 30x over its unknown budget for no reason,
  // so inert breadboard-only nets never reach the circuit.
  const circuit = new Circuit()
  const rootToNet = new Map<string, NetId>()
  if (groundRoot !== null) rootToNet.set(dsu.find(groundRoot), 0)

  for (const [root] of byRoot) {
    if (rootToNet.has(root)) continue
    if (!rootIsActive.has(root)) continue
    rootToNet.set(root, circuit.allocNet())
  }

  const netOf = new Map<string, NetId>()
  const nets: CompiledNet[] = []
  for (const [root, pins] of byRoot) {
    const id = rootToNet.get(root)
    const active = rootIsActive.has(root)
    if (id !== undefined) for (const p of pins) netOf.set(pinKeyOf(p), id)
    nets.push({ id: id ?? -1, pins, active })
  }

  const net = (ref: PinRef): NetId | undefined => netOf.get(pinKeyOf(ref))

  // ─── Instantiate devices ───
  const mcuPorts = new Map<string, NortonPort>()
  const leds = new Map<string, Diode>()
  const meters = new Map<string, { readonly id: string; current: number }>()
  const analogNets = new Map<string, NetId>()
  const pinNets = new Map<string, NetId>()
  const behavioural: CompileResult['behavioural'] = []
  const limitations: string[] = []
  const shortedPins: ShortedPin[] = []
  const hasGround = groundRoot !== null

  for (const part of doc.parts) {
    const def = getPart(part.type)
    const el = def.electrical

    if (el.kind === 'resistor') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      const ohms = Number(part.props.ohms ?? el.defaultOhms)
      const r = new Resistor(part.id, a, b, ohms)
      circuit.add(r)
      meters.set(part.id, r)
    } else if (el.kind === 'potentiometer') {
      // Track split by the wiper. This is what makes analogRead() meaningful:
      // the divider is real, so the ADC reads a genuine node voltage.
      const a = net({ partId: part.id, pinId: '1' })
      const w = net({ partId: part.id, pinId: '2' })
      const b = net({ partId: part.id, pinId: '3' })
      const pos = Math.min(100, Math.max(0, Number(part.props.position ?? 50))) / 100
      // Never exactly zero: a 0 Ω leg would be a short, and the wiper of a real
      // pot always has some track resistance either side.
      const lo = Math.max(el.totalOhms * pos, 0.5)
      const hi = Math.max(el.totalOhms * (1 - pos), 0.5)
      if (a !== undefined && w !== undefined) circuit.add(new Resistor(part.id + '.a', a, w, lo))
      if (w !== undefined && b !== undefined) circuit.add(new Resistor(part.id + '.b', w, b, hi))
    } else if (el.kind === 'variable_resistor') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      // LDR response is roughly logarithmic in illumination, so interpolate
      // geometrically rather than linearly — a linear map makes the mid-range
      // behave nothing like a real sensor.
      const t = Math.min(100, Math.max(0, Number(part.props.light ?? 60))) / 100
      const ohms = el.minOhms * Math.pow(el.maxOhms / el.minOhms, 1 - t)
      const r = new Resistor(part.id, a, b, ohms)
      circuit.add(r)
      meters.set(part.id, r)
    } else if (el.kind === 'load') {
      const pins = def.pins
      const a = net({ partId: part.id, pinId: pins[0].id })
      const b = net({ partId: part.id, pinId: pins[1].id })
      if (a === undefined || b === undefined) continue
      const r = new Resistor(part.id, a, b, el.ohms)
      circuit.add(r)
      meters.set(part.id, r)
    } else if (el.kind === 'sensor') {
      // The sensor shares its DATA line with the MCU, so it gets its own Norton
      // port and the behavioural model drives it. Open-drain: it only pulls
      // down, and releasing means going high-impedance.
      const data = net({ partId: part.id, pinId: 'DATA' })
      if (data === undefined) continue
      const port = new NortonPort(part.id + '.data', 0, data, 1e-9, 0)
      circuit.add(port)
      behavioural.push({ partId: part.id, protocol: el.protocol, port, net: data })
    } else if (el.kind === 'reactive') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      if (el.element === 'capacitor') {
        // DC steady state of a capacitor is an open circuit. That is the right
        // answer for the operating point and the wrong answer for anything the
        // student put the capacitor there to do, so say so.
        circuit.add(new Resistor(part.id, a, b, 1e12))
        limitations.push(
          'Capacitors are held at their DC steady state (no current flows). ' +
            'Charging, discharging and timing need transient simulation, which is not available yet.',
        )
      } else {
        circuit.add(new Resistor(part.id, a, b, 0.01))
        limitations.push(
          'Inductors are held at their DC steady state (a plain wire). ' +
            'Current ramp and back-EMF need transient simulation, which is not available yet.',
        )
      }
    } else if (el.kind === 'diode') {
      const a = net({ partId: part.id, pinId: 'A' })
      const c = net({ partId: part.id, pinId: 'C' })
      if (a === undefined || c === undefined) continue
      const d = new DiodeDevice(part.id, a, c, DIODE_1N4148)
      circuit.add(d)
      meters.set(part.id, d)
    } else if (el.kind === 'led') {
      const a = net({ partId: part.id, pinId: 'A' })
      const c = net({ partId: part.id, pinId: 'C' })
      if (a === undefined || c === undefined) continue
      const internal = circuit.allocNet()
      const { devices, diode } = createLED(part.id, a, c, internal)
      circuit.add(...devices)
      leds.set(part.id, diode)
      meters.set(part.id, diode)
    } else if (el.kind === 'mcu') {
      for (const pin of def.pins) {
        const n = net({ partId: part.id, pinId: pin.id })
        if (n === undefined) continue

        /**
         * n === 0 means this pin sits ON the ground net — it is wired directly
         * to GND. For a GND pin that is simply correct. For anything else it is
         * a dead short, and it must be REPORTED rather than skipped: see
         * ShortedPin for why the solver can never find it on its own.
         */
        const shorted = n === 0 && pin.type !== 'gnd'

        if (pin.type === 'digital' || pin.type === 'analog') {
          if (shorted) {
            shortedPins.push({
              deviceId: `${part.id}.${pin.id}`,
              pinId: pin.id,
              role: 'io',
              volts: 5,
            })
          }
          /**
           * Permanently stamped, so the sparsity pattern never changes (§2.6) —
           * and stamped EVEN WHEN SHORTED, where both terminals are ground and
           * the device contributes nothing to the matrix. Dropping it was not
           * free: mcuPorts is what the engine watches, so a shorted D13 fell out
           * of the watch list, stopped tracking its own drive state, and
           * vanished from the pin readout entirely.
           *
           * An analog pin is a high-impedance input plus an ADC tap. It needs
           * the same stamp so it can be driven digitally (A0-A5 double as
           * D14-D19 on a real Uno).
           */
          const port = new NortonPort(`${part.id}.${pin.id}`, 0, n, 1e-8, 0)
          circuit.add(port)
          mcuPorts.set(pin.id, port)
          pinNets.set(pin.id, n)
          if (pin.type === 'analog') analogNets.set(pin.id, n)
        } else if (pin.id === '5V' || pin.id === '3.3V') {
          const volts = pin.id === '5V' ? 5 : 3.3
          if (shorted) {
            // A VoltageSource from ground to ground is a degenerate branch row
            // (a singular matrix), so the rail cannot be modelled here at all.
            // Reporting it is the only honest option.
            shortedPins.push({
              deviceId: `${part.id}.${pin.id}`,
              pinId: pin.id,
              role: 'supply',
              volts,
            })
          } else {
            circuit.add(
              new VoltageSource(`${part.id}.${pin.id === '5V' ? '5V' : '3V3'}`, n, 0, volts),
            )
          }
        }
      }
    } else if (el.kind === 'button') {
      const a = net({ partId: part.id, pinId: '1a' })
      const b = net({ partId: part.id, pinId: '2a' })
      if (a === undefined || b === undefined) continue
      const closed = Number(part.props.pressed ?? 0) === 1
      // Open contacts are a very large resistance rather than a removed device,
      // so pressing a button never changes the matrix structure.
      const sw = new Resistor(part.id, a, b, closed ? 0.05 : 1e12)
      circuit.add(sw)
      meters.set(part.id, sw)
    }
  }

  // ─── Problems worth telling the student about, before solving ───
  if (doc.parts.length > 0 && !hasGround) {
    problems.push('No ground in the circuit — add an Arduino or connect to GND.')
  }
  // ─── Connectivity: dangling leads and channel-crossed orphans ───
  //
  // Current can only flow through a net with at least TWO component terminals
  // on it (in one, out another). A net with exactly one is a dead end: its lone
  // lead is electrically dangling no matter what pico-amp gmin leak the solver
  // reports. The solver cannot see this — it solves the dead-ended circuit
  // perfectly and stays silent — yet a dangling lead (a), and a pair of leads
  // mis-wired across the breadboard's centre channel (b), are the two commonest
  // beginner mistakes, and to a newbie a dark LED that should be lit is
  // indistinguishable from a broken simulator.
  //
  // These are CONNECTIVITY problems, not destructive faults, so they go through
  // `problems` (which the Checks panel renders), never SolveFault. They are
  // purely topological, so a circuit that is merely switched OFF — a LOW pin, an
  // open button, an unlit LED — is still fully connected and stays silent.
  const wiredKeys = new Set<string>()
  for (const w of doc.wires) {
    if (!partById.has(w.from.partId) || !partById.has(w.to.partId)) continue
    wiredKeys.add(pinKeyOf(w.from))
    wiredKeys.add(pinKeyOf(w.to))
  }
  const isBreadboardPart = (partId: string): boolean => {
    const p = partById.get(partId)
    return p !== undefined && getPart(p.type).electrical.kind === 'breadboard'
  }

  const deadLeads: DeadLead[] = []
  const liveCount = new Map<string, number>() // partId → pins that reach a real net

  for (const part of doc.parts) {
    const def = getPart(part.type)
    const kind = def.electrical.kind
    if (kind === 'breadboard') continue
    const isMcu = kind === 'mcu'
    for (const pin of def.pins) {
      const root = dsu.find(pinKeyOf({ partId: part.id, pinId: pin.id }))
      const cp = componentPins.get(root) ?? 0
      if (cp >= 2) {
        liveCount.set(part.id, (liveCount.get(part.id) ?? 0) + 1)
        continue
      }
      if (cp !== 1) continue // cp === 0: an MCU pin with no wire at all — unused.

      // A dead-end terminal: the only component pin on its net.
      if (isMcu) {
        // Only a pin the student actually WIRED and could DRIVE is worth a word.
        // An unused header pin is normal; power/ground leads are the short-
        // circuit path's job, not this one.
        if (pin.type !== 'digital' && pin.type !== 'analog') continue
        if (!wiredKeys.has(pinKeyOf({ partId: part.id, pinId: pin.id }))) continue
      } else if (kind === 'potentiometer') {
        // A pot is legitimately one-legged (a rheostat leaves one end open), so
        // a dead-end leg is not reported per-pin. A pot wired to NOTHING still
        // gets the whole-part message below via liveCount === 0.
        continue
      }

      const coords: DeadLead['coords'] = []
      for (const ref of byRoot.get(root) ?? []) {
        if (!isBreadboardPart(ref.partId)) continue
        const bc = bankCol(ref.pinId)
        if (bc) coords.push({ ...bc, hole: ref.pinId })
      }
      deadLeads.push({
        partId: part.id,
        pinId: pin.id,
        label: isMcu ? pin.id : `${def.label} "${part.id}"`,
        isMcu,
        coords,
      })
    }
  }

  // (b) Channel crossings: two dead leads on the same COLUMN but opposite banks
  // look joined and are not. Report each such column once, and mark both leads
  // as explained so they don't also get the generic dangling message.
  const explained = new Set<DeadLead>()
  const hintedCols = new Set<number>()
  for (let i = 0; i < deadLeads.length; i++) {
    for (let j = i + 1; j < deadLeads.length; j++) {
      const a = deadLeads[i]
      const b = deadLeads[j]
      let crossed: { ca: DeadLead['coords'][number]; cb: DeadLead['coords'][number] } | null = null
      for (const ca of a.coords) {
        const cb = b.coords.find((c) => c.col === ca.col && c.bank !== ca.bank)
        if (cb) {
          crossed = { ca, cb }
          break
        }
      }
      if (!crossed) continue
      explained.add(a)
      explained.add(b)
      if (!hintedCols.has(crossed.ca.col)) {
        hintedCols.add(crossed.ca.col)
        problems.push(
          `${a.label} (${crossed.ca.hole}) and ${b.label} (${crossed.cb.hole}) are on the ` +
            `same breadboard column but opposite sides of the centre channel, so they are ` +
            `not connected. Bridge the two banks with a jumper wire.`,
        )
      }
    }
  }

  // (a) Everything the crossing hints didn't cover.
  for (const part of doc.parts) {
    const def = getPart(part.type)
    const kind = def.electrical.kind
    if (kind === 'breadboard' || kind === 'mcu') continue
    const live = liveCount.get(part.id) ?? 0
    if (live === 0) {
      // No pin of this part reaches a real net. If a crossing already explained
      // its leads, that hint said why — don't pile on.
      const anyExplained = deadLeads.some((l) => l.partId === part.id && explained.has(l))
      if (!anyExplained) problems.push(`${def.label} "${part.id}" is not connected to anything.`)
    } else {
      for (const l of deadLeads) {
        if (l.partId !== part.id || explained.has(l)) continue
        problems.push(`${def.label} "${part.id}" has a lead (pin ${l.pinId}) wired to nothing.`)
      }
    }
  }
  // A driven MCU pin wired to a dead end of its own (e.g. across the channel with
  // nothing on the other side to pair with).
  for (const l of deadLeads) {
    if (!l.isMcu || explained.has(l)) continue
    problems.push(`${l.pinId} is driven but its wire reaches nothing else — it is left dangling.`)
  }

  return {
    circuit,
    netOf,
    nets,
    mcuPorts,
    leds,
    meters,
    analogNets,
    pinNets,
    behavioural,
    limitations: [...new Set(limitations)],
    problems,
    shortedPins,
    unknowns: circuit.size,
  }
}
