/**
 * Adversarial test suite for TRANSIENT (time-domain) circuit analysis.
 *
 * Everything here is asserted against CLOSED-FORM circuit theory derived BY HAND
 * in the comments — never against the engine's own output. The one subtlety a
 * transient solver adds over the DC one is that backward Euler is an APPROXIMATION
 * at finite h, so where it matters each value is checked two ways:
 *
 *   1. against the EXACT discrete backward-Euler recurrence (an independent
 *      closed form: the BE update is a linear map whose fixed point and geometric
 *      decay rate are solvable on paper), and
 *   2. against the CONTINUOUS analytic solution to ~0.1 %, which the discrete
 *      form must approach as h shrinks.
 *
 * If the load-bearing capacitor sign (TRANSIENT_DESIGN.md §1.1) were flipped, the
 * RC-charge test (§3.1) would rise the wrong way or diverge. It does neither.
 *
 * Run: npx tsx lib/simulator/__tests__/transient.test.ts
 */

import { Circuit } from '../solver'
import { Capacitor, Inductor, Resistor, VoltageSource } from '../devices'
import { GROUND } from '../types'
import { compile } from '../model/compile'
import type { CircuitDoc } from '../model/document'

// ─── Harness (same table style as the other suites) ───────────────────────────

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
function record(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass, note })
}
function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}
/** Absolute tolerance. NaN/Infinity always fails. */
function near(name: string, actual: number, expected: number, tol: number, unit = 'V'): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  record(
    name,
    pass,
    `${expected.toPrecision(6)} ${unit} ±${tol.toExponential(1)}`,
    `${Number.isFinite(actual) ? actual.toPrecision(6) : String(actual)} ${unit}`,
    pass ? undefined : `err ${Math.abs(actual - expected).toExponential(2)} > tol ${tol.toExponential(2)}`,
  )
}

