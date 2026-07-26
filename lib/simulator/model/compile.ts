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
  HD44780_BACKLIGHT,
  HD44780_BACKLIGHT_OHMS,
  HD44780_INPUT_OHMS,
  HD44780_SUPPLY,
  Inductor,
  LED_SERIES_R,
  NortonPort,
  RELAY_MODULE_4CH,
  Resistor,
  SENSOR_SUPPLIES,
  SensorPort,
  SensorSupply,
  STEPPER_28BYJ48,
  ULN2003,
  VoltageSource,
  Winding,
  createL298N,
  createLED,
  createRelayModule,
  createStepper,
  createULN2003,
  type DarlingtonSink,
  type Diode,
  type HBridgeChannel,
  type ReactiveDevice,
} from '../devices'
import type { NetId } from '../types'
import { getPart, ledColour, potentiometerLegs, variableResistorOhms } from './parts'
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

/**
 * The channels of one driver IC, tagged by which kind it is.
 *
 * A discriminated union rather than two maps, because the reader
 * (analog-state.ts) has to switch on the kind anyway to describe them, and two
 * maps would let a part appear in neither or — worse — in both.
 */
export type DriverChannels =
  | { kind: 'h_bridge'; channels: HBridgeChannel[] }
  | { kind: 'darlington_array'; channels: DarlingtonSink[]; indices: number[] }

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
  /**
   * Part id → the switching channels of a driver IC, so the engine can report
   * what the driver is DOING.
   *
   * These devices already compute everything a student needs — an
   * HBridgeChannel's mode (coast/forward/reverse/brake) and its two supply
   * verdicts, a DarlingtonSink's on/off and its collector current — on every
   * single solve, and until this map existed all of it was thrown away. The
   * result was two parts, both electrically excellent, that could not tell a
   * student why their motor was not turning. Handed over by NAME for the same
   * reason `reactive` is: the engine has a `Circuit` full of anonymous devices
   * and no way back to the part the student can see.
   */
  drivers: Map<string, DriverChannels>
  /**
   * Name → every element that stores energy: capacitors, inductors, and the
   * WINDINGS inside motors, relay coils and stepper phases.
   *
   * The engine needs these by NAME, not just as anonymous members of the
   * circuit, for one reason: compile() runs on every document edit and builds a
   * brand-new Circuit with brand-new reactive devices sitting at their t=0
   * initial condition. Without a per-part handle there is no way to carry a
   * half-charged capacitor across an edit, and dragging the part two pixels
   * would silently dump its charge — the PIR-hold-timer defect again, in the
   * analog half of the engine.
   *
   * THE KEY IS THE PART ID where the part IS the element (a capacitor, an
   * inductor, a motor) and the DEVICE id where one part holds several (a relay
   * board's four coils, a stepper's four phases: `relay_1.coil1`,
   * `stepper_1.phaseA`). Both are stable across a recompile of the same
   * document, which is all the carry-over needs; `analog-state.ts` only ever
   * looks this map up for `kind: 'reactive'` parts, where the key is the part id.
   */
  reactive: Map<string, ReactiveDevice>
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

/**
 * Ground pin ids a sensor module may declare, in the order the supply check
 * prefers them.
 *
 * Only the MCP3008 has more than one, and DGND leads because the digital supply
 * current returns there — see the sensor branch of compile() for the rest of the
 * reasoning. Every other part declares exactly `GND`, so the order costs nothing.
 */
const SENSOR_GROUND_PINS = ['GND', 'DGND', 'AGND'] as const

/**
 * Every pin an HD44780 module LISTENS on, each of which gets its leakage
 * resistance to the module's own VSS.
 *
 * V0 is in the list and is not a logic input — it is the contrast tap — but it
 * wants the identical treatment for the identical reason: a defined level when
 * nothing is driving it, and an impedance too high to load whatever is.
 */
