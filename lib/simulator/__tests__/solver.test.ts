/**
 * Adversarial test suite for the MNA DC operating-point solver.
 *
 * Everything here is asserted against CLOSED-FORM circuit theory computed inside
 * this file — never against the solver's own output. Where a value cannot be
 * written in closed form (diode chains), it is obtained by bisecting the exact
 * nonlinear scalar equation, which is an independent oracle, not the solver.
 *
 * Two extra independent oracles are used because SIMULATOR_ARCHITECTURE.md §5
 * names "a plausible but wrong number reported as success" as the failure mode
 * that matters:
 *
 *   1. kclAudit()      — recomputes every device current from device physics
 *                        using only the RETURNED voltages, and checks KCL at
 *                        every node. A dropped, mis-signed or mis-stamped
 *                        device shows up here even if Newton "converged".
 *   2. referenceNodal() — a second, completely separate resistive-network
 *                        solver (plain nodal analysis + my own Gauss-Jordan,
 *                        not linalg.ts) used to cross-check randomised nets.
 *
 * Run: npx tsx lib/simulator/__tests__/solver.test.ts
 */

import { Circuit } from '../solver'
import {
  Resistor,
  VoltageSource,
  NortonPort,
  Diode,
  createLED,
  DIODE_1N4148,
  LED_RED,
  LED_SERIES_R,
  type DiodeParams,
} from '../devices'
import { GROUND, VT, type NetId } from '../types'

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Row {
  group: string
  name: string
  expected: string
  actual: string
  pass: boolean
  note?: string
}

const rows: Row[] = []
let currentGroup = ''
function group(g: string): void {
  currentGroup = g
}

function fmt(x: number): string {
  if (typeof x !== 'number') return String(x)
  if (!Number.isFinite(x)) return String(x)
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(4)
  return x.toFixed(6)
}

function record(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass, note })
}

/** Assert a number against a theory value. NaN/Infinity always fails. */
function near(name: string, actual: number, expected: number, tol: number, unit = 'V'): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  record(
    name,
    pass,
    `${fmt(expected)} ${unit}`,
    `${fmt(actual)} ${unit}`,
    pass ? undefined : `err ${fmt(Math.abs(actual - expected))} > tol ${fmt(tol)}`,
  )
}

function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}

function allFinite(a: Float64Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

// ─── Independent oracle 1: KCL audit from device physics ──────────────────────

type Elem =
  | { k: 'R'; a: NetId; b: NetId; ohms: number }
  | { k: 'D'; a: NetId; b: NetId; p: DiodeParams }
  | { k: 'V'; a: NetId; b: NetId; branch: number }
  | { k: 'N'; a: NetId; b: NetId; g: number; i: number }

/** Current a → b through the element, from device physics and the solved voltages. */
function elemCurrent(e: Elem, v: Float64Array, x: Float64Array): number {
  const va = e.a === GROUND ? 0 : v[e.a]
  const vb = e.b === GROUND ? 0 : v[e.b]
  switch (e.k) {
    case 'R':
      return (va - vb) / Math.max(e.ohms, 1e-12)
    case 'D': {
      const vte = e.p.n * VT
      return e.p.is * (Math.exp(Math.min((va - vb) / vte, 300)) - 1)
    }
    case 'N':
      return e.g * (va - vb) + e.i
    case 'V':
      // The stamp defines the branch unknown as the current leaving `pos`.
      return x[e.branch]
  }
}

/**
 * Check KCL at every non-ground node using only the returned voltages.
 * Returns the worst absolute residual and the scale of the largest device current.
 */
function kclAudit(
  elems: Elem[],
  v: Float64Array,
  x: Float64Array,
): { worst: number; node: number; scale: number } {
  const leaving = new Float64Array(v.length)
  let scale = 0
  for (const e of elems) {
    const i = elemCurrent(e, v, x)
    if (Number.isFinite(i)) scale = Math.max(scale, Math.abs(i))
    if (e.a !== GROUND) leaving[e.a] += i
    if (e.b !== GROUND) leaving[e.b] -= i
  }
  let worst = 0
  let node = 0
  for (let k = 1; k < v.length; k++) {
    // gmin (1e-9 S from every node to ground) is a legitimate part of the answer.
    const r = Math.abs(leaving[k] + 1e-9 * v[k])
    if (r > worst) {
      worst = r
      node = k
    }
  }
  return { worst, node, scale }
}

function kclCheck(name: string, elems: Elem[], v: Float64Array, x: Float64Array, relTol = 1e-5): void {
  const { worst, node, scale } = kclAudit(elems, v, x)
  const tol = 2e-8 + relTol * scale
  const pass = Number.isFinite(worst) && worst <= tol
  record(
    name,
    pass,
    `|KCL| <= ${fmt(tol)} A`,
    `${fmt(worst)} A @ net ${node}`,
    pass ? undefined : `largest device current ${fmt(scale)} A`,
  )
}

// ─── Independent oracle 2: a second resistive solver ──────────────────────────

/** Gauss-Jordan with partial pivoting. Deliberately NOT linalg.ts. */
function gaussJordan(M: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const A = M.map((r, i) => [...r, rhs[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-300) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    const d = A[c][c]
    for (let j = c; j <= n; j++) A[c][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c]
      if (f === 0) continue
      for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j]
    }
  }
  return A.map((r) => r[n])
}

/** Plain nodal analysis for a resistive net with some node voltages held fixed. */
function referenceNodal(
  nodeCount: number,
  fixed: Map<number, number>,
  res: Array<[number, number, number]>,
): number[] | null {
  const unknown: number[] = []
  for (let k = 1; k <= nodeCount; k++) if (!fixed.has(k)) unknown.push(k)
  const idx = new Map(unknown.map((k, i) => [k, i]))
  const m = unknown.length
  const A = Array.from({ length: m }, () => new Array(m).fill(0))
  const b = new Array(m).fill(0)
  const vOf = (k: number) => (k === 0 ? 0 : (fixed.get(k) ?? NaN))

  for (const [a, bb, r] of res) {
    const g = 1 / r
    for (const [p, q] of [
      [a, bb],
      [bb, a],
    ]) {
      const ip = idx.get(p)
      if (ip === undefined) continue
      A[ip][ip] += g
      const iq = idx.get(q)
      if (iq !== undefined) A[ip][iq] -= g
      else b[ip] += g * vOf(q)
    }
  }
  const sol = gaussJordan(A, b)
  if (!sol) return null
  const out = new Array(nodeCount + 1).fill(0)
  for (let k = 1; k <= nodeCount; k++) out[k] = fixed.has(k) ? fixed.get(k)! : sol[idx.get(k)!]
  return out
}

// ─── Independent oracle 3: exact nonlinear scalar solve ───────────────────────

/**
 * Exact solution of  V = I*R + k*n*VT*ln(I/Is + 1)  by bisection.
 * Machine-precision, and computed without touching the solver.
 */
function seriesDiodeCurrent(V: number, R: number, k: number, p: DiodeParams): number {
  const vte = p.n * VT
  const f = (I: number) => V - I * R - k * vte * Math.log(I / p.is + 1)
  let lo = 0
  let hi = V / R
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

function diodeDrop(I: number, p: DiodeParams): number {
  return p.n * VT * Math.log(I / p.is + 1)
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Ohm's law — dividers, series/parallel, superposition
// ══════════════════════════════════════════════════════════════════════════════

group('1 ohm')

{
  // 5 V ── 1k ── mid ── 2k ── GND.  Theory: 5 * 2/(1+2) = 10/3 V.
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, mid, 1000))
  c.add(new Resistor('R2', mid, GROUND, 2000))
  const r = c.solve()
  truth('1.1 divider solves', r.ok, 'ok:true', `ok:${r.ok}${r.error ? ' ' + r.error : ''}`)
  near('1.1 divider Vcc', r.voltages[vcc], 5, 1e-9)
  near('1.1 divider Vmid = 10/3', r.voltages[mid], 10 / 3, 1e-5)
  near('1.1 source branch current', r.x[c.size - 1] * 1000, -5 / 3, 1e-5, 'mA')
  kclCheck('1.1 divider KCL', [
    { k: 'V', a: vcc, b: GROUND, branch: 1 },
    { k: 'R', a: vcc, b: mid, ohms: 1000 },
    { k: 'R', a: mid, b: GROUND, ohms: 2000 },
  ], r.voltages, r.x)
}

