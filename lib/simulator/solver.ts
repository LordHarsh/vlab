/**
 * MNA DC operating-point solver with Newton-Raphson and gmin stepping.
 *
 * There is deliberately no time integration here. See SIMULATOR_ARCHITECTURE.md
 * §2.1: every fidelity requirement in the product spec is a DC operating point,
 * and a fixed-timestep transient solver was rejected for being both too slow on
 * target hardware and capable of returning plausible wrong answers silently.
 */

import { luFactor, luSolve } from './linalg'
import {
  type Device,
  type NetId,
  type SolveOptions,
  type SolveResult,
  type StampContext,
  DEFAULT_OPTIONS,
} from './types'

export class Circuit {
  private devices: Device[] = []
  private nextNet: NetId = 1
  private nodeCount = 0
  private extraCount = 0
  private n = 0

  /** Solution carried between solves — a warm start worth several iterations. */
  private x: Float64Array = new Float64Array(0)

  /** Allocate a fresh net. Net 0 is ground and is never allocated. */
  allocNet(): NetId {
    return this.nextNet++
  }

  add(...devices: Device[]): void {
    this.devices.push(...devices)
    this.dirty = true
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

    const direct = this.newton(o, o.gmin)
    if (direct.ok) return direct

    // Homotopy: start with a heavily damped circuit that is trivially solvable,
    // then walk gmin down, warm-starting each step from the last solution. This
    // is what rescues circuits with a floating subnet or a hard nonlinearity.
    const stepped = this.gminStepping(o)
    return stepped
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
      index: (net: NetId) => (net === 0 ? -1 : net - 1),
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
          error: 'solution diverged (non-finite)',
        }
      }

      const converged = this.checkConvergence(xNew, o)
      this.x.set(xNew)
      ctx.x.set(xNew)

      // A linear circuit is exact in one solve; there is nothing to iterate on.
      if (!hasNonlinear) {
        return {
          ok: true,
          voltages: this.extractVoltages(),
          x: this.x,
          iterations,
          usedGminStepping: false,
        }
      }

      // Require at least two iterations so the convergence test compares two
      // real iterates rather than against the zero initial guess, and require
      // that no device is still being damped — see Device.settled.
      const settled = this.devices.every((d) => d.settled !== false)
      if (converged && settled && iter > 0) {
        return {
          ok: true,
          voltages: this.extractVoltages(),
          x: this.x,
          iterations,
          usedGminStepping: false,
        }
      }
    }

    return {
      ok: false,
      voltages: this.extractVoltages(),
      x: this.x,
      iterations,
      usedGminStepping: false,
      error: `no convergence in ${o.maxIter} iterations`,
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
