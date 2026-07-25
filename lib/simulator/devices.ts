/**
 * Device models and their MNA stamps.
 *
 * Every device contributes conductances to A and currents to b. Nonlinear
 * devices linearise around the previous Newton iterate (companion model:
 * a conductance Geq in parallel with a current source Ieq).
 */

import { type Device, type StampContext, type NetId, type SolveFault, VT } from './types'

/**
 * Read-only view of the converged solution handed to a reactive device after a
 * transient step succeeds, so it can advance its stored state. Deliberately
 * narrower than StampContext: advancing must only READ node voltages, never
 * touch the matrix, and a full StampContext satisfies this shape structurally.
 */
export interface TransientContext {
  voltage(net: NetId): number
}

/**
 * A device with memory: a capacitor or inductor whose companion model depends on
 * a timestep `h` and on state stored from the previous accepted step. The DC
 * solver knows nothing about these methods — Circuit.transientStep() drives them
 * (see solver.ts). At DC (no step set) they stamp exactly as the old stub did, so
 * a plain solve() of a cap/inductor circuit is byte-for-byte unchanged.
 */
export interface ReactiveDevice extends Device {
  /** Set the timestep for the NEXT stamp(). h <= 0 means DC mode. */
  setStep(h: number): void
  /** Advance stored state from the converged voltages of the step just solved. */
  advance(ctx: TransientContext): void
  /** Return to the t=0 initial condition (uncharged cap / zero inductor current). */
  resetTransient(): void
  /**
   * The two nets this element bridges.
   *
   * Read by two callers that both need to talk ABOUT the element rather than
   * stamp it: Circuit.smallestTimeConstant(), which drives a unit test current
   * between these nets to measure the resistance the network presents; and the
   * engine, which uses them to decide whether a stored charge is still the same
   * charge after the student edits the document.
   */
  readonly terminals: readonly [NetId, NetId]
  /**
   * The time constant this element would have if the rest of the network
   * presented `rTh` ohms across its terminals, in seconds: R·C for a capacitor,
   * L/R for an inductor.
   *
   * The element owns this rather than the caller because the two formulas are
   * reciprocal in R — an engine that guessed "τ = R × value" would size the
   * timestep for an inductor by a factor of R² out.
   */
  timeConstant(rTh: number): number
  /**
   * Stored state: branch VOLTS for a capacitor, branch AMPS for an inductor.
   *
   * Writable, and that is the point. compile() builds a brand-new Circuit — and
   * therefore brand-new reactive devices at their t=0 initial condition — on
   * every document edit, including a mere drag across the canvas. Without a way
   * to carry the state over, nudging a capacitor two pixels would dump its
   * charge. That is the same class of defect as the PIR whose hold timer was
   * reset by the very prop change that started it.
   */
  state: number
  /**
   * Branch current from the step just advanced, amps, a → b. Both elements
   * already computed it; declaring it here is what lets compile() put them in
   * `meters` alongside the resistors and LEDs.
   */
  current: number
}

export function isReactive(d: Device): d is ReactiveDevice {
  const r = d as Partial<ReactiveDevice>
  return typeof r.setStep === 'function' && typeof r.advance === 'function'
}

// ─── Linear devices ───────────────────────────────────────────────────────────

/** Stamp a conductance between two nets. The workhorse of every device. */
function stampConductance(ctx: StampContext, a: NetId, b: NetId, g: number): void {
  const ia = ctx.index(a)
  const ib = ctx.index(b)
  const n = ctx.n
  if (ia >= 0) ctx.A[ia * n + ia] += g
  if (ib >= 0) ctx.A[ib * n + ib] += g
  if (ia >= 0 && ib >= 0) {
    ctx.A[ia * n + ib] -= g
    ctx.A[ib * n + ia] -= g
  }
}

/** Stamp a current source pushing `i` amps from net `a` through to net `b`. */
function stampCurrent(ctx: StampContext, a: NetId, b: NetId, i: number): void {
  const ia = ctx.index(a)
  const ib = ctx.index(b)
  if (ia >= 0) ctx.b[ia] -= i
  if (ib >= 0) ctx.b[ib] += i
}

/**
 * Floor for any resistance, in ohms. This is a NUMERICAL limit, not cosmetic.
 *
 * Clamping R=0 to 1e-12 Ω stamps a conductance of 1e12 S onto the diagonal.
 * Double precision carries ~2.2e-16 relative error, so any conductance below
 * 1e12 × 2.2e-16 ≈ 2.2e-4 S — i.e. any resistor above ~4.5 kΩ — is annihilated
 * when summed against it. Measured with the old clamp: a 5V/10k/short/10k
 * divider returned 2.048 V where theory says 2.500 V, and reported ok:true,
 * because the matrix is only singular to working precision and LU never
 * notices. 1 mΩ is both physically honest for a wire and numerically safe.
 */
export const MIN_RESISTANCE = 1e-3

export class Resistor implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  constructor(
    readonly id: string,
    private a: NetId,
    private b: NetId,
    private ohms: number,
  ) {}

  stamp(ctx: StampContext): void {
    // Invalid input is rejected, not reinterpreted. Clamping a negative
    // resistance silently turns it into a 1 mΩ short and returns a plausible
    // 0 V — the same class of silent-wrong-answer that Circuit.index() rejects
    // for unallocated nets, so it is rejected the same way. Circuit.solve()
    // catches this and surfaces it as ok:false.
    if (!Number.isFinite(this.ohms) || this.ohms < 0) {
      throw new Error(
        `Resistor "${this.id}" has an invalid resistance (${this.ohms}). ` +
          `Resistance must be a finite, non-negative number.`,
      )
    }
    const r = Math.max(this.ohms, MIN_RESISTANCE)
    stampConductance(ctx, this.a, this.b, 1 / r)
  }

  /** Current a→b, from the converged voltages. */
  currentThrough(ctx: StampContext): number {
    const r = Math.max(this.ohms, MIN_RESISTANCE)
    return (ctx.voltage(this.a) - ctx.voltage(this.b)) / r
  }

  readback(ctx: StampContext): void {
    this.current = this.currentThrough(ctx)
  }

  /** Last solved current, amps. */
  current = 0

  /** Power rating in watts. A common through-hole resistor is quarter-watt. */
  rating = 0.25

  safety(ctx: StampContext): SolveFault | null {
    const i = this.currentThrough(ctx)
    const p = i * i * Math.max(this.ohms, MIN_RESISTANCE)
    if (p <= this.rating) return null
    return {
      kind: 'over_power',
      severity: 'destructive',
      deviceId: this.id,
      value: p,
      message: `Resistor is dissipating ${p.toFixed(2)} W — it is rated for ${this.rating} W and would burn out.`,
    }
  }
}

/**
 * Ideal voltage source. Needs one extra unknown (its branch current), which is
 * what makes this "modified" nodal analysis.
 */
export class VoltageSource implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 1
  branchIndex = -1

  constructor(
    readonly id: string,
    private pos: NetId,
    private neg: NetId,
    public volts: number,
  ) {}

  stamp(ctx: StampContext): void {
    const ip = ctx.index(this.pos)
    const im = ctx.index(this.neg)
    const k = this.branchIndex
    const n = ctx.n
    if (ip >= 0) {
      ctx.A[ip * n + k] += 1
      ctx.A[k * n + ip] += 1
    }
    if (im >= 0) {
      ctx.A[im * n + k] -= 1
      ctx.A[k * n + im] -= 1
    }
    ctx.b[k] += this.volts
  }

  /** Branch current, from the converged solution. Positive = out of pos. */
  current = 0

  readback(ctx: StampContext): void {
    this.current = this.branchIndex >= 0 ? ctx.x[this.branchIndex] : 0
  }

  /** Amps beyond which this is a short, not a load. */
  maxCurrent = 1

  safety(ctx: StampContext): SolveFault | null {
    const i = Math.abs(this.branchIndex >= 0 ? ctx.x[this.branchIndex] : 0)
    if (i <= this.maxCurrent) return null
    return {
      kind: 'short_circuit',
      severity: 'destructive',
      deviceId: this.id,
      value: i,
      message:
        `${i.toFixed(1)} A is being drawn from a ${this.volts} V supply — that is a short circuit. ` +
        `On real hardware this destroys the board or the supply.`,
    }
  }
}

/**
 * A Norton-form source: conductance G to `b`, in parallel with current I.
 *
 * This is how every MCU pin is stamped (SIMULATOR_ARCHITECTURE.md §2.6). Pins
 * are stamped permanently, so the sparsity pattern never changes between pin
 * states and the symbolic structure stays constant.
 */
export class NortonPort implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  constructor(
    readonly id: string,
    /**
     * `protected`, not `private`, so SensorPort can read them in its own
     * safety(). Nothing outside this file can see them either way — the change
     * buys a subclass, not an escape hatch.
     */
    protected a: NetId,
    protected b: NetId,
    public g: number,
    public i: number,
  ) {}

  set(g: number, i: number): void {
    this.g = g
    this.i = i
  }

  stamp(ctx: StampContext): void {
    stampConductance(ctx, this.a, this.b, this.g)
    // Current flows a → b, i.e. INTO the driven node. Reversing these two
    // arguments drives the node to −V instead of +V, which is silent: the
    // solver converges happily and the LED simply never lights.
    stampCurrent(ctx, this.a, this.b, this.i)
  }

  /**
   * ATmega328P per-I/O-pin current limits, from the datasheet
   * (§32.2 Absolute Maximum Ratings and §32 DC Characteristics):
   *
   *   maxCurrent  0.040 A — absolute maximum DC current per I/O pin. Past this
   *                         the output driver is damaged: the pin is destroyed.
   *   ratedCurrent 0.020 A — the current at which Atmel still guarantees valid
   *                         output logic levels; the recommended continuous
   *                         maximum. Between the two the pin works but is
   *                         over-stressed — a caution, not a destruction.
   */
  ratedCurrent = 0.02
  maxCurrent = 0.04

  /**
   * Current the port drives OUT into its net, amps.
   *
   * The branch current a → b of a Norton source: i − g·(V_b − V_a). Real MCU
   * pins reference ground (a = 0), so this is (V_open − V_net)/R_drive, exactly
   * the current sourced.
   *
   * Only a pin actively SOURCING can exceed a few mA. A floating or pull-up
   * INPUT (i ≈ 0 with a tiny g) can source at most ~0.25 mA, and a pin sinking
   * current gives a negative value — both fall under any rating and never
   * fault, which is the "floating/input pins must not fault" rule.
   */
  protected sourcedCurrent(ctx: StampContext): number {
    return this.i - this.g * (ctx.voltage(this.b) - ctx.voltage(this.a))
  }

  /**
   * True when this port contributes nothing to the matrix, so there is no real
   * current to judge and nothing any safety() should report:
   *   - a pin wired straight to GND has a === b === ground. That is a
   *     topological dead short, already surfaced by ShortedPin in compile.ts
   *     and gated on drive state by the engine, so reporting it again here
   *     would double-count it.
   *   - a degenerate self-loop (a === b on a floating net) is a no-op.
   */
  protected degenerate(): boolean {
    return this.a === this.b
  }

  safety(ctx: StampContext): SolveFault | null {
    if (this.degenerate()) return null

    const sourced = this.sourcedCurrent(ctx)
    if (sourced <= this.ratedCurrent) return null

    const mA = (sourced * 1000).toFixed(0)
    if (sourced <= this.maxCurrent) {
      return {
        kind: 'over_current',
        severity: 'caution',
        deviceId: this.id,
        value: sourced,
        message:
          `${mA} mA out of an I/O pin, past the ${(this.ratedCurrent * 1000).toFixed(0)} mA ` +
          `it is recommended to stay under. On real hardware, drawing this ` +
          `continuously over-stresses the pin.`,
      }
    }
    return {
      kind: 'over_current',
      severity: 'destructive',
      deviceId: this.id,
      value: sourced,
      message:
        `${mA} mA through a pin rated for ${(this.maxCurrent * 1000).toFixed(0)} mA. ` +
        `On real hardware this pin is destroyed.`,
    }
  }
}

// ─── Sensor modules: supply and output ────────────────────────────────────────

/**
 * The datasheet numbers that decide whether a sensor MODULE survives its wiring.
 *
 * WHY ONE PARAMETERISED PAIR OF DEVICES AND NOT SEVEN CLASSES. The seven tier-2
 * sensor parts differ in their protocols — which is why each has a behavioural
 * model of its own, hundreds of lines apart — but they do not differ at all in
 * how they are DESTROYED. Every one of them dies the same three ways: too much
 * volts on the supply pin, the supply pin and the ground pin swapped, or an
 * output driven into more current than its pad can pass. Seven classes would be
 * seven copies of the same three comparisons, and the numbers would drift; one
 * class plus one table per part keeps the mechanism in one place and the
 * DATASHEET in the other, which is the split every other multi-part model here
 * already uses (BuzzerParams, MotorParams, DarlingtonParams, HBridgeParams).
 *
 * The alternative — putting the ratings on the part definition in parts.ts —
 * was rejected because parts.ts is geometry and inspector data: it has no other
 * electrical constant in it, and a rating declared there would be one more thing
 * that can be declared and never reach the solver, which is the exact class of
 * defect this work exists to close.
 *
 * WHAT IS A DATASHEET LINE AND WHAT IS A JUDGEMENT is marked per part in
 * SENSOR_SUPPLIES below. Modules assembled from a jellybean MCU (HC-SR04,
 * HC-SR501, DHT11) publish an operating window and no absolute maximum at all;
 * the silicon parts (DS18B20, MCP3008) publish both.
 */
