/**
 * MNA DC operating-point solver with Newton-Raphson and gmin stepping.
 *
 * There is deliberately no time integration here. See SIMULATOR_ARCHITECTURE.md
 * §2.1: every fidelity requirement in the product spec is a DC operating point,
 * and a fixed-timestep transient solver was rejected for being both too slow on
 * target hardware and capable of returning plausible wrong answers silently.
 */

import { luFactor, luSolve } from './linalg'
import { isReactive, type ReactiveDevice } from './devices'
import {
  type Device,
  type NetId,
  type SolveOptions,
  type SolveResult,
  type SolveFault,
  type StampContext,
  DEFAULT_OPTIONS,
} from './types'

export class Circuit {
  private devices: Device[] = []
  private nextNet: NetId = 1
  private nodeCount = 0
  private extraCount = 0
  private n = 0

  /**
   * True once at least one capacitor or inductor has been added. The compiler
   * sets nothing directly — it just adds the devices; the engine reads this flag
   * to decide whether a transient loop is needed (TRANSIENT_DESIGN.md §4).
   */
  hasReactive = false

  /** Reactive devices, cached; invalidated whenever a device is added. */
  private reactiveCache: ReactiveDevice[] | null = null

  /** Solution carried between solves — a warm start worth several iterations. */
  private x: Float64Array = new Float64Array(0)

  /** Allocate a fresh net. Net 0 is ground and is never allocated. */
  allocNet(): NetId {
    // Must invalidate: without this, allocating after a solve leaves the matrix
    // sized for the old net count. Measured symptom was ok:true with a branch
    // current returned in a node-voltage slot and a NaN beside it.
    this.dirty = true
    return this.nextNet++
  }

  add(...devices: Device[]): void {
    this.devices.push(...devices)
    for (const d of devices) if (isReactive(d)) this.hasReactive = true
    this.reactiveCache = null
    this.dirty = true
  }

  private reactive(): ReactiveDevice[] {
    if (this.reactiveCache === null) this.reactiveCache = this.devices.filter(isReactive)
    return this.reactiveCache
  }

  private dirty = true

  /** Assign matrix indices. Cheap, but only redone when the topology changes. */
  private layout(): void {
    this.nodeCount = this.nextNet - 1
    let extra = 0
    for (const d of this.devices) {
      if (d.extraUnknowns > 0) {
        d.branchIndex = this.nodeCount + extra
        extra += d.extraUnknowns
      } else {
        d.branchIndex = -1
      }
    }
    this.extraCount = extra
    this.n = this.nodeCount + extra

    if (this.x.length !== this.n) this.x = new Float64Array(this.n)
    this.dirty = false
  }

  get size(): number {
    if (this.dirty) this.layout()
    return this.n
  }

  /** Discard the warm start. Use when the operating point has moved a long way. */
  resetState(): void {
    this.x = new Float64Array(this.n)
    for (const d of this.devices) {
      const anyDev = d as Device & { reset?: () => void }
      if (typeof anyDev.reset === 'function') anyDev.reset()
    }
  }

  solve(opts: Partial<SolveOptions> = {}): SolveResult {
    const o = { ...DEFAULT_OPTIONS, ...opts }
    if (this.dirty) this.layout()

    let direct: SolveResult
    try {
      direct = this.newton(o, o.gmin)
    } catch (e) {
      // A malformed circuit (e.g. a device stamped onto an unallocated net) must
      // surface as a failed solve, not an exception — this runs inside the
      // simulation worker and a throw would take the whole session down.
      return {
        ok: false,
        voltages: new Float64Array(this.nextNet),
        x: new Float64Array(this.n),
        iterations: 0,
        usedGminStepping: false,
        faults: [],
        error: e instanceof Error ? e.message : String(e),
      }
    }
    if (direct.ok) return direct

    // Homotopy: start with a heavily damped circuit that is trivially solvable,
    // then walk gmin down, warm-starting each step from the last solution. This
    // is what rescues circuits with a floating subnet or a hard nonlinearity.
    const stepped = this.gminStepping(o)
    return stepped
  }

  /**
   * Reset every reactive device to its t=0 initial condition and discard the
   * warm start. Call once before a transient run (TRANSIENT_DESIGN.md §2).
   * Leaves the DC solve() path completely untouched.
   */
  beginTransient(): void {
    if (this.dirty) this.layout()
    for (const d of this.reactive()) d.resetTransient()
    this.x = new Float64Array(this.n)
  }

  /**
   * Advance one transient step of size `h` seconds (backward Euler).
   *
   *   1. set h on every reactive device, so stamp() builds the right Geq/Ieq;
   *   2. run the EXISTING Newton solve — companions make caps/inductors linear,
   *      diodes/LEDs stay nonlinear, so the whole thing goes through solve() as-is;
   *   3. on success, advance each reactive device's stored state from the
   *      converged voltages. On failure, state is NOT advanced (return ok:false).
   *
   * solve() itself is unchanged. Read a node voltage from the returned
   * SolveResult.voltages[net] after each step.
   */
  transientStep(h: number, opts: Partial<SolveOptions> = {}): SolveResult {
    if (this.dirty) this.layout()
    if (!(h > 0) || !Number.isFinite(h)) {
      return {
        ok: false,
        voltages: new Float64Array(this.nextNet),
        x: new Float64Array(this.n),
        iterations: 0,
        usedGminStepping: false,
        faults: [],
        error: `transientStep requires a finite h > 0 (got ${h}).`,
      }
    }

    const reactive = this.reactive()
    for (const d of reactive) d.setStep(h)

    const res = this.solve(opts)

    if (res.ok && reactive.length > 0) {
      // this.x holds the converged solution after solve(); read voltages from it.
      const readCtx = { voltage: (net: NetId): number => (net === 0 ? 0 : this.x[net - 1]) }
      for (const d of reactive) d.advance(readCtx)
    }
    return res
  }

