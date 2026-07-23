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
    private a: NetId,
    private b: NetId,
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

  safety(ctx: StampContext): SolveFault | null {
    // A port whose two terminals are the SAME net contributes nothing to the
    // matrix, so there is no real current to judge and nothing to report here:
    //   - a pin wired straight to GND has a === b === ground. That is a
    //     topological dead short, already surfaced by ShortedPin in compile.ts
    //     and gated on drive state by the engine, so reporting it again here
    //     would double-count it.
    //   - a degenerate self-loop (a === b on a floating net) is a no-op.
    if (this.a === this.b) return null

    // Current the pin drives OUT into its net is the branch current a → b of a
    // Norton source: i − g·(V_b − V_a). Real MCU pins reference ground (a = 0),
    // so this is (V_open − V_net)/R_drive, exactly the current sourced.
    //
    // Only a pin actively SOURCING can exceed a few mA. A floating or pull-up
    // INPUT (i ≈ 0 with a tiny g) can source at most ~0.25 mA, and a pin
    // sinking current gives a negative value — both fall under the rating and
    // never fault, which is the "floating/input pins must not fault" rule.
    const sourced = this.i - this.g * (ctx.voltage(this.b) - ctx.voltage(this.a))
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

  constructor(
    readonly id: string,
    private a: NetId,
    private b: NetId,
    private farads: number,
    v0 = 0,
  ) {
    this.v0 = v0
    this.vPrev = v0
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
}

/** Silicon signal diode, roughly 1N4148. */
export const DIODE_1N4148: DiodeParams = { is: 2.52e-9, n: 1.752 }

/**
 * Red LED. These parameters are not arbitrary — combined with a 2 Ω series
 * resistance they reproduce the ngspice reference numbers in
 * SIMULATOR_ARCHITECTURE.md §5.5 to within a fraction of a milliamp:
 *
 *   220 Ω → 13.76 mA,  1 kΩ → 3.12 mA,  10 kΩ → 0.32 mA,  none → 1419 mA
 */
export const LED_RED: DiodeParams = { is: 1e-20, n: 1.8 }
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

  /** Recommended continuous forward current. A 5 mm LED is typically 20 mA. */
  rating = 0.02

  /**
   * Absolute-maximum continuous forward current. Standard 5 mm LED datasheets
   * (e.g. Kingbright / Vishay red) rate the DC forward current at 20 mA
   * recommended and 30 mA absolute maximum, above which the die overheats and
   * fails. Between the two the LED is bright but running hot — a caution.
   */
  absMaxCurrent = 0.03

  safety(ctx: StampContext): SolveFault | null {
    this.readback(ctx)
    // At or below the rating there is nothing to say.
    if (this.current <= this.rating) return null

    const mA = (this.current * 1000).toFixed(0)
    const rated = (this.rating * 1000).toFixed(0)

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
          `${mA} mA through a part running above its ${rated} mA rating. ` +
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
        `${mA} mA through a part rated for ${rated} mA. ` +
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