export interface SensorSupplyParams {
  /** Lowest supply the part is specified to work at, volts. */
  minVolts: number
  /** Highest supply the part is specified to work at, volts. */
  maxVolts: number
  /**
   * Absolute maximum supply, volts. Above this the part is destroyed rather
   * than merely out of spec.
   */
  absMaxVolts: number
  /**
   * Reverse supply the part survives, volts (a POSITIVE magnitude). Silicon
   * datasheets print this as the "−0.5 V on any pin" line; beyond it the
   * substrate diode conducts unbounded and the die cooks.
   */
  absMaxReverseVolts: number
  /** Supply current drawn in normal operation, amps. */
  supplyAmps: number
  /** Continuous current a driven output pin is specified for, amps. */
  outputRatedAmps: number
  /** Absolute maximum current on a driven output pin, amps. */
  outputMaxAmps: number
  /** Part name WITH its article, for fault messages: "a DHT11", "an MCP3008". */
  label: string
  /** What the part calls its supply pin — "VCC" or "VDD". */
  supplyPin: string
}

/**
 * Per-protocol ratings for every tier-2 sensor.
 *
 * Keyed by the SAME protocol string the part declares in `electrical.protocol`
 * and the engine switches on in makeBehavioural(), so a new sensor cannot be
 * added with a model and no ratings without the key being obviously absent.
 *
 * Sources, one per part. `[sheet]` marks a printed datasheet line; `[judged]`
 * marks a number the datasheet does not give, with the reasoning that bounds it.
 */
export const SENSOR_SUPPLIES: Record<string, SensorSupplyParams> = {
  /**
   * DHT11 (Aosong / D-Robotics DHT11 datasheet).
   *   [sheet]  Power supply 3.3-5.5 V DC
   *   [sheet]  Supply current: measuring 0.3 mA, standby 60 uA
   *   [judged] No absolute maximum is printed anywhere in the sheet. 6.0 V is
   *            taken from the DS18B20's own printed +6.0 V "any pin" limit,
   *            which is the same 5 V CMOS process class the module's on-board
   *            8-bit MCU is built on; the module has no regulator, so its supply
   *            pin IS that die's VDD.
   *   [judged] No output current is specified. The DATA line is open-drain and
   *            the model only ever pulls it DOWN, so the rating that matters is
   *            a sink: 10 mA / 25 mA is the ordinary 8-bit-MCU pad limit and is
   *            far above the ~1 mA a 4.7 kOhm pull-up delivers on a correctly
   *            built bus.
   */
  dht11: {
    minVolts: 3.3,
    maxVolts: 5.5,
    absMaxVolts: 6.0,
    absMaxReverseVolts: 0.5,
    supplyAmps: 0.3e-3,
    outputRatedAmps: 0.01,
    outputMaxAmps: 0.025,
    label: 'a DHT11',
    supplyPin: 'VCC',
  },
  /**
   * DS18B20 (Analog Devices / Maxim DS18B20 datasheet).
   *   [sheet]  Absolute maximum: voltage on any pin relative to ground
   *            -0.5 V to +6.0 V
   *   [sheet]  Operating VDD 3.0 V to 5.5 V
   *   [sheet]  Active supply current 1.0 mA typ (1.5 mA max)
   *   [sheet]  DQ logic 0: IOL = 4.0 mA at VOL 0.4 V max
   *   [judged] The absolute maximum DQ current is not printed. 20 mA is the
   *            standard limit for the open-drain pad class and is 5x the only
   *            characterised sink, which is the whole span the part is specified
   *            over.
   * Reversing GND and VDD is the classic way to cook one of these — parts.ts
   * says so on the pinout, and this is the number that makes the simulator
   * agree.
   */
  ds18b20: {
    minVolts: 3.0,
    maxVolts: 5.5,
    absMaxVolts: 6.0,
    absMaxReverseVolts: 0.5,
    supplyAmps: 1.0e-3,
    outputRatedAmps: 0.004,
    outputMaxAmps: 0.02,
    label: 'a DS18B20',
    supplyPin: 'VDD',
  },
  /**
   * HC-SR04 (the module's own spec sheet, as sold).
   *   [sheet]  Working voltage DC 5 V
   *   [sheet]  Working current 15 mA
   *   [judged] 4.5-5.5 V as the working window: 4.5 V is already the model's own
   *            HC_SR04.MIN_SUPPLY_VOLTS in behavioural.ts (the point below which
   *            the module releases ECHO and drives nothing), and +-10 % of a
   *            5 V rail is the narrowest defensible reading of "DC 5 V".
   *   [judged] 6.0 V absolute maximum, on the same reasoning as the DHT11: the
   *            board is a bare 5 V MCU plus a 40 kHz driver, with no regulator.
   *   [judged] ECHO is a push-pull MCU pad; 10 mA / 25 mA is that pad class.
   */
  hc_sr04: {
    minVolts: 4.5,
    maxVolts: 5.5,
    absMaxVolts: 6.0,
    absMaxReverseVolts: 0.5,
    supplyAmps: 15e-3,
    outputRatedAmps: 0.01,
    outputMaxAmps: 0.025,
    label: 'an HC-SR04',
    supplyPin: 'VCC',
  },
  /**
   * HC-SR501 PIR (the module's own spec sheet).
   *   [sheet]  Working voltage range DC 4.5 V - 20 V
   *   [sheet]  Static current < 60 uA
   *   [sheet]  Output 3.3 V / 0 V
   *   [judged] 24 V absolute maximum. The board regulates its own 3.3 V with an
   *            HT7133-class LDO, whose input absolute maximum is 24 V; the 20 V
   *            in the spec is the working limit below it.
   *   [judged] The 3.3 V output comes from the BISS0001's OUT pin through the
   *            board's series resistor; no current is specified. 10 mA / 25 mA
   *            again, and note this part is the one where the rating is least
   *            likely to be reached — it drives an MCU input.
   * NOTE THE CONSEQUENCE: a student who puts 12 V on a PIR gets NO fault, which
   * is correct. A real HC-SR501 runs happily on 12 V and that is why the module
   * exists in alarm kits.
   */
  pir: {
    minVolts: 4.5,
    maxVolts: 20,
    absMaxVolts: 24,
    absMaxReverseVolts: 0.5,
    supplyAmps: 60e-6,
    outputRatedAmps: 0.01,
    outputMaxAmps: 0.025,
    label: 'an HC-SR501 PIR',
    supplyPin: 'VCC',
  },
  /**
   * YF-S201 water flow sensor (the sensor's own spec sheet).
   *   [sheet]  Working voltage 5 V - 18 V DC
   *   [sheet]  Max current draw 15 mA at 5 V
   *   [sheet]  Output load capacity <= 10 mA at DC 5 V  <- a REAL printed
   *            output-current limit, and the only one of the seven that has one
   *   [judged] 24 V absolute maximum, 20 % over the printed 18 V working top —
   *            the same margin convention DCMotor and UnipolarStepper use where
   *            a sheet gives no absolute maximum.
   *   [judged] 25 mA as the destructive output figure: the open-collector
   *            transistor is a jellybean small-signal NPN, and 2.5x the printed
   *            load capacity is where one stops being a switch.
   * The model's own YF_S201.MIN_SUPPLY_VOLTS is 4.5, half a volt under the
   * printed 5, on the same courtesy the HC-SR04 gets — so `minVolts` here is the
   * SHEET's 5 and the behavioural cut-off is deliberately more forgiving.
   */
  flow: {
    minVolts: 5,
    maxVolts: 18,
    absMaxVolts: 24,
    absMaxReverseVolts: 0.5,
    supplyAmps: 15e-3,
    outputRatedAmps: 0.01,
    outputMaxAmps: 0.025,
    label: 'a YF-S201 flow sensor',
    supplyPin: 'VCC',
  },
  /**
   * Pulse sensor SEN-11574 / "Pulse Sensor Amped".
   *   [sheet]  Operating voltage 3 V to 5 V (the product's own spec)
   *   [sheet]  Current draw ~4 mA
   *   [sheet]  The amplifier is an MCP6001, whose absolute maximum VDD-VSS is
   *            7.0 V and whose output short-circuit current is +-23 mA typical.
   *   [judged] Splitting the MCP6001's 23 mA short-circuit figure into a 10 mA
   *            rated / 23 mA maximum pair: the op-amp is a signal source feeding
   *            an ADC and is not specified to drive a load at all, so the rated
   *            figure is a working limit rather than a sheet line.
   */
  pulse: {
    minVolts: 3.0,
    maxVolts: 5.5,
    absMaxVolts: 7.0,
    absMaxReverseVolts: 0.3,
    supplyAmps: 4e-3,
    outputRatedAmps: 0.01,
    outputMaxAmps: 0.023,
    label: 'a pulse sensor',
    supplyPin: 'VCC',
  },
  /**
   * MCP3008 (Microchip DS21295).
   *   [sheet]  Absolute maximum VDD 7.0 V
   *   [sheet]  Absolute maximum on all inputs and outputs w.r.t. VSS:
   *            -0.6 V to VDD +0.6 V   -> the reverse figure below
   *   [sheet]  Operating VDD 2.7 V to 5.5 V
   *   [sheet]  IDD 425 uA typ at VDD = 5 V, fSAMPLE = 200 ksps
   *   [sheet]  Maximum output current sunk or sourced by any output pin: 25 mA
   *   [judged] 10 mA as the RATED output figure. DOUT drives one SPI master
   *            input, and the sheet gives no continuous figure below its 25 mA
   *            absolute maximum.
   * The supply is referenced to DGND, exactly as MCP3008Device.supply() reads it
   * in behavioural.ts — AGND is the analog return and a part with only AGND
   * wired has no digital return path at all.
   */
  mcp3008: {
    minVolts: 2.7,
    maxVolts: 5.5,
    absMaxVolts: 7.0,
    absMaxReverseVolts: 0.6,
    supplyAmps: 425e-6,
    outputRatedAmps: 0.01,
    outputMaxAmps: 0.025,
    label: 'an MCP3008',
    supplyPin: 'VDD',
  },
}

/**
 * A sensor module's supply pin: the load it draws, and every way that supply
 * can destroy it.
 *
 * BEFORE THIS DEVICE EXISTED, `kind:'sensor'` built a Norton port per driven pin
 * and NOTHING ELSE — so seven parts had no safety() at all. A student could put
 * 12 V on a DHT11's VCC, or reverse a DS18B20's GND and VDD, and the Checks
 * panel stayed green.
 *
 * It is also a real electrical improvement rather than a bolted-on checker: the
 * supply pin is now a genuine LOAD. A sensor fed through a series resistor drops
 * a real voltage across it and can be seen to brown out, where before its VCC
 * pin drew exactly nothing and any resistor in front of it was invisible.
 *
 * The load is a CONDUCTANCE, not a current source, for the same reason Buzzer's
 * is: G = I_supply / V_nominal, taken at the top of the specified window. A
 * current source would keep pulling its rated amps out of a dead rail, which is
 * not what a CMOS part does and would make a browned-out sensor look like a
 * short. It is linear, so it cannot make Newton limit-cycle.
 */
export class SensorSupply implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  /** Supply current at the last solve, amps. Positive is into the supply pin. */
  current = 0

  constructor(
    readonly id: string,
    /** The part's VCC / VDD net. */
    private pos: NetId,
    /** The part's OWN ground pin's net — never net 0 unless it was wired there. */
    private neg: NetId,
    readonly params: SensorSupplyParams,
  ) {}

  /** Conductance the module presents across its supply, siemens. */
  get conductance(): number {
    return this.params.supplyAmps / this.params.maxVolts
  }

  stamp(ctx: StampContext): void {
    stampConductance(ctx, this.pos, this.neg, this.conductance)
  }

  /** Supply voltage at the converged solution, volts. Negative means reversed. */
  voltsAcross(ctx: StampContext): number {
    return ctx.voltage(this.pos) - ctx.voltage(this.neg)
  }

  readback(ctx: StampContext): void {
    this.current = this.voltsAcross(ctx) * this.conductance
  }

  safety(ctx: StampContext): SolveFault | null {
    const p = this.params
    // A device whose two terminals are the same net stamps nothing and can
    // report nothing — the same rule NortonPort.degenerate() states.
    if (this.pos === this.neg) return null
    const v = this.voltsAcross(ctx)

    /**
     * REVERSED FIRST, because it is the more specific diagnosis and the more
     * expensive mistake. A negative supply is not "under-volts"; it is the
     * supply and ground pins swapped, and every silicon datasheet here bounds it
     * with the same "-0.5 V on any pin" line: past that the substrate diode
     * conducts without limit.
     */
    if (v < -p.absMaxReverseVolts) {
      return {
        kind: 'supply_range',
        severity: 'destructive',
        deviceId: this.id,
        value: v,
        message:
          `${Math.abs(v).toFixed(1)} V BACKWARDS across ${p.label} — ${p.supplyPin} and GND are ` +
          `swapped. The part is rated to ${p.absMaxReverseVolts} V reverse on any pin; on real ` +
          `hardware this destroys it.`,
      }
    }

    if (v > p.absMaxVolts) {
      return {
        kind: 'supply_range',
        severity: 'destructive',
        deviceId: this.id,
        value: v,
        message:
          `${v.toFixed(1)} V on the ${p.supplyPin} of ${p.label}, which is rated ` +
          `${p.minVolts}-${p.maxVolts} V with an absolute maximum of ${p.absMaxVolts} V. ` +
          `On real hardware this part is destroyed.`,
      }
    }

    /**
     * Over the specified window but inside the absolute maximum: the part is
     * running out of spec — it may read wrong, it will run hot, and it is not
     * guaranteed to survive — but it is not destroyed. The same graduated shape
     * every other part here uses, and the honest answer for the gap between two
     * numbers a datasheet prints separately for a reason.
     */
    if (v > p.maxVolts) {
      return {
        kind: 'supply_range',
        severity: 'caution',
        deviceId: this.id,
        value: v,
        message:
          `${v.toFixed(1)} V on the ${p.supplyPin} of ${p.label}, past the ${p.maxVolts} V top of ` +
          `its specified supply range. It is inside the ${p.absMaxVolts} V absolute maximum, so it ` +
          `still works — out of spec, and not guaranteed to.`,
      }
    }

    return null
  }
}

