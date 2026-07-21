/**
 * Device models and their MNA stamps.
 *
 * Every device contributes conductances to A and currents to b. Nonlinear
 * devices linearise around the previous Newton iterate (companion model:
 * a conductance Geq in parallel with a current source Ieq).
 */

import { type Device, type StampContext, type NetId, VT } from './types'

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
    const r = Math.max(this.ohms, MIN_RESISTANCE)
    stampConductance(ctx, this.a, this.b, 1 / r)
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