{
  // Series 1k + 2k + 3k across 5 V. I = 5/6 mA. Nodes 5, 25/6, 5/2.
  const c = new Circuit()
  const n1 = c.allocNet()
  const n2 = c.allocNet()
  const n3 = c.allocNet()
  c.add(new VoltageSource('V1', n1, GROUND, 5))
  c.add(new Resistor('R1', n1, n2, 1000))
  c.add(new Resistor('R2', n2, n3, 2000))
  c.add(new Resistor('R3', n3, GROUND, 3000))
  const r = c.solve()
  near('1.2 series n2 = 25/6', r.voltages[n2], 25 / 6, 1e-5)
  near('1.2 series n3 = 5/2', r.voltages[n3], 5 / 2, 1e-5)
}

{
  // 600 Ω in series with (1k ‖ 1k ‖ 2k = 400 Ω) across 5 V → mid = 2 V exactly.
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('Rs', vcc, mid, 600))
  c.add(new Resistor('Ra', mid, GROUND, 1000))
  c.add(new Resistor('Rb', mid, GROUND, 1000))
  c.add(new Resistor('Rc', mid, GROUND, 2000))
  const r = c.solve()
  near('1.3 parallel 1k|1k|2k mid = 2 V', r.voltages[mid], 2, 1e-5)
}

{
  // Superposition: node X tied by 1k→5V, 2k→3V, 3k→GND.
  // V = (5/1k + 3/2k) / (1/1k + 1/2k + 1/3k) = 39/11.
  const build = (v1: number, v2: number) => {
    const c = new Circuit()
    const a = c.allocNet()
    const b = c.allocNet()
    const x = c.allocNet()
    c.add(new VoltageSource('V1', a, GROUND, v1))
    c.add(new VoltageSource('V2', b, GROUND, v2))
    c.add(new Resistor('R1', a, x, 1000))
    c.add(new Resistor('R2', b, x, 2000))
    c.add(new Resistor('R3', x, GROUND, 3000))
    return { r: c.solve(), x }
  }
  const both = build(5, 3)
  const only1 = build(5, 0)
  const only2 = build(0, 3)
  near('1.4 two sources Vx = 39/11', both.r.voltages[both.x], 39 / 11, 1e-5)
  near('1.4 V1 alone Vx = 30/11', only1.r.voltages[only1.x], 30 / 11, 1e-5)
  near('1.4 V2 alone Vx = 9/11', only2.r.voltages[only2.x], 9 / 11, 1e-5)
  const sup = only1.r.voltages[only1.x] + only2.r.voltages[only2.x]
  near('1.4 superposition holds', sup, both.r.voltages[both.x], 1e-9)
}

{
  // Floating source: neither terminal grounded.
  // GND -V1(5)- n1 -1k- n2 -V2(3, +n2/-n3)- n3 -2k- GND  →  I = 2/3 mA.
  const c = new Circuit()
  const n1 = c.allocNet()
  const n2 = c.allocNet()
  const n3 = c.allocNet()
  c.add(new VoltageSource('V1', n1, GROUND, 5))
  c.add(new Resistor('R1', n1, n2, 1000))
  c.add(new VoltageSource('V2', n2, n3, 3))
  c.add(new Resistor('R2', n3, GROUND, 2000))
  const r = c.solve()
  near('1.5 floating src n2 = 13/3', r.voltages[n2], 13 / 3, 1e-5)
  near('1.5 floating src n3 = 4/3', r.voltages[n3], 4 / 3, 1e-5)
  kclCheck('1.5 floating src KCL', [
    { k: 'V', a: n1, b: GROUND, branch: 3 },
    { k: 'R', a: n1, b: n2, ohms: 1000 },
    { k: 'V', a: n2, b: n3, branch: 4 },
    { k: 'R', a: n3, b: GROUND, ohms: 2000 },
  ], r.voltages, r.x)
}

{
  // Unbalanced Wheatstone with a bridging resistor: vA = 43/13, vB = 38/13.
  const c = new Circuit()
  const vcc = c.allocNet()
  const a = c.allocNet()
  const b = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, a, 1000))
  c.add(new Resistor('R2', a, GROUND, 2000))
  c.add(new Resistor('R3', vcc, b, 3000))
  c.add(new Resistor('R4', b, GROUND, 4000))
  c.add(new Resistor('R5', a, b, 10000))
  const r = c.solve()
  near('1.6 bridge vA = 43/13', r.voltages[a], 43 / 13, 1e-5)
  near('1.6 bridge vB = 38/13', r.voltages[b], 38 / 13, 1e-5)
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. R-2R ladder — exact halving at every rung
// ══════════════════════════════════════════════════════════════════════════════

group('2 ladder')

{
  // R-2R: driven node n1 at 5 V, then R to each next node, 2R shunt at each
  // node, and a 2R termination doubling up on the last node. Looking right from
  // any node is exactly 2R, so every node is exactly half the previous.
  const R = 1000
  const STAGES = 8
  const c = new Circuit()
  const nodes: NetId[] = []
  for (let i = 0; i < STAGES; i++) nodes.push(c.allocNet())
  c.add(new VoltageSource('V1', nodes[0], GROUND, 5))
  for (let i = 0; i < STAGES; i++) {
    c.add(new Resistor(`Rsh${i}`, nodes[i], GROUND, 2 * R))
    if (i + 1 < STAGES) c.add(new Resistor(`Rse${i}`, nodes[i], nodes[i + 1], R))
  }
  c.add(new Resistor('Rterm', nodes[STAGES - 1], GROUND, 2 * R))
  const r = c.solve()
  truth('2.1 R-2R solves', r.ok, 'ok:true', `ok:${r.ok}`)
  let worst = 0
  for (let i = 0; i < STAGES; i++) {
    worst = Math.max(worst, Math.abs(r.voltages[nodes[i]] - 5 / 2 ** i))
  }
  near('2.1 R-2R node k = 5/2^k (worst of 8)', worst, 0, 1e-6)
  near('2.1 R-2R last node = 5/128', r.voltages[nodes[7]], 5 / 128, 1e-7)
  // Input resistance of an R-2R ladder is exactly R.
  near('2.1 R-2R input current = 5 mA', -r.x[c.size - 1] * 1000, 5, 1e-5, 'mA')
}

{
  // Second ladder with an analytic recurrence: series 1k, shunt 10k, 6 rungs.
  const c = new Circuit()
  const vcc = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  const RUNGS = 6
  const nodes: NetId[] = []
  let prev = vcc
  for (let i = 0; i < RUNGS; i++) {
    const nd = c.allocNet()
    nodes.push(nd)
    c.add(new Resistor(`Rs${i}`, prev, nd, 1000))
    c.add(new Resistor(`Rp${i}`, nd, GROUND, 10000))
    prev = nd
  }
  const r = c.solve()
  // Reference: fold the ladder from the far end, then walk voltages forward.
  const Rin: number[] = new Array(RUNGS)
  for (let i = RUNGS - 1; i >= 0; i--) {
    const right = i === RUNGS - 1 ? Infinity : 1000 + Rin[i + 1]
    Rin[i] = 1 / (1 / 10000 + 1 / right)
  }
  const expected: number[] = []
  let vSrc = 5
  for (let i = 0; i < RUNGS; i++) {
    const v = vSrc * (Rin[i] / (1000 + Rin[i]))
    expected.push(v)
    vSrc = v
  }
  let w = 0
  for (let i = 0; i < RUNGS; i++) w = Math.max(w, Math.abs(r.voltages[nodes[i]] - expected[i]))
  near('2.2 RC-ladder recurrence (worst of 6)', w, 0, 1e-5)
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. Diode: forward drop and reverse blocking
// ══════════════════════════════════════════════════════════════════════════════

group('3 diode')

{
  // 5 V ── 4.3k ── D(1N4148) ── GND. Exact I from the closed-form equation.
  const c = new Circuit()
  const vcc = c.allocNet()
  const an = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, an, 4300))
  const d = new Diode('D1', an, GROUND, DIODE_1N4148)
  c.add(d)
  const r = c.solve()
  const Iexact = seriesDiodeCurrent(5, 4300, 1, DIODE_1N4148)
  const Vdexact = diodeDrop(Iexact, DIODE_1N4148)
  truth('3.1 fwd diode solves', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
  near('3.1 fwd diode I (exact)', d.current * 1000, Iexact * 1000, 1e-4, 'mA')
  near('3.1 fwd diode Vd (exact)', r.voltages[an], Vdexact, 1e-5)
  // The brief's acceptance band: 0.6–0.7 V at ~1 mA.
  const inBand = r.voltages[an] >= 0.6 && r.voltages[an] <= 0.7
  truth(
    '3.1 Vd in 0.6-0.7 V band @ 1 mA',
    inBand,
    '0.6 .. 0.7 V',
    `${fmt(r.voltages[an])} V @ ${fmt(d.current * 1000)} mA`,
    inBand ? undefined : 'DIODE_1N4148 params put 1 mA at 0.585 V',
  )
  kclCheck('3.1 fwd diode KCL', [
    { k: 'V', a: vcc, b: GROUND, branch: 2 },
    { k: 'R', a: vcc, b: an, ohms: 4300 },
    { k: 'D', a: an, b: GROUND, p: DIODE_1N4148 },
  ], r.voltages, r.x)
}