/**
 * A sensor module's DRIVEN output pin.
 *
 * Identical to a NortonPort electrically — that is what it is, and the engine
 * drives it through the same set() — but with the SENSOR's ratings and the
 * SENSOR's name on its fault.
 *
 * This class exists because of a specific wrong answer. A sensor's driven pin
 * used to be a plain NortonPort, whose safety() carries the ATmega328P's pad
 * ratings and the ATmega328P's wording. Overloading an HC-SR04's ECHO therefore
 * produced "...mA through a pin rated for 40 mA. On real hardware this pin is
 * destroyed." attributed to `hcs_4.echo` — the wrong part, the wrong datasheet,
 * and stated with total confidence. Silence would have been better than that.
 */
export class SensorPort extends NortonPort {
  constructor(
    id: string,
    a: NetId,
    b: NetId,
    g: number,
    i: number,
    readonly params: SensorSupplyParams,
    /** The pin id as the part silkscreens it — "ECHO", "DATA", "OUT". */
    readonly pinName: string,
  ) {
    super(id, a, b, g, i)
    this.ratedCurrent = params.outputRatedAmps
    this.maxCurrent = params.outputMaxAmps
  }

  safety(ctx: StampContext): SolveFault | null {
    if (this.degenerate()) return null
    const sourced = this.sourcedCurrent(ctx)
    if (sourced <= this.ratedCurrent) return null

    const mA = (sourced * 1000).toFixed(0)
    const p = this.params
    if (sourced <= this.maxCurrent) {
      return {
        kind: 'over_current',
        severity: 'caution',
        deviceId: this.id,
        value: sourced,
        message:
          `${mA} mA out of the ${this.pinName} pin of ${p.label}, past the ` +
          `${(this.ratedCurrent * 1000).toFixed(0)} mA that output is specified for. ` +
          `On real hardware this over-stresses the sensor's own output driver.`,
      }
    }
    return {
      kind: 'over_current',
      severity: 'destructive',
      deviceId: this.id,
      value: sourced,
      message:
        `${mA} mA out of the ${this.pinName} pin of ${p.label}, whose absolute maximum is ` +
        `${(this.maxCurrent * 1000).toFixed(0)} mA. On real hardware the sensor's output ` +
        `driver is destroyed.`,
    }
  }
}

// ─── Reactive devices (backward-Euler companion models) ───────────────────────

/**
 * Conductance ceiling for a reactive companion, in siemens: the same 1/MIN_RESISTANCE
 * a wire is clamped to. As h→0, Geq = C/h → ∞; a step so small that C/h exceeds
 * this is finer than the LU can represent against the rest of the matrix anyway.
 */
const MAX_CONDUCTANCE = 1 / MIN_RESISTANCE

/**
 * Capacitor, backward-Euler companion (TRANSIENT_DESIGN.md §1.1).
 *
 *   i_C = C·dv/dt.  BE over one step h:  i_C(t) = (C/h)·v(t) − (C/h)·v_prev
 *
 * so the companion is a conductance Geq = C/h in parallel with a current source
 * Ieq = Geq·v_prev. The source is stamped INTO node a (out of b) — the sign is
 * load-bearing: flip it and an RC cap charges the wrong way. Pinned by §3.1.
 *
 * DC mode (no step set, h <= 0): stamps as a 1e12 Ω open, byte-for-byte the
 * behaviour of the resistor stub it replaces, so a plain DC solve() is unchanged.
 */
export class Capacitor implements ReactiveDevice {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  /** Timestep in seconds; <= 0 means DC mode. */
  private h = 0
  /** Branch voltage (va − vb) at the end of the previous accepted step. */
  private vPrev: number
  /** Initial condition, restored by resetTransient(). */
  private readonly v0: number

  /** Reported current i_C for the step just advanced, amps (a → b). */
  current = 0

  readonly terminals: readonly [NetId, NetId]

  constructor(
    readonly id: string,
    private a: NetId,
    private b: NetId,
    private farads: number,
    v0 = 0,
  ) {
    this.v0 = v0
    this.vPrev = v0
    this.terminals = [a, b]
  }

  /** τ = R·C. */
  timeConstant(rTh: number): number {
    return this.farads * rTh
  }

  /** Branch voltage carried between compiles. See ReactiveDevice.state. */
  get state(): number {
    return this.vPrev
  }
  set state(v: number) {
    this.vPrev = v
  }

  setStep(h: number): void {
    this.h = h
  }

  resetTransient(): void {
    this.vPrev = this.v0
    this.current = 0
  }

  /** Companion conductance for the current step, clamped. */
  private geq(): number {
    if (!(this.h > 0)) return 1e-12 // DC: a 1e12 Ω open, the stub it replaces.
    return Math.min(this.farads / this.h, MAX_CONDUCTANCE)
  }

  stamp(ctx: StampContext): void {
    if (!Number.isFinite(this.farads) || this.farads < 0) {
      throw new Error(
        `Capacitor "${this.id}" has an invalid capacitance (${this.farads}). ` +
          `Capacitance must be a finite, non-negative number.`,
      )
    }
    const g = this.geq()
    stampConductance(ctx, this.a, this.b, g)
    if (this.h > 0) {
      // Ieq = Geq·v_prev, injected INTO node a (out of b). See the class note.
      stampCurrent(ctx, this.b, this.a, g * this.vPrev)
    }
  }

  advance(ctx: TransientContext): void {
    const vNew = ctx.voltage(this.a) - ctx.voltage(this.b)
    // i_C = Geq·(v(t) − v_prev) = C·dv/dt for this step, using pre-update v_prev.
    this.current = this.geq() * (vNew - this.vPrev)
    this.vPrev = vNew
  }
}

/**
 * Inductor, backward-Euler companion (TRANSIENT_DESIGN.md §1.2).
 *
 *   v = L·di/dt.  BE:  i_L(t) = i_L(t−h) + (h/L)·v(t)
 *
 * Norton companion: Geq = h/L in parallel with a source Ieq = i_prev pushing
 * a → b. DC mode (h <= 0) stamps as a 0.01 Ω near-short, the stub it replaces.
 */
export class Inductor implements ReactiveDevice {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  private h = 0
  /** Branch current (a → b) at the end of the previous accepted step. */
  private iPrev: number
  private readonly i0: number

  /** Reported current i_L for the step just advanced, amps (a → b). */
  current = 0

  readonly terminals: readonly [NetId, NetId]

  constructor(
    readonly id: string,
    private a: NetId,
    private b: NetId,
    private henries: number,
    i0 = 0,
  ) {
    this.i0 = i0
    this.iPrev = i0
    this.current = i0
    this.terminals = [a, b]
  }

  /**
   * τ = L/R — RECIPROCAL in R, unlike the capacitor's R·C. A shorted inductor
   * has a long time constant, a shorted capacitor a short one. rTh is floored at
   * MIN_RESISTANCE so a dead short returns a large finite τ rather than Infinity.
   */
  timeConstant(rTh: number): number {
    return this.henries / Math.max(rTh, MIN_RESISTANCE)
  }

  /** Branch current carried between compiles. See ReactiveDevice.state. */
  get state(): number {
    return this.iPrev
  }
  set state(i: number) {
    this.iPrev = i
    this.current = i
  }

  setStep(h: number): void {
    this.h = h
  }

  resetTransient(): void {
    this.iPrev = this.i0
    this.current = this.i0
  }

  private geq(): number {
    if (!(this.h > 0)) return 1 / 0.01 // DC: a 0.01 Ω short, the stub it replaces.
    return Math.min(this.h / this.henries, MAX_CONDUCTANCE)
  }

  stamp(ctx: StampContext): void {
    if (!Number.isFinite(this.henries) || this.henries <= 0) {
      throw new Error(
        `Inductor "${this.id}" has an invalid inductance (${this.henries}). ` +
          `Inductance must be a finite, positive number.`,
      )
    }
    const g = this.geq()
    stampConductance(ctx, this.a, this.b, g)
    if (this.h > 0) {
      // Ieq = i_prev pushing a → b.
      stampCurrent(ctx, this.a, this.b, this.iPrev)
    }
  }

  advance(ctx: TransientContext): void {
    const v = ctx.voltage(this.a) - ctx.voltage(this.b)
    // i_L(t) = i_prev + (h/L)·v(t) = i_prev + Geq·v(t).
    this.iPrev = this.iPrev + this.geq() * v
    this.current = this.iPrev
  }
}

// ─── Nonlinear devices ────────────────────────────────────────────────────────

export interface DiodeParams {
  /** Saturation current (A). */
  is: number
  /** Emission coefficient. */
  n: number
  /**
   * Recommended continuous forward current, amps — the CAUTION threshold.
   *
   * Optional, and it defaults to `LED_RATED_AMPS`, because the LED is the case
   * that has no params of its own to carry it: `ledColour()` in parts.ts builds
   * `{is, n}` per colour and knows nothing about ratings, and every one of the
   * six colours is the same 5 mm lamp. Every OTHER user of this class states its
   * own numbers below, and the default is what an unstated one falls back to.
   */
  ratedAmps?: number
  /** Absolute maximum forward current, amps — the DESTRUCTIVE threshold. */
  maxAmps?: number
  /**
   * What the part is called in a fault message, WITH its article ("an LED",
   * "a 1N4148").
   *
   * The article is part of the string rather than computed, because "a"/"an"
   * here follows the SOUND of a part number, not its spelling: "an LED", "an
   * MCP3008", "a 1N4148". A rule over the first letter gets all three wrong.
   */
  label?: string
}

/**
 * Recommended and absolute-maximum forward current for a standard 5 mm LED,
 * amps. Kingbright / Vishay red-lamp datasheets: 20 mA DC forward current
 * recommended, 30 mA absolute maximum, above which the die overheats and fails.
 *
 * These are the DEFAULTS for any DiodeParams that names no rating of its own,
 * which is exactly the LED colours — see DiodeParams.ratedAmps.
 */
export const LED_RATED_AMPS = 0.02
export const LED_ABS_MAX_AMPS = 0.03

/**
 * Silicon signal diode, roughly 1N4148.
 *
 * RATINGS ARE THE DIODE'S OWN, and until this constant carried them the part
 * inherited the LED's 20 mA / 30 mA — so a correctly built flyback or clamp
 * circuit was reported as a DESTROYED component at a sixth of the part's real
 * rating. The simulator telling a student their right answer is wrong is worse
 * than saying nothing.
 *
 * From the NXP / ON Semiconductor 1N4148 datasheets (both agree; Vishay rates
 * the continuous figure higher still, at 300 mA):
 *
 *   IF    continuous forward current            200 mA
 *   IFRM  repetitive peak forward current       500 mA
 *   IFSM  non-repetitive peak forward surge     1 A (1 s)
 *
 * `ratedAmps` is IF — held above it the part runs hot and ages, which is the
 * caution. `maxAmps` is IFRM: a current the part survives only as a repeated
 * PEAK, so a DC operating point sitting there is past what any of the three
 * datasheet lines permit continuously, which is the destruction. IFSM is not
 * used, because a 1 s surge rating says nothing about a steady state.
 */
export const DIODE_1N4148: DiodeParams = {
  is: 2.52e-9,
  n: 1.752,
  ratedAmps: 0.2,
  maxAmps: 0.5,
  label: 'a 1N4148',
}

/**
 * Red LED. These parameters are not arbitrary — combined with a 2 Ω series
 * resistance they reproduce the ngspice reference numbers in
 * SIMULATOR_ARCHITECTURE.md §5.5 to within a fraction of a milliamp:
 *
 *   220 Ω → 13.76 mA,  1 kΩ → 3.12 mA,  10 kΩ → 0.32 mA,  none → 1419 mA
 */
export const LED_RED: DiodeParams = { is: 1e-20, n: 1.8, label: 'an LED' }
export const LED_SERIES_R = 2.0

/**
 * SPICE's pnjlim. Without it, Newton overshoots into the exponential and
 * produces either Infinity or wild oscillation.
 *
 * The adversarial verifier's headline finding was that REMOVING junction
 * limiting makes Newton appear to converge faster while returning a
 * confidently wrong answer (3.2 V where the truth was 5.8 V). It converges to
 * the wrong root. This function is load-bearing for correctness, not just speed.
 */
function pnjlim(
  vnew: number,
  vold: number,
  vt: number,
  vcrit: number,
): { v: number; limited: boolean } {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt
      return { v: arg > 0 ? vold + vt * Math.log(arg) : vcrit, limited: true }
    }
    return { v: vt * Math.log(vnew / vt), limited: true }
  }
  return { v: vnew, limited: false }
}

export class Diode implements Device {
  readonly nonlinear = true
  readonly extraUnknowns = 0
  branchIndex = -1

  /** Junction voltage from the previous Newton iterate, for limiting. */
  private vPrev = 0
  private readonly vte: number
  private readonly vcrit: number

  /** Last solved current, in amps. Read by the safety checker. */
  current = 0

  /** False while junction limiting is still damping this device. */
  settled = true

