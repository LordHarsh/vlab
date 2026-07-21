/**
 * Document → netlist → solvable circuit.
 *
 * Runs on every edit. The netlist is always derived, never stored (§7).
 */

import { Circuit } from '../solver'
import { NortonPort, Resistor, VoltageSource, createLED, type Diode } from '../devices'
import type { NetId } from '../types'
import { getPart } from './parts'
import { pinKeyOf, type CircuitDoc, type PinRef } from './document'

export interface CompiledNet {
  id: NetId
  pins: PinRef[]
  /** True if this net carries at least one non-breadboard pin. */
  active: boolean
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
  /** Human-readable problems to surface in the editor before solving. */
  problems: string[]
  /** Matrix unknowns — the budget the architecture caps at ~15. */
  unknowns: number
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
  const hasGround = groundRoot !== null

  for (const part of doc.parts) {
    const def = getPart(part.type)
    const el = def.electrical

    if (el.kind === 'resistor') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      const ohms = Number(part.props.ohms ?? el.defaultOhms)
      circuit.add(new Resistor(part.id, a, b, ohms))
    } else if (el.kind === 'led') {
      const a = net({ partId: part.id, pinId: 'A' })
      const c = net({ partId: part.id, pinId: 'C' })
      if (a === undefined || c === undefined) continue
      const internal = circuit.allocNet()
      const { devices, diode } = createLED(part.id, a, c, internal)
      circuit.add(...devices)
      leds.set(part.id, diode)
    } else if (el.kind === 'mcu') {
      for (const pin of def.pins) {
        const n = net({ partId: part.id, pinId: pin.id })
        if (n === undefined || n === 0) continue
        if (pin.type === 'digital') {
          // Permanently stamped, so the sparsity pattern never changes (§2.6).
          const port = new NortonPort(`${part.id}.${pin.id}`, 0, n, 1e-8, 0)
          circuit.add(port)
          mcuPorts.set(pin.id, port)
        } else if (pin.id === '5V') {
          circuit.add(new VoltageSource(`${part.id}.5V`, n, 0, 5))
        } else if (pin.id === '3V3') {
          circuit.add(new VoltageSource(`${part.id}.3V3`, n, 0, 3.3))
        }
      }
    } else if (el.kind === 'button') {
      const a = net({ partId: part.id, pinId: '1a' })
      const b = net({ partId: part.id, pinId: '2a' })
      if (a === undefined || b === undefined) continue
      const closed = part.props.pressed === 1
      // Open contacts are a very large resistance rather than a removed device,
      // so pressing a button never changes the matrix structure.
      circuit.add(new Resistor(part.id, a, b, closed ? 0.05 : 1e12))
    }
  }

  // ─── Problems worth telling the student about, before solving ───
  if (doc.parts.length > 0 && !hasGround) {
    problems.push('No ground in the circuit — add an Arduino or connect to GND.')
  }
  for (const part of doc.parts) {
    const def = getPart(part.type)
    if (def.electrical.kind === 'breadboard' || def.electrical.kind === 'mcu') continue
    const unconnected = def.pins.filter((p) => {
      const n = net({ partId: part.id, pinId: p.id })
      return n === undefined
    })
    if (unconnected.length === def.pins.length) {
      problems.push(`${def.label} "${part.id}" is not connected to anything.`)
    }
  }

  return {
    circuit,
    netOf,
    nets,
    mcuPorts,
    leds,
    problems,
    unknowns: circuit.size,
  }
}