{
  // Sanity on the same model at 10 mA — should land in the classic 0.65–0.70 band.
  const I = seriesDiodeCurrent(5, 432, 1, DIODE_1N4148)
  const c = new Circuit()
  const vcc = c.allocNet()
  const an = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, an, 432))
  const d = new Diode('D1', an, GROUND, DIODE_1N4148)
  c.add(d)
  const r = c.solve()
  near('3.2 fwd diode @ ~10 mA (exact)', d.current * 1000, I * 1000, 1e-3, 'mA')
  near('3.2 Vd @ ~10 mA (exact)', r.voltages[an], diodeDrop(I, DIODE_1N4148), 1e-5)
}

{
  // Reverse bias: 5 V across a reversed diode through 1k. I must be ~ -Is.
  const c = new Circuit()
  const vcc = c.allocNet()
  const nd = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, nd, 1000))
  const d = new Diode('D1', GROUND, nd, DIODE_1N4148) // anode grounded → reverse
  c.add(d)
  const r = c.solve()
  truth('3.3 reverse diode solves', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
  near('3.3 reverse current = -Is', d.current, -DIODE_1N4148.is, 1e-13, 'A')
  near('3.3 reverse node holds 5 V', r.voltages[nd], 5, 1e-4)
  truth(
    '3.3 reverse leakage < 10 nA',
    Math.abs(d.current) < 1e-8,
    '< 1e-8 A',
    `${fmt(Math.abs(d.current))} A`,
  )
}

{
  // Hard reverse bias, 100 V — must not overflow or NaN.
  const c = new Circuit()
  const vcc = c.allocNet()
  const nd = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 100))
  c.add(new Resistor('R1', vcc, nd, 1000))
  const d = new Diode('D1', GROUND, nd, DIODE_1N4148)
  c.add(d)
  const r = c.solve()
  truth(
    '3.4 100 V reverse: finite',
    r.ok && allFinite(r.voltages),
    'ok:true, finite',
    `ok:${r.ok}, v=${fmt(r.voltages[nd])}`,
  )
}

{
  // LED sweep against the ngspice reference in SIMULATOR_ARCHITECTURE.md §5.5,
  // and against the exact closed form of the same model.
  for (const [R, refmA] of [
    [220, 13.76],
    [1000, 3.12],
    [10000, 0.32],
    [0, 1419],
  ] as const) {
    const c = new Circuit()
    const vcc = c.allocNet()
    const an = R > 0 ? c.allocNet() : vcc
    const internal = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, 5))
    if (R > 0) c.add(new Resistor('R1', vcc, an, R))
    const { devices, diode } = createLED('LED1', an, GROUND, internal)
    c.add(...devices)
    const r = c.solve()
    const exact = seriesDiodeCurrent(5, R + LED_SERIES_R, 1, LED_RED)
    near(`3.5 LED ${R || 'none'} exact I`, diode.current * 1000, exact * 1000, 1e-3, 'mA')
    const errPct = (Math.abs(diode.current * 1000 - refmA) / refmA) * 100
    truth(
      `3.5 LED ${R || 'none'} vs ngspice`,
      r.ok && errPct < 5,
      `${refmA} mA +-5%`,
      `${fmt(diode.current * 1000)} mA (${errPct.toFixed(2)}%)`,
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. Diode topologies: series, anti-series, anti-parallel
// ══════════════════════════════════════════════════════════════════════════════

group('4 diode top')

{
  // 5 V ── 1k ── D1 ── mid ── D2 ── GND.
  const c = new Circuit()
  const vcc = c.allocNet()
  const a = c.allocNet()
  const mid = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, a, 1000))
  const d1 = new Diode('D1', a, mid, DIODE_1N4148)
  const d2 = new Diode('D2', mid, GROUND, DIODE_1N4148)
  c.add(d1, d2)
  const r = c.solve()
  const I = seriesDiodeCurrent(5, 1000, 2, DIODE_1N4148)
  const Vd = diodeDrop(I, DIODE_1N4148)
  truth('4.1 two in series solves', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
  near('4.1 series I (exact)', d1.current * 1000, I * 1000, 1e-4, 'mA')
  near('4.1 series node A = 2*Vd', r.voltages[a], 2 * Vd, 1e-5)
  near('4.1 series node mid = Vd', r.voltages[mid], Vd, 1e-5)
  // Identical diodes carrying the same current must drop identically.
  near('4.1 equal split (mid = A/2)', r.voltages[mid], r.voltages[a] / 2, 1e-7)
  near('4.1 same current in both', d1.current - d2.current, 0, 1e-11, 'A')
  kclCheck('4.1 two in series KCL', [
    { k: 'V', a: vcc, b: GROUND, branch: 3 },
    { k: 'R', a: vcc, b: a, ohms: 1000 },
    { k: 'D', a, b: mid, p: DIODE_1N4148 },
    { k: 'D', a: mid, b: GROUND, p: DIODE_1N4148 },
  ], r.voltages, r.x)
}

{
  // Anti-series (back to back): D1 a→mid, D2 GND→mid. Must block both ways.
  const runAntiSeries = (supply: number) => {
    const c = new Circuit()
    const vcc = c.allocNet()
    const a = c.allocNet()
    const mid = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, supply))
    c.add(new Resistor('R1', vcc, a, 1000))
    c.add(new Diode('D1', a, mid, DIODE_1N4148))
    c.add(new Diode('D2', GROUND, mid, DIODE_1N4148))
    const r = c.solve()
    return { r, a, vcc, current: (supply - r.voltages[a]) / 1000 }
  }
  const fwd = runAntiSeries(5)
  const rev = runAntiSeries(-5)
  truth('4.2 anti-series +5 V solves', fwd.r.ok, 'ok:true', `ok:${fwd.r.ok}`)
  truth('4.2 anti-series -5 V solves', rev.r.ok, 'ok:true', `ok:${rev.r.ok}`)
  truth(
    '4.2 anti-series blocks at +5 V',
    Math.abs(fwd.current) < 1e-6,
    '|I| < 1 uA',
    `${fmt(fwd.current)} A`,
  )
  truth(
    '4.2 anti-series blocks at -5 V',
    Math.abs(rev.current) < 1e-6,
    '|I| < 1 uA',
    `${fmt(rev.current)} A`,
  )
  truth(
    '4.2 anti-series symmetric',
    Math.abs(fwd.current + rev.current) < 1e-9,
    'I(+5) = -I(-5)',
    `${fmt(fwd.current + rev.current)} A`,
  )
}