// ══════════════════════════════════════════════════════════════════════════════
group('3.1 RC charging — the anchor test, pins the capacitor sign')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * 5 V — R=1 kΩ — C=1 µF — GND.  τ = RC = 1e-3 s.  Step h = τ/1000 = 1e-6 s.
   *
   * Continuous:  v_C(t) = 5·(1 − e^(−t/τ)).
   *
   * EXACT discrete backward-Euler form. One free node N (cap top). With the cap
   * companion Geq = C/h and source Ieq = Geq·v_prev injected INTO N, KCL at N is
   *   (V_N − 5)/R + Geq·V_N − Geq·v_prev = 0
   *   ⇒ V_N = (5/R + Geq·v_prev)/(1/R + Geq)
   *         = 5/(1+R·Geq) + (R·Geq/(1+R·Geq))·v_prev.
   * With R·Geq = R·C/h = τ/h, write r = 1/(1 + h/τ). Then
   *   v(k) = 5·(1 − r^k),   r = 1/(1 + h/τ).
   * This is the independent oracle; it is NOT read from the engine.
   */
  const R = 1000
  const C = 1e-6
  const tau = R * C // 1e-3
  const h = tau / 1000 // 1e-6
  const r = 1 / (1 + h / tau) // = 1000/1001
  const vDiscrete = (k: number): number => 5 * (1 - Math.pow(r, k))

  const ckt = new Circuit()
  const nS = ckt.allocNet()
  const nN = ckt.allocNet()
  ckt.add(new VoltageSource('V', nS, GROUND, 5))
  ckt.add(new Resistor('R', nS, nN, R))
  const cap = new Capacitor('C', nN, GROUND, C)
  ckt.add(cap)

  truth('adding a capacitor sets circuit.hasReactive', ckt.hasReactive, 'true', String(ckt.hasReactive))

  ckt.beginTransient()

  let vAt1 = 0 // reported i_C at the first step, to check t=0+ current
  let iAt1 = 0
  let prev = 0
  let monotone = true
  let overshoot = false
  let vTau = 0
  const totalSteps = 5000 // 5·τ, enough to asymptote
  for (let k = 1; k <= totalSteps; k++) {
    const res = ckt.transientStep(h)
    if (!res.ok) {
      truth(`step ${k} solved`, false, 'ok:true', res.error ?? 'ok:false')
      break
    }
    const v = res.voltages[nN]
    if (k === 1) {
      vAt1 = v
      iAt1 = cap.current
    }
    if (v < prev - 1e-9) monotone = false
    if (v > 5 + 1e-9) overshoot = true
    if (k === 1000) vTau = v // t = τ
    prev = v
  }

  // At t = τ (k=1000): exact discrete form and continuous form.
  near('v_C(τ) matches the exact backward-Euler recurrence', vTau, vDiscrete(1000), 1e-5)
  // Continuous 5·(1−e^−1) = 3.16060 V. BE undershoots slightly at finite h; the
  // gap is 5·(e^−1 − r^1000) ≈ 9.2e-4 V, i.e. 0.03 % — inside 0.1 %.
  near('v_C(τ) is within 0.1 % of the continuous 3.16060 V', vTau, 5 * (1 - Math.exp(-1)), 3e-3)

  // First step: v goes 0 → 5/1001, so i_C = Geq·Δv = (C/h)·(5/1001) = 4.995 mA,
  // and it equals the resistor current (5 − 5/1001)/R = 4.995 mA. ≈ 5 mA = 5V/1kΩ.
  near('reported i_C at t=0+ ≈ 5 mA (= 5 V / 1 kΩ)', iAt1 * 1000, (5 / R) * 1000, 0.02, 'mA')
  truth('first-step node voltage is the expected 5/1001 V', Math.abs(vAt1 - 5 / 1001) < 1e-9,
    `${(5 / 1001).toPrecision(6)} V`, vAt1.toPrecision(6))

  truth('v_C rises monotonically (correct sign — never charges the wrong way)', monotone,
    'monotone up', monotone ? 'monotone up' : 'NON-MONOTONE')
  truth('v_C never overshoots 5 V (backward Euler cannot ring on RC)', !overshoot,
    'no overshoot', overshoot ? 'OVERSHOOT' : 'no overshoot')
  // After 5·τ the cap is 99.3 % charged: 5·(1−e^−5) = 4.9663 V.
  near('v_C asymptotes toward 5 V (99.3 % at 5·τ)', prev, 5 * (1 - Math.exp(-5)), 5e-3)
  // Late current has decayed to ~0.
  near('reported i_C has decayed to ~0 by 5·τ', cap.current * 1000, 0, 0.05, 'mA')
}

// ══════════════════════════════════════════════════════════════════════════════
group('3.2 RC discharging')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * C=1 µF pre-charged to 5 V, R=1 kΩ across it, no source. τ = RC = 1e-3 s.
   * Continuous:  v_C(t) = 5·e^(−t/τ).
   *
   * Discrete: only node N. KCL  V_N/R + Geq·V_N − Geq·v_prev = 0
   *   ⇒ V_N = v_prev·(R·Geq/(1+R·Geq)) = v_prev·r,  r = 1/(1+h/τ).
   * So v(k) = 5·r^k. Independent oracle.
   */
  const R = 1000
  const C = 1e-6
  const tau = R * C
  const h = tau / 1000
  const r = 1 / (1 + h / tau)
  const vDiscrete = (k: number): number => 5 * Math.pow(r, k)

  const ckt = new Circuit()
  const nN = ckt.allocNet()
  ckt.add(new Resistor('R', nN, GROUND, R))
  ckt.add(new Capacitor('C', nN, GROUND, C, 5)) // v0 = 5 V

  ckt.beginTransient()
  let prev = 5
  let monotone = true
  let vTau = 0
  for (let k = 1; k <= 5000; k++) {
    const res = ckt.transientStep(h)
    const v = res.voltages[nN]
    if (v > prev + 1e-9) monotone = false
    if (k === 1000) vTau = v
    prev = v
  }
  // At t=τ: discrete 5·r^1000, continuous 5·e^−1 = 1.83940 V.
  near('v_C(τ) matches the exact backward-Euler recurrence', vTau, vDiscrete(1000), 1e-5)
  near('v_C(τ) is within 0.1 % of the continuous 1.83940 V', vTau, 5 * Math.exp(-1), 3e-3)
  truth('v_C decays monotonically to 0', monotone, 'monotone down',
    monotone ? 'monotone down' : 'NON-MONOTONE')
  // After 5·τ: 5·e^−5 = 0.0337 V.
  near('v_C decays toward 0 (0.034 V at 5·τ)', prev, 5 * Math.exp(-5), 5e-3)
}