  constructor(
    readonly id: string,
    private anode: NetId,
    private cathode: NetId,
    private params: DiodeParams = DIODE_1N4148,
  ) {
    this.vte = params.n * VT
    this.vcrit = this.vte * Math.log(this.vte / (Math.SQRT2 * params.is))
    this.rating = params.ratedAmps ?? LED_RATED_AMPS
    this.absMaxCurrent = params.maxAmps ?? LED_ABS_MAX_AMPS
  }

  reset(): void {
    this.vPrev = 0
    this.settled = true
  }

  stamp(ctx: StampContext): void {
    const raw = ctx.voltage(this.anode) - ctx.voltage(this.cathode)
    const { v: vd, limited } = pnjlim(raw, this.vPrev, this.vte, this.vcrit)
    this.settled = !limited
    this.vPrev = vd

    const { is } = this.params
    const e = Math.exp(Math.min(vd / this.vte, 300))
    const id = is * (e - 1)
    const gd = (is / this.vte) * e

    this.current = id

    // Companion model: conductance gd in parallel with current source ieq.
    const ieq = id - gd * vd
    stampConductance(ctx, this.anode, this.cathode, gd)
    stampCurrent(ctx, this.anode, this.cathode, ieq)
  }

  /** Recompute current from the converged voltages — see Device.readback. */
  readback(ctx: StampContext): void {
    const vd = ctx.voltage(this.anode) - ctx.voltage(this.cathode)
    this.current = this.params.is * (Math.exp(Math.min(vd / this.vte, 300)) - 1)
  }

  /**
   * Recommended continuous forward current, amps — the caution threshold.
   *
   * Taken from THIS junction's own params rather than being a constant on the
   * class. It was a constant (0.02) for as long as the only nonlinear junction
   * in the library was an LED, and the moment a second one existed that constant
   * became a wrong datasheet applied to the wrong part: a 1N4148 rated 200 mA
   * continuous was reported destroyed at 30 mA.
   */
  rating: number

  /** Absolute-maximum forward current, amps — the destructive threshold. */
  absMaxCurrent: number

  safety(ctx: StampContext): SolveFault | null {
    this.readback(ctx)
    // At or below the rating there is nothing to say.
    if (this.current <= this.rating) return null

    const mA = (this.current * 1000).toFixed(0)
    const rated = (this.rating * 1000).toFixed(0)
    // "a part" was the wording while every junction here was an LED. Now that
    // the same class models a signal diode and an opto-coupler's IR die, the
    // message names WHICH part it is talking about — a fault that quotes a
    // rating has to say whose rating it is.
    const what = this.params.label ?? 'a part'

    // Above the rating but still within the absolute maximum: the part survives
    // for now but ages fast. Non-destructive, so the wording warns rather than
    // alarms.
    if (this.current <= this.absMaxCurrent) {
      return {
        kind: 'over_current',
        severity: 'caution',
        deviceId: this.id,
        value: this.current,
        message:
          `${mA} mA through ${what} running above its ${rated} mA rating. ` +
          `On real hardware this shortens its life.`,
      }
    }

    // Past the absolute maximum — the original destructive fault, unchanged.
    return {
      kind: 'over_current',
      severity: 'destructive',
      deviceId: this.id,
      value: this.current,
      message:
        `${mA} mA through ${what} rated for ${rated} mA. ` +
        `On real hardware this part is destroyed.`,
    }
  }
}

/**
 * An LED is a diode plus its bulk series resistance, which needs an internal
 * net between them. Returning two devices keeps the solver free of special
 * cases — Rs is just a resistor.
 */
export function createLED(
  id: string,
  anode: NetId,
  cathode: NetId,
  internal: NetId,
  params: DiodeParams = LED_RED,
  rs = LED_SERIES_R,
): { devices: Device[]; diode: Diode } {
  const diode = new Diode(`${id}.d`, anode, internal, params)
  const rseries = new Resistor(`${id}.rs`, internal, cathode, rs)
  return { devices: [diode, rseries], diode }
}

// ─── Transducers ──────────────────────────────────────────────────────────────

/**
 * Electrical characteristics of a buzzer, from its datasheet.
 *
 * The two kinds of "buzzer" sold for Arduino kits are electrically nothing alike
 * and that difference IS the lesson (a passive one is silent on digitalWrite,
 * an active one ignores tone()):
 *
 *   ACTIVE  — a magnetic transducer plus its own oscillator, e.g. a TMB12A05
 *             class 5 V unit: rated 5 V DC, <= 30 mA, operating 4-7 V, and its
 *             internal oscillator fixes the pitch at ~2300 Hz. To the circuit it
 *             is a resistor of Vrated/Irated = 167 Ohm.
 *
 *   PASSIVE — a bare piezo element, e.g. a 12 mm disc of ~10 nF. It has NO DC
 *             path at all; current through it is displacement current, so a DC
 *             operating point correctly reports ~0 A and the pitch is whatever
 *             the driving square wave is. Modelled as the same 1e-12 S open the
 *             Capacitor stamps at DC.
 */
export interface BuzzerParams {
  /** Rated DC supply, volts. */
  ratedVolts: number
  /** DC current drawn at ratedVolts by an ACTIVE buzzer, amps. */
  ratedAmps: number
  /** Absolute maximum continuous DC supply, volts. Past this the coil cooks. */
  maxVolts: number
  /** Piezo element capacitance of a PASSIVE buzzer, farads. */
  piezoFarads: number
  /** Fixed pitch of an ACTIVE buzzer's internal oscillator, hertz. */
  oscillatorHz: number
  /** Minimum supply at which an ACTIVE buzzer's oscillator runs, volts. */
  minOperatingVolts: number
}

/** Generic 5 V buzzer as sold in Arduino kits. See BuzzerParams for sources. */
export const BUZZER_5V: BuzzerParams = {
  ratedVolts: 5,
  ratedAmps: 0.03,
  maxVolts: 7,
  piezoFarads: 1e-8,
  oscillatorHz: 2300,
  minOperatingVolts: 4,
}

export class Buzzer implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  /** Last solved current, amps, from the + terminal to the − terminal. */
  current = 0

  constructor(
    readonly id: string,
    private a: NetId,
    private b: NetId,
    /** True for a bare piezo element, false for a self-oscillating unit. */
    readonly passive: boolean,
    readonly params: BuzzerParams = BUZZER_5V,
  ) {}

  /**
   * DC conductance. A passive piezo is a capacitor, so at a DC operating point
   * it is an open — the same 1e-12 S (1 TOhm) the Capacitor stamps with no step
   * set, and for the same reason.
   */
  private g(): number {
    if (this.passive) return 1e-12
    return this.params.ratedAmps / this.params.ratedVolts
  }

  stamp(ctx: StampContext): void {
    stampConductance(ctx, this.a, this.b, this.g())
  }

  /** Voltage across the buzzer at the converged solution. */
  voltsAcross(ctx: StampContext): number {
    return ctx.voltage(this.a) - ctx.voltage(this.b)
  }

  readback(ctx: StampContext): void {
    this.current = this.voltsAcross(ctx) * this.g()
  }

  safety(ctx: StampContext): SolveFault | null {
    const v = Math.abs(this.voltsAcross(ctx))
    if (v <= this.params.maxVolts) return null
    const p = this.passive ? 0 : v * v * this.g()
    return {
      kind: 'over_power',
      severity: 'destructive',
      deviceId: this.id,
      value: p,
      message:
        `${v.toFixed(1)} V across a buzzer rated for ${this.params.ratedVolts} V ` +
        `(absolute maximum ${this.params.maxVolts} V). On real hardware this part is destroyed.`,
    }
  }
}

/**
 * Brushed DC motor, at its electrical/mechanical steady state.
 *
 * Everything follows from the four numbers every small-motor datasheet prints —
 * nominal voltage Vn, no-load speed w0, no-load current I0 and stall current Is
 * — and nothing is fitted per experiment.
 *
 *   Armature resistance   Ra = Vn / Is            (locked rotor: no back-EMF)
 *   Back-EMF constant     Ke = (Vn − I0·Ra) / w0
 *
 * A brushed motor's current-versus-torque curve is a STRAIGHT LINE from the
 * no-load point (0 torque, I0) to the stall point (stall torque, Is) — that is
 * what the performance curves on the datasheet are. Writing the mechanical load
 * as the fraction L of stall torque it demands, at nominal voltage:
 *
 *   i = I0 + L·(Is − I0)
 *
 * and the whole element is a conductance, because the line passes through the
 * origin in V:
 *
 *   G(L) = (I0 + L·(Is − I0)) / Vn      i = G(L)·V
 *
 * Speed comes straight out of the back-EMF balance V = i·Ra + Ke·w:
 *
 *   w = (V − i·Ra) / Ke
 *
 * Three things make this model worth having rather than a fudge:
 *
 *   - A FREE-RUNNING motor (L = 0) is a resistor of Vn/I0, NOT of Ra. Back-EMF,
 *     not copper, is what limits the current of a spinning motor; stamping the
 *     coil resistance alone overstates it by Is/I0 — an order of magnitude. At
 *     L = 1 the back-EMF is gone and the element becomes exactly Ra, the
 *     locked-rotor current every motor datasheet warns about.
 *   - Speed is LINEAR in current, w = i·(1/G − Ra)/Ke, so the engine's exact
 *     time-weighted current average converts straight into the time-averaged
 *     speed of a PWM-driven motor at no extra solve. PWM duty falls out free.
 *   - The element stays LINEAR at every load, so it cannot make the Newton loop
 *     limit-cycle. A load that is a constant torque rather than a proportional
 *     one puts a kink at V = L·Vn, and Newton can ping-pong across a kink
 *     forever; that model was written first and rejected for exactly that.
 *
 * HONEST LIMITATIONS, both structural:
 *
 *   - The load is PROPORTIONAL to the applied voltage — a fan or a pump, whose
 *     torque falls away as the motor slows. A constant-torque load (a weight on
 *     a winch) can stall a motor at low voltage while still drawing locked-rotor
 *     current; that is not modelled. At full load this model is stalled at every
 *     voltage, which is the case that matters.
 *   - This is the STEADY state only. Rotor inertia, the start-up inrush and the
 *     inductive spike when the motor is switched off all need transient
 *     simulation. Circuit.transientStep() exists but the interactive engine does
 *     not drive it yet, so none of those appear.
 */
export interface MotorParams {
  /** Nominal supply, volts. */
  ratedVolts: number
  /** No-load speed at ratedVolts, rpm. */
  noLoadRpm: number
  /** No-load current at ratedVolts, amps. */
  noLoadAmps: number
  /** Locked-rotor current at ratedVolts, amps. */
  stallAmps: number
}

/**
 * Small brushed hobby motor, 6 V nominal — the size found in Arduino kits.
 * Ra = 6/0.8 = 7.5 Ohm; free-running it looks like 6/0.07 = 85.7 Ohm.
 */
export const HOBBY_MOTOR_6V: MotorParams = {
  ratedVolts: 6,
  noLoadRpm: 6000,
  noLoadAmps: 0.07,
  stallAmps: 0.8,
}

export class DCMotor implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  /** Last solved current, amps, + terminal to − terminal. Signed. */
  current = 0

  /** Mechanical load as a fraction of stall torque, 0..1. */
  readonly load: number

  constructor(
    readonly id: string,
    private a: NetId,
    private b: NetId,
    load = 0,
    readonly params: MotorParams = HOBBY_MOTOR_6V,
  ) {
    this.load = Math.min(1, Math.max(0, load))
  }

  /** Armature (coil) resistance, ohms: Ra = Vn/Is, the locked-rotor figure. */
  get coilOhms(): number {
    return Math.max(this.params.ratedVolts / this.params.stallAmps, MIN_RESISTANCE)
  }

  /** Back-EMF constant, volts per rpm. Ke = (Vn − I0·Ra)/w0. */
  get voltsPerRpm(): number {
    const { ratedVolts: vn, noLoadAmps: i0, noLoadRpm: n0 } = this.params
    return (vn - i0 * this.coilOhms) / n0
  }

  /**
   * Terminal conductance at this load, siemens.
   * G(L) = (I0 + L·(Is − I0))/Vn — the datasheet's own no-load-to-stall line.
   */
  get conductance(): number {
    const { ratedVolts: vn, noLoadAmps: i0, stallAmps: is } = this.params
    return (i0 + this.load * (is - i0)) / vn
  }

  /** What the motor looks like to the rest of the circuit, ohms. */
  get effectiveOhms(): number {
    return 1 / this.conductance
  }

  stamp(ctx: StampContext): void {
    stampConductance(ctx, this.a, this.b, this.conductance)
  }

  /** Terminal voltage at the converged solution, volts. */
  voltsAcross(ctx: StampContext): number {
    return ctx.voltage(this.a) - ctx.voltage(this.b)
  }

  readback(ctx: StampContext): void {
    this.current = this.voltsAcross(ctx) * this.conductance
  }

  /**
   * Shaft speed for an armature current, rpm, signed by direction.
   *
   * w = (V − i·Ra)/Ke with V = i/G, so w = i·(1/G − Ra)/Ke — LINEAR in current.
   * That is exactly why the engine can hand it a TIME-AVERAGED current and get
   * the time-averaged speed of a PWM-driven motor without solving anything
   * extra: the average of a linear function is the function of the average.
   */
  rpmFor(current: number): number {
    return (current * (this.effectiveOhms - this.coilOhms)) / this.voltsPerRpm
  }

  safety(ctx: StampContext): SolveFault | null {
    const v = this.voltsAcross(ctx)
    const av = Math.abs(v)
    const i = v * this.conductance

    // Over-voltage burns the winding insulation. 1.5x nominal is the usual
    // "absolute maximum" headroom quoted for small brushed motors.
    const maxVolts = 1.5 * this.params.ratedVolts
    if (av > maxVolts) {
      return {
        kind: 'over_power',
        severity: 'destructive',
        deviceId: this.id,
        value: av * Math.abs(i),
        message:
          `${av.toFixed(1)} V across a ${this.params.ratedVolts} V motor. ` +
          `On real hardware the winding insulation fails.`,
      }
    }

    // A stalled or heavily loaded motor develops little back-EMF, so most of the
    // supply lands in the copper. It survives for a while — that is what makes
    // this a caution and not a death.
    const rpm = Math.abs(this.rpmFor(i))
    if (Math.abs(i) > 0.5 * this.params.stallAmps && rpm < 0.1 * this.params.noLoadRpm) {
      return {
        kind: 'over_current',
        severity: 'caution',
        deviceId: this.id,
        value: Math.abs(i),
        message:
          `${(Math.abs(i) * 1000).toFixed(0)} mA into a motor that is barely turning ` +
          `(${rpm.toFixed(0)} rpm). With no back-EMF to oppose it the winding heats ` +
          `fast — reduce the load or the voltage.`,
      }
    }
    return null
  }
}