{
  // Anti-parallel: must conduct in both directions, symmetrically.
  const runAntiParallel = (supply: number) => {
    const c = new Circuit()
    const vcc = c.allocNet()
    const a = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, supply))
    c.add(new Resistor('R1', vcc, a, 1000))
    c.add(new Diode('D1', a, GROUND, DIODE_1N4148))
    c.add(new Diode('D2', GROUND, a, DIODE_1N4148))
    const r = c.solve()
    return { r, i: (supply - r.voltages[a]) / 1000, v: r.voltages[a] }
  }
  const p = runAntiParallel(5)
  const m = runAntiParallel(-5)
  const I = seriesDiodeCurrent(5, 1000, 1, DIODE_1N4148)
  near('4.3 anti-parallel +5 V I (exact)', p.i * 1000, I * 1000, 1e-4, 'mA')
  near('4.3 anti-parallel -5 V I (exact)', m.i * 1000, -I * 1000, 1e-4, 'mA')
  truth(
    '4.3 anti-parallel symmetric',
    Math.abs(p.v + m.v) < 1e-9,
    'V(+5) = -V(-5)',
    `${fmt(p.v + m.v)} V`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. NortonPort polarity in every pin mode
// ══════════════════════════════════════════════════════════════════════════════

group('5 norton')

const R_DRIVE = 25
const R_PULLUP = 20000
const G_FLOAT = 1e-8
const VCC = 5
const MODES = {
  output_low: { g: 1 / R_DRIVE, i: 0 },
  output_high: { g: 1 / R_DRIVE, i: VCC / R_DRIVE },
  input: { g: G_FLOAT, i: 0 },
  input_pullup: { g: 1 / R_PULLUP, i: VCC / R_PULLUP },
} as const

/** Pin driven by a Norton port, optionally loaded by `rl` ohms to `to`. */
function pinRig(
  mode: keyof typeof MODES,
  load?: { ohms: number; to: 'gnd' | 'vcc' },
): { v: number; ok: boolean; res: ReturnType<Circuit['solve']> } {
  const c = new Circuit()
  const pin = c.allocNet()
  const { g, i } = MODES[mode]
  c.add(new NortonPort('P', GROUND, pin, g, i))
  if (load) {
    if (load.to === 'gnd') c.add(new Resistor('RL', pin, GROUND, load.ohms))
    else {
      const rail = c.allocNet()
      c.add(new VoltageSource('VR', rail, GROUND, 5))
      c.add(new Resistor('RL', pin, rail, load.ohms))
    }
  }
  const res = c.solve()
  return { v: res.voltages[pin], ok: res.ok, res }
}

// Theory: a Norton (G, I) between GND and pin is a Thevenin source of I/G volts
// behind 1/G ohms.  Open circuit → I/G.  Loaded by RL → (I/G)*RL/(RL + 1/G).
{
  near('5.1 output_high, open', pinRig('output_high').v, 5, 1e-3)
  near('5.1 output_low, open', pinRig('output_low').v, 0, 1e-9)
  near('5.1 input_pullup, open', pinRig('input_pullup').v, 5, 1e-3)
  near('5.1 input (hi-Z), open', pinRig('input').v, 0, 1e-9)

  near('5.2 output_high + 1k to GND', pinRig('output_high', { ohms: 1000, to: 'gnd' }).v,
    5 * 1000 / (1000 + 25), 1e-4)
  near('5.2 output_low + 1k to 5V', pinRig('output_low', { ohms: 1000, to: 'vcc' }).v,
    5 * 25 / (1000 + 25), 1e-4)
  near('5.2 input_pullup + 20k to GND', pinRig('input_pullup', { ohms: 20000, to: 'gnd' }).v,
    2.5, 1e-3)
  near('5.2 input_pullup + 1k to GND', pinRig('input_pullup', { ohms: 1000, to: 'gnd' }).v,
    5 * 1000 / 21000, 1e-4)
  near('5.2 input + 1k to 5V', pinRig('input', { ohms: 1000, to: 'vcc' }).v,
    5 * (1 / 1000) / (1 / 1000 + G_FLOAT + 1e-9), 1e-5)
}

{
  // Argument-order probe. NortonPort(a, b, g, i) pushes i from a to b, so a port
  // written as (pin, GND, ...) is the SAME device reversed: -I/G.
  const c = new Circuit()
  const pin = c.allocNet()
  c.add(new NortonPort('P', pin, GROUND, 1 / R_DRIVE, VCC / R_DRIVE))
  const r = c.solve()
  truth(
    '5.3 reversed arg order gives -5 V',
    Math.abs(r.voltages[pin] + 5) < 1e-3,
    '-5 V (sign is arg-order dependent)',
    `${fmt(r.voltages[pin])} V`,
  )
}

{
  // Norton referenced to a non-ground node: pin should sit at Vref + I/G.
  const c = new Circuit()
  const ref = c.allocNet()
  const pin = c.allocNet()
  c.add(new VoltageSource('VREF', ref, GROUND, 2))
  c.add(new NortonPort('P', ref, pin, 1 / R_DRIVE, VCC / R_DRIVE))
  const r = c.solve()
  near('5.4 Norton floating on 2 V ref', r.voltages[pin], 7, 1e-3)
}

{
  // Two pins fighting through 1k: HIGH pin and LOW pin.
  // I = 5/(25+1000+25). vHigh = 5 - 25I, vLow = 25I.
  const c = new Circuit()
  const pa = c.allocNet()
  const pb = c.allocNet()
  c.add(new NortonPort('A', GROUND, pa, 1 / R_DRIVE, VCC / R_DRIVE))
  c.add(new NortonPort('B', GROUND, pb, 1 / R_DRIVE, 0))
  c.add(new Resistor('R', pa, pb, 1000))
  const r = c.solve()
  const I = 5 / 1050
  near('5.5 pin fight: HIGH side', r.voltages[pa], 5 - 25 * I, 1e-4)
  near('5.5 pin fight: LOW side', r.voltages[pb], 25 * I, 1e-4)
  kclCheck('5.5 pin fight KCL', [
    { k: 'N', a: GROUND, b: pa, g: 1 / R_DRIVE, i: VCC / R_DRIVE },
    { k: 'N', a: GROUND, b: pb, g: 1 / R_DRIVE, i: 0 },
    { k: 'R', a: pa, b: pb, ohms: 1000 },
  ], r.voltages, r.x)
}

{
  // Two pins driving HIGH and LOW shorted together by a 0 Ω wire → 2.5 V.
  const c = new Circuit()
  const pa = c.allocNet()
  const pb = c.allocNet()
  c.add(new NortonPort('A', GROUND, pa, 1 / R_DRIVE, VCC / R_DRIVE))
  c.add(new NortonPort('B', GROUND, pb, 1 / R_DRIVE, 0))
  c.add(new Resistor('W', pa, pb, 0))
  const r = c.solve()
  near('5.6 shorted HIGH/LOW pins = 2.5 V', r.voltages[pa], 2.5, 1e-4)
  near('5.6 short has no drop', r.voltages[pa] - r.voltages[pb], 0, 1e-9)
}

{
  // The real product topology: pin → 220 Ω → LED → GND, HIGH and LOW.
  const build = (mode: keyof typeof MODES) => {
    const c = new Circuit()
    const pin = c.allocNet()
    const an = c.allocNet()
    const internal = c.allocNet()
    const { g, i } = MODES[mode]
    c.add(new NortonPort('D13', GROUND, pin, g, i))
    c.add(new Resistor('R1', pin, an, 220))
    const { devices, diode } = createLED('LED1', an, GROUND, internal)
    c.add(...devices)
    const r = c.solve()
    return { r, pin, diode }
  }
  const hi = build('output_high')
  const lo = build('output_low')
  const exact = seriesDiodeCurrent(5, 25 + 220 + LED_SERIES_R, 1, LED_RED)
  near('5.7 D13 HIGH: LED current (exact)', hi.diode.current * 1000, exact * 1000, 2e-3, 'mA')
  truth(
    '5.7 D13 HIGH: pin above 4 V',
    hi.r.voltages[hi.pin] > 4,
    '> 4 V',
    `${fmt(hi.r.voltages[hi.pin])} V`,
  )
  truth(
    '5.7 D13 LOW: LED dark',
    Math.abs(lo.diode.current) < 1e-9,
    '|I| < 1 nA',
    `${fmt(lo.diode.current)} A`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. Degenerate inputs a student would actually create
// ══════════════════════════════════════════════════════════════════════════════

group('6 degenerate')

/** Every degenerate case must be ok:true-and-finite, or ok:false-with-error. */
function degenerate(name: string, c: Circuit, extra?: (r: ReturnType<Circuit['solve']>) => string) {
  let r: ReturnType<Circuit['solve']>
  try {
    r = c.solve()
  } catch (e) {
    record(name, false, 'no throw', `THREW ${String(e)}`)
    return null
  }
  const finite = allFinite(r.voltages) && allFinite(r.x)
  const pass = (r.ok && finite) || (!r.ok && typeof r.error === 'string' && r.error.length > 0)
  record(
    name,
    pass,
    'ok+finite, or ok:false+error',
    `ok:${r.ok}${r.error ? ` "${r.error}"` : ''}, finite:${finite}${extra ? ', ' + extra(r) : ''}`,
    pass ? undefined : 'returned success with non-finite values',
  )
  return r
}

{
  // Completely floating subnet alongside a working circuit.
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  const f1 = c.allocNet()
  const f2 = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, mid, 1000))
  c.add(new Resistor('R2', mid, GROUND, 1000))
  c.add(new Resistor('RF', f1, f2, 1000)) // no path to ground
  const r = degenerate('6.1 floating subnet', c)
  if (r) {
    near('6.1 grounded part unaffected', r.voltages[mid], 2.5, 1e-5)
    truth(
      '6.1 floating nets pinned at 0',
      Math.abs(r.voltages[f1]) < 1e-9 && Math.abs(r.voltages[f2]) < 1e-9,
      '~0 V',
      `${fmt(r.voltages[f1])}, ${fmt(r.voltages[f2])} V`,
    )
  }
}

{
  // Two ideal voltage sources in parallel, different values. Physically illegal.
  const c = new Circuit()
  const n = c.allocNet()
  c.add(new VoltageSource('V1', n, GROUND, 5))
  c.add(new VoltageSource('V2', n, GROUND, 3))
  const r = degenerate('6.2 parallel 5 V / 3 V sources', c, (rr) => `v=${fmt(rr.voltages[n])}`)
  if (r) {
    truth(
      '6.2 does not silently pick a value',
      !r.ok,
      'ok:false',
      `ok:${r.ok}, v=${fmt(r.voltages[n])} V`,
    )
  }
}

{
  // Two identical sources in parallel — legal physically, singular in MNA.
  const c = new Circuit()
  const n = c.allocNet()
  c.add(new VoltageSource('V1', n, GROUND, 5))
  c.add(new VoltageSource('V2', n, GROUND, 5))
  degenerate('6.3 parallel 5 V / 5 V sources', c, (rr) => `v=${fmt(rr.voltages[n])}`)
}

{
  // Zero-ohm resistor as a bare wire in a divider: 5 V ─0Ω─ a ─1k─ GND.
  const c = new Circuit()
  const vcc = c.allocNet()
  const a = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('W', vcc, a, 0))
  c.add(new Resistor('R', a, GROUND, 1000))
  const r = degenerate('6.4 zero-ohm wire', c)
  if (r) near('6.4 wire carries the full 5 V', r.voltages[a], 5, 1e-6)
}