// ══════════════════════════════════════════════════════════════════════════════
group('3.3 RL rise — pins the inductor sign')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * 5 V — R=100 Ω — L=10 mH — GND.  τ = L/R = 1e-4 s.  h = τ/1000 = 1e-7 s.
   * Continuous:  i_L(t) = (5/R)·(1 − e^(−t/τ)) = 0.05·(1 − e^(−t/τ)).
   *
   * Discrete: node N between R and L, L companion Geq = h/L, Ieq = i_prev a→b.
   * Inductor branch current i_L = Geq·V_N + i_prev. KCL at N:
   *   (V_N − 5)/R + Geq·V_N + i_prev = 0  ⇒  V_N = (5/R − i_prev)/(1/R + Geq).
   *   i_L(k) = i_prev + Geq·V_N
   *          = i_prev·(1 − Geq/(1/R+Geq)) + (Geq/(1/R+Geq))·(5/R)
   * With B = 1 − Geq/(1/R+Geq) = 1/(1 + R·Geq) = 1/(1 + h/τ) (since R·Geq = R·h/L = h/τ),
   *   i_L(k) = 0.05·(1 − B^k),  B = 1/(1 + h/τ).  Independent oracle.
   */
  const R = 100
  const L = 10e-3
  const tau = L / R // 1e-4
  const h = tau / 1000 // 1e-7
  const B = 1 / (1 + h / tau)
  const iDiscrete = (k: number): number => 0.05 * (1 - Math.pow(B, k))

  const ckt = new Circuit()
  const nS = ckt.allocNet()
  const nN = ckt.allocNet()
  ckt.add(new VoltageSource('V', nS, GROUND, 5))
  ckt.add(new Resistor('R', nS, nN, R))
  const ind = new Inductor('L', nN, GROUND, L)
  ckt.add(ind)

  ckt.beginTransient()
  let prev = 0
  let monotone = true
  let iTau = 0
  for (let k = 1; k <= 5000; k++) {
    const res = ckt.transientStep(h)
    if (!res.ok) {
      truth(`RL step ${k} solved`, false, 'ok:true', res.error ?? 'ok:false')
      break
    }
    const i = ind.current
    if (i < prev - 1e-12) monotone = false
    if (k === 1000) iTau = i
    prev = i
  }
  // At t=τ: discrete 0.05·(1−B^1000), continuous 0.05·0.63212 = 31.606 mA.
  near('i_L(τ) matches the exact backward-Euler recurrence', iTau * 1000, iDiscrete(1000) * 1000, 1e-2, 'mA')
  near('i_L(τ) is within 0.1 % of the continuous 31.606 mA (63.2 %)',
    iTau * 1000, 0.05 * (1 - Math.exp(-1)) * 1000, 0.03, 'mA')
  truth('i_L rises monotonically (correct sign — no back-EMF divergence)', monotone,
    'monotone up', monotone ? 'monotone up' : 'NON-MONOTONE')
  // After 5·τ: 50·(1−e^−5) = 49.66 mA, asymptoting to 50 mA = 5V/100Ω.
  near('i_L asymptotes toward 50 mA (99.3 % at 5·τ)', prev * 1000, 0.05 * (1 - Math.exp(-5)) * 1000, 0.5, 'mA')
}