// ─── Motor driver stages ──────────────────────────────────────────────────────

/**
 * Why a driver stage is a SWITCHED LINEAR element and not a nonlinear one.
 *
 * A Darlington sink and an H-bridge leg are both "a transistor in saturation or
 * fully off". In saturation a bipolar device is very nearly a fixed voltage
 * offset in series with a small bulk resistance — a Thevenin source — which is
 * exactly a Norton stamp and costs no extra matrix unknown. What is genuinely
 * discontinuous is only the ON/OFF decision, and that decision is a function of
 * the LOGIC INPUT voltage alone: nothing on the output side feeds back to it.
 *
 * That one-directional dependence is what makes the switch safe inside the
 * Newton loop, where a general kink would not be (see the DCMotor note on why a
 * constant-torque load was rejected: Newton ping-pongs across a kink forever).
 * The switch state cannot oscillate because the node that decides it is solved
 * independently of anything the switch does. Both classes below therefore
 * declare `nonlinear = true` — not because their I/V curve is nonlinear, but
 * because the solver must be made to run a SECOND iteration: with only one, the
 * stamp would be built from the zero initial guess and every driver in the
 * circuit would read its input as 0 V and stay off. They also drive `settled`
 * exactly as the diode does, so the solver cannot accept a solution taken while
 * the switch was still moving.
 */

export interface DarlingtonParams {
  /**
   * VCE(sat) at the LOWER of the two collector currents the datasheet
   * characterises. Two points is the whole reason this pair exists: a
   * saturated Darlington is an offset plus a resistance, and one point cannot
   * separate them.
   */
  satVolts1: number
  satAmps1: number
  /** VCE(sat) at the higher characterised collector current. */
  satVolts2: number
  satAmps2: number
  /** Input characteristic: II(on) at VI. Fixes the load the driving pin sees. */
  inputTestVolts: number
  inputTestAmps: number
  /** Input voltage at which the datasheet GUARANTEES the channel is on. */
  vih: number
  /** Two base-emitter drops. Below this no base current flows at all. */
  vil: number
  /** Highest collector current the datasheet characterises, amps. */
  ratedAmps: number
  /** Absolute maximum output current per channel, amps. */
  maxAmps: number
  /** Channels in the package. */
  channels: number
}

/**
 * ULN2003A — seven NPN Darlington sinks with common flyback diodes.
 *
 * Every number is from the TI ULN2003A datasheet (SLRS027, Ta = 25 °C):
 *
 *   VCE(sat)  0.9 V typ at IC = 100 mA (VI = 2.7 V)
 *             1.1 V typ at IC = 200 mA (VI = 3.0 V)
 *             1.3 V typ at IC = 350 mA (VI = 3.0 V)
 *   II(on)    0.93 mA typ at VI = 3.85 V
 *   VI(on)    2.4 V max — guaranteed on at IC = 200 mA
 *   IC        500 mA absolute maximum per channel
 *
 * The two saturation points are what the model is built from; the third
 * (350 mA) is a free check, and the derivation reproduces it: R_on comes out at
 * (1.1 − 0.9)/(0.2 − 0.1) = 2 Ω and the zero-current offset at
 * 0.9 − 0.1 × 2 = 0.7 V, so 350 mA predicts 0.7 + 0.35 × 2 = 1.40 V against the
 * datasheet's 1.3 V typ — 0.1 V high at 1.75x the highest fitted current.
 *
 * The 1.4 V of VI below which nothing happens is not a datasheet line but a
 * physical one: the input drives the base of a Darlington through a 2.7 kΩ
 * resistor, and two base-emitter junctions in series need two Vbe (~0.7 V each)
 * before any base current flows at all.
 */
export const ULN2003: DarlingtonParams = {
  satVolts1: 0.9,
  satAmps1: 0.1,
  satVolts2: 1.1,
  satAmps2: 0.2,
  inputTestVolts: 3.85,
  inputTestAmps: 0.93e-3,
  vih: 2.4,
  vil: 1.4,
  ratedAmps: 0.35,
  maxAmps: 0.5,
  channels: 7,
}

/**
 * One Darlington channel: a logic input, and an open-collector output that
 * either sinks to the chip's own ground pin or is not there at all.
 *
 * "Or is not there at all" is the load-bearing half. An off Darlington stamps
 * NOTHING on the output, which is what open-collector means — the pin is
 * released to whatever else is on it, exactly as the behavioural devices'
 * 'release' does. Stamping a large resistance instead would quietly drain a
 * motor coil's pull-up.
 *
 * Note that the input resistor and the sink both return to `gnd`, the chip's
 * OWN ground pin and not net 0. A student who forgets the ground wire gets a
 * chip that does nothing, which is what happens on a bench.
 */
export class DarlingtonSink implements Device {
  readonly nonlinear = true
  readonly extraUnknowns = 0
  branchIndex = -1

  /** True while the channel is conducting. Read by the UI and by tests. */
  on = false
  /** False on the iteration in which the switch flipped. See Device.settled. */
  settled = true
  /** Collector current sunk into OUT, amps. Positive means sinking. */
  current = 0
  /** Base current the driving pin has to supply, amps. */
  inputCurrent = 0

  constructor(
    readonly id: string,
    private inNet: NetId,
    private outNet: NetId | undefined,
    private gnd: NetId,
    readonly params: DarlingtonParams = ULN2003,
  ) {}

  reset(): void {
    this.on = false
    this.settled = true
  }

  /** Incremental collector resistance in saturation, from the two test points. */
  get onOhms(): number {
    const p = this.params
    return (p.satVolts2 - p.satVolts1) / (p.satAmps2 - p.satAmps1)
  }

  /** VCE(sat) extrapolated back to zero collector current, volts. */
  get offsetVolts(): number {
    const p = this.params
    return p.satVolts1 - p.satAmps1 * this.onOhms
  }

  /** VCE(sat) this model predicts at a given collector current, volts. */
  saturationVolts(amps: number): number {
    return this.offsetVolts + amps * this.onOhms
  }

  /**
   * Input resistance, ohms, straight from the datasheet's input characteristic.
   *
   * A plain resistance rather than "2.7 kΩ behind two Vbe" on purpose: the
   * offset model would SOURCE current out of the input below 1.4 V, which no
   * real input ever does, and the error the plain resistance carries instead is
   * a fraction of a milliamp at the one end of the range where it matters least.
   */
  get inputOhms(): number {
    return this.params.inputTestVolts / this.params.inputTestAmps
  }

  stamp(ctx: StampContext): void {
    stampConductance(ctx, this.inNet, this.gnd, 1 / Math.max(this.inputOhms, MIN_RESISTANCE))

    const vin = ctx.voltage(this.inNet) - ctx.voltage(this.gnd)
    // Hysteresis across the datasheet's own undefined band. Inside it a real
    // part may do either thing, and holding the previous state is both legal
    // and the only choice that cannot chatter.
    const on = this.on ? vin > this.params.vil : vin >= this.params.vih
    this.settled = on === this.on
    this.on = on

    if (!on || this.outNet === undefined) return
    const g = 1 / Math.max(this.onOhms, MIN_RESISTANCE)
    stampConductance(ctx, this.outNet, this.gnd, g)
    // Push the output UP to the saturation offset at zero current: the KCL row
    // then reads i(out→gnd) = g·(V_out − V_offset), which is the Thevenin
    // source the class note describes. Reverse these two and the output sits at
    // −0.7 V and sinks nothing.
    stampCurrent(ctx, this.gnd, this.outNet, g * this.offsetVolts)
  }

  readback(ctx: StampContext): void {
    this.inputCurrent =
      (ctx.voltage(this.inNet) - ctx.voltage(this.gnd)) / Math.max(this.inputOhms, MIN_RESISTANCE)
    if (!this.on || this.outNet === undefined) {
      this.current = 0
      return
    }
    const vce = ctx.voltage(this.outNet) - ctx.voltage(this.gnd)
    this.current = (vce - this.offsetVolts) / Math.max(this.onOhms, MIN_RESISTANCE)
  }

  safety(ctx: StampContext): SolveFault | null {
    this.readback(ctx)
    const i = this.current
    if (i <= this.params.ratedAmps) return null
    const mA = (i * 1000).toFixed(0)
    if (i <= this.params.maxAmps) {
      return {
        kind: 'over_current',
        severity: 'caution',
        deviceId: this.id,
        value: i,
        message:
          `${mA} mA through a Darlington channel the datasheet only characterises to ` +
          `${(this.params.ratedAmps * 1000).toFixed(0)} mA. It conducts, but hot — the ` +
          `package cannot carry this on every channel at once.`,
      }
    }
    return {
      kind: 'over_current',
      severity: 'destructive',
      deviceId: this.id,
      value: i,
      message:
        `${mA} mA through a channel rated for ${(this.params.maxAmps * 1000).toFixed(0)} mA. ` +
        `On real hardware this channel is destroyed.`,
    }
  }
}

/**
 * A whole ULN2003: seven channels plus the flyback diodes to COM.
 *
 * The diodes are real silicon on the die — that is the entire reason this part
 * is used to drive coils rather than seven discrete transistors — so they are
 * stamped. At a DC operating point every one of them is reverse-biased (an
 * output can only be pulled DOWN, so it is never above COM) and contributes
 * nothing, which is honest: their job is to absorb the inductive kick when a
 * coil is switched OFF, and that is a transient, not an operating point. What
 * they DO catch at DC is a student who wires an output above COM.
 *
 * A channel with no COM net gets no diode, which is also what the hardware
 * does: the diodes share one cathode and an unwired COM leaves them floating.
 */
export function createULN2003(
  id: string,
  nets: {
    in: Array<NetId | undefined>
    out: Array<NetId | undefined>
    com: NetId | undefined
    gnd: NetId
  },
  params: DarlingtonParams = ULN2003,
): { devices: Device[]; channels: DarlingtonSink[] } {
  const devices: Device[] = []
  const channels: DarlingtonSink[] = []
  for (let k = 0; k < params.channels; k++) {
    const inNet = nets.in[k]
    if (inNet === undefined) continue
    const ch = new DarlingtonSink(`${id}.ch${k + 1}`, inNet, nets.out[k], nets.gnd, params)
    devices.push(ch)
    channels.push(ch)
    if (nets.out[k] !== undefined && nets.com !== undefined) {
      // Anode on the output, cathode on COM: it conducts only when the output
      // is dragged above the common rail.
      devices.push(new Diode(`${id}.d${k + 1}`, nets.out[k]!, nets.com, DIODE_1N4148))
    }
  }
  return { devices, channels }
}

export interface HBridgeParams {
  /** VCEsat(H), the upper (source) transistor, volts at satTestAmps. */
  sourceSatVolts: number
  /** VCEsat(L), the lower (sink) transistor, volts at satTestAmps. */
  sinkSatVolts: number
  /** The single current at which the datasheet characterises both. */
  satTestAmps: number
  /** Bulk resistance per transistor, ohms. Not a datasheet line — see L298N. */
  onOhms: number
  /** Logic input thresholds, volts. */
  vil: number
  vih: number
  /** Input characteristic Iin(H) at inputTestVolts, for the load on the pin. */
  inputTestVolts: number
  inputTestAmps: number
  /** Logic supply window, volts. */
  minLogicVolts: number
  maxLogicVolts: number
  /**
   * How far the motor supply must sit above a logic high before the output
   * stage works. The datasheet writes the lower bound of Vs as "VIH + 2.5 V".
   */
  supplyHeadroomVolts: number
  /** Io per channel: continuous, and non-repetitive peak, amps. */
  ratedAmps: number
  peakAmps: number
}

/**
 * L298N dual full-bridge, from the ST L298 datasheet.
 *
 *   VCEsat(H) source   0.95 min / 1.35 typ / 1.7 max V, at I = 1 A
 *   VCEsat(L) sink     0.85 min / 1.2  typ / 1.6 max V, at I = 1 A
 *   VCEsat total drop  1.80 min /            3.2 max V, at I = 1 A
 *   VIL −0.3 to 1.5 V, VIH 2.3 V to Vss
 *   Iin(H) 30 µA typ, 100 µA max
 *   Vss (logic) 4.5 to 7 V ; Vs (motor) VIH + 2.5 V to 46 V
 *   Io 2 A DC per channel, 3 A non-repetitive peak
 *
 * THE DROP IS THE LESSON. Two transistors are in series with the motor at all
 * times, so a bridge fed from 5 V delivers about 5 − 1.35 − 1.2 = 2.45 V to the
 * load. Students who wire an L298N to a 5 V rail and find their motor limp have
 * not made a mistake; they have met the part. Modelling the bridge as an ideal
 * switch would delete that entirely.
 *
 * `onOhms` is the one number here that is NOT off the datasheet, because the
 * datasheet characterises saturation at a single current (1 A) and one point
 * cannot separate an offset from a resistance. A saturated bipolar is offset-
 * dominated, so the model takes the typical saturation voltages as constant
 * offsets and adds 0.15 Ω per transistor of bulk. The consequence is bounded
 * and checkable: the total drop runs from 2.55 V at no load to 3.15 V at the
 * 2 A rating, and the datasheet's own window for the total drop is 1.80–3.2 V,
 * so the model stays inside it across the entire permitted operating range.
 */