{
  // Zero-ohm resistor shorting the measured node to ground.
  const c = new Circuit()
  const vcc = c.allocNet()
  const a = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R', vcc, a, 1000))
  c.add(new Resistor('W', a, GROUND, 0))
  const r = degenerate('6.5 zero-ohm to ground', c)
  if (r) near('6.5 shorted node reads 0 V', r.voltages[a], 0, 1e-6)
}

{
  // Dead short straight across the supply.
  const c = new Circuit()
  const vcc = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('SHORT', vcc, GROUND, 0))
  const r = degenerate('6.6 short across the source', c, (rr) => `I=${fmt(rr.x[rr.x.length - 1])} A`)
  if (r && r.ok) {
    near('6.6 shorted rail still reads 5 V', r.voltages[vcc], 5, 1e-6)
    truth(
      '6.6 reports a physically absurd current',
      Math.abs(r.x[r.x.length - 1]) > 1e9,
      'huge (no fault flag exists)',
      `${fmt(r.x[r.x.length - 1])} A`,
    )
  }
}

{
  // Both pins of each device type on the same net.
  const mk = (label: string, add: (c: Circuit, n: NetId) => void) => {
    const c = new Circuit()
    const vcc = c.allocNet()
    const a = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, 5))
    c.add(new Resistor('R1', vcc, a, 1000))
    c.add(new Resistor('R2', a, GROUND, 1000))
    add(c, a)
    const r = degenerate(`6.7 self-loop ${label}`, c, (rr) => `v=${fmt(rr.voltages[a])}`)
    if (r && r.ok) near(`6.7 self-loop ${label} is a no-op`, r.voltages[a], 2.5, 1e-5)
  }
  mk('resistor', (c, a) => c.add(new Resistor('SELF', a, a, 470)))
  mk('diode', (c, a) => c.add(new Diode('SELF', a, a, DIODE_1N4148)))
  mk('norton', (c, a) => c.add(new NortonPort('SELF', a, a, 1 / 25, 5 / 25)))
  // A voltage source across itself is contradictory unless V = 0.
  {
    const c = new Circuit()
    const a = c.allocNet()
    c.add(new VoltageSource('V1', a, GROUND, 5))
    c.add(new VoltageSource('SELF', a, a, 5))
    degenerate('6.7 self-loop vsource', c, (rr) => `v=${fmt(rr.voltages[a])}`)
  }
}

{
  // Completely empty circuit.
  const c = new Circuit()
  const r = degenerate('6.8 empty circuit', c, (rr) => `n=${rr.voltages.length}`)
  if (r) truth('6.8 empty gives 0 iterations sanely', r.iterations >= 0, '>= 0', String(r.iterations))
}

{
  // One net, one device, no return path.
  const c = new Circuit()
  const a = c.allocNet()
  c.add(new Resistor('R', a, GROUND, 1000))
  degenerate('6.9 single resistor, no source', c, (rr) => `v=${fmt(rr.voltages[a])}`)
}

{
  // Nets allocated but never referenced by a device.
  const c = new Circuit()
  const a = c.allocNet()
  c.allocNet()
  c.allocNet()
  c.add(new VoltageSource('V1', a, GROUND, 5))
  degenerate('6.10 unused allocated nets', c, (rr) => `len=${rr.voltages.length}`)
}

{
  // A net allocated AFTER a solve. `allocNet()` does not mark the layout dirty.
  const c = new Circuit()
  const a = c.allocNet()
  c.add(new VoltageSource('V1', a, GROUND, 5))
  c.add(new Resistor('R1', a, GROUND, 1000))
  const first = c.solve()
  const late = c.allocNet()
  const second = c.solve()
  truth(
    '6.11 allocNet() after solve()',
    second.ok && allFinite(second.voltages),
    'ok+finite (or ok:false)',
    `ok:${second.ok}, v[${late}]=${fmt(second.voltages[late])}, v[${a}]=${fmt(second.voltages[a])}`,
    second.ok && !allFinite(second.voltages)
      ? 'ok:true with NaN — allocNet does not set dirty'
      : undefined,
  )
  void first
}

{
  // Devices referencing a net id that was never allocated (what you get if you
  // hand Circuit the ids that netlist.ts minted instead of calling allocNet()).
  const c = new Circuit()
  c.allocNet() // net 1 only
  c.add(new VoltageSource('V1', 1, GROUND, 5))
  c.add(new Resistor('R1', 1, 2, 1000)) // net 2 never allocated
  c.add(new Resistor('R2', 2, GROUND, 1000))
  const r = c.solve()
  // Theory: this is a 1k/1k divider, net 2 must be 2.5 V.
  const reported = r.voltages.length > 2 ? r.voltages[2] : NaN
  truth(
    '6.12 unallocated net id',
    !r.ok || (Number.isFinite(reported) && Math.abs(reported - 2.5) < 1e-4),
    'ok:false, or net2 = 2.5 V',
    `ok:${r.ok}, voltages.len=${r.voltages.length}, net1=${fmt(r.voltages[1])}, net2=${fmt(reported)}`,
    r.ok ? 'silently dropped stamps; no validation that nets were allocated' : undefined,
  )
}

{
  // Negative resistance — Math.max(ohms, 1e-12) turns it into a dead short.
  const c = new Circuit()
  const vcc = c.allocNet()
  const a = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, a, 1000))
  c.add(new Resistor('RNEG', a, GROUND, -1000))
  const r = c.solve()
  truth(
    '6.13 negative resistance',
    !r.ok || Math.abs(r.voltages[a]) < 1e-6,
    'ok:false, or clamped short (0 V)',
    `ok:${r.ok}, v=${fmt(r.voltages[a])} V`,
  )
}

{
  // NaN / Infinity component values must never surface as ok:true.
  for (const [label, ohms] of [
    ['NaN', NaN],
    ['Infinity', Infinity],
  ] as const) {
    const c = new Circuit()
    const vcc = c.allocNet()
    const a = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, 5))
    c.add(new Resistor('R1', vcc, a, ohms))
    c.add(new Resistor('R2', a, GROUND, 1000))
    const r = c.solve()
    truth(
      `6.14 resistor = ${label}`,
      !r.ok || allFinite(r.voltages),
      'ok:false, or finite',
      `ok:${r.ok}${r.error ? ` "${r.error}"` : ''}, v=${fmt(r.voltages[a])}`,
    )
  }
  {
    const c = new Circuit()
    const vcc = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, NaN))
    c.add(new Resistor('R1', vcc, GROUND, 1000))
    const r = c.solve()
    truth(
      '6.14 source volts = NaN',
      !r.ok || allFinite(r.voltages),
      'ok:false, or finite',
      `ok:${r.ok}${r.error ? ` "${r.error}"` : ''}, v=${fmt(r.voltages[vcc])}`,
    )
  }
}