  private gminStepping(o: SolveOptions): SolveResult {
    this.resetState()
    let last: SolveResult | null = null
    for (let g = 1e-3; g >= o.gmin; g /= 10) {
      last = this.newton(o, g)
      if (!last.ok) {
        return {
          ...last,
          usedGminStepping: true,
          error: `gmin stepping failed at g=${g.toExponential(1)}: ${last.error ?? 'no convergence'}`,
        }
      }
    }
    return last
      ? { ...last, usedGminStepping: true }
      : {
          ok: false,
          voltages: new Float64Array(this.nextNet),
          x: this.x,
          iterations: 0,
          usedGminStepping: true,
          faults: [],
          error: 'gmin stepping produced no result',
        }
  }

  private newton(o: SolveOptions, gmin: number): SolveResult {
    const n = this.n
    const A = new Float64Array(n * n)
    const b = new Float64Array(n)
    const hasNonlinear = this.devices.some((d) => d.nonlinear)

    const ctx: StampContext = {
      A,
      b,
      x: this.x,
      n,
      index: (net: NetId) => {
        if (net === 0) return -1
        // Typed arrays discard out-of-range writes silently, so a device
        // stamped onto a net this Circuit never allocated corrupts a branch row
        // and still reports success. Fail loudly instead.
        if (net < 0 || net >= this.nextNet) {
          throw new Error(
            `Device stamped onto net ${net}, which this circuit never allocated ` +
              `(highest is ${this.nextNet - 1}). Nets must come from allocNet().`,
          )
        }
        return net - 1
      },
      voltage: (net: NetId) => (net === 0 ? 0 : this.x[net - 1]),
    }

    let iterations = 0

    for (let iter = 0; iter < o.maxIter; iter++) {
      iterations = iter + 1
      A.fill(0)
      b.fill(0)

      // gmin from every node to ground. Without this a floating subnet — a wire
      // the student hasn't connected yet — produces a singular matrix.
      for (let i = 0; i < this.nodeCount; i++) A[i * n + i] += gmin

      for (const d of this.devices) d.stamp(ctx)

      const LU = A.slice()
      const piv = luFactor(LU, n)
      if (!piv) {
        return {
          ok: false,
          voltages: this.extractVoltages(),
          x: this.x,
          iterations,
          usedGminStepping: false,
          faults: [],
          error: 'singular matrix',
        }
      }

      const xNew = luSolve(LU, piv, b, n)

      if (!allFinite(xNew)) {
        return {
          ok: false,
          voltages: this.extractVoltages(),
          x: this.x,
          iterations,
          usedGminStepping: false,
          faults: [],
          error: 'solution diverged (non-finite)',
        }
      }

      const converged = this.checkConvergence(xNew, o)
      this.x.set(xNew)
      ctx.x.set(xNew)

      // A linear circuit is exact in one solve; there is nothing to iterate on.
      if (!hasNonlinear) {
        return this.succeed(ctx, iterations)
      }

      // Require at least two iterations so the convergence test compares two
      // real iterates rather than against the zero initial guess, and require
      // that no device is still being damped — see Device.settled.
      const settled = this.devices.every((d) => d.settled !== false)
      if (converged && settled && iter > 0) {
        return this.succeed(ctx, iterations)
      }
    }

    return {
      ok: false,
      voltages: this.extractVoltages(),
      x: this.x,
      iterations,
      usedGminStepping: false,
      faults: [],
      error: `no convergence in ${o.maxIter} iterations`,
    }
  }

  /**
   * Finalise a converged solve: let devices recompute their reported quantities
   * from the final voltages, and hand back copies rather than the live buffers.
   */
  private succeed(ctx: StampContext, iterations: number): SolveResult {
    for (const d of this.devices) d.readback?.(ctx)
    const faults: SolveFault[] = []
    for (const d of this.devices) {
      const f = d.safety?.(ctx)
      if (f) faults.push(f)
    }
    return {
      ok: true,
      faults,
      voltages: this.extractVoltages(),
      // this.x is the warm-start buffer and keeps mutating on the next solve;
      // returning it directly let an old result change under the caller.
      x: this.x.slice(),
      iterations,
      usedGminStepping: false,
    }
  }

  private checkConvergence(xNew: Float64Array, o: SolveOptions): boolean {
    for (let i = 0; i < this.nodeCount; i++) {
      const tol = o.reltol * Math.abs(xNew[i]) + o.vntol
      if (Math.abs(xNew[i] - this.x[i]) > tol) return false
    }
    for (let i = this.nodeCount; i < this.n; i++) {
      const tol = o.reltol * Math.abs(xNew[i]) + o.abstol
      if (Math.abs(xNew[i] - this.x[i]) > tol) return false
    }
    return true
  }

  private extractVoltages(): Float64Array {
    const v = new Float64Array(this.nextNet)
    for (let net = 1; net < this.nextNet; net++) v[net] = this.x[net - 1]
    return v
  }
}

function allFinite(a: Float64Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}
