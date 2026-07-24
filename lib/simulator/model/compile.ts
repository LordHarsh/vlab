/**
 * Document → netlist → solvable circuit.
 *
 * Runs on every edit. The netlist is always derived, never stored (§7).
 */

import { Circuit } from '../solver'
import {
  Buzzer,
  Capacitor,
  DCMotor,
  Diode as DiodeDevice,
  DIODE_1N4148,
  Inductor,
  NortonPort,
  RELAY_MODULE_4CH,
  Resistor,
  STEPPER_28BYJ48,
  ULN2003,
  UnipolarStepper,
  VoltageSource,
  createL298N,
  createLED,
  createRelayModule,
  createULN2003,
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
   * Part id → its motor, so the engine can convert a TIME-AVERAGED current into
   * a speed. Speed is affine in current (see DCMotor), which is what lets a
   * PWM-driven motor report its real average rpm without an extra solve.
   */
  motors: Map<string, DCMotor>
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
   * Parts needing a behavioural model. The engine instantiates these; the
   * compiler only wires up their electrical side.
   *
   * `nets` carries EVERY pin of the part that reached a real net, keyed by pin
   * id, so a device can read its own supply rail (an unpowered HC-SR04 must not
   * answer) as easily as its signal line. `ports` carries a Norton port for each
   * pin the part declares it can DRIVE.
   */
  behavioural: Array<{
    partId: string
    protocol: string
    nets: Record<string, NetId>
    ports: Record<string, NortonPort>
  }>
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
  const motors = new Map<string, DCMotor>()
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
    } else if (el.kind === 'buzzer') {
      const a = net({ partId: part.id, pinId: 'P' })
      const b = net({ partId: part.id, pinId: 'N' })
      if (a === undefined || b === undefined) continue
      // Passive means a bare piezo element — a capacitor, so an open at DC.
      const passive = Number(part.props.passive ?? 0) >= 0.5
      const bz = new Buzzer(part.id, a, b, passive)
      circuit.add(bz)
      meters.set(part.id, bz)
      // The sound is a property of the drive waveform in TIME, which a DC
      // operating point cannot hold. A monitor watches the terminal voltage and
      // reports the pitch; it drives nothing, hence no ports.
      behavioural.push({
        partId: part.id,
        protocol: 'buzzer',
        nets: { P: a, N: b },
        ports: {},
      })
      if (passive) {
        limitations.push(
          'A passive buzzer is a piezo element — a capacitor — so no DC current flows ' +
            'through it. The pitch it is being driven at is reported, but the current ' +
            'reads zero because that is its true DC steady state.',
        )
      }
    } else if (el.kind === 'motor') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      const load = Math.min(100, Math.max(0, Number(part.props.load ?? 0))) / 100
      const m = new DCMotor(part.id, a, b, load)
      circuit.add(m)
      meters.set(part.id, m)
      motors.set(part.id, m)
      limitations.push(
        'The motor is solved at its steady state. Start-up inrush, rotor inertia and ' +
          'the inductive spike when it is switched off all need transient simulation, ' +
          'which the interactive engine does not run yet.',
      )
    } else if (el.kind === 'darlington_array') {
      /**
       * Everything a ULN2003 does returns to its OWN ground pin, never to net 0
       * — the input resistors and the open-collector sinks alike (see
       * DarlingtonSink in devices.ts). So an unwired GND is not a detail to
       * paper over: the chip contributes nothing and does nothing, which is what
       * a bench does. GND is typed `passive` on the part for exactly this.
       */
      const gnd = net({ partId: part.id, pinId: 'GND' })
      if (gnd === undefined) continue
      const ins: Array<NetId | undefined> = []
      const outs: Array<NetId | undefined> = []
      for (let k = 1; k <= ULN2003.channels; k++) {
        ins.push(net({ partId: part.id, pinId: `IN${k}` }))
        outs.push(net({ partId: part.id, pinId: `OUT${k}` }))
      }
      // A channel whose input is unwired is not instantiated at all, so seven
      // unused channels cost nothing; and a COM that never reached a net gets no
      // flyback diode, which is also what the hardware does.
      const com = net({ partId: part.id, pinId: 'COM' })
      const { devices } = createULN2003(part.id, { in: ins, out: outs, com, gnd })
      if (devices.length === 0) continue
      circuit.add(...devices)
    } else if (el.kind === 'h_bridge') {
      const gnd = net({ partId: part.id, pinId: 'GND' })
      if (gnd === undefined) continue
      /**
       * An unwired logic input is handed the chip's OWN ground net rather than a
       * node of its own.
       *
       * Both give the same answer — HBridgeChannel stamps the input resistor to
       * gnd, so an unconnected pin solves to 0 V and reads LOW — but a fresh net
       * would spend a matrix unknown to prove it, six times over on a part where
       * half the pins are routinely unused. Handing over `gnd` makes the
       * conductance a self-loop the stamp discards, and the level comparison
       * v(gnd) − v(gnd) = 0 is exactly the LOW the real pin would read.
       */
      const logic = (pinId: string): NetId => net({ partId: part.id, pinId }) ?? gnd
      const out = (pinId: string) => net({ partId: part.id, pinId })
      const { devices } = createL298N(part.id, {
        in1: logic('IN1'),
        in2: logic('IN2'),
        ena: logic('ENA'),
        in3: logic('IN3'),
        in4: logic('IN4'),
        enb: logic('ENB'),
        out1: out('OUT1'),
        out2: out('OUT2'),
        out3: out('OUT3'),
        out4: out('OUT4'),
        vs: out('VS'),
        vss: out('VSS'),
        gnd,
      })
      circuit.add(...devices)
      limitations.push(
        'The motor driver is solved at a DC operating point. Its ~2.5 V transistor drop is ' +
          'modelled, but switching a motor off produces no inductive kick, so the flyback ' +
          'diodes never conduct and the bridge is never seen doing the job it is there for. ' +
          'That needs transient simulation, which the interactive engine does not run yet.',
      )
    } else if (el.kind === 'stepper') {
      const com = net({ partId: part.id, pinId: 'COM' })
      // No common tap on a net means no winding has a return path, so there is
      // nothing to stamp and no position to report.
      if (com === undefined) continue
      const phases = ['A', 'B', 'C', 'D'].map((p) => net({ partId: part.id, pinId: p }))
      const st = new UnipolarStepper(part.id, com, phases, STEPPER_28BYJ48)
      circuit.add(st)
      // The total current out of the common tap. The four coil currents are not
      // separately metered: they are what the driver's channels sink, and the
      // shaft position the monitor reports is the reading that matters.
      meters.set(part.id, st)
      /**
       * A MONITOR, with `ports: {}`. The stepper never drives its own net — it
       * watches the four solved coil voltages and turns the energisation
       * sequence into a shaft position, exactly as BuzzerMonitor turns a drive
       * waveform into a pitch. Giving it a port would let it fight the driver
       * that is supposed to own the wire.
       */
      const stepperNets: Record<string, NetId> = {}
      for (const pin of def.pins) {
        const n = net({ partId: part.id, pinId: pin.id })
        if (n !== undefined) stepperNets[pin.id] = n
      }
      behavioural.push({ partId: part.id, protocol: 'stepper', nets: stepperNets, ports: {} })
      limitations.push(
        'The stepper is solved at a DC operating point: the angle reported is the one the ' +
          'coil sequence commands. Winding inductance is not modelled, so there is no coil ' +
          'rise time, no torque falling away as the step rate climbs, and no inductive kick ' +
          'when a phase switches off — a real 28BYJ-48 starts losing steps long before this ' +
          'model would.',
      )
    } else if (el.kind === 'relay_module') {
      /**
       * A relay board, built one channel at a time.
       *
       * Everything on it returns to its OWN GND pin, never net 0 — the opto
       * LEDs' series resistors and the coil drivers' emitters alike — for the
       * same reason the ULN2003's do. An unwired GND therefore leaves the whole
       * board on a floating island doing nothing, which is what a bench does.
       *
       * A CHANNEL IS ONLY BUILT WHEN SOMETHING IS ATTACHED TO IT. Each one costs
       * two internal nodes (the opto junction and the coil's low side) plus two
       * diodes for Newton to chew on, and a board sitting in the component tray
       * with nothing wired would otherwise spend eight unknowns proving that
       * four unconnected relays are off. "Attached" is topological, not a wire
       * count: a pin is attached when its net carries at least one OTHER
       * component pin, so a jumper into a dead breadboard column still counts as
       * unattached — which is also exactly what it is.
       *
       * The contact terminals count too, not just IN. A de-energised relay has
       * COM sitting on NC, so a load wired through COM/NC is POWERED with no
       * input signal at all; building the channel only when IN is wired would
       * turn that real (and commonly surprising) behaviour into an open circuit.
       */
      const gnd = net({ partId: part.id, pinId: 'GND' })
      const vcc = net({ partId: part.id, pinId: 'VCC' })
      if (gnd === undefined || vcc === undefined) continue

      const joined = (pinId: string): boolean =>
        (componentPins.get(dsu.find(pinKeyOf({ partId: part.id, pinId }))) ?? 0) >= 2

      const ins: Array<NetId | undefined> = []
      const coms: Array<NetId | undefined> = []
      const nos: Array<NetId | undefined> = []
      const ncs: Array<NetId | undefined> = []
      const internal: Array<[NetId, NetId] | undefined> = []
      const relayNets: Record<string, NetId> = {}
      for (const pin of def.pins) {
        const n = net({ partId: part.id, pinId: pin.id })
        if (n !== undefined) relayNets[pin.id] = n
      }

      for (let k = 1; k <= el.channels; k++) {
        ins.push(net({ partId: part.id, pinId: `IN${k}` }))
        coms.push(net({ partId: part.id, pinId: `COM${k}` }))
        nos.push(net({ partId: part.id, pinId: `NO${k}` }))
        ncs.push(net({ partId: part.id, pinId: `NC${k}` }))
        const used =
          joined(`IN${k}`) || joined(`COM${k}`) || joined(`NO${k}`) || joined(`NC${k}`)
        if (!used) {
          internal.push(undefined)
          continue
        }
        const optoJunction = circuit.allocNet()
        const coilNode = circuit.allocNet()
        internal.push([optoJunction, coilNode])
        // The coil node is not a pin, so the behavioural monitor could never
        // see it — and it is the one node that says unambiguously whether the
        // armature has pulled in. Handing it over under a synthetic key is the
        // same move compile() makes when it gives a sensor its VCC net.
        relayNets[`_coil${k}`] = coilNode
        relayNets[`_opto${k}`] = optoJunction
      }

      const activeLow = Number(part.props.activeLow ?? 1) >= 0.5
      const { devices } = createRelayModule(
        part.id,
        { vcc, gnd, in: ins, com: coms, no: nos, nc: ncs, internal },
        activeLow,
        RELAY_MODULE_4CH,
      )
      if (devices.length > 0) {
        circuit.add(...devices)
        limitations.push(
          'The relay is solved at a DC operating point: the contact is where the coil current ' +
            'says it should be. Coil inductance is not modelled, so there is no 5–10 ms pull-in ' +
            'delay, no contact bounce, and the flyback diode is never seen absorbing the ' +
            'inductive kick it is there for — all of which need transient simulation.',
        )
      }
      /**
       * A MONITOR, with `ports: {}`. The board never drives one of its own
       * nets; it watches its coil nodes and reports which way each contact has
       * thrown, exactly as StepperMonitor watches coil voltages. Pushed even
       * when no channel was built, so an unpowered or unwired board says so
       * rather than vanishing from the readout.
       */
      behavioural.push({ partId: part.id, protocol: 'relay', nets: relayNets, ports: {} })
    } else if (el.kind === 'sensor') {
      // Every pin that reached a real net, so the model can read its own supply
      // as well as its signal lines.
      const nets: Record<string, NetId> = {}
      for (const pin of def.pins) {
        const n = net({ partId: part.id, pinId: pin.id })
        if (n !== undefined) nets[pin.id] = n
      }
      // Each driven pin gets its own Norton port, permanently stamped and
      // starting released (high impedance) so it cannot fight whatever else is
      // on the wire before the model has decided anything.
      const ports: Record<string, NortonPort> = {}
      for (const signal of el.drives) {
        const n = nets[signal]
        if (n === undefined) continue
        const port = new NortonPort(`${part.id}.${signal.toLowerCase()}`, 0, n, 1e-9, 0)
        circuit.add(port)
        ports[signal] = port
      }
      if (Object.keys(ports).length === 0) continue
      behavioural.push({ partId: part.id, protocol: el.protocol, nets, ports })
    } else if (el.kind === 'reactive') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      if (el.element === 'capacitor') {
        // A real reactive device now: transient stepping (Circuit.transientStep)
        // charges and discharges it. Circuit.hasReactive is set automatically by
        // add(). At DC (a plain solve, which is what the interactive engine still
        // runs) the Capacitor stamps as a 1e12 Ω open — its true steady state —
        // so the honest limitation below stays accurate until the engine drives a
        // transient loop (TRANSIENT_DESIGN.md §4).
        const microfarads = Number(part.props.microfarads ?? 1)
        circuit.add(new Capacitor(part.id, a, b, microfarads * 1e-6))
        limitations.push(
          'Capacitors are held at their DC steady state (no current flows). ' +
            'Charging, discharging and timing need transient simulation, which is not available yet.',
        )
      } else {
        const millihenries = Number(part.props.millihenries ?? 1)
        circuit.add(new Inductor(part.id, a, b, millihenries * 1e-3))
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
              /**
               * The board's OWN I/O rail, not a constant. This line used to read
               * `volts: 5`, which is right for an Uno and overstates a shorted
               * Pico pad by 52% (3.3 V through the same pad impedance). The
               * fault message quotes this number to the student, so a wrong
               * value here is a wrong lesson, not a rounding error.
               */
              volts: el.logicVolts,
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
      } else if (
        kind === 'darlington_array' ||
        kind === 'h_bridge' ||
        kind === 'relay_module' ||
        (kind === 'sensor' && def.electrical.kind === 'sensor' && def.electrical.protocol === 'mcp3008')
      ) {
        /**
         * A multi-channel driver IC legitimately leaves channels unused, and the
         * experiments that ship these do exactly that: a 28BYJ-48 needs four of a
         * ULN2003's seven sinks, one DC motor uses one of an L298N's two
         * bridges, a four-channel relay board switching one lamp uses one
         * contact set of four, and an MCP3008 reading one pulse sensor uses one
         * of eight analog inputs. Reporting each spare pin as a dangling lead
         * would put eleven "wired to nothing" notices on a CORRECTLY built exp 9
         * — noise that would train a student to ignore the Checks panel.
         *
         * So the same rule the MCU header gets, for the same reason: a pin the
         * student never touched is unused, not broken. A pin they DID wire and
         * that still reaches nothing is a genuine mistake and is still reported.
         */
        if (!wiredKeys.has(pinKeyOf({ partId: part.id, pinId: pin.id }))) continue
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
    motors,
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