{
  // A dangling diode leg — anode driven, cathode connected to nothing.
  const c = new Circuit()
  const vcc = c.allocNet()
  const cat = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Diode('D1', vcc, cat, DIODE_1N4148))
  const r = degenerate('6.15 diode with a dangling cathode', c, (rr) => `vcat=${fmt(rr.voltages[cat])}`)
  if (r && r.ok) {
    truth(
      '6.15 dangling cathode is not held at 0 V',
      Math.abs(r.voltages[cat]) > 1,
      'floats up (gmin artefact)',
      `${fmt(r.voltages[cat])} V`,
    )
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. Convergence stress
// ══════════════════════════════════════════════════════════════════════════════

group('7 converge')

{
  // 10 diodes in series, 12 V through 1k.
  const c = new Circuit()
  const vcc = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 12))
  let prev = c.allocNet()
  c.add(new Resistor('R1', vcc, prev, 1000))
  const ds: Diode[] = []
  for (let i = 0; i < 10; i++) {
    const next = i === 9 ? GROUND : c.allocNet()
    const d = new Diode(`D${i}`, prev, next, DIODE_1N4148)
    ds.push(d)
    c.add(d)
    prev = next
  }
  const r = c.solve()
  const I = seriesDiodeCurrent(12, 1000, 10, DIODE_1N4148)
  truth('7.1 ten diodes in series converge', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
  near('7.1 ten diodes I (exact)', ds[0].current * 1000, I * 1000, 5e-3, 'mA')
  let spread = 0
  for (const d of ds) spread = Math.max(spread, Math.abs(d.current - ds[0].current))
  near('7.1 all ten carry the same current', spread, 0, 1e-8, 'A')
}