const LCD_INPUT_PINS = [
  'V0',
  'RS',
  'RW',
  'E',
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
] as const

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

  /**
   * Is this pin ATTACHED to anything — i.e. does its net carry a second
   * component terminal, so current could flow in one and out another?
   *
   * Topological, not a wire count: a jumper into a dead breadboard column is
   * still unattached, which is also exactly what it is. This is the same rule
   * the dangling-lead detection at the foot of compile() uses, hoisted so the
   * relay board and the ULN2003 can share one definition of "wired up" with it.
   */
  const joined = (partId: string, pinId: string): boolean =>
    (componentPins.get(dsu.find(pinKeyOf({ partId, pinId }))) ?? 0) >= 2

  // ─── Instantiate devices ───
  /**
   * How many MCU PARTS the document holds — not how many board types. Two Unos
   * count as two. See where `mcuPorts` is written below for why the count, not
   * the variety, is what decides whether the engine gets a watch list.
   */
  const mcuPartCount = doc.parts.filter((p) => getPart(p.type).electrical.kind === 'mcu').length
  const mcuPorts = new Map<string, NortonPort>()
  const leds = new Map<string, Diode>()
  const motors = new Map<string, DCMotor>()
  const meters = new Map<string, { readonly id: string; current: number }>()
  const drivers = new Map<string, DriverChannels>()
  const reactive = new Map<string, ReactiveDevice>()
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
      /**
       * The TRACK is a per-instance property now, not a library constant.
       *
       * It is genuinely electrical: the whole track sits permanently across
       * whatever the pot is wired between, so a 1 kΩ pot on a 5 V rail burns
       * 5 mA where a 100 kΩ one burns 50 µA — and the same figure is the source
       * impedance the ADC's sample-and-hold has to charge through. A document
       * that carries no `totalOhms` (every starter authored before this prop)
       * falls back to the library value and compiles to exactly what it did.
       *
       * The arithmetic itself lives in parts.ts so the device readout can
       * describe the same divider this stamps, rather than a second copy of it.
       */
      const { lower, upper } = potentiometerLegs(
        Number(part.props.totalOhms ?? el.totalOhms),
        Number(part.props.position ?? 50),
      )
      if (a !== undefined && w !== undefined) circuit.add(new Resistor(part.id + '.a', a, w, lower))
      if (w !== undefined && b !== undefined) circuit.add(new Resistor(part.id + '.b', w, b, upper))
    } else if (el.kind === 'variable_resistor') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      // LDR response is roughly logarithmic in illumination, so interpolate
      // geometrically rather than linearly — a linear map makes the mid-range
      // behave nothing like a real sensor. The curve lives in parts.ts so the
      // device readout reports the resistance this actually stamped.
      const ohms = variableResistorOhms(el.minOhms, el.maxOhms, Number(part.props.light ?? 60))
      const r = new Resistor(part.id, a, b, ohms)
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
        /**
         * THE ONE COIL-LIKE PART THAT WAS NOT GIVEN A REACTIVE MODEL, and the
         * reason is the timestep rather than the physics.
         *
         * A 10 nF piezo on a driving pin (25 Ω) has τ = 250 ns. The engine's
         * floor is 20 µs — eighty times coarser — so a Capacitor here would
         * transfer the right CHARGE per edge (backward Euler conserves it) and
         * report it as a current spread over one whole step: about 2.5 mA for
         * 20 µs where the real part draws 200 mA for 250 ns. The average would
         * be right and the reading would be off by eighty. Modelling it would
         * also put every tone() circuit into the transient loop to produce a
         * number nobody can use. So the element stays a 1e-12 S open, the
         * limitation says what that costs, and the pitch — which is what the
         * part is for — comes from the behavioural monitor.
         */
        limitations.push(
          'A passive buzzer is a bare piezo element: about 10 nF of capacitance and no DC ' +
            'path at all, so the current through it reads zero. Its real current is a ' +
            'displacement spike lasting a few hundred nanoseconds on each edge of the drive ' +
            'waveform — far shorter than the timestep this simulator runs at, so there is no ' +
            'honest reading of it to show. The pitch it is being driven at is reported instead.',
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
      reactive.set(part.id, m)
      /**
       * The armature's INDUCTANCE is modelled and integrated, so the current
       * ramps in and the switch-off kick is real. Rotor INERTIA is not, and the
       * two are different things — this note now says only the second, because
       * the first stopped being a limitation when DCMotor became a winding.
       */
      limitations.push(
        'The motor winding has real inductance, so its current ramps up and it kicks back ' +
          'when switched off. Rotor inertia is not modelled: speed still follows current ' +
          'instantly, so the large start-up current surge a real motor draws while its ' +
          'shaft is still stationary does not appear.',
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
      const { devices, channels } = createULN2003(part.id, { in: ins, out: outs, com, gnd })
      if (devices.length === 0) continue
      circuit.add(...devices)
      /**
       * WHICH channel each entry of `channels` IS.
       *
       * createULN2003 skips any channel whose input net is undefined, so the
       * array is not necessarily 1..7 and `channels[0]` is not necessarily
       * channel 1 — a readout that assumed it would report a 28BYJ-48 driven
       * from IN4..IN7 as channels 1..4. Derived from the same condition
       * createULN2003 itself tests, rather than assumed.
       *
       * In practice every channel IS built today, because a ULN2003 pin always
       * earns a net of its own (a non-MCU pin makes its root active on its own),
       * so `ins[k]` is never undefined. That is fine and costs a few conductance
       * stamps; what it means is that "built" is not the same question as
       * "wired", which is why the metering below asks the second one.
       */
      const indices: number[] = []
      for (let k = 0; k < ins.length; k++) if (ins[k] !== undefined) indices.push(k + 1)
      drivers.set(part.id, { kind: 'darlington_array', channels, indices })
      /**
       * Meter only the channels the student actually WIRED an input to.
       *
       * Metering all seven would put five rows of 0.00 mA in the Measurements
       * panel of a correctly built stepper circuit — the same noise the
       * dangling-lead detection already refuses to produce for the spare pins of
       * a multi-channel driver, and for the same reason.
       */
      for (let k = 0; k < channels.length; k++) {
        if (joined(part.id, `IN${indices[k]}`)) meters.set(`${part.id}.ch${indices[k]}`, channels[k])
      }
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
      const { devices, channels } = createL298N(part.id, {
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
      drivers.set(part.id, { kind: 'h_bridge', channels })
      // Per channel, keyed exactly as the channel's own fault deviceId is
      // (`l298n_1.A`), so a milliamp figure in Measurements and a fault in
      // Checks name the same thing.
      for (const ch of channels) meters.set(ch.id, ch)
      /**
       * NO LIMITATION IS PUSHED HERE ANY MORE.
       *
       * The one that used to be here said the flyback diodes never conduct,
       * because nothing ever produced an inductive kick for them to catch. Both
       * halves of that are now false: the
       * board's eight freewheel diodes are stamped (createL298N), the motor on
       * the output is a winding, and switching the bridge off drives the output
       * past a rail until one diode in each leg conducts and carries the decay.
       * The ~2.5 V transistor drop the note also mentioned was never a
       * limitation — it is modelled, and it is the lesson.
       */
    } else if (el.kind === 'stepper') {
      const com = net({ partId: part.id, pinId: 'COM' })
      // No common tap on a net means no winding has a return path, so there is
      // nothing to stamp and no position to report.
      if (com === undefined) continue
      const phases = ['A', 'B', 'C', 'D'].map((p) => net({ partId: part.id, pinId: p }))
      // The four phase windings are separate reactive devices; see the note on
      // UnipolarStepper for why they cannot be folded into one.
      const { devices: stepperDevices, stepper: st } = createStepper(
        part.id,
        com,
        phases,
        STEPPER_28BYJ48,
      )
      circuit.add(...stepperDevices)
      for (const coil of st.coils) if (coil !== undefined) reactive.set(coil.id, coil)
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
      /**
       * The ELECTRICAL half of the old warning is gone — each phase is a 50 Ω /
       * 300 mH winding now, integrated in time, so there is a rise time and
       * there is a kick. What survives is the MECHANICAL half, which no amount
       * of circuit solving reaches: this model has no rotor and no torque, so it
       * reports the angle the sequence commanded whatever the current did.
       */
      limitations.push(
        'Each stepper winding has real inductance (50 Ω, 300 mH), so the phase current takes ' +
          'about 6 ms to build and kicks back into the driver when the phase switches off. ' +
          'The shaft, though, is not simulated: the angle reported is the one the coil ' +
          'sequence commands, so this model still keeps up at step rates where a real ' +
          '28BYJ-48 would run out of torque and start losing steps.',
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
          joined(part.id, `IN${k}`) ||
          joined(part.id, `COM${k}`) ||
          joined(part.id, `NO${k}`) ||
          joined(part.id, `NC${k}`)
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
        for (const d of devices) if (d instanceof Winding) reactive.set(d.id, d)
        /**
         * WHAT SURVIVES IS THE MECHANICS. The coil is a 70 Ω / 50 mH winding
         * now, so the flyback diode really does carry the release current — that
         * clause is deleted rather than softened. But pull-in delay and contact
         * bounce were never electrical: the coil reaches its pull-in current in
         * L/R = 714 µs and the armature takes the datasheet's 10 ms to move,
         * which is thirteen times longer. Adding inductance does not buy them.
         */
        limitations.push(
          'The relay coil is a real winding (70 Ω, 50 mH), so it charges and its flyback ' +
            'diode carries the current when the coil is switched off. The ARMATURE is not ' +
            'simulated: the contact moves the instant the coil current says it should, with ' +
            'none of the 10 ms pull-in delay, 5 ms release or contact bounce a real relay has.',
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

      /**
       * THE SUPPLY PIN IS A DEVICE NOW, and that is what gives these seven parts
       * a safety() at all.
       *
       * Until this branch stamped one, `kind:'sensor'` built Norton ports and
       * nothing else — so a DHT11 on 12 V, or a DS18B20 with GND and VDD
       * reversed, produced a green Checks panel. See SensorSupply in devices.ts.
       *
       * BOTH terminals are required. A supply pin with no ground return draws
       * nothing and destroys nothing on a bench either — 12 V on a VCC whose GND
       * is in the air is a floating island, not a dead sensor — so a part
       * missing either one is stamped nothing and reports nothing, which is the
       * honest answer rather than a convenient one.
       *
       * GROUND IS THE FIRST DECLARED GROUND PIN THAT REACHED A NET. Six of the
       * seven have exactly one; the MCP3008 has two, and the order below is
       * DGND first because that is the return the digital supply current
       * actually flows in — and because MCP3008Device.supply() in behavioural.ts
       * already reads `VDD − DGND`, so the safety check and the model agree
       * about what "the supply" is by construction.
       */
      const supplyParams = SENSOR_SUPPLIES[el.protocol]
      const supplyNet = supplyParams === undefined ? undefined : nets[supplyParams.supplyPin]
      const groundNet = SENSOR_GROUND_PINS.map((p) => nets[p]).find((n) => n !== undefined)
      if (supplyParams !== undefined && supplyNet !== undefined && groundNet !== undefined) {
        circuit.add(new SensorSupply(`${part.id}.supply`, supplyNet, groundNet, supplyParams))
      }

      /**
       * Each driven pin gets its own Norton port, permanently stamped and
       * starting released (high impedance) so it cannot fight whatever else is
       * on the wire before the model has decided anything.
       *
       * A SensorPort rather than a bare NortonPort, and the difference is not
       * cosmetic: a NortonPort's safety() carries the ATmega328P's pad ratings
       * and the ATmega328P's wording, so overloading an HC-SR04's ECHO used to
       * report "…mA through a pin rated for 40 mA … this pin is destroyed"
       * against `hcs_4.echo`. Wrong part, wrong datasheet, stated with total
       * confidence. A protocol with no ratings row falls back to the plain port
       * rather than inventing one.
       */
      const ports: Record<string, NortonPort> = {}
      for (const signal of el.drives) {
        const n = nets[signal]
        if (n === undefined) continue
        const id = `${part.id}.${signal.toLowerCase()}`
        const port =
          supplyParams === undefined
            ? new NortonPort(id, 0, n, 1e-9, 0)
            : new SensorPort(id, 0, n, 1e-9, 0, supplyParams, signal)
        circuit.add(port)
        ports[signal] = port
      }
      if (Object.keys(ports).length === 0) continue
      behavioural.push({ partId: part.id, protocol: el.protocol, nets, ports })
    } else if (el.kind === 'reactive') {
      const a = net({ partId: part.id, pinId: '1' })
      const b = net({ partId: part.id, pinId: '2' })
      if (a === undefined || b === undefined) continue
      /**
       * A real reactive element, genuinely integrated in time.
       *
       * `Circuit.hasReactive` is set automatically by add(), and BOTH engines
       * read it to switch their run loop from "solve one DC operating point and
       * memoise it" to "advance backward-Euler steps in step with the MCU
       * clock" (engine.ts stepTransient / pico/engine.ts). That is why the
       * "charging and timing are not simulated" limitation that used to be
       * pushed here is gone: it is no longer true, and leaving a stale warning
       * up is its own kind of dishonesty.
       *
       * A plain DC `solve()` still stamps a capacitor as a 1e12 Ω open and an
       * inductor as a 0.01 Ω short — their true steady states — so nothing that
       * only ever calls solve() changes behaviour.
       */
      const device: ReactiveDevice =
        el.element === 'capacitor'
          ? new Capacitor(part.id, a, b, Number(part.props.microfarads ?? 1) * 1e-6)
          : new Inductor(part.id, a, b, Number(part.props.millihenries ?? 1) * 1e-3)
      circuit.add(device)
      reactive.set(part.id, device)
      // Both report a branch current from the step just advanced, so the
      // Measurements panel can show a charging cap's current decaying to zero —
      // which is the one number that says out loud that time is passing.
      meters.set(part.id, device)
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
      /**
       * COLOUR IS ELECTRICAL, not decoration.
       *
       * A red LED drops ~2.0 V and a blue or green one ~3.2 V, so the same
       * 220 Ω on the same 5 V Uno pad passes 12.39 mA of red and 7.47 mA of
       * blue. Rendering the dome blue while solving it as red would put a
       * number in the Measurements panel that no bench would ever produce — and
       * on a Pico's 3.3 V rail the difference is the whole answer: 5.16 mA of
       * red against 0.90 mA of blue, i.e. an LED that barely lights.
       *
       * `ledColour(undefined)` is red, whose `is` is the literal 1e-20 fitted
       * against the ngspice reference solves — so a document that carries no
       * colour (every starter authored before this prop, every saved attempt)
       * compiles to exactly the circuit it did before.
       */
      const colour = ledColour(part.props.color)
      const { devices, diode } = createLED(part.id, a, c, internal, {
        is: colour.is,
        n: colour.n,
      })
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
          /**
           * Keyed by BARE pin name, which is correct only because exactly one
           * MCU may run — both engines look these up as "D13"/"GP15" while
           * mapping a CPU port-and-bit onto a pad, and they have no part id to
           * qualify it with.
           *
           * So a document holding two MCUs registers NONE of them. It used to
           * register both, and since the key omits the part the second Uno's
           * "D13" silently replaced the first's: the engine then drove
           * whichever board sorted last in `doc.parts` and left the other one
           * wired, powered and inert, with nothing on screen saying why.
           * detectBoard() refuses such a document, so nothing can run either
           * way — but an empty map is the honest representation of "no board
           * is being driven", and it cannot be mistaken for a working one.
           *
           * The NortonPorts themselves are still stamped for every MCU, because
           * the analog solve needs each pad's pull-up/pull-down regardless of
           * which CPU is running. Only the engine's watch list is withheld.
           */
          if (mcuPartCount === 1) mcuPorts.set(pin.id, port)
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
    } else if (el.kind === 'character_lcd') {
      /**
       * A character LCD: a supply, eleven high-impedance inputs, a contrast tap
       * and a backlight — and then a monitor that reads the wire.
       *
       * EVERYTHING RETURNS TO THE MODULE'S OWN VSS, never to net 0, for the same
       * reason the ULN2003's and the relay board's do. Without that pin on a net
       * there is no reference for a logic level and no return for the supply
       * current, so the part is stamped nothing and decodes nothing — which is
       * exactly what a module with its ground lead in the air does.
       */
      const vss = net({ partId: part.id, pinId: 'VSS' })
      const vdd = net({ partId: part.id, pinId: 'VDD' })
      if (vss === undefined) continue

      if (vdd !== undefined) {
        circuit.add(new SensorSupply(`${part.id}.supply`, vdd, vss, HD44780_SUPPLY))
      }

      /**
       * The input leakage of every pin the controller LISTENS on.
       *
       * Not a formality. D0-D3 are unconnected in a 4-bit wiring, and the
       * initialisation sequence only works because the silicon reads them as
       * zero while it is still in 8-bit mode; a pin with no defined level would
       * make the first four bytes of every sketch's startup a coin toss. V0 gets
       * the same high impedance because the bias tap draws tens of microamps at
       * most, and loading a student's trimmer would move the contrast they set.
       */
      for (const pinId of LCD_INPUT_PINS) {
        const n = net({ partId: part.id, pinId })
        if (n === undefined || n === vss) continue
        circuit.add(
          new Resistor(`${part.id}.${pinId.toLowerCase()}in`, n, vss, HD44780_INPUT_OHMS),
        )
      }

      /**
       * The backlight, as the LED array and the on-board ballast it really is.
       *
       * Metered under `<part>.backlight` and registered as an LED, so the panel
       * reports its current and the canvas gets a brightness for it through the
       * same path every other LED uses — which is what makes a backlight on a
       * PWM pin dim rather than blink, since the engine's display filter is
       * already averaging that map.
       */
      const anode = net({ partId: part.id, pinId: 'A' })
      const cathode = net({ partId: part.id, pinId: 'K' })
      if (anode !== undefined && cathode !== undefined && anode !== cathode) {
        const internal = circuit.allocNet()
        const { devices, diode } = createLED(
          `${part.id}.backlight`,
          anode,
          cathode,
          internal,
          HD44780_BACKLIGHT,
          // The module's own ballast, plus the array's bulk resistance: two
          // junctions in series, each carrying the same LED_SERIES_R every other
          // LED in this simulator does.
          HD44780_BACKLIGHT_OHMS + 2 * LED_SERIES_R,
        )
        circuit.add(...devices)
        leds.set(`${part.id}.backlight`, diode)
        meters.set(`${part.id}.backlight`, diode)
      }

      /**
       * A MONITOR, with `ports: {}`.
       *
       * The display never drives one of its own nets. Every signal pin is an
       * input, so giving it a port would let it fight the sketch for the bus it
       * is supposed to be listening to — the same reasoning that keeps
       * RelayMonitor and StepperMonitor portless. What it does instead is read
       * the solved voltages on E, RS, R/W and D0-D7 and decode the HD44780's own
       * protocol out of them.
       */
      const lcdNets: Record<string, NetId> = {}
      for (const pin of def.pins) {
        const n = net({ partId: part.id, pinId: pin.id })
        if (n !== undefined) lcdNets[pin.id] = n
      }
      behavioural.push({ partId: part.id, protocol: 'hd44780', nets: lcdNets, ports: {} })

      /**
       * FOUR THINGS THIS DISPLAY DOES NOT DO, each stated narrowly enough to be
       * checkable and none of them claiming the engine is incapable of it.
       */
      limitations.push(
        'The LCD decodes writes only. A transfer with R/W high is a READ — the busy flag, ' +
          'the address counter or a character read back out of display memory — and the model ' +
          'counts those and leaves the data pins alone instead of answering them. Arduino’s ' +
          'LiquidCrystal never wires R/W and never reads, so a stock sketch is unaffected; a ' +
          'sketch that polls the busy flag will wait forever for a reply.',
      )
      limitations.push(
        'The eight custom characters an HD44780 can be given are accepted and stored, so the ' +
          'address counter stays in step with the sketch, but they are not drawn: a cell ' +
          'holding one of codes 0-7 shows an empty box. Codes 0xA0-0xFF — the katakana and ' +
          'Greek half of the A00 character ROM — are shown the same way. Everything in ' +
          '0x20-0x7F is drawn from the real 5x8 ROM bitmaps, including the yen sign at 0x5C ' +
          'and the two arrows at 0x7E and 0x7F that a sketch printing ASCII does not expect.',
      )
      limitations.push(
        'Instructions take effect the instant the E pulse ends. A real HD44780 needs 37 µs ' +
          'for most of them and 1.52 ms after a clear or a home, during which it ignores the ' +
          'bus; this model accepts writes sent inside that window that the hardware would ' +
          'drop. A sketch whose delays are too short therefore works here and fails on a ' +
          'bench, which is the one direction this simulator is more forgiving than the part.',
      )
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
        /**
         * A 16-pin LCD wired in 4-bit mode leaves FIVE pins deliberately unused
         * — D0-D3 and, on the common wiring, R/W — and the backlight pair is
         * optional on top of that. Six "wired to nothing" notices on a correctly
         * built display is exactly the noise this exemption exists to stop.
         */
        kind === 'character_lcd' ||
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
    drivers,
    reactive,
    analogNets,
    pinNets,
    behavioural,
    limitations: [...new Set(limitations)],
    problems,
    shortedPins,
    unknowns: circuit.size,
  }
}