export const L298N: HBridgeParams = {
  sourceSatVolts: 1.35,
  sinkSatVolts: 1.2,
  satTestAmps: 1,
  onOhms: 0.15,
  vil: 1.5,
  vih: 2.3,
  inputTestVolts: 5,
  inputTestAmps: 30e-6,
  minLogicVolts: 4.5,
  maxLogicVolts: 7,
  supplyHeadroomVolts: 2.5,
  ratedAmps: 2,
  peakAmps: 3,
}

/**
 * What one bridge channel is doing, straight off the datasheet's truth table:
 *
 *   Ven = H, C = H, D = L   Forward
 *   Ven = H, C = L, D = H   Reverse
 *   Ven = H, C = D          Fast Motor Stop   (both outputs on the same rail)
 *   Ven = L, C = X, D = X   Free Running Motor Stop
 *
 * `coast` is the enable being low: both legs are off and the motor is left to
 * spin down on its own. `brake` is both legs on the same rail, which shorts the
 * motor through the bridge and stops it hard. Those two are different things on
 * a bench and the model keeps them different.
 */
export type BridgeMode = 'coast' | 'forward' | 'reverse' | 'brake'

/**
 * One half of an L298N: IN1/IN2, an enable, and OUT1/OUT2.
 *
 * Each output leg is a totem pole of its own controlled by its own input and
 * gated by the enable — which is what the silicon is — so forward, reverse and
 * both flavours of brake fall out of two independent legs rather than out of a
 * four-way case analysis that could disagree with the truth table.
 */
export class HBridgeChannel implements Device {
  readonly nonlinear = true
  readonly extraUnknowns = 0
  branchIndex = -1

  settled = true
  /** Current out of OUT_A into the load, amps. Signed: negative is reverse. */
  current = 0
  mode: BridgeMode = 'coast'
  /** False when Vss is missing or outside 4.5–7 V: the chip's logic is dead. */
  logicOk = false
  /** False when Vs is not far enough above a logic high to run the outputs. */
  supplyOk = false
  /**
   * The enable pin's own level, UNGATED by logicOk/supplyOk.
   *
   * `mode` collapses to 'coast' whenever the chip cannot drive, which is the
   * right answer for the motor and the wrong one for the student: "coast"
   * describes a bridge that was told to stop, and a bridge that was told to go
   * and has no supply looks identical. This is what lets safety() tell those two
   * apart and say WHY the output is dead.
   */
  enableAsked = false

  private sourceA = false
  private sourceB = false
  private driving = false

  constructor(
    readonly id: string,
    private nets: {
      in1: NetId
      in2: NetId
      en: NetId
      outA: NetId | undefined
      outB: NetId | undefined
      vs: NetId | undefined
      vss: NetId | undefined
      gnd: NetId
    },
    readonly params: HBridgeParams = L298N,
  ) {}

  reset(): void {
    this.driving = false
    this.enableAsked = false
    this.mode = 'coast'
    this.settled = true
  }

  /**
   * What the two inputs are ASKING for, ignoring whether the chip can deliver.
   *
   * `mode` is what the bridge is doing; this is what it was told to do. They
   * differ exactly when the part is dead — no logic supply, no motor supply —
   * which is the case the student most needs spelled out.
   */
  get commandedMode(): BridgeMode {
    if (!this.enableAsked) return 'coast'
    return this.sourceA === this.sourceB ? 'brake' : this.sourceA ? 'forward' : 'reverse'
  }

  /** Load the chip puts on each driving pin, ohms. */
  get inputOhms(): number {
    return this.params.inputTestVolts / this.params.inputTestAmps
  }

  /** Lowest motor supply at which the output stage can work, volts. */
  get minSupplyVolts(): number {
    return this.params.vih + this.params.supplyHeadroomVolts
  }

  /** Total transistor drop at a given load current, volts — the L298N tax. */
  totalDropVolts(amps: number): number {
    const a = Math.abs(amps)
    return (
      this.params.sourceSatVolts +
      this.params.sinkSatVolts +
      2 * a * Math.max(this.params.onOhms, MIN_RESISTANCE)
    )
  }

  private levelOf(ctx: StampContext, net: NetId, was: boolean): boolean {
    const v = ctx.voltage(net) - ctx.voltage(this.nets.gnd)
    return was ? v > this.params.vil : v >= this.params.vih
  }

  /** Stamp one output leg as a Thevenin source in Norton form. */
  private stampLeg(ctx: StampContext, out: NetId, source: boolean): void {
    const g = 1 / Math.max(this.params.onOhms, MIN_RESISTANCE)
    if (source) {
      if (this.nets.vs === undefined) return
      stampConductance(ctx, this.nets.vs, out, g)
      // i(vs→out) = g·(V_vs − V_out − VCEsat(H)): the transistor conducts only
      // what is left after its own saturation drop.
      stampCurrent(ctx, out, this.nets.vs, g * this.params.sourceSatVolts)
    } else {
      stampConductance(ctx, out, this.nets.gnd, g)
      // i(out→gnd) = g·(V_out − VCEsat(L)).
      stampCurrent(ctx, this.nets.gnd, out, g * this.params.sinkSatVolts)
    }
  }

  stamp(ctx: StampContext): void {
    const gin = 1 / Math.max(this.inputOhms, MIN_RESISTANCE)
    stampConductance(ctx, this.nets.in1, this.nets.gnd, gin)
    stampConductance(ctx, this.nets.in2, this.nets.gnd, gin)
    stampConductance(ctx, this.nets.en, this.nets.gnd, gin)

    const vss =
      this.nets.vss === undefined ? 0 : ctx.voltage(this.nets.vss) - ctx.voltage(this.nets.gnd)
    const vs =
      this.nets.vs === undefined ? 0 : ctx.voltage(this.nets.vs) - ctx.voltage(this.nets.gnd)
    this.logicOk = vss >= this.params.minLogicVolts && vss <= this.params.maxLogicVolts
    this.supplyOk = vs >= this.minSupplyVolts

    this.enableAsked = this.levelOf(ctx, this.nets.en, this.driving)
    const enabled = this.logicOk && this.supplyOk && this.enableAsked
    const a = this.levelOf(ctx, this.nets.in1, this.sourceA)
    const b = this.levelOf(ctx, this.nets.in2, this.sourceB)

    // Everything that decides the switch is on the input side, so comparing the
    // whole decision against last iteration's is exactly Device.settled's job.
    this.settled = enabled === this.driving && a === this.sourceA && b === this.sourceB
    this.driving = enabled
    this.sourceA = a
    this.sourceB = b
    this.mode = !enabled ? 'coast' : a === b ? 'brake' : a ? 'forward' : 'reverse'

    if (!enabled) return
    if (this.nets.outA !== undefined) this.stampLeg(ctx, this.nets.outA, a)
    if (this.nets.outB !== undefined) this.stampLeg(ctx, this.nets.outB, b)
  }

  /** Voltage the load actually sees, OUT_A − OUT_B. */
  outputVolts(ctx: StampContext): number {
    if (this.nets.outA === undefined || this.nets.outB === undefined) return 0
    return ctx.voltage(this.nets.outA) - ctx.voltage(this.nets.outB)
  }

  readback(ctx: StampContext): void {
    this.current = 0
    if (!this.driving || this.nets.outA === undefined) return
    const g = 1 / Math.max(this.params.onOhms, MIN_RESISTANCE)
    const va = ctx.voltage(this.nets.outA) - ctx.voltage(this.nets.gnd)
    if (this.sourceA) {
      if (this.nets.vs === undefined) return
      const vsv = ctx.voltage(this.nets.vs) - ctx.voltage(this.nets.gnd)
      this.current = g * (vsv - va - this.params.sourceSatVolts)
    } else {
      this.current = -g * (va - this.params.sinkSatVolts)
    }
  }

  safety(ctx: StampContext): SolveFault | null {
    const vss =
      this.nets.vss === undefined ? 0 : ctx.voltage(this.nets.vss) - ctx.voltage(this.nets.gnd)
    if (vss > this.params.maxLogicVolts) {
      return {
        kind: 'over_power',
        severity: 'destructive',
        deviceId: this.id,
        value: vss,
        message:
          `${vss.toFixed(1)} V on the logic supply of an L298, which is rated ` +
          `${this.params.minLogicVolts}–${this.params.maxLogicVolts} V. The motor supply ` +
          `goes on Vs, not on Vss — on real hardware this destroys the chip.`,
      }
    }

    /**
     * WHY THE OUTPUT IS DEAD.
     *
     * The model has always known this — logicOk and supplyOk are computed on
     * every solve — and it threw the answer away, so a student whose motor did
     * not turn had nothing but a silent Checks panel and a bridge reporting
     * 'coast'. These are CAUTIONS, not destructions: nothing is being damaged.
     * They fire only when the channel is actually being ASKED to drive, so an
     * L298N sitting unwired in the tray, or one whose enable is deliberately
     * low, says nothing at all.
     */
    if (this.enableAsked && !this.logicOk) {
      const vs =
        this.nets.vs === undefined ? 0 : ctx.voltage(this.nets.vs) - ctx.voltage(this.nets.gnd)
      return {
        kind: 'supply_range',
        severity: 'caution',
        deviceId: this.id,
        value: vss,
        message:
          this.nets.vss === undefined || vss < 0.5
            ? `This bridge is enabled but Vss — the LOGIC supply, the "+5V" screw terminal — ` +
              `is not connected. Without ${this.params.minLogicVolts}–${this.params.maxLogicVolts} V ` +
              `there the chip's logic is dead and the outputs never switch, ` +
              `whatever Vs is doing (${vs.toFixed(1)} V).`
            : `${vss.toFixed(1)} V on Vss, outside the ` +
              `${this.params.minLogicVolts}–${this.params.maxLogicVolts} V this chip's logic needs. ` +
              `The bridge is enabled but its outputs cannot switch.`,
      }
    }
    if (this.enableAsked && this.logicOk && !this.supplyOk) {
      const vs =
        this.nets.vs === undefined ? 0 : ctx.voltage(this.nets.vs) - ctx.voltage(this.nets.gnd)
      return {
        kind: 'supply_range',
        severity: 'caution',
        deviceId: this.id,
        value: vs,
        message:
          `This bridge is enabled but Vs — the MOTOR supply — is ${vs.toFixed(1)} V. The output ` +
          `stage needs at least VIH + ${this.params.supplyHeadroomVolts} V = ` +
          `${this.minSupplyVolts.toFixed(1)} V, so nothing is driven. ` +
          `Vs is the "+12V" screw terminal, not the "+5V" one.`,
      }
    }

    this.readback(ctx)
    const i = Math.abs(this.current)
    if (i <= this.params.ratedAmps) return null
    if (i <= this.params.peakAmps) {
      return {
        kind: 'over_current',
        severity: 'caution',
        deviceId: this.id,
        value: i,
        message:
          `${i.toFixed(2)} A through a bridge rated for ${this.params.ratedAmps} A continuous. ` +
          `The part allows ${this.params.peakAmps} A as a non-repetitive peak only — held here ` +
          `it overheats.`,
      }
    }
    return {
      kind: 'over_current',
      severity: 'destructive',
      deviceId: this.id,
      value: i,
      message:
        `${i.toFixed(2)} A through a bridge whose absolute peak is ${this.params.peakAmps} A. ` +
        `On real hardware this channel is destroyed.`,
    }
  }
}

/** Both halves of an L298N, wired from one part's pins. */
export function createL298N(
  id: string,
  nets: {
    in1: NetId
    in2: NetId
    ena: NetId
    in3: NetId
    in4: NetId
    enb: NetId
    out1?: NetId
    out2?: NetId
    out3?: NetId
    out4?: NetId
    vs?: NetId
    vss?: NetId
    gnd: NetId
  },
  params: HBridgeParams = L298N,
): { devices: Device[]; channels: HBridgeChannel[] } {
  const a = new HBridgeChannel(
    `${id}.A`,
    {
      in1: nets.in1,
      in2: nets.in2,
      en: nets.ena,
      outA: nets.out1,
      outB: nets.out2,
      vs: nets.vs,
      vss: nets.vss,
      gnd: nets.gnd,
    },
    params,
  )
  const b = new HBridgeChannel(
    `${id}.B`,
    {
      in1: nets.in3,
      in2: nets.in4,
      en: nets.enb,
      outA: nets.out3,
      outB: nets.out4,
      vs: nets.vs,
      vss: nets.vss,
      gnd: nets.gnd,
    },
    params,
  )
  return { devices: [a, b], channels: [a, b] }
}

// ─── Unipolar stepper ─────────────────────────────────────────────────────────

export interface StepperParams {
  /** Rated winding voltage, volts. */
  ratedVolts: number
  /** DC resistance of ONE phase, COM to a phase lead, ohms. */
  phaseOhms: number
  /** Stride angle at the MOTOR shaft, degrees per half-step. */
  strideDegrees: number
  /** Internal gear reduction between motor shaft and output shaft. */
  gearRatio: number
  /** Absolute maximum continuous winding voltage, volts. */
  maxVolts: number
}