{
  // Twenty diodes in series with too little headroom to turn on.
  const c = new Circuit()
  const vcc = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  let prev = c.allocNet()
  c.add(new Resistor('R1', vcc, prev, 1000))
  const ds: Diode[] = []
  for (let i = 0; i < 20; i++) {
    const next = i === 19 ? GROUND : c.allocNet()
    const d = new Diode(`D${i}`, prev, next, DIODE_1N4148)
    ds.push(d)
    c.add(d)
    prev = next
  }
  const r = c.solve()
  const I = seriesDiodeCurrent(5, 1000, 20, DIODE_1N4148)
  truth('7.2 twenty diodes, 5 V (starved)', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
  if (r.ok) near('7.2 starved chain I (exact)', ds[0].current * 1e6, I * 1e6, 5, 'uA')
}

{
  // Ten LEDs in parallel off one pin — the classic "why is it dim" circuit.
  const c = new Circuit()
  const pin = c.allocNet()
  c.add(new NortonPort('D13', GROUND, pin, 1 / 25, 5 / 25))
  const leds: Diode[] = []
  for (let i = 0; i < 10; i++) {
    const an = c.allocNet()
    const internal = c.allocNet()
    c.add(new Resistor(`R${i}`, pin, an, 220))
    const { devices, diode } = createLED(`LED${i}`, an, GROUND, internal)
    c.add(...devices)
    leds.push(diode)
  }
  const r = c.solve()
  truth('7.3 ten parallel LEDs converge', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
  let spread = 0
  for (const d of leds) spread = Math.max(spread, Math.abs(d.current - leds[0].current))
  near('7.3 identical branches match', spread * 1000, 0, 1e-9, 'mA')
  // Theory: the ten identical branches collapse to one branch of (220+2)/10 Ω.
  const Itotal = seriesDiodeCurrent(5, 25 + (220 + LED_SERIES_R) / 10, 1, {
    is: LED_RED.is * 10,
    n: LED_RED.n,
  })
  near('7.3 total pin current (exact)', leds.reduce((s, d) => s + d.current, 0) * 1000,
    Itotal * 1000, 1e-2, 'mA')
}

{
  // Reverse-biased LED at 5 V, then a hard forward LED with no resistor at all.
  const c = new Circuit()
  const vcc = c.allocNet()
  const internal = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  const { devices, diode } = createLED('LED1', GROUND, vcc, internal)
  c.add(...devices)
  const r = c.solve()
  truth(
    '7.4 reversed LED across 5 V',
    r.ok && Math.abs(diode.current) < 1e-15,
    'ok, |I| < 1 fA',
    `ok:${r.ok}, I=${fmt(diode.current)} A`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. Idempotence, warm start, path independence
// ══════════════════════════════════════════════════════════════════════════════

group('8 state')

function ledRig() {
  const c = new Circuit()
  const pin = c.allocNet()
  const an = c.allocNet()
  const internal = c.allocNet()
  const port = new NortonPort('D13', GROUND, pin, 1 / 25, 0)
  c.add(port)
  c.add(new Resistor('R1', pin, an, 220))
  const { devices, diode } = createLED('LED1', an, GROUND, internal)
  c.add(...devices)
  return { c, port, pin, diode }
}

{
  const { c, port, pin } = ledRig()
  port.set(1 / 25, 5 / 25)
  const a = c.solve()
  const b = c.solve()
  const va = Array.from(a.voltages)
  const vb = Array.from(b.voltages)
  let same = va.length === vb.length
  for (let i = 0; i < va.length && same; i++) same = va[i] === vb[i]
  truth('8.1 solve() twice is bit-identical', same, 'identical', same ? 'identical' : `${fmt(va[pin])} vs ${fmt(vb[pin])}`)
  truth(
    '8.1 iteration count settles',
    b.iterations <= a.iterations,
    'warm <= cold',
    `${a.iterations} then ${b.iterations}`,
  )
}

{
  // Warm start vs cold resetState() must give the same answer.
  const warm = ledRig()
  warm.port.set(1 / 25, 5 / 25)
  warm.c.solve()
  warm.port.set(1 / 25, 0) // LOW
  warm.c.solve()
  warm.port.set(1 / 25, 5 / 25) // back to HIGH, warm from LOW
  const warmHigh = warm.c.solve()

  const cold = ledRig()
  cold.port.set(1 / 25, 5 / 25)
  cold.c.resetState()
  const coldHigh = cold.c.solve()

  near('8.2 warm-start HIGH == cold HIGH (pin)', warmHigh.voltages[warm.pin],
    coldHigh.voltages[cold.pin], 1e-9)
  near('8.2 warm-start HIGH == cold HIGH (I)', warm.diode.current * 1000,
    cold.diode.current * 1000, 1e-9, 'mA')
}

{
  // Path independence: HIGH→LOW→HIGH must land exactly where HIGH started.
  // If this drifts, the memoisation cache in §2.4 caches poisoned values.
  const { c, port, pin, diode } = ledRig()
  port.set(1 / 25, 5 / 25)
  const first = c.solve().voltages[pin]
  const firstI = diode.current
  for (let k = 0; k < 25; k++) {
    port.set(1 / 25, 0)
    c.solve()
    port.set(1 / 25, 5 / 25)
    c.solve()
  }
  const later = c.solve().voltages[pin]
  near('8.3 25 HIGH/LOW cycles: pin drift', later - first, 0, 1e-12)
  near('8.3 25 HIGH/LOW cycles: current drift', (diode.current - firstI) * 1000, 0, 1e-12, 'mA')
}

{
  // resetState() must not change the converged answer of a linear circuit either.
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, mid, 1000))
  c.add(new Resistor('R2', mid, GROUND, 3000))
  const a = c.solve().voltages[mid]
  c.resetState()
  const b = c.solve().voltages[mid]
  near('8.4 linear: reset changes nothing', b - a, 0, 0)
  near('8.4 linear value = 3.75 V', a, 3.75, 1e-5)
}

{
  // SolveResult.x aliases the live warm-start buffer, so an earlier result
  // mutates under the caller. voltages[] is a fresh copy; x[] is not.
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  const src = new VoltageSource('V1', vcc, GROUND, 5)
  c.add(src)
  c.add(new Resistor('R1', vcc, mid, 1000))
  c.add(new Resistor('R2', mid, GROUND, 1000))
  const first = c.solve()
  const snapshotV = first.voltages[mid]
  const snapshotX = first.x[mid - 1]
  src.volts = 10
  c.solve()
  truth(
    '8.5 old result.voltages not mutated',
    first.voltages[mid] === snapshotV,
    `${fmt(snapshotV)} V`,
    `${fmt(first.voltages[mid])} V`,
  )
  truth(
    '8.5 old result.x not mutated',
    first.x[mid - 1] === snapshotX,
    `${fmt(snapshotX)}`,
    `${fmt(first.x[mid - 1])}`,
    first.x[mid - 1] !== snapshotX ? 'SolveResult.x aliases Circuit.x' : undefined,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. Cross-check against an independent nodal solver (randomised)
// ══════════════════════════════════════════════════════════════════════════════

group('9 fuzz')

{
  // Deterministic LCG so failures are reproducible.
  let seed = 0x2f6e2b1
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }

  let worstErr = 0
  let worstCase = ''
  let failures = 0
  const TRIALS = 300

  for (let t = 0; t < TRIALS; t++) {
    const nodeCount = 3 + Math.floor(rnd() * 4) // 3..6 non-ground nodes
    const c = new Circuit()
    const nets: NetId[] = []
    for (let i = 0; i < nodeCount; i++) nets.push(c.allocNet())

    // Node 1 is a 5 V rail, node 2 is a 3 V rail. The rest are unknowns.
    const fixed = new Map<number, number>([
      [1, 5],
      [2, 3],
    ])
    c.add(new VoltageSource('VA', nets[0], GROUND, 5))
    c.add(new VoltageSource('VB', nets[1], GROUND, 3))

    const res: Array<[number, number, number]> = []
    const edgeCount = nodeCount + 2 + Math.floor(rnd() * 5)
    for (let e = 0; e < edgeCount; e++) {
      const a = Math.floor(rnd() * (nodeCount + 1)) // 0..nodeCount, 0 = ground
      let b = Math.floor(rnd() * (nodeCount + 1))
      if (a === b) b = (b + 1) % (nodeCount + 1)
      const ohms = 10 ** (1 + rnd() * 4) // 10 Ω .. 100 kΩ
      res.push([a, b, ohms])
      c.add(new Resistor(`R${e}`, a as NetId, b as NetId, ohms))
    }
    // Guarantee every unknown node has at least one tie so the reference is solvable.
    for (let k = 3; k <= nodeCount; k++) {
      res.push([k, 0, 100000])
      c.add(new Resistor(`Rt${k}`, k as NetId, GROUND, 100000))
    }

    const ref = referenceNodal(nodeCount, fixed, res)
    if (!ref) continue
    const r = c.solve()
    if (!r.ok) {
      failures++
      continue
    }
    for (let k = 1; k <= nodeCount; k++) {
      const err = Math.abs(r.voltages[k] - ref[k])
      if (err > worstErr) {
        worstErr = err
        worstCase = `trial ${t}, net ${k}: got ${fmt(r.voltages[k])}, ref ${fmt(ref[k])}`
      }
    }
  }
  truth(
    `9.1 ${TRIALS} random resistive nets vs independent nodal solver`,
    worstErr < 1e-6,
    'worst |err| < 1e-6 V',
    `${fmt(worstErr)} V${worstCase ? ` (${worstCase})` : ''}`,
  )
  truth('9.1 no unexpected solve failures', failures === 0, '0 failures', String(failures))
}

{
  // Same fuzz, with an extra 0 Ω wire thrown in — the numerically nasty case.
  let seed = 0x51ab33d
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  let worstErr = 0
  let worstCase = ''
  const TRIALS = 150
  for (let t = 0; t < TRIALS; t++) {
    const nodeCount = 4
    const c = new Circuit()
    for (let i = 0; i < nodeCount; i++) c.allocNet()
    const fixed = new Map<number, number>([[1, 5]])
    c.add(new VoltageSource('VA', 1, GROUND, 5))
    const res: Array<[number, number, number]> = []
    const push = (a: number, b: number, ohms: number) => {
      res.push([a, b, Math.max(ohms, 1e-12)])
      c.add(new Resistor(`R${res.length}`, a as NetId, b as NetId, ohms))
    }
    push(1, 2, 10 ** (1 + rnd() * 3))
    push(2, 3, rnd() < 0.35 ? 0 : 10 ** (1 + rnd() * 3))
    push(3, 4, 10 ** (1 + rnd() * 3))
    push(4, 0, 10 ** (1 + rnd() * 3))
    push(2, 0, 10 ** (1 + rnd() * 4))
    push(3, 0, 10 ** (1 + rnd() * 4))
    const ref = referenceNodal(nodeCount, fixed, res)
    if (!ref) continue
    const r = c.solve()
    if (!r.ok) continue
    for (let k = 1; k <= nodeCount; k++) {
      const err = Math.abs(r.voltages[k] - ref[k])
      if (err > worstErr) {
        worstErr = err
        worstCase = `trial ${t}, net ${k}: got ${fmt(r.voltages[k])}, ref ${fmt(ref[k])}`
      }
    }
  }
  truth(
    `9.2 ${TRIALS} nets containing 0 Ω wires`,
    worstErr < 1e-6,
    'worst |err| < 1e-6 V',
    `${fmt(worstErr)} V${worstCase ? ` (${worstCase})` : ''}`,
  )
}

{
  // Wide dynamic range: 1 mΩ next to 100 MΩ in the same divider.
  const cases: Array<[number, number]> = [
    [1e-3, 1e8],
    [1e8, 1e-3],
    [1e-6, 1e6],
    [1e9, 1e9],
    [1e-9, 1e-9],
  ]
  let worst = 0
  let detail = ''
  for (const [r1, r2] of cases) {
    const c = new Circuit()
    const vcc = c.allocNet()
    const mid = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, 5))
    c.add(new Resistor('R1', vcc, mid, r1))
    c.add(new Resistor('R2', mid, GROUND, r2))
    const r = c.solve()
    // Theory including the 1 nS gmin leak that the solver deliberately adds.
    const g1 = 1 / Math.max(r1, 1e-12)
    const g2 = 1 / Math.max(r2, 1e-12)
    const expect = (5 * g1) / (g1 + g2 + 1e-9)
    const err = Math.abs(r.voltages[mid] - expect)
    if (err > worst) {
      worst = err
      detail = `R1=${fmt(r1)} R2=${fmt(r2)}: got ${fmt(r.voltages[mid])}, want ${fmt(expect)}`
    }
  }
  truth('9.3 extreme resistance ratios', worst < 1e-6, 'worst |err| < 1e-6 V',
    `${fmt(worst)} V (${detail})`)
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. The §5 failure mode: ok:true with a provably wrong number
// ══════════════════════════════════════════════════════════════════════════════

group('10 silent')

{
  // gmin loading a genuinely high-impedance divider. An MCU analog input reading
  // a 10 MΩ/10 MΩ divider must read 2.5 V; the pin's own 100 MΩ makes it 2.381.
  // gmin (1 GΩ per node) must not move it further.
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, mid, 10e6))
  c.add(new Resistor('R2', mid, GROUND, 10e6))
  c.add(new NortonPort('A0', GROUND, mid, G_FLOAT, 0)) // pin in input mode
  const r = c.solve()
  const expect = (5 * 1e-7) / (1e-7 + 1e-7 + G_FLOAT) // theory, pin loading only
  near('10.1 10M/10M divider into an input pin', r.voltages[mid], expect, 5e-3)
  truth(
    '10.1 gmin error on a hi-Z node',
    Math.abs(r.voltages[mid] - expect) < 5e-3,
    `${fmt(expect)} V`,
    `${fmt(r.voltages[mid])} V, gmin skew ${fmt(r.voltages[mid] - expect)} V`,
  )
}

{
  // gmin vs the "input" pin model: G_FLOAT = 1e-8 is only 10x gmin = 1e-9.
  // A floating input pulled up through 10 MΩ should read close to 5 V*10/(10+100).
  const c = new Circuit()
  const vcc = c.allocNet()
  const pin = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, pin, 10e6))
  c.add(new NortonPort('D2', GROUND, pin, G_FLOAT, 0))
  const r = c.solve()
  const expect = (5 * 1e-7) / (1e-7 + G_FLOAT)
  const rel = Math.abs(r.voltages[pin] - expect) / expect
  truth(
    '10.2 10 MΩ pull-up into a hi-Z input',
    rel < 0.01,
    `${fmt(expect)} V (+-1%)`,
    `${fmt(r.voltages[pin])} V, ${(rel * 100).toFixed(2)}% off`,
    rel >= 0.01 ? 'gmin=1e-9 is only 10x below G_FLOAT=1e-8' : undefined,
  )
}