// ══════════════════════════════════════════════════════════════════════════════
group('3.4 RLC — the three damping regimes')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Source-free series R–L–C ringdown. Loop: GND — R — A — L — B — C — GND, with
   * the cap pre-charged to V0 = 5 V and i_L(0) = 0. Measure v_C = V(B).
   *
   * L = 1 mH, C = 1 µF:
   *   ω0 = 1/√(LC) = 1/√(1e-9) = 31623 rad/s
   *   R_crit = 2·√(L/C) = 2·√1000 = 63.246 Ω          (ζ = R/R_crit)
   *   α = R/(2L)  (neper frequency)
   *
   * Underdamped (ζ<1) rings: v_C(t) = e^(−αt)[V0·cos(ωd t) + …·sin(ωd t)], crossing
   * zero every half period, ωd = ω0·√(1−ζ²), Td = 2π/ωd. Over/critically damped
   * (ζ≥1) never cross zero — v_C decays monotonically to 0.
   */
  const L = 1e-3
  const C = 1e-6
  const w0 = 1 / Math.sqrt(L * C) // 31623 rad/s
  const Rcrit = 2 * Math.sqrt(L / C) // 63.246 Ω

  function ringdown(R: number, h: number, steps: number): number[] {
    const ckt = new Circuit()
    const nA = ckt.allocNet()
    const nB = ckt.allocNet()
    ckt.add(new Resistor('R', GROUND, nA, R))
    ckt.add(new Inductor('L', nA, nB, L))
    ckt.add(new Capacitor('C', nB, GROUND, C, 5)) // v0 = 5 V
    ckt.beginTransient()
    const vC: number[] = []
    for (let k = 0; k < steps; k++) {
      const res = ckt.transientStep(h)
      vC.push(res.voltages[nB])
      if (!Number.isFinite(res.voltages[nB])) break
    }
    return vC
  }

  // ── Underdamped R = 10 Ω ──
  // ζ = 10/63.246 = 0.15811.  ωd = 31623·√(1−0.025) = 31623·0.98742 = 31225 rad/s.
  // Td = 2π/31225 = 2.0122e-4 s = 201.22 µs.
  {
    const R = 10
    const zeta = R / Rcrit
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    const Td = (2 * Math.PI) / wd // ~201.22 µs
    const h = 1e-7 // Td/h ≈ 2012, BE frequency error negligible
    const steps = 6000 // ~3 periods
    const vC = ringdown(R, h, steps)

    // Zero-crossing times of v_C (rings around 0). Half-period apart.
    const crossings: number[] = []
    for (let k = 1; k < vC.length; k++) {
      if ((vC[k - 1] <= 0 && vC[k] > 0) || (vC[k - 1] >= 0 && vC[k] < 0)) crossings.push(k * h)
    }
    truth('underdamped: v_C crosses zero (it rings)', crossings.length >= 4,
      '≥4 zero-crossings', String(crossings.length))
    // Successive crossings are Td/2 apart → measured period = 2·mean spacing.
    let measuredTd = 0
    if (crossings.length >= 3) {
      let sum = 0
      for (let i = 1; i < crossings.length; i++) sum += crossings[i] - crossings[i - 1]
      measuredTd = 2 * (sum / (crossings.length - 1))
    }
    near('underdamped: observed period matches 2π/ωd within a few %',
      measuredTd * 1e6, Td * 1e6, Td * 1e6 * 0.03, 'µs')
    // Envelope decays: a later ring peak is smaller than an earlier one.
    const peak = (from: number, to: number): number => {
      let m = 0
      for (let k = from; k < to && k < vC.length; k++) m = Math.max(m, Math.abs(vC[k]))
      return m
    }
    const early = peak(0, 2000)
    const late = peak(4000, 6000)
    truth('underdamped: the ring envelope decays (later peak < earlier peak)', late < early,
      `${late.toFixed(3)} < ${early.toFixed(3)}`, `${late.toFixed(3)} vs ${early.toFixed(3)}`)
  }

  // ── Overdamped R = 200 Ω ──
  // ζ = 200/63.246 = 3.1623 > 1: two real poles, v_C decays monotonically, no cross.
  {
    const R = 200
    const h = 1e-7
    const vC = ringdown(R, h, 6000)
    let monotone = true
    let crossed = false
    for (let k = 1; k < vC.length; k++) {
      if (vC[k] > vC[k - 1] + 1e-9) monotone = false
      if (vC[k] < -1e-6) crossed = true
    }
    truth('overdamped: v_C decays monotonically (no oscillation)', monotone,
      'monotone down', monotone ? 'monotone down' : 'NON-MONOTONE')
    truth('overdamped: v_C never crosses zero (no ringing)', !crossed,
      'no zero-crossing', crossed ? 'CROSSED' : 'no zero-crossing')
  }

  // ── Critically damped R ≈ 63.246 Ω ──
  // ζ = 1: fastest non-oscillating decay. No overshoot, no derivative sign change
  // beyond the first — v_C is monotone and reaches 1 % of V0 faster than overdamped.
  {
    const h = 1e-7
    const steps = 6000
    const crit = ringdown(Rcrit, h, steps)
    const over = ringdown(200, h, steps)
    let monotone = true
    let crossed = false
    for (let k = 1; k < crit.length; k++) {
      if (crit[k] > crit[k - 1] + 1e-9) monotone = false
      if (crit[k] < -1e-6) crossed = true
    }
    truth('critically damped: v_C is monotone (no derivative sign change past first)', monotone,
      'monotone down', monotone ? 'monotone down' : 'NON-MONOTONE')
    truth('critically damped: no zero-crossing', !crossed, 'no zero-crossing',
      crossed ? 'CROSSED' : 'no zero-crossing')
    const settle = (v: number[]): number => {
      for (let k = 0; k < v.length; k++) if (Math.abs(v[k]) < 0.05) return k // 1 % of 5 V
      return v.length
    }
    truth('critically damped settles faster than overdamped', settle(crit) < settle(over),
      `${settle(crit)} < ${settle(over)} steps`, `${settle(crit)} vs ${settle(over)}`)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('3.5 Stability / long-run — 50 000 steps')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Underdamped source-free RLC (R=10, L=1 mH, C=1 µF), 50 000 steps of h=1e-7.
   * Backward Euler is L-stable, so a passive circuit MUST NOT grow:
   *   - nothing NaN/Inf,
   *   - total stored energy E = ½·C·v_C² + ½·L·i_L² is non-increasing (R only
   *     ever dissipates; BE adds numerical damping on top, never energy),
   *   - it settles to the DC point v_C→0, i_L→0.
   */
  const L = 1e-3
  const C = 1e-6
  const R = 10
  const h = 1e-7

  const ckt = new Circuit()
  const nA = ckt.allocNet()
  const nB = ckt.allocNet()
  ckt.add(new Resistor('R', GROUND, nA, R))
  const ind = new Inductor('L', nA, nB, L)
  const cap = new Capacitor('C', nB, GROUND, C, 5)
  ckt.add(ind)
  ckt.add(cap)
  ckt.beginTransient()

  let anyBad = false
  let energyMonotone = true
  let prevE = 0.5 * C * 5 * 5 // initial: cap at 5 V, i_L = 0
  const E0 = prevE
  let vFinal = 0
  let iFinal = 0
  for (let k = 1; k <= 50_000; k++) {
    const res = ckt.transientStep(h)
    const vC = res.voltages[nB]
    const iL = ind.current
    if (!Number.isFinite(vC) || !Number.isFinite(iL)) {
      anyBad = true
      break
    }
    const E = 0.5 * C * vC * vC + 0.5 * L * iL * iL
    // Allow a tiny relative slack for float noise; the trend must be downward.
    if (E > prevE + 1e-12 + 1e-9 * E0) energyMonotone = false
    prevE = E
    vFinal = vC
    iFinal = iL
  }
  truth('50 000 steps produced no NaN/Inf', !anyBad, 'all finite', anyBad ? 'NON-FINITE' : 'all finite')
  truth('stored energy is non-increasing (passive, L-stable)', energyMonotone,
    'E monotone down', energyMonotone ? 'E monotone down' : 'ENERGY GREW')
  near('settles to the DC point: v_C → 0', vFinal, 0, 1e-3)
  near('settles to the DC point: i_L → 0', iFinal * 1000, 0, 1e-3, 'mA')
}