/**
 * 28BYJ-48, 5 V — the geared unipolar stepper in every Arduino/Pi kit.
 *
 * Datasheet:
 *   Rated voltage            5 V DC
 *   Number of phases         4
 *   Speed variation ratio    1/64
 *   Stride angle             5.625° / 64
 *   DC resistance            50 Ω ± 7 % (25 °C)
 *
 * "Stride angle 5.625°/64" is the whole geometry in one line: 5.625° is what
 * the MOTOR shaft turns per half-step, so 360/5.625 = 64 half-steps per motor
 * revolution, and the 1/64 gearbox makes 64 × 64 = 4096 half-steps per OUTPUT
 * revolution. Nothing below hardcodes 4096; it is derived, and the test derives
 * it independently.
 *
 * HONEST LIMITATIONS:
 *
 *   - The real gear train is 63.68395:1, not 64:1 — the datasheet's own 1/64 is
 *     a round number, and over one commanded revolution the true output shaft
 *     falls about 0.5 % short (it takes ~4076 half-steps, not 4096). The model
 *     follows the datasheet, so a student's "step(4096) = one turn" arithmetic
 *     works out exactly here and would be half a degree out on the bench.
 *   - Windings are modelled by their DC resistance only. The ~300 mH of phase
 *     inductance is what limits the top step rate on real hardware; with no
 *     transient loop there is no rise time, so this model will happily follow a
 *     step sequence far faster than the part can, and it does not model the
 *     torque falling away with speed.
 *   - Torque, holding torque and losing steps under load are not modelled. The
 *     model reports the position the COIL SEQUENCE commands.
 *
 * `maxVolts` is 1.5x rated, the same convention DCMotor uses for a winding, and
 * is a judgement call rather than a datasheet line — the datasheet gives no
 * absolute maximum.
 */
export const STEPPER_28BYJ48: StepperParams = {
  ratedVolts: 5,
  phaseOhms: 50,
  strideDegrees: 5.625,
  gearRatio: 64,
  maxVolts: 7.5,
}

/** Half-steps per revolution of the OUTPUT shaft. 4096 for a 28BYJ-48. */
export function halfStepsPerRevolution(p: StepperParams): number {
  return (360 / p.strideDegrees) * p.gearRatio
}

/** Output-shaft degrees advanced by one half-step. */
export function degreesPerHalfStep(p: StepperParams): number {
  return p.strideDegrees / p.gearRatio
}

/**
 * The eight-state half-step ring, as bit patterns over the four phases.
 *
 * Bit 3 is phase A (IN1), bit 2 is B, bit 1 is C, bit 0 is D — the order the
 * ULN2003 board's IN1..IN4 are wired to the motor's four coils. Adjacent
 * entries differ by energising or de-energising exactly one coil, which is what
 * makes the ring a ring: the rotor's equilibrium moves one half-step at a time.
 *
 * A full-step drive is this same ring visited two at a time: the odd entries
 * (one coil at a time) are wave drive, the even entries (two coils at a time)
 * are the higher-torque two-phase-on drive. That is why the tracker credits a
 * jump of two, and it is not a special case bolted on.
 */
export const HALF_STEP_SEQUENCE: readonly number[] = [
  0b1000, 0b1100, 0b0100, 0b0110, 0b0010, 0b0011, 0b0001, 0b1001,
]

/** Ring position of an energisation pattern, or −1 if it is not in the ring. */
export function stepPhaseIndex(pattern: number): number {
  return HALF_STEP_SEQUENCE.indexOf(pattern & 0b1111)
}

/**
 * Turns a stream of coil patterns into a shaft position.
 *
 * The rule is deliberately strict. A pattern that is not in the ring at all
 * (0b1010 energises two coils wound in OPPOSITION, so the rotor feels no net
 * field) and a jump of three or more ring positions are both refused: the
 * counter does not move and the error is counted. A real motor pulled through a
 * three-position jump may or may not follow depending on speed and load, and a
 * simulator that guessed would be reporting a position the bench would not
 * reproduce. Refusing is the same choice §2.3 makes everywhere else.
 */
export class StepTracker {
  /** Signed cumulative half-steps since the first energisation. */
  halfSteps = 0
  /** Current ring position, or −1 before any valid pattern has been seen. */
  index = -1
  /** Patterns refused: not in the ring, or too big a jump. */
  sequenceErrors = 0
  /** Last pattern fed in. */
  pattern = 0

  reset(): void {
    this.halfSteps = 0
    this.index = -1
    this.sequenceErrors = 0
    this.pattern = 0
  }

  /**
   * Feed the currently energised pattern. Returns the signed half-steps moved,
   * which is 0 for a repeat, for all coils off, and for anything refused.
   */
  apply(pattern: number): number {
    const p = pattern & 0b1111
    this.pattern = p
    // All coils off is not an error and not a step: the rotor is unheld, and
    // where it ends up is friction's business, not the sequence's.
    if (p === 0) return 0

    const idx = stepPhaseIndex(p)
    if (idx < 0) {
      this.sequenceErrors++
      return 0
    }
    if (this.index < 0) {
      // The first energisation defines the origin. There is no earlier state to
      // measure a step against, so it cannot be one.
      this.index = idx
      return 0
    }
    if (idx === this.index) return 0

    const forward = (idx - this.index + 8) % 8
    const delta = forward > 4 ? forward - 8 : forward
    if (delta === 1 || delta === -1 || delta === 2 || delta === -2) {
      this.index = idx
      this.halfSteps += delta
      return delta
    }
    // Three or more: the sequence is wrong, and where the shaft ends up is not
    // something this model will invent. Resynchronise to the coils, credit
    // nothing, and say so.
    this.sequenceErrors++
    this.index = idx
    return 0
  }
}

/**
 * The motor's electrical half: four windings from the common tap to the four
 * phase leads.
 *
 * That really is all a unipolar stepper is to the circuit — the position is a
 * property of the SEQUENCE in time, which a DC operating point cannot hold, so
 * it lives in the behavioural StepperMonitor exactly as a buzzer's pitch does.
 */
export class UnipolarStepper implements Device {
  readonly nonlinear = false
  readonly extraUnknowns = 0
  branchIndex = -1

  /** Per-phase currents, COM → phase lead, amps. */
  readonly phaseCurrents: number[] = [0, 0, 0, 0]
  /** Total current out of the common tap, amps. */
  current = 0

  constructor(
    readonly id: string,
    private com: NetId,
    private phases: Array<NetId | undefined>,
    readonly params: StepperParams = STEPPER_28BYJ48,
  ) {}

  /** Current one phase draws at its rated voltage, amps. */
  get ratedPhaseAmps(): number {
    return this.params.ratedVolts / Math.max(this.params.phaseOhms, MIN_RESISTANCE)
  }

  stamp(ctx: StampContext): void {
    if (!Number.isFinite(this.params.phaseOhms) || this.params.phaseOhms <= 0) {
      throw new Error(
        `Stepper "${this.id}" has an invalid phase resistance (${this.params.phaseOhms}). ` +
          `Winding resistance must be a finite, positive number.`,
      )
    }
    const g = 1 / Math.max(this.params.phaseOhms, MIN_RESISTANCE)
    for (const p of this.phases) {
      if (p === undefined) continue
      stampConductance(ctx, this.com, p, g)
    }
  }

  /** Voltage across one winding, COM − phase. An open lead reads 0. */
  phaseVolts(ctx: StampContext, k: number): number {
    const p = this.phases[k]
    if (p === undefined) return 0
    return ctx.voltage(this.com) - ctx.voltage(p)
  }

  readback(ctx: StampContext): void {
    const r = Math.max(this.params.phaseOhms, MIN_RESISTANCE)
    let total = 0
    for (let k = 0; k < this.phaseCurrents.length; k++) {
      const i = this.phaseVolts(ctx, k) / r
      this.phaseCurrents[k] = i
      total += i
    }
    this.current = total
  }

  safety(ctx: StampContext): SolveFault | null {
    let worst = 0
    for (let k = 0; k < this.phaseCurrents.length; k++) {
      worst = Math.max(worst, Math.abs(this.phaseVolts(ctx, k)))
    }
    if (worst <= this.params.ratedVolts) return null
    if (worst <= this.params.maxVolts) {
      return {
        kind: 'over_power',
        severity: 'caution',
        deviceId: this.id,
        value: (worst * worst) / Math.max(this.params.phaseOhms, MIN_RESISTANCE),
        message:
          `${worst.toFixed(1)} V across a winding rated for ${this.params.ratedVolts} V. ` +
          `It turns, but a stepper holds its coils energised continuously and this one is ` +
          `now dissipating ${((worst * worst) / this.params.phaseOhms).toFixed(2)} W per phase.`,
      }
    }
    return {
      kind: 'over_power',
      severity: 'destructive',
      deviceId: this.id,
      value: (worst * worst) / Math.max(this.params.phaseOhms, MIN_RESISTANCE),
      message:
        `${worst.toFixed(1)} V across a ${this.params.ratedVolts} V winding. ` +
        `On real hardware the insulation fails.`,
    }
  }
}

// ─── Opto-isolated relay module ───────────────────────────────────────────────

/**
 * The infra-red LED inside a PC817 opto-coupler.
 *
 * NOT `LED_RED`, and that difference is the whole reason this constant exists. A
 * PC817's emitter is a GaAs infra-red die with a forward drop of 1.2 V typical
 * at IF = 20 mA (Sharp PC817 datasheet, electro-optical characteristics);
 * `LED_RED` would put 1.88 V there, which on a 5 V rail behind the board's own
 * 1 kOhm series resistor is a 20 % error in the input current — i.e. in the exact
 * number that decides whether the channel switches at all.
 *
 * `is` is DERIVED from that one datasheet point rather than fitted:
 *
 *   Vf = n*VT*ln(If/Is)  =>  Is = If*exp(-Vf/(n*VT))
 *      = 0.020 * exp(-1.2 / (1.8 * 0.025852))
 *      = 0.020 * exp(-25.7878)  =  1.2633e-13 A
 *
 * devices.test.ts recomputes that expression from the datasheet numbers and
 * asserts the model reproduces 1.2 V at 20 mA, so the constant cannot drift
 * away from its own derivation.
 */
export const OPTO_LED: DiodeParams = {
  is: 1.2633e-13,
  n: 1.8,
  /**
   * Sharp PC817 datasheet, absolute maximum ratings: forward current IF 50 mA,
   * with the electro-optical characteristics all taken at IF = 20 mA. So 20 mA
   * is the current the part is CHARACTERISED at (the caution) and 50 mA is the
   * one it is destroyed above (the destruction) — the same two numbers
   * RelayChannel.safety() already quotes for the opto, now on the junction
   * itself so the two cannot disagree.
   */
  ratedAmps: 0.02,
  maxAmps: 0.05,
  label: 'an opto-coupler LED',
}

/**
 * A four-channel opto-isolated relay board, as sold for Arduino/Pi kits.
 *
 * THE BOARD IS ACTIVE LOW, and that is the single most consequential fact about
 * it. The input circuit is  VCC -> opto LED -> 1 kOhm -> IN, so current only
 * flows — and the channel only switches — when the driving pin PULLS IN DOWN.
 * Driving IN high turns the channel OFF. Every "my relay is on when my code says
 * off" question about these boards is this. High-trigger variants do exist (some
 * boards carry a jumper), so `activeLow` is a property of the placed part, and
 * the two wirings are genuinely different circuits rather than a sign flip: on a
 * high-trigger board the same LED and resistor run IN -> opto LED -> 1 kOhm -> GND.
 *
 * RELAY — Songle SRD-05VDC-SL-C, the part fitted to every one of these boards:
 *
 *   Nominal coil voltage      5 VDC
 *   Coil resistance           70 Ohm +/- 10 %
 *   Nominal coil current      71.4 mA        (and 5/70 = 71.4 mA — consistent)
 *   Coil power                0.36 W
 *   Pick-up voltage           <= 75 % of nominal = 3.75 V
 *   Drop-out voltage          >= 10 % of nominal = 0.50 V
 *   Max allowable voltage     110 % of nominal   = 5.50 V
 *   Contact rating            10 A 250 VAC / 10 A 30 VDC
 *   Contact resistance        100 mOhm max
 *
 * The pick-up figure is not a detail: a 5 V relay board fed from a 3.3 V rail
 * gets about 3.0 V on the coil, BELOW the 3.75 V it is guaranteed to operate at,
 * so the opto switches, the transistor saturates, and the relay still does not
 * click. That is exactly what happens on a bench with a Pi or a Pico, and the
 * model reproduces it rather than quietly closing the contact.
 *
 * OPTO-COUPLER — Sharp PC817:
 *
 *   Forward voltage    1.2 V typ at IF = 20 mA
 *   Forward current    50 mA absolute maximum
 *   CTR                50–600 % at IF = 5 mA
 *
 * TWO NUMBERS HERE ARE JUDGEMENT, NOT DATASHEET, and are marked as such:
 *
 *   `optoOnAmps` / `optoOffAmps` — the LED current at which the board's own
 *      switching transistor is taken to be saturated, and the current at which
 *      it releases. No datasheet prints this, because it depends on a
 *      transistor the relay board chose. It is BOUNDED, though, and that is what
 *      makes it defensible: the board's 1 kOhm from a 5 V rail delivers about
 *      (5 - 1.12)/1000 = 3.9 mA, so the threshold has to sit below that or a
 *      correctly built board would not work; and a PC817's CTR is only specified
 *      down to 5 mA, so it has to sit well above the sub-milliamp region where
 *      CTR collapses. 2.0 mA is a little over half the available current and
 *      twice the 1.0 mA release point.
 *
 *   `driverOhms` — bulk resistance of the coil-driving transistor in
 *      saturation. An S8050 datasheet gives VCE(sat) at one current only, and
 *      one point cannot separate an offset from a resistance (the same problem
 *      the L298N model has). Taking VCE(sat) as a constant 0.3 V offset plus
 *      0.5 Ohm of bulk puts the drop at 0.34 V at the coil's ~70 mA, leaving
 *      4.66 V of a 5 V rail on the coil — 66.6 mA, against the 71.4 mA an ideal
 *      5 V would drive. Measured boards sit inside that band.
 */