{
  // KCL audit over every nonlinear circuit built above, to catch a Newton run
  // that "converged" to a point that is not actually a solution.
  const c = new Circuit()
  const vcc = c.allocNet()
  const a = c.allocNet()
  const m = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, a, 470))
  const d1 = new Diode('D1', a, m, DIODE_1N4148)
  const d2 = new Diode('D2', m, GROUND, DIODE_1N4148)
  c.add(d1, d2)
  c.add(new Resistor('Rbleed', m, GROUND, 33000))
  const r = c.solve()
  kclCheck('10.3 asymmetric diode chain KCL', [
    { k: 'V', a: vcc, b: GROUND, branch: 3 },
    { k: 'R', a: vcc, b: a, ohms: 470 },
    { k: 'D', a, b: m, p: DIODE_1N4148 },
    { k: 'D', a: m, b: GROUND, p: DIODE_1N4148 },
    { k: 'R', a: m, b: GROUND, ohms: 33000 },
  ], r.voltages, r.x, 1e-4)
  truth('10.3 asymmetric chain solves', r.ok, 'ok:true', `ok:${r.ok}, ${r.iterations} iters`)
}

{
  // Sweep a diode circuit across 200 supply voltages and check every point
  // against the closed form. Looking for a band where Newton lands on a wrong
  // root but still reports success.
  let worstRel = 0
  let worstAt = 0
  let notOk = 0
  for (let k = 0; k <= 200; k++) {
    const V = 0.05 + k * 0.075 // 0.05 .. 15.05 V
    const c = new Circuit()
    const vcc = c.allocNet()
    const an = c.allocNet()
    c.add(new VoltageSource('V1', vcc, GROUND, V))
    c.add(new Resistor('R1', vcc, an, 1000))
    const d = new Diode('D1', an, GROUND, DIODE_1N4148)
    c.add(d)
    const r = c.solve()
    if (!r.ok) {
      notOk++
      continue
    }
    const exact = seriesDiodeCurrent(V, 1000, 1, DIODE_1N4148)
    const rel = Math.abs(d.current - exact) / Math.max(exact, 1e-12)
    if (rel > worstRel) {
      worstRel = rel
      worstAt = V
    }
  }
  truth('10.4 201-point diode sweep, all converge', notOk === 0, '0 failures', String(notOk))
  truth(
    '10.4 worst relative current error over sweep',
    worstRel < 1e-4,
    '< 0.01%',
    `${(worstRel * 100).toFixed(6)}% at V=${fmt(worstAt)} V`,
  )
}

{
  // Same sweep, but warm-started from the previous point (the product's actual
  // usage pattern for a knob drag). A warm start must not change the answer.
  const c = new Circuit()
  const vcc = c.allocNet()
  const an = c.allocNet()
  const src = new VoltageSource('V1', vcc, GROUND, 5)
  c.add(src)
  c.add(new Resistor('R1', vcc, an, 1000))
  const d = new Diode('D1', an, GROUND, DIODE_1N4148)
  c.add(d)
  let worstRel = 0
  let worstAt = 0
  let notOk = 0
  // Deliberately hostile ordering: big jumps up and down.
  const seq: number[] = []
  for (let k = 0; k <= 100; k++) seq.push(k % 2 === 0 ? 0.05 + k * 0.15 : 15.05 - k * 0.15)
  for (const V of seq) {
    src.volts = V
    const r = c.solve()
    if (!r.ok) {
      notOk++
      continue
    }
    const exact = seriesDiodeCurrent(V, 1000, 1, DIODE_1N4148)
    const rel = Math.abs(d.current - exact) / Math.max(exact, 1e-12)
    if (rel > worstRel) {
      worstRel = rel
      worstAt = V
    }
  }
  truth('10.5 warm-started hostile sweep converges', notOk === 0, '0 failures', String(notOk))
  truth(
    '10.5 warm-started worst relative error',
    worstRel < 1e-4,
    '< 0.01%',
    `${(worstRel * 100).toFixed(6)}% at V=${fmt(worstAt)} V`,
  )
}

{
  // Same, but with the Norton pin as the source and no resetState between
  // states — this is exactly what the memoisation layer in §2.4 does.
  const { c, port, diode } = ledRig()
  let worst = 0
  const cold = (i: number) => {
    const k = ledRig()
    k.port.set(1 / 25, i)
    k.c.resetState()
    k.c.solve()
    return k.diode.current
  }
  for (let k = 0; k < 40; k++) {
    const i = (k % 2 === 0 ? 5 : 0) / 25
    port.set(1 / 25, i)
    c.solve()
    const ref = cold(i)
    worst = Math.max(worst, Math.abs(diode.current - ref))
  }
  truth(
    '10.6 memoised pin toggling == cold solve',
    worst < 1e-12,
    'exact match',
    `worst diff ${fmt(worst)} A`,
  )
}

{
  // Convergence tolerance probe: does reltol=1e-3 on NODE VOLTAGES leave a
  // large current error when the node voltage is large but the diode is stiff?
  // 100 V rail, 1 kΩ, diode: a 1e-3 relative node tolerance is 100 mV here.
  const c = new Circuit()
  const vcc = c.allocNet()
  const an = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 100))
  c.add(new Resistor('R1', vcc, an, 1000))
  const d = new Diode('D1', an, GROUND, DIODE_1N4148)
  c.add(d)
  const r = c.solve()
  const exact = seriesDiodeCurrent(100, 1000, 1, DIODE_1N4148)
  const rel = Math.abs(d.current - exact) / exact
  truth(
    '10.7 100 V rail: reltol on a big node voltage',
    r.ok && rel < 1e-4,
    'rel err < 0.01%',
    `ok:${r.ok}, ${(rel * 100).toFixed(6)}% (${fmt(d.current * 1000)} vs ${fmt(exact * 1000)} mA)`,
  )
}

{
  // Does the solver ever report success while gmin stepping quietly changed the
  // effective gmin (and therefore the answer)?
  const c = new Circuit()
  const vcc = c.allocNet()
  const mid = c.allocNet()
  c.add(new VoltageSource('V1', vcc, GROUND, 5))
  c.add(new Resistor('R1', vcc, mid, 1000))
  c.add(new Resistor('R2', mid, GROUND, 1000))
  const r = c.solve()
  truth(
    '10.8 simple circuit needs no gmin stepping',
    !r.usedGminStepping,
    'usedGminStepping:false',
    `usedGminStepping:${r.usedGminStepping}`,
  )
}

// ─── Report ───────────────────────────────────────────────────────────────────

const nameW = Math.max(...rows.map((r) => r.name.length), 4)
const expW = Math.max(...rows.map((r) => r.expected.length), 8)
const actW = Math.min(Math.max(...rows.map((r) => r.actual.length), 6), 62)

console.log('\nADVERSARIAL SOLVER TEST SUITE — lib/simulator')
console.log('='.repeat(nameW + expW + actW + 14))
console.log(
  `${'TEST'.padEnd(nameW)}  ${'EXPECTED'.padEnd(expW)}  ${'ACTUAL'.padEnd(actW)}  RESULT`,
)
console.log('-'.repeat(nameW + expW + actW + 14))

let lastGroup = ''
let failed = 0
for (const r of rows) {
  if (r.group !== lastGroup) {
    console.log(`\n[${r.group}]`)
    lastGroup = r.group
  }
  if (!r.pass) failed++
  const act = r.actual.length > actW ? r.actual.slice(0, actW - 1) + '…' : r.actual
  console.log(
    `${r.name.padEnd(nameW)}  ${r.expected.padEnd(expW)}  ${act.padEnd(actW)}  ${r.pass ? 'PASS' : 'FAIL'}`,
  )
  if (!r.pass && r.note) console.log(`${' '.repeat(nameW)}  -> ${r.note}`)
}

console.log('\n' + '='.repeat(nameW + expW + actW + 14))
console.log(`${rows.length - failed}/${rows.length} passed, ${failed} failed`)

if (failed > 0) {
  console.log('\nFAILURES')
  console.log('-'.repeat(72))
  for (const r of rows) {
    if (r.pass) continue
    console.log(`  [${r.group}] ${r.name}`)
    console.log(`      expected: ${r.expected}`)
    console.log(`      actual  : ${r.actual}`)
    if (r.note) console.log(`      note    : ${r.note}`)
  }
}

process.exit(failed > 0 ? 1 : 0)
