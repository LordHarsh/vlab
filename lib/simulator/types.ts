/**
 * Core types for the VLab circuit simulator.
 *
 * Net 0 is always ground. Every other net gets a row/column in the MNA matrix.
 * See SIMULATOR_ARCHITECTURE.md §2 for why this is a DC operating-point solver
 * with no transient integration in the hot loop.
 */

export type NetId = number

export const GROUND: NetId = 0

/** Thermal voltage at 300.15 K (27 °C), the SPICE default. */
export const VT = 0.025852

export interface SolveOptions {
  /** Relative tolerance on the Newton convergence check. */
  reltol: number
  /** Absolute voltage tolerance (volts). */
  vntol: number
  /** Absolute current tolerance (amps). */
  abstol: number
  /** Newton iteration cap before we declare non-convergence. */
  maxIter: number
  /**
   * Conductance added from every node to ground. Prevents singular matrices when
   * a student leaves a subnet floating — the single most common failure mode.
   *
   * The architecture suggested 1 GΩ (1e-9 S), but that is only 10x below the
   * 1e-8 S used to model a high-impedance input pin, so it visibly loaded high
   * value dividers: a 10M/10M pair read 2.3697 V against a true 2.3810 V, about
   * 2.3 LSB of a 10-bit analogRead. 1 TΩ still breaks singularity and sits four
   * orders below the input model.
   */
  gmin: number
}

export const DEFAULT_OPTIONS: SolveOptions = {
  reltol: 1e-3,
  vntol: 1e-6,
  abstol: 1e-12,
  maxIter: 100,
  gmin: 1e-12,
}

/**
 * The matrix being assembled for one Newton iteration.
 *
 * `A` is row-major dense, size n×n. `b` is the RHS. `x` is the previous Newton
 * iterate, which nonlinear devices read to compute their linearisation point.
 */
export interface StampContext {
  readonly A: Float64Array
  readonly b: Float64Array
  readonly x: Float64Array
  readonly n: number
  /** Matrix index for a net, or -1 for ground (which has no row/column). */
  index(net: NetId): number
  /** Voltage of a net at the current Newton iterate. Ground is always 0. */
  voltage(net: NetId): number
}

export interface Device {
  readonly id: string
  /** Nonlinear devices force the Newton loop to iterate. */
  readonly nonlinear: boolean
  /** Number of extra unknowns (branch currents) this device needs. */
  readonly extraUnknowns: number
  /**
   * Assigned by the solver before stamping: the matrix index of this device's
   * first extra unknown, or -1 if it has none.
   */
  branchIndex: number
  stamp(ctx: StampContext): void
  /**
   * False while the device is still being damped (e.g. a diode whose junction
   * voltage is being limited). The node-voltage convergence test alone is not
   * sufficient: an off diode moves the node voltages by almost nothing between
   * iterations, so Newton "converges" at the wrong root while limiting is still
   * walking the junction up. SPICE guards this the same way.
   */
  readonly settled?: boolean
  /**
   * Recompute reported quantities (currents, powers) from the CONVERGED
   * voltages. Called once after the Newton loop succeeds.
   *
   * Without this a device's current is one iterate stale: stamp() reads iterate
   * k−1, the solver then solves for k and returns those voltages. With
   * reltol=1e-3 the final step can be ~1 mV, which on a diode's exponential is
   * ~2% of current — and the error depends on how many iterations were needed,
   * so a cold solve and a warm solve of the same circuit disagreed. That value
   * feeds LED brightness, the over-current check, and the memoisation cache.
   */
  readback?(ctx: StampContext): void
}

export interface SolveResult {
  ok: boolean
  /** Node voltages indexed by NetId. Index 0 (ground) is always 0. */
  voltages: Float64Array
  /** Raw solution vector, including branch currents past the node block. */
  x: Float64Array
  iterations: number
  /** Set when ok === false. */
  error?: string
  /** True if gmin stepping was needed to reach a solution. */
  usedGminStepping: boolean
}