// ══════════════════════════════════════════════════════════════════════════════
group('4. compile() integration — a CircuitDoc capacitor charges')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Proves the compile.ts wiring: a document with a capacitor produces a Circuit
   * whose hasReactive is set and whose transientStep charges the cap. Uno 5V —
   * R=1 kΩ — C=1 µF — GND. The Uno's floating digital pins add only 1e-8 S, so
   * the RC is essentially the ideal one: v_C → ~5 V, τ ≈ RC = 1e-3 s.
   *
   * The DC limitation banner MUST remain (the interactive engine still runs a DC
   * solve; only this explicit transientStep loop evolves it in time).
   */
  const place = (id: string, type: string, props: Record<string, number | string> = {}) => ({
    id, type, x: 0, y: 0, rotation: 0 as const, props,
  })
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: 1000 }),
      place('c', 'capacitor', { microfarads: 1 })],
    wires: [
      { id: 'w1', from: { partId: 'uno', pinId: '5V' }, to: { partId: 'r', pinId: '1' }, color: '#000' },
      { id: 'w2', from: { partId: 'r', pinId: '2' }, to: { partId: 'c', pinId: '1' }, color: '#000' },
      { id: 'w3', from: { partId: 'c', pinId: '2' }, to: { partId: 'uno', pinId: 'GND.1' }, color: '#000' },
    ],
  }
  const compiled = compile(doc)
  truth('compiled circuit reports hasReactive', compiled.circuit.hasReactive, 'true',
    String(compiled.circuit.hasReactive))
  truth('the honest DC limitation banner is still present', compiled.limitations.length === 1,
    '1 limitation', JSON.stringify(compiled.limitations))

  const capNet = compiled.netOf.get('c 1')!
  compiled.circuit.beginTransient()
  const h = 1e-6
  let prev = 0
  let monotone = true
  let vTau = 0
  for (let k = 1; k <= 5000; k++) {
    const res = compiled.circuit.transientStep(h)
    if (!res.ok) {
      truth(`doc step ${k} solved`, false, 'ok:true', res.error ?? 'ok:false')
      break
    }
    const v = res.voltages[capNet]
    if (v < prev - 1e-9) monotone = false
    if (k === 1000) vTau = v
    prev = v
  }
  truth('the doc capacitor charges monotonically', monotone, 'monotone up',
    monotone ? 'monotone up' : 'NON-MONOTONE')
  // ~63 % at τ; the 1e-8 S pin leakage shifts the final level by < 1 mV, so the
  // continuous 3.16 V still holds to a few mV.
  near('doc v_C(τ) ≈ 63 % of 5 V', vTau, 5 * (1 - Math.exp(-1)), 1e-2)
  near('doc v_C asymptotes toward ~5 V', prev, 5 * (1 - Math.exp(-5)), 1e-2)
}