export interface RelayModuleParams {
  /** Nominal coil voltage, volts. */
  coilVolts: number
  /** Coil DC resistance, ohms. */
  coilOhms: number
  /** Must-operate coil voltage, volts. */
  pullInVolts: number
  /** Must-release coil voltage, volts. */
  dropOutVolts: number
  /** Maximum allowable coil voltage, volts. */
  maxCoilVolts: number
  /** Series resistor between the opto LED and the IN pin, ohms. */
  inputOhms: number
  /** Opto LED current at which the channel is taken to be on, amps. Judgement. */
  optoOnAmps: number
  /** Opto LED current at which it releases, amps. Judgement. */
  optoOffAmps: number
  /** Absolute maximum forward current of the opto LED, amps. */
  optoMaxAmps: number
  /** VCE(sat) of the coil-driving transistor at zero current, volts. */
  driverSatVolts: number
  /** Bulk resistance of that transistor in saturation, ohms. Judgement. */
  driverOhms: number
  /** Closed-contact resistance, ohms. */
  contactOhms: number
  /** Contact current rating, amps. */
  contactAmps: number
  /** Channels on the board. */
  channels: number
}

/** The common 4-channel opto-isolated board. See RelayModuleParams for sources. */
export const RELAY_MODULE_4CH: RelayModuleParams = {
  coilVolts: 5,
  coilOhms: 70,
  pullInVolts: 3.75,
  dropOutVolts: 0.5,
  maxCoilVolts: 5.5,
  inputOhms: 1000,
  optoOnAmps: 2.0e-3,
  optoOffAmps: 1.0e-3,
  optoMaxAmps: 0.05,
  driverSatVolts: 0.3,
  driverOhms: 0.5,
  contactOhms: 0.1,
  contactAmps: 10,
  channels: 4,
}

/**
 * Open-contact resistance, ohms. The same 1e12 Ohm the push button uses for an
 * open switch, and for the same reason: removing the device instead would change
 * the matrix STRUCTURE every time a relay clicks, and the point of stamping
 * switches permanently (§2.6) is that it never does.
 */
const CONTACT_OPEN_OHMS = 1e12

/**
 * One relay channel: the coil driver and the SPDT contact.
 *
 * `nonlinear = true` for exactly the reason DarlingtonSink and HBridgeChannel
 * are — see the note above DarlingtonParams. The I/V curve of a closed contact
 * is a straight line; what needs a second Newton iteration is the ON/OFF
 * DECISION, and that decision is read off the input side and is never fed back
 * from the output.
 *
 * The channel does NOT stamp the opto LED or its series resistor: those are an
 * ordinary Diode and Resistor, created alongside it by createRelayModule(), so
 * the input current is SOLVED rather than assumed. This device only measures the
 * current the solver found across that resistor.
 */
export class RelayChannel implements Device {
  readonly nonlinear = true
  readonly extraUnknowns = 0
  branchIndex = -1

  /** True while the coil is energised and COM is on NO. */
  on = false
  /** False on the iteration in which the contact moved. See Device.settled. */
  settled = true
  /** Coil current, amps. The Device.current convention. */
  current = 0
  /** Solved opto LED current, amps — what the driving pin has to sink or source. */
  optoAmps = 0
  /** Current through whichever contact is closed, COM -> NO or COM -> NC, amps. */
  contactCurrent = 0

  constructor(
    readonly id: string,
    private nets: {
      /** The series resistor's two ends: the opto current is (vHi - vLo)/R. */
      seriesHi: NetId
      seriesLo: NetId
      /** The coil's low side — the driver transistor's collector. */
      coil: NetId
      /** The module's OWN supply pins, never net 0. */
      vcc: NetId
      gnd: NetId
      com?: NetId
      no?: NetId
      nc?: NetId
    },
    readonly params: RelayModuleParams = RELAY_MODULE_4CH,
  ) {}

  reset(): void {
    this.on = false
    this.settled = true
  }

  /** Coil current at its nominal voltage, amps: 5/70 = 71.4 mA on an SRD-05VDC. */
  get nominalCoilAmps(): number {
    return this.params.coilVolts / Math.max(this.params.coilOhms, MIN_RESISTANCE)
  }

  /**
   * What the coil would see if the driver were switched on, volts.
   *
   * Read off the SUPPLY only — never off the coil node — so the decision stays
   * one-directional and Newton cannot ping-pong across it. The driver's own
   * saturation drop is subtracted because that is voltage the coil never gets.
   */
  availableCoilVolts(ctx: StampContext): number {
    const supply = ctx.voltage(this.nets.vcc) - ctx.voltage(this.nets.gnd)
    return supply - this.params.driverSatVolts
  }

  stamp(ctx: StampContext): void {
    const p = this.params
    const iOpto =
      (ctx.voltage(this.nets.seriesHi) - ctx.voltage(this.nets.seriesLo)) /
      Math.max(p.inputOhms, MIN_RESISTANCE)
    this.optoAmps = iOpto

    // Hysteresis on BOTH halves, across each datasheet's own undefined band: the
    // opto's unspecified sub-5 mA CTR region, and the relay's pick-up/drop-out
    // gap. Inside either, a real part may do anything, and holding the previous
    // state is the only choice that cannot chatter.
    const optoOn = this.on ? iOpto > p.optoOffAmps : iOpto >= p.optoOnAmps
    const vAvail = this.availableCoilVolts(ctx)
    const coilOk = this.on ? vAvail > p.dropOutVolts : vAvail >= p.pullInVolts
    const on = optoOn && coilOk

    this.settled = on === this.on
    this.on = on

    if (on) {
      // The driver transistor, as a Thevenin source in Norton form — exactly the
      // stamp DarlingtonSink uses. i(coil->gnd) = g*(V_coil - VCE(sat)).
      const g = 1 / Math.max(p.driverOhms, MIN_RESISTANCE)
      stampConductance(ctx, this.nets.coil, this.nets.gnd, g)
      stampCurrent(ctx, this.nets.gnd, this.nets.coil, g * p.driverSatVolts)
    }

    // The SPDT contact. Both halves are stamped in BOTH states so the sparsity
    // pattern is fixed; only the conductance changes when the armature moves.
    const closed = 1 / Math.max(p.contactOhms, MIN_RESISTANCE)
    const open = 1 / CONTACT_OPEN_OHMS
    if (this.nets.com !== undefined) {
      if (this.nets.no !== undefined) {
        stampConductance(ctx, this.nets.com, this.nets.no, on ? closed : open)
      }
      if (this.nets.nc !== undefined) {
        stampConductance(ctx, this.nets.com, this.nets.nc, on ? open : closed)
      }
    }
  }

  readback(ctx: StampContext): void {
    const p = this.params
    this.optoAmps =
      (ctx.voltage(this.nets.seriesHi) - ctx.voltage(this.nets.seriesLo)) /
      Math.max(p.inputOhms, MIN_RESISTANCE)
    this.current = this.on
      ? (ctx.voltage(this.nets.coil) - ctx.voltage(this.nets.gnd) - p.driverSatVolts) /
        Math.max(p.driverOhms, MIN_RESISTANCE)
      : 0

    this.contactCurrent = 0
    if (this.nets.com === undefined) return
    const other = this.on ? this.nets.no : this.nets.nc
    if (other === undefined) return
    this.contactCurrent =
      (ctx.voltage(this.nets.com) - ctx.voltage(other)) / Math.max(p.contactOhms, MIN_RESISTANCE)
  }

  safety(ctx: StampContext): SolveFault | null {
    const p = this.params
    const supply = ctx.voltage(this.nets.vcc) - ctx.voltage(this.nets.gnd)
    if (supply > p.maxCoilVolts) {
      return {
        kind: 'over_power',
        severity: 'destructive',
        deviceId: this.id,
        value: supply,
        message:
          `${supply.toFixed(1)} V on the VCC of a ${p.coilVolts} V relay module, whose coil is ` +
          `rated to ${p.maxCoilVolts} V absolute maximum. On real hardware the coil cooks.`,
      }
    }

    this.readback(ctx)
    if (this.optoAmps > p.optoMaxAmps) {
      return {
        kind: 'over_current',
        severity: 'destructive',
        deviceId: this.id,
        value: this.optoAmps,
        message:
          `${(this.optoAmps * 1000).toFixed(0)} mA through an opto-coupler LED rated for ` +
          `${(p.optoMaxAmps * 1000).toFixed(0)} mA. On real hardware the isolator is destroyed.`,
      }
    }

    const ic = Math.abs(this.contactCurrent)
    if (ic > p.contactAmps) {
      return {
        kind: 'over_current',
        severity: 'destructive',
        deviceId: this.id,
        value: ic,
        message:
          `${ic.toFixed(1)} A through a contact rated for ${p.contactAmps} A. ` +
          `On real hardware the contacts weld shut.`,
      }
    }
    return null
  }
}

/**
 * A whole relay board: per channel an opto input, a coil, its flyback diode and
 * an SPDT contact.
 *
 * `internal` supplies the two nodes each channel needs and that no pin exposes:
 * the junction between the opto LED and its series resistor, and the coil's low
 * side. They are real nodes on the real board, and the compiler allocates them
 * exactly the way it allocates an LED's internal series node.
 *
 * THE FLYBACK DIODE IS STAMPED AND IS INERT AT DC, exactly as the ULN2003's are
 * and for the same reason: an energised coil pulls its low side DOWN, so a diode
 * from that node up to VCC is always reverse-biased at an operating point. Its
 * job is to absorb the inductive kick when the coil switches OFF, and that is a
 * transient the interactive engine does not run yet. It is modelled rather than
 * omitted because it is real silicon on the board.
 *
 * A channel is built only where `internal` carries a slot for it — the compiler
 * fills that in from the netlist, so channels nothing is attached to cost
 * nothing at all.
 */
export function createRelayModule(
  id: string,
  nets: {
    vcc: NetId
    gnd: NetId
    /** Per channel, undefined where the channel is not being built. */
    in: Array<NetId | undefined>
    com: Array<NetId | undefined>
    no: Array<NetId | undefined>
    nc: Array<NetId | undefined>
    /** [optoJunction, coilLowSide] per channel, allocated by the caller. */
    internal: Array<[NetId, NetId] | undefined>
  },
  activeLow: boolean,
  params: RelayModuleParams = RELAY_MODULE_4CH,
): { devices: Device[]; channels: RelayChannel[] } {
  const devices: Device[] = []
  const channels: RelayChannel[] = []

  for (let k = 0; k < params.channels; k++) {
    const slot = nets.internal[k]
    if (slot === undefined) continue
    const [optoJunction, coilNode] = slot
    const inNet = nets.in[k]

    /**
     * The input branch. The two trigger polarities really are different
     * circuits:
     *
     *   active LOW   VCC -> opto LED -> R -> IN   (current flows when IN is low)
     *   active HIGH  IN  -> opto LED -> R -> GND  (current flows when IN is high)
     *
     * An IN that reached no net at all gets the module's own ground, the same
     * substitution createL298N makes for an unwired logic pin: it solves to the
     * same answer (no current, channel off) without spending a matrix unknown to
     * prove it.
     */
    const inputEnd = inNet ?? nets.gnd
    const optoAnode = activeLow ? nets.vcc : inputEnd
    const seriesEnd = activeLow ? inputEnd : nets.gnd
    const opto = new Diode(`${id}.opto${k + 1}`, optoAnode, optoJunction, OPTO_LED)
    // The opto's OWN ratings, not an indicator LED's: 20 mA is the datasheet's
    // test condition and 50 mA its absolute maximum forward current.
    opto.rating = 0.02
    opto.absMaxCurrent = params.optoMaxAmps
    devices.push(opto)
    devices.push(new Resistor(`${id}.rin${k + 1}`, optoJunction, seriesEnd, params.inputOhms))

    /**
     * The coil, from the module's own VCC down to the driver's collector.
     *
     * Its power rating is the COIL's, not a quarter-watt resistor's. An
     * SRD-05VDC dissipates 0.36 W at its nominal 5 V and is rated to 110 % of
     * that voltage, i.e. 5.5^2/70 = 0.43 W — so a coil doing its job would trip
     * Resistor's 0.25 W default and report a burnt-out part on a correctly built
     * circuit. Above this the coil really is over-volted, and RelayChannel's own
     * safety() names that fault properly, so the two cannot double-report.
     */
    const coil = new Resistor(`${id}.coil${k + 1}`, nets.vcc, coilNode, params.coilOhms)
    coil.rating = (params.maxCoilVolts * params.maxCoilVolts) / params.coilOhms
    devices.push(coil)
    // Flyback: anode on the collector, cathode on VCC. See the note above.
    devices.push(new Diode(`${id}.dfly${k + 1}`, coilNode, nets.vcc, DIODE_1N4148))

    const ch = new RelayChannel(
      `${id}.ch${k + 1}`,
      {
        seriesHi: optoJunction,
        seriesLo: seriesEnd,
        coil: coilNode,
        vcc: nets.vcc,
        gnd: nets.gnd,
        com: nets.com[k],
        no: nets.no[k],
        nc: nets.nc[k],
      },
      params,
    )
    devices.push(ch)
    channels.push(ch)
  }

  return { devices, channels }
}