// ─── Report ───────────────────────────────────────────────────────────────────

const nameW = Math.max(50, ...rows.map((r) => r.name.length))
const expW = Math.max(24, ...rows.map((r) => r.expected.length))
const actW = Math.max(24, ...rows.map((r) => r.actual.length))

let lastGroup = ''
for (const r of rows) {
  if (r.group !== lastGroup) {
    lastGroup = r.group
    console.log('\n' + r.group)
    console.log('-'.repeat(nameW + expW + actW + 14))
  }
  console.log(
    `${r.name.padEnd(nameW)}  ${r.expected.padEnd(expW)}  ${r.actual.padEnd(actW)}  ` +
      (r.pass ? 'PASS' : '*** FAIL ***'),
  )
  if (!r.pass && r.note) console.log(`${' '.repeat(nameW)}  -> ${r.note}`)
}

const failures = rows.filter((r) => !r.pass)
console.log('\n' + '='.repeat(nameW + expW + actW + 14))
console.log(`${rows.length - failures.length}/${rows.length} passed`)
if (failures.length) {
  console.log('\nFAILURES')
  for (const f of failures) {
    console.log(`  [${f.group}] ${f.name}`)
    console.log(`      expected: ${f.expected}`)
    console.log(`      actual  : ${f.actual}`)
    if (f.note) console.log(`      note    : ${f.note}`)
  }
}
process.exit(failures.length > 0 ? 1 : 0)
