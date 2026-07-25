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

import fs from 'node:fs'
import path from 'node:path'
import { Circuit } from '../solver'
import {
  Capacitor,
  DCMotor,
  Diode,
  DIODE_1N4148,
  DIODE_L298N_FREEWHEEL,
  HOBBY_MOTOR_6V,
  Inductor,
  RELAY_MODULE_4CH,
  Resistor,
  STEPPER_28BYJ48,
  VoltageSource,
  Winding,
  createL298N,
  type MotorParams,
} from '../devices'
import { GROUND } from '../types'
import { compile } from '../model/compile'
import { SimulationEngine, parseIntelHex } from '../engine'
import { PicoSimulationEngine, PICO_VDD, PICO_ADC_MAX } from '../pico/engine'
import { loadPicoFirmware } from '../pico/firmware'
import type { CircuitDoc, DocWire } from '../model/document'

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
/** Relative tolerance, for values whose scale spans orders of magnitude. */
function nearRel(name: string, actual: number, expected: number, rel: number, unit = ''): void {
  const scale = Math.max(Math.abs(actual), Math.abs(expected))
  const r = scale === 0 ? 0 : Math.abs(actual - expected) / scale
  const pass = Number.isFinite(actual) && r <= rel
  record(
    name,
    pass,
    `${expected.toExponential(4)} ${unit} (rel ≤ ${rel.toExponential(1)})`,
    `${Number.isFinite(actual) ? actual.toExponential(4) : String(actual)} ${unit}`,
    pass ? undefined : `relative error ${r.toExponential(2)} exceeds ${rel.toExponential(1)}`,
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
   * The limitation banner MUST BE GONE. It used to say charging and timing were
   * not simulated, which was true while nothing drove a transient loop. Groups 5
   * onward drive one through the real engine, so the warning would now be a lie —
   * and a stale warning is the kind of dishonesty that survives for years because
   * nothing tests for its absence.
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
  truth('the "not simulated" banner is gone, because it stopped being true',
    compiled.limitations.length === 0, '[]', JSON.stringify(compiled.limitations))

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

// ══════════════════════════════════════════════════════════════════════════════
// ENGINE-LEVEL GROUPS
//
// Everything above drives Circuit.transientStep() by hand. That proves the
// numerics and proves nothing at all about the product: the reason this work
// existed is that those numerics were correct and UNREACHABLE, because
// engine.ts only ever called circuit.solve(). Groups 5–9 therefore assert
// through the REAL engine — real compiled firmware, the real run loop, the real
// snapshot — and read the capacitor the way a student does, off the ADC panel.
//
// Reading through the ADC is deliberate rather than convenient. It is the only
// public path to a node voltage, so it cannot drift from what the editor shows,
// and it costs 4.888 mV of quantisation (5 V / 1023) which every tolerance
// below accounts for explicitly.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The AVR pin model from engine.ts, restated on purpose.
 *
 * engine.ts owns these as module-private constants, so a test that imported
 * them could not detect a change to them — the same argument compile.test.ts
 * makes for the same three numbers. Restating them means these groups assert
 * that a driven pin behaves like a 5 V source behind 25 Ω, which is the
 * electrical claim, not merely that it behaves like whatever engine.ts says.
 */
const R_DRIVE = 25
const G_FLOAT = 1e-8
const GMIN = 1e-12
const VCC = 5
/** engine.ts STEPS_PER_TAU / MIN_STEP_SECONDS / MAX_STEP_SECONDS, likewise. */
const STEPS_PER_TAU = 50
const MIN_STEP = 20e-6
const MAX_STEP = 5e-3
const ADC_MAX = 1023

/** The timestep engine.ts will pick for a given τ. */
const stepFor = (tau: number): number =>
  Math.min(Math.max(tau / STEPS_PER_TAU, MIN_STEP), MAX_STEP)

/**
 * Exact backward-Euler charge after `t` seconds of steps of size `h`, toward
 * `vFinal` with time constant `tau`, starting from `v0`.
 *
 *   v(k) = vFinal + (v0 − vFinal)·ρ^k,   ρ = 1/(1 + h/τ)
 *
 * derived in group 3.1 and reused here. This is the INDEPENDENT oracle: it is
 * solved on paper, not read from the engine.
 */
function beCharge(t: number, h: number, tau: number, vFinal: number, v0 = 0): number {
  const rho = 1 / (1 + h / tau)
  return vFinal + (v0 - vFinal) * Math.pow(rho, t / h)
}

/** What analogRead() reports for a node at `v` volts on a 5 V reference. */
const counts = (v: number): number => Math.max(0, Math.min(ADC_MAX, Math.round((v / VCC) * ADC_MAX)))

const placeP = (id: string, type: string, props: Record<string, number | string> = {}) => ({
  id, type, x: 0, y: 0, rotation: 0 as const, props,
})
let ewSeq = 0
const w = (from: [string, string], to: [string, string]): DocWire => ({
  id: `ew${++ewSeq}`,
  from: { partId: from[0], pinId: from[1] },
  to: { partId: to[0], pinId: to[1] },
  color: '#111827',
})

function firmware(name: string): Uint16Array {
  const p = path.join(process.cwd(), 'public', 'sim', name)
  if (!fs.existsSync(p)) throw new Error(`Missing firmware fixture ${p}; run from the repo root.`)
  return parseIntelHex(fs.readFileSync(p, 'utf8'))
}

// ══════════════════════════════════════════════════════════════════════════════
group('5. THE ANCHOR — a capacitor charges through the real engine loop')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Uno 5V — R=1 kΩ — C=1 µF — GND, with A0 on the capacitor node.
   *
   * τ: the capacitor looks back through the 1 kΩ at the 5 V rail, which is an
   * ideal source and therefore a small-signal short, in parallel with A0's
   * floating input (1e-8 S) and gmin (1e-12 S). So
   *
   *   R_th = 1 / (1/1000 + 1e-8 + 1e-12) = 999.99 Ω
   *   τ    = R_th·C = 9.99990e-4 s  ≈ 1 ms
   *
   * and the final level is a divider against that same leakage:
   *
   *   V_∞ = 5 · (1e-8 + 1e-12)⁻¹ / ((1e-8 + 1e-12)⁻¹ + 1000) = 4.99995 V
   *
   * Both are computed below rather than typed as decimals, so the arithmetic is
   * visible and cannot be a transcription error.
   *
   * The engine picks h = τ/50 = 20 µs (the τ/50 rule and the 20 µs floor happen
   * to coincide here), and backward Euler at 50 steps per τ reads 0.58 % LOW at
   * t = τ — an exactly computable bias, asserted against below in BOTH forms:
   * tightly against the BE recurrence, and to 1 % against the continuous curve
   * the brief names (3.16 V at t = RC). 0.58 % is far inside the ±20 % tolerance
   * of a real electrolytic capacitor.
   */
  const R = 1000
  const C = 1e-6
  const gLeak = G_FLOAT + GMIN
  const rTh = 1 / (1 / R + gLeak)
  const tau = rTh * C
  const vFinal = VCC * (1 / gLeak) / (1 / gLeak + R)
  const h = stepFor(tau)

  const doc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: R }),
      placeP('c', 'capacitor', { microfarads: 1 })],
    wires: [
      w(['uno', '5V'], ['r', '1']),
      w(['r', '2'], ['c', '1']),
      w(['c', '2'], ['uno', 'GND.1']),
      w(['c', '1'], ['uno', 'A0']),
    ],
  }

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  const s0 = eng.snapshot()

  truth('the engine is in transient mode (h > 0)', (s0.transientStep ?? 0) > 0,
    '> 0 s', String(s0.transientStep))
  near('the engine derived h = τ/50 = 20 µs from the circuit itself',
    (s0.transientStep ?? 0) * 1e6, h * 1e6, 0.01, 'µs')
  truth('an uncharged capacitor starts at 0 counts', s0.adc.A0 === 0, '0', String(s0.adc.A0))

  // Sample at 1τ, 2τ, 3τ and 5τ. run() takes microseconds; τ is 1 ms.
  const seen: Record<number, number> = {}
  let monotone = true
  let last = -1
  let overshoot = false
  for (let ms = 1; ms <= 5; ms++) {
    eng.run(1000) // 1 ms of simulated time
    const s = eng.snapshot()
    seen[ms] = s.adc.A0
    if (s.adc.A0 < last) monotone = false
    if (s.adc.A0 > ADC_MAX) overshoot = true
    last = s.adc.A0
  }

  // t = τ. THE anchor: the brief's 5 V / 1 kΩ / 1 µF reaching 63.2 % at t = RC.
  const beTau = beCharge(1e-3, h, tau, vFinal)
  near('v_C(τ) matches the exact backward-Euler recurrence (±2 counts)',
    seen[1], counts(beTau), 2, 'counts')
  // Continuous 5·(1−e⁻¹) = 3.1606 V = 646.7 counts. BE at h=τ/50 sits 0.58 %
  // below it, i.e. ~4 counts, so 1 % (10 counts) is the honest tolerance.
  near('v_C(τ) is within 1 % of the continuous 3.1606 V (63.2 % of 5 V)',
    seen[1], counts(vFinal * (1 - Math.exp(-1))), 10, 'counts')

  near('v_C(2τ) matches backward Euler (86.5 % of 5 V)',
    seen[2], counts(beCharge(2e-3, h, tau, vFinal)), 2, 'counts')
  near('v_C(3τ) matches backward Euler (95.0 % of 5 V)',
    seen[3], counts(beCharge(3e-3, h, tau, vFinal)), 2, 'counts')
  near('v_C(5τ) matches backward Euler (99.3 % of 5 V)',
    seen[5], counts(beCharge(5e-3, h, tau, vFinal)), 2, 'counts')

  truth('the charge curve rises monotonically through the engine', monotone,
    'monotone up', monotone ? 'monotone up' : 'NON-MONOTONE')
  truth('it never overshoots the rail', !overshoot, 'no overshoot',
    overshoot ? 'OVERSHOOT' : 'no overshoot')

  const sEnd = eng.snapshot()
  truth('the engine actually took transient steps', (sEnd.transientSteps ?? 0) > 200,
    '> 200 steps', String(sEnd.transientSteps))
  truth('the memo cache was never consulted in transient mode', sEnd.cacheHits === 0,
    '0 cache hits', String(sEnd.cacheHits))
}

// ══════════════════════════════════════════════════════════════════════════════
group('6. MCU clock and analog time are the SAME time')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The claim under test: a `delay(1000)` in the sketch and a 1 s RC curve agree.
   *
   * Blink drives D13 high, delays 1000 ms, drives it low. D13 — 10 kΩ —
   * C=100 µF — GND, A0 on the capacitor node, so the capacitor charges for
   * exactly one `delay(1000)` and is then cut off.
   *
   * Two INDEPENDENT clocks measure that interval:
   *
   *   - avr8js's cycle counter, via snapshot().simSeconds, which is what the
   *     firmware's own delay loop counts against;
   *   - the capacitor's charge, inverted through the backward-Euler recurrence.
   *     Solving v = V(1 − ρⁿ) for n gives n = ln(1 − v/V)/ln ρ, and t = n·h.
   *
   * If the transient integrator had its own clock — a fixed h accumulated
   * independently, say — these two would drift apart and this is where it would
   * show. They cannot drift here by construction: the step handed to the solver
   * IS (cpu.cycles − lastStepCycles)/CLOCK_HZ.
   *
   * Element values: a driven-high pin is 5 V behind R_DRIVE = 25 Ω, in series
   * with the 10 kΩ, so R_source = 10025 Ω, loaded by A0's 1e-8 S and gmin.
   */
  const R = 10000
  const C = 100e-6
  const gLeak = G_FLOAT + GMIN
  const rSource = R + R_DRIVE
  const rTh = 1 / (1 / rSource + gLeak)
  const tau = rTh * C
  const vFinal = VCC * (1 / gLeak) / (1 / gLeak + rSource)
  // τ ≈ 1.0024 s, so τ/50 = 20 ms is above the 5 ms ceiling and h clamps there.
  const h = stepFor(tau)

  const doc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: R }),
      placeP('c', 'capacitor', { microfarads: 100 })],
    wires: [
      w(['uno', 'D13'], ['r', '1']),
      w(['r', '2'], ['c', '1']),
      w(['c', '2'], ['uno', 'GND.1']),
      w(['c', '1'], ['uno', 'A0']),
    ],
  }

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  near('h clamps to the 5 ms ceiling for a τ ≈ 1 s circuit',
    (eng.snapshot().transientStep ?? 0) * 1e3, h * 1e3, 0.01, 'ms')

  /**
   * Walk in 1 ms slices, recording every D13 transition with the simulated time
   * and the ADC reading at that moment. 1 ms of 1000 is 0.1 % of resolution on
   * the interval, which is well inside every tolerance below.
   */
  interface Edge { high: boolean; t: number; adc: number }
  const edges: Edge[] = []
  let prevHigh = eng.snapshot().pins.D13 === 'high'
  for (let i = 0; i < 4200 && edges.length < 4; i++) {
    eng.run(1000)
    const s = eng.snapshot()
    const high = s.pins.D13 === 'high'
    if (high !== prevHigh) {
      edges.push({ high, t: s.simSeconds, adc: s.adc.A0 })
      prevHigh = high
    }
  }

  truth('walked to a rising and a falling edge on D13', edges.length >= 2,
    '≥2 edges', `${edges.length} edges`)

  const rise = edges.find((e) => e.high)
  const fall = edges.find((e) => !e.high && rise !== undefined && e.t > rise.t)

  if (rise && fall) {
    // 1. What the MCU says the interval was.
    const tMcu = fall.t - rise.t
    near('the MCU held D13 high for delay(1000) = 1.000 s', tMcu * 1e3, 1000, 3, 'ms')

    // 2. What the CAPACITOR says the interval was, inverted from its charge.
    //    The ADC quantum is 4.888 mV and dv/dt at t=τ is V/τ·e⁻¹ = 1.835 V/s,
    //    so one count is 2.7 ms of time resolution — the dominant error here.
    const vFall = (fall.adc / ADC_MAX) * VCC
    const rho = 1 / (1 + h / tau)
    const tAnalog = (Math.log(1 - vFall / vFinal) / Math.log(rho)) * h

    near('the CAPACITOR independently measures the same 1.000 s',
      tAnalog * 1e3, 1000, 12, 'ms')
    near('the two clocks agree with each other to under 1 %',
      ((tAnalog - tMcu) / tMcu) * 100, 0, 1, '%')

    // 3. And the absolute level is the closed-form one, not merely self-consistent.
    near('v_C at the falling edge matches the BE closed form',
      fall.adc, counts(beCharge(tMcu, h, tau, vFinal)), 3, 'counts')
    // Continuous 63.2 % of 4.9995 V = 3.1605 V = 646.6 counts; BE at h = τ/200
    // is only ~1 count below, so this is a tight check of the whole chain.
    near('and is within 1 % of the continuous 63.2 % of the rail',
      fall.adc, counts(vFinal * (1 - Math.exp(-tMcu / tau))), 10, 'counts')
  } else {
    truth('found a rise followed by a fall', false, 'both edges', 'missing an edge')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('7. the memo cache cannot freeze the charge curve')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * THE TRAP THIS WORK EXISTED TO AVOID, as a regression test.
   *
   * engine.ts memoises DC solves on stateKey() — the pin drive vector plus the
   * behavioural drives. A capacitor's voltage is state that key does not
   * capture. Blink returns D13 to 'high' once every two seconds, so the key at
   * the second rising edge is CHARACTER-FOR-CHARACTER the key at the first; a
   * cache hit would restore the node voltages from the first time and report an
   * RC circuit as a resistive divider, with ok:true, for as long as a student
   * watched it. That is the same class as the anti-phase averaging bug and the
   * analog-drive stale-hit bug already fixed in this engine.
   *
   * Same circuit as group 6, so the capacitor is charging and discharging with
   * τ ≈ 1 s while D13 toggles at 0.5 Hz. The capacitor voltage AT SUCCESSIVE
   * RISING EDGES must be strictly increasing as the sawtooth builds toward its
   * steady state:
   *
   *   v₀ = 0
   *   v₁ = [V(1−ρⁿ)]·ρⁿ                 (charge 1 s, then discharge 1 s)
   *   v₂ = [V + (v₁−V)ρⁿ]·ρⁿ
   *
   * ≈ 0 V, 1.16 V, 1.32 V. A frozen cache gives 0 V, 0 V, 0 V — so this
   * assertion fails loudly the moment the memo is re-enabled in transient mode.
   */
  const R = 10000
  const C = 100e-6
  const gLeak = G_FLOAT + GMIN
  const rSource = R + R_DRIVE
  const tau = (1 / (1 / rSource + gLeak)) * C
  const vFinal = VCC * (1 / gLeak) / (1 / gLeak + rSource)
  const h = stepFor(tau)

  const doc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: R }),
      placeP('c', 'capacitor', { microfarads: 100 })],
    wires: [
      w(['uno', 'D13'], ['r', '1']),
      w(['r', '2'], ['c', '1']),
      w(['c', '2'], ['uno', 'GND.1']),
      w(['c', '1'], ['uno', 'A0']),
    ],
  }

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  const risingAdc: number[] = []
  let prevHigh = eng.snapshot().pins.D13 === 'high'
  for (let i = 0; i < 5200 && risingAdc.length < 3; i++) {
    eng.run(1000)
    const s = eng.snapshot()
    const high = s.pins.D13 === 'high'
    if (high && !prevHigh) risingAdc.push(s.adc.A0)
    prevHigh = high
  }

  truth('reached three rising edges of D13', risingAdc.length === 3,
    '3 rising edges', String(risingAdc.length))

  if (risingAdc.length === 3) {
    truth(
      'v_C at successive rising edges STRICTLY INCREASES (a frozen cache would repeat)',
      risingAdc[0] < risingAdc[1] && risingAdc[1] < risingAdc[2],
      'strictly increasing',
      risingAdc.join(' → ') + ' counts',
    )
    // Hand-derived sawtooth, from the recurrence in the comment above.
    const rho = Math.pow(1 / (1 + h / tau), 1.0 / h)
    const v1 = vFinal * (1 - rho) * rho
    const v2 = (vFinal + (v1 - vFinal) * rho) * rho
    near('2nd rising edge matches the hand-derived sawtooth', risingAdc[1], counts(v1), 6, 'counts')
    near('3rd rising edge matches the hand-derived sawtooth', risingAdc[2], counts(v2), 6, 'counts')
  }

  truth('cacheHits stayed at zero for the whole run', eng.snapshot().cacheHits === 0,
    '0', String(eng.snapshot().cacheHits))
}

// ══════════════════════════════════════════════════════════════════════════════
group('8. stored charge survives an edit, but not a rewire')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * compile() builds a brand-new Circuit — and brand-new capacitors at their
   * t=0 condition — on EVERY document change, including dragging a part two
   * pixels. Without carry-over, nudging a capacitor dumps its charge. That is
   * the PIR-hold-timer defect (a prop change destroying the state the change was
   * meant to start) transplanted into the analog half of the engine.
   *
   * Carry-over is gated on the element still bridging the SAME TWO NETS, because
   * that is what makes it the same charge on the same two points. A capacitor
   * the student re-wired is electrically somewhere else and must start again —
   * insisting its old voltage still applied would be inventing a number.
   */
  const R = 1000
  const gLeak = G_FLOAT + GMIN
  const tau = (1 / (1 / R + gLeak)) * 1e-6
  const vFinal = VCC * (1 / gLeak) / (1 / gLeak + R)
  const h = stepFor(tau)

  const base = (capX: number): CircuitDoc => ({
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: R }),
      { id: 'c', type: 'capacitor', x: capX, y: 0, rotation: 0 as const, props: { microfarads: 1 } }],
    wires: [
      w(['uno', '5V'], ['r', '1']),
      w(['r', '2'], ['c', '1']),
      w(['c', '2'], ['uno', 'GND.1']),
      w(['c', '1'], ['uno', 'A0']),
    ],
  })

  const eng = new SimulationEngine(firmware('blink.hex'), base(0))
  eng.run(1000) // one τ
  const before = eng.snapshot().adc.A0
  near('charged to 63 % before the edit', before, counts(beCharge(1e-3, h, tau, vFinal)), 2, 'counts')

  // A DRAG: same wiring, different x. The charge must survive it.
  eng.setDocument(base(40))
  const after = eng.snapshot().adc.A0
  truth('dragging the capacitor does NOT dump its charge',
    Math.abs(after - before) <= 2, `${before} ±2 counts`, String(after))

  // And it goes on charging from where it was, rather than restarting.
  eng.run(1000)
  const later = eng.snapshot().adc.A0
  near('it continues charging from where it was (86.5 % at 2τ)',
    later, counts(beCharge(2e-3, h, tau, vFinal)), 3, 'counts')

  /**
   * The guard itself, checked at the compile level so the assertion is about the
   * RULE rather than about a net id that happens to fall out a certain way: an
   * unchanged wiring keeps the terminals, a rewire changes them, and the engine
   * carries state only when they match.
   */
  const t0 = compile(base(0)).reactive.get('c')!.terminals
  const t1 = compile(base(40)).reactive.get('c')!.terminals
  truth('a drag leaves the capacitor on the same two nets (so carry-over applies)',
    t0[0] === t1[0] && t0[1] === t1[1], `[${t0}]`, `[${t1}]`)

  const rewired: CircuitDoc = {
    parts: base(0).parts,
    wires: [
      w(['uno', '5V'], ['r', '1']),
      w(['r', '2'], ['uno', 'A0']),
      // The capacitor now hangs off D7 instead of the resistor's output.
      w(['uno', 'D7'], ['c', '1']),
      w(['c', '2'], ['uno', 'GND.1']),
    ],
  }
  const t2 = compile(rewired).reactive.get('c')!.terminals
  truth('a REWIRE moves it to different nets (so carry-over is refused)',
    t0[0] !== t2[0] || t0[1] !== t2[1], `≠ [${t0}]`, `[${t2}]`)
}

// ══════════════════════════════════════════════════════════════════════════════
group('9. the Pico engine steps a capacitor too')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The same coupling on rp2040js, whose clock counts NANOSECONDS rather than
   * cycles — the one place the two engines could plausibly have diverged.
   *
   * Pico 3V3 — R=1 kΩ — C=1 µF — GND, with GP26 (ADC0) on the capacitor node.
   * Driving from the always-on 3V3 rail rather than a GPIO keeps this about the
   * transient loop: no firmware has to run, so an inert branch-to-self image is
   * enough and the test costs milliseconds.
   *
   * A Pico is a 3.3 V part, so every expected value differs from the Uno's by
   * that ratio — which is exactly the kind of constant that gets copied across
   * by accident, and would be caught here.
   *
   * AND SO IS THE PAD'S PULL-DOWN. An RP2040 GPIO comes out of reset with its
   * pull-down ENABLED, so GP26 is a ~55 kΩ resistor to ground before any
   * firmware touches it — not the 100 MΩ a floating AVR input presents. That is
   * a 55 kΩ load across a 1 kΩ source, which pulls the asymptote down by 1.8 %
   * (3.241 V rather than 3.300 V) and shortens τ by the same factor. Writing
   * this group with the AVR's G_FLOAT gave expectations 70 counts high against a
   * perfectly correct engine; the datasheet reset state is the oracle, and
   * pico.test.ts calls treating it as clean high-impedance "the easy wrong
   * assumption" for exactly this reason.
   */
  const R = 1000
  const C = 1e-6
  /** RP2040 internal pull-down, from pico/engine.ts R_PULL. Restated, not imported. */
  const R_PULL = 55_000
  const gLeak = 1 / R_PULL + G_FLOAT + GMIN
  const rTh = 1 / (1 / R + gLeak)
  const tau = rTh * C
  const vFinal = PICO_VDD * (1 / gLeak) / (1 / gLeak + R)
  const h = stepFor(tau)

  const doc: CircuitDoc = {
    parts: [placeP('pico', 'raspberry_pi_pico'), placeP('r', 'resistor', { ohms: R }),
      placeP('c', 'capacitor', { microfarads: 1 })],
    wires: [
      w(['pico', '3.3V'], ['r', '1']),
      w(['r', '2'], ['c', '1']),
      w(['c', '2'], ['pico', 'GND.1']),
      w(['c', '1'], ['pico', 'GP26']),
    ],
  }

  // 16 KB of zeroed bootrom and a single Thumb `B .` at the flash base, exactly
  // as pico.test.ts's inertFirmware() does — the CPU is not what is under test.
  const flash = new Uint8Array(4)
  flash[0] = 0xfe
  flash[1] = 0xe7
  const eng = new PicoSimulationEngine(loadPicoFirmware(new Uint8Array(16 * 1024), flash), doc)

  const s0 = eng.snapshot()
  truth('the Pico engine is in transient mode', (s0.transientStep ?? 0) > 0,
    '> 0 s', String(s0.transientStep))
  near('and derived the same h = τ/50 = 20 µs', (s0.transientStep ?? 0) * 1e6, h * 1e6, 0.01, 'µs')

  const pcounts = (v: number): number =>
    Math.max(0, Math.min(PICO_ADC_MAX, Math.round((v / PICO_VDD) * PICO_ADC_MAX)))

  let monotone = true
  let last = -1
  const seen: number[] = []
  for (let ms = 1; ms <= 5; ms++) {
    eng.run(1000)
    const s = eng.snapshot()
    seen.push(s.adc.GP26)
    if (s.adc.GP26 < last) monotone = false
    last = s.adc.GP26
  }

  // 12-bit over 3.3 V: 0.806 mV per count, so tolerances are in counts of that.
  near('Pico v_C(1 ms) matches the exact backward-Euler recurrence',
    seen[0], pcounts(beCharge(1e-3, h, tau, vFinal)), 8, 'counts')
  near('Pico v_C(τ) is within 1 % of 63.2 % of the loaded rail',
    seen[0], pcounts(vFinal * (1 - Math.exp(-1e-3 / tau))), 45, 'counts')
  near('Pico v_C(5 ms) matches backward Euler',
    seen[4], pcounts(beCharge(5e-3, h, tau, vFinal)), 8, 'counts')
  truth('the Pico charge curve rises monotonically', monotone, 'monotone up',
    monotone ? 'monotone up' : 'NON-MONOTONE')

  const sEnd = eng.snapshot()
  truth('the Pico engine took transient steps', (sEnd.transientSteps ?? 0) > 200,
    '> 200 steps', String(sEnd.transientSteps))
  truth('and never consulted its memo cache', sEnd.cacheHits === 0, '0', String(sEnd.cacheHits))

  /**
   * The 3.3 V rail is the whole point: an Uno's 5 V constants must not leak in.
   * The capacitor settles at 3.241 V — the 3.3 V rail loaded by the pad's own
   * 55 kΩ pull-down — which as a fraction of a 3.3 V full scale is 98.2 %. On a
   * 5 V part the same divider would read 4.91 V, i.e. off the top of this ADC,
   * so this assertion fails hard if the rail is ever inherited from the AVR.
   */
  // Sampled after a further 10 ms — 15 τ in all, so the exponential is settled
  // to 3e-7 of full scale and what remains is the divider, not the transient.
  eng.run(10_000)
  const settled = (eng.snapshot().adc.GP26 / PICO_ADC_MAX) * PICO_VDD
  near('the Pico settles on its own 3.3 V rail (loaded by the pad pull-down)',
    settled, vFinal, 0.01, 'V')
}

// ══════════════════════════════════════════════════════════════════════════════
group('10. the timestep is derived from the circuit, and clamped')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * h = clamp(τ/50, 20 µs, 5 ms), with τ measured by the driving-point probe.
   *
   * The clamps are not cosmetic. The 20 µs floor is a COST ceiling — at most
   * 50 000 analog solves per simulated second — and the reason it is safe to hit
   * is that backward Euler is L-stable: h ≫ τ collapses to the DC steady state
   * within a step or two instead of ringing, which is the right answer for a
   * time constant finer than anything observable. The 5 ms ceiling keeps a 20 Hz
   * snapshot showing a curve rather than a staircase.
   */
  const cases: Array<{ ohms: number; uf: number; label: string }> = [
    { ohms: 100, uf: 1, label: 'fast (τ = 100 µs → τ/50 = 2 µs, floors at 20 µs)' },
    { ohms: 1000, uf: 1, label: 'mid (τ = 1 ms → h = 20 µs)' },
    { ohms: 10000, uf: 10, label: 'slow (τ = 100 ms → τ/50 = 2 ms, in range)' },
    { ohms: 100000, uf: 470, label: 'very slow (τ = 47 s → τ/50 = 940 ms, ceils at 5 ms)' },
  ]
  for (const { ohms, uf, label } of cases) {
    const doc: CircuitDoc = {
      parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms }),
        placeP('c', 'capacitor', { microfarads: uf })],
      wires: [
        w(['uno', '5V'], ['r', '1']),
        w(['r', '2'], ['c', '1']),
        w(['c', '2'], ['uno', 'GND.1']),
      ],
    }
    // NOTE the leakage here is gmin ALONE, not gmin + G_FLOAT. Nothing in this
    // document wires an MCU pin to the capacitor node, so no floating input
    // hangs off it — unlike groups 5–8, where A0 is deliberately attached to
    // read the voltage and its 1e-8 S genuinely does load the node.
    const tau = (1 / (1 / ohms + GMIN)) * uf * 1e-6
    const eng = new SimulationEngine(firmware('blink.hex'), doc)
    const got = eng.snapshot().transientStep ?? 0
    nearRel(`h for ${label}`, got, stepFor(tau), 1e-6, 's')
  }

  /**
   * A purely resistive circuit must NOT enter transient mode at all — it would
   * pay for stepping and gain nothing, and its memo cache is entirely valid.
   *
   * The resistor hangs off D13 rather than the 5 V rail on purpose: the cache is
   * only ever consulted from evaluate(), evaluate() only runs on a pin edge, and
   * a pin edge only reaches the engine for a WIRED pin. A 5V—R—GND circuit
   * produces no edges at all, so it would report zero cache hits while proving
   * nothing. Blink toggling D13 gives exactly two reachable pin states, so every
   * edge after the first two is a hit.
   */
  const plain: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: 1000 })],
    wires: [w(['uno', 'D13'], ['r', '1']), w(['r', '2'], ['uno', 'GND.1'])],
  }
  const engPlain = new SimulationEngine(firmware('blink.hex'), plain)
  // 2.5 s: Blink's period is 2 s, so this is the first run long enough for D13
  // to RETURN to a pin state the cache has already stored. A shorter run would
  // report zero hits for want of a repeat rather than for want of a cache.
  engPlain.run(2_500_000)
  const sp = engPlain.snapshot()
  truth('a resistive circuit reports no timestep', (sp.transientStep ?? 0) === 0,
    '0 s', String(sp.transientStep))
  truth('a resistive circuit takes no transient steps', (sp.transientSteps ?? 0) === 0,
    '0 steps', String(sp.transientSteps))
  truth('and it still USES the memo cache (the DC path is untouched)', sp.cacheHits > 0,
    '> 0 cache hits', String(sp.cacheHits))
}

// ══════════════════════════════════════════════════════════════════════════════
group('11. a capacitor REPORTS its charge, and an inductor its current')
// ══════════════════════════════════════════════════════════════════════════════
//
// The transient engine has genuinely charged capacitors for a while, and the
// Device-state panel had no branch for one — a student building an RC could
// watch the current decay in Measurements and had no way at all to read the
// VOLTAGE that current was building, which is the number the exercise is about.
//
// Everything asserted here is measured through the REAL engine and checked
// against the same closed-form backward-Euler oracle group 3.1 derived by hand,
// so a reported voltage that drifted from the solved one would fail on the
// arithmetic rather than on its own output.
{
  const R = 1000
  const C = 1e-6
  const gLeak = G_FLOAT + GMIN
  const rTh = 1 / (1 / R + gLeak)
  const tau = rTh * C
  const vFinal = (VCC * (1 / gLeak)) / (1 / gLeak + R)
  const h = stepFor(tau)

  const doc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: R }),
      placeP('c', 'capacitor', { microfarads: 1 })],
    wires: [
      w(['uno', '5V'], ['r', '1']),
      w(['r', '2'], ['c', '1']),
      w(['c', '2'], ['uno', 'GND.1']),
      w(['c', '1'], ['uno', 'A0']),
    ],
  }

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  const s0 = eng.snapshot().deviceStates.c

  truth('the capacitor reports at all', s0 !== undefined, 'a state', String(s0 !== undefined))
  truth('it names itself a capacitor', s0?.element === 'capacitor', 'capacitor', String(s0?.element))
  truth('and says it is being integrated in time', s0?.transient === true, 'true', String(s0?.transient))
  truth('its declared value comes from the document, in µF',
    Number(s0?.value) === 1, '1 µF', String(s0?.value))
  truth('an uncharged capacitor is charging, not steady',
    s0?.trend === 'charging', 'charging', String(s0?.trend))
  // i(0⁺) = V/R exactly: the cap is a short at t = 0, so the resistor sets it.
  near('the initial current is V/R = 5 mA', Number(s0?.amps) * 1e3, (VCC / R) * 1e3, 0.02, 'mA')

  // t = τ. The SAME closed form group 3.1 uses, and the same 0.58 % BE bias.
  eng.run(1000)
  const s1 = eng.snapshot().deviceStates.c
  near('v_C(τ) as REPORTED matches the backward-Euler recurrence',
    Number(s1?.volts), beCharge(1e-3, h, tau, vFinal), 5e-3)
  near('... i.e. within 1 % of the continuous 3.1606 V',
    Number(s1?.volts), vFinal * (1 - Math.exp(-1)), 0.05)
  /**
   * The current has to be the DERIVATIVE of the voltage that was reported
   * beside it, not an independent number: i = C·dv/dt = C·(V∞ − v)/τ. This is
   * the assertion that would catch a reported voltage and a reported current
   * coming from different instants — the exact class of bug the snapshot's
   * "step to now" comment exists to prevent, checked here on the pair.
   */
  near('the reported current is C·dv/dt of the reported voltage',
    Number(s1?.amps) * 1e3, ((C * (vFinal - Number(s1?.volts))) / tau) * 1e3, 0.02, 'mA')
  truth('and it is still charging at t = τ', s1?.trend === 'charging', 'charging', String(s1?.trend))

  eng.run(4000)
  const s5 = eng.snapshot().deviceStates.c
  near('v_C(5τ) as reported is 99.3 % of the rail',
    Number(s5?.volts), beCharge(5e-3, h, tau, vFinal), 5e-3)
  truth('the reported voltage rose monotonically',
    Number(s5?.volts) > Number(s1?.volts) && Number(s1?.volts) > Number(s0?.volts),
    'v(0) < v(τ) < v(5τ)',
    `${Number(s0?.volts).toFixed(3)} < ${Number(s1?.volts).toFixed(3)} < ${Number(s5?.volts).toFixed(3)}`)
  truth('and the current fell as it did',
    Math.abs(Number(s5?.amps)) < Math.abs(Number(s1?.amps)),
    'i(5τ) < i(τ)',
    `${(Number(s5?.amps) * 1e3).toFixed(4)} < ${(Number(s1?.amps) * 1e3).toFixed(4)} mA`)

  /**
   * A capacitor whose leads reach nothing must say so rather than silently
   * reporting 0 V, which is indistinguishable from a discharged one that IS in
   * the circuit — and "you forgot a wire" is the mistake this panel exists for.
   */
  const loose: CircuitDoc = { parts: doc.parts, wires: [] }
  const engLoose = new SimulationEngine(firmware('blink.hex'), loose)
  const sl = engLoose.snapshot().deviceStates.c
  truth('an unwired capacitor reports itself disconnected',
    sl?.connected === false, 'false', String(sl?.connected))
}

{
  /**
   * The inductor, which until now had no palette part at all — so none of the
   * `Inductor` device, none of `timeConstant()`'s reciprocal-in-R handling and
   * none of the RL branch of the engine could be reached by a student.
   *
   * 10 mH through 100 Ω: τ = L/R = 100 µs, i(∞) = 5/100 = 50 mA. The 20 µs floor
   * means h = τ/5 rather than τ/50, so backward Euler is a good deal coarser
   * here than in the RC case — which is why every figure below is checked
   * against the BE recurrence at THIS h, and only loosely against the
   * continuous curve.
   */
  const R = 100
  const L = 10e-3
  const tau = L / R
  const iFinal = VCC / R
  const h = stepFor(tau)

  const doc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'resistor', { ohms: R }),
      placeP('l', 'inductor', { millihenries: 10 })],
    wires: [
      w(['uno', '5V'], ['r', '1']),
      w(['r', '2'], ['l', '1']),
      w(['l', '2'], ['uno', 'GND.1']),
      w(['l', '1'], ['uno', 'A0']),
    ],
  }

  const eng = new SimulationEngine(firmware('blink.hex'), doc)
  const s0 = eng.snapshot().deviceStates.l
  truth('the inductor part reaches the engine at all', s0 !== undefined, 'a state', String(s0 !== undefined))
  truth('it names itself an inductor', s0?.element === 'inductor', 'inductor', String(s0?.element))
  truth('the circuit is in transient mode because of it',
    (eng.snapshot().transientStep ?? 0) > 0, '> 0 s', String(eng.snapshot().transientStep))
  near('h is derived from L/R, floored at 20 µs',
    (eng.snapshot().transientStep ?? 0) * 1e6, h * 1e6, 0.1, 'µs')

  /**
   * An inductor is an OPEN at t = 0 — it holds its current at zero — so the
   * whole rail appears across it. That is the mirror of the capacitor's
   * "short at t = 0", and getting it backwards is the sign error group 3.3
   * exists to catch, here on the REPORTED pair.
   */
  near('at t = 0 the whole 5 V is across it', Number(s0?.volts), VCC, 1e-3)
  near('... and no current flows yet', Number(s0?.amps) * 1e3, 0, 0.01, 'mA')
  truth('its current is rising', s0?.trend === 'rising', 'rising', String(s0?.trend))

  eng.run(100) // t = τ
  const s1 = eng.snapshot().deviceStates.l
  // i(k) = iFinal·(1 − ρ^k), ρ = 1/(1 + h/τ) — the same recurrence, one dual along.
  const beRise = (t: number) => iFinal * (1 - Math.pow(1 / (1 + h / tau), t / h))
  near('i_L(τ) as REPORTED matches the backward-Euler recurrence',
    Number(s1?.amps) * 1e3, beRise(1e-4) * 1e3, 0.05, 'mA')
  // v_L = L·di/dt, which for this recurrence is exactly the rail minus i·R.
  near('the reported voltage is the rail minus i·R — Kirchhoff on the pair',
    Number(s1?.volts), VCC - Number(s1?.amps) * R, 2e-3)

  eng.run(900) // t = 10τ
  const s10 = eng.snapshot().deviceStates.l
  near('i_L(10τ) has reached the DC limit V/R = 50 mA',
    Number(s10?.amps) * 1e3, iFinal * 1e3, 0.05, 'mA')
  truth('an inductor at DC is a wire — almost nothing across it',
    Math.abs(Number(s10?.volts)) < 5e-3, '< 5 mV', `${(Number(s10?.volts) * 1e3).toFixed(3)} mV`)
  truth('the reported current rose monotonically',
    Number(s10?.amps) > Number(s1?.amps) && Number(s1?.amps) > Number(s0?.amps),
    'i(0) < i(τ) < i(10τ)',
    `${(Number(s0?.amps) * 1e3).toFixed(4)} < ${(Number(s1?.amps) * 1e3).toFixed(4)} < ${(Number(s10?.amps) * 1e3).toFixed(4)} mA`)

  /**
   * THE PROP REACHES THE SOLVER. Ten times the inductance is ten times the time
   * constant, so at a fixed 200 µs the two circuits must be at genuinely
   * different points on their curves — 2τ against 0.2τ.
   */
  const engBig = new SimulationEngine(firmware('blink.hex'), {
    parts: doc.parts.map((p) => (p.id === 'l' ? { ...p, props: { millihenries: 100 } } : p)),
    wires: doc.wires,
  })
  engBig.run(200)
  const engSmall = new SimulationEngine(firmware('blink.hex'), doc)
  engSmall.run(200)
  const iBig = Number(engBig.snapshot().deviceStates.l?.amps)
  const iSmall = Number(engSmall.snapshot().deviceStates.l?.amps)
  truth('a 100 mH choke is far behind a 10 mH one at the same instant',
    iBig < iSmall / 3, 'i(100 mH) < i(10 mH)/3',
    `${(iBig * 1e3).toFixed(3)} mA vs ${(iSmall * 1e3).toFixed(3)} mA`)
  near('and the 10 mH one is at 2τ on its own curve',
    iSmall * 1e3, beRise(2e-4) * 1e3, 0.05, 'mA')
}


// ══════════════════════════════════════════════════════════════════════════════
group('12. WINDINGS — a coil is a series R–L branch, not a resistor')
// ══════════════════════════════════════════════════════════════════════════════
//
// Motors, relay coils and stepper phases were all stamped as bare conductances,
// so `Circuit.hasReactive` stayed false for every one of them and the transient
// loop — which HAS been coupled into the engine for a while — never ran on the
// circuits it was most needed for. They are `RLBranch` companions now:
//
//   i = Geq·v + Ieq       Geq = k/(1 + k·R),  Ieq = i_prev/(1 + k·R),  k = h/L
//
// Every number below is derived on paper from R, L and V. Nothing is captured
// from the engine's own output.

// ── 12.1 THE DC DEGENERACY ────────────────────────────────────────────────────
//
// THE TRAP THIS PINS: at h = 0 the companion formula gives k = 0 and therefore
// Geq = 0/(1 + 0) = 0 — an OPEN CIRCUIT, which is the one thing a winding is
// not. Every steady-state assertion in every other suite goes through the DC
// path (a plain solve() sets no step), so a winding that took the formula
// literally would silently stop conducting the moment the transient loop was
// off: a motor reading 0 A, a relay that never pulls in, and 2 691 assertions
// failing for a reason that has nothing to do with any of them. DC is written
// out separately as Geq = 1/R, Ieq = 0, and this is what holds it there.
{
  const RSERIES = 100
  const RM = new DCMotor('probe', GROUND, GROUND, 0).effectiveOhms // 6/0.07 = 85.714 Ω

  // Two circuits identical but for the element under test: the winding, and the
  // plain resistor it replaced. A DC solve must not be able to tell them apart.
  const build = (winding: boolean) => {
    const c = new Circuit()
    const top = c.allocNet()
    const mid = c.allocNet()
    c.add(new VoltageSource('v', top, GROUND, VCC))
    c.add(new Resistor('rs', top, mid, RSERIES))
    c.add(winding ? new DCMotor('m', mid, GROUND, 0) : new Resistor('m', mid, GROUND, RM))
    return { c, res: c.solve(), mid }
  }
  const wound = build(true)
  const plain = build(false)

  truth('a motor makes its circuit reactive — the whole point',
    wound.c.hasReactive && !plain.c.hasReactive,
    'motor reactive, resistor not',
    `${wound.c.hasReactive} / ${plain.c.hasReactive}`)
  // v = V·R/(R + Rs) = 5·85.714/185.714 = 2.30769 V, from the divider alone.
  const vDivider = (VCC * RM) / (RM + RSERIES)
  near('at DC the winding solves to the plain resistive divider',
    wound.res.voltages[wound.mid], vDivider, 1e-9)
  near('   — to the last bit of the resistor it replaced',
    wound.res.voltages[wound.mid], plain.res.voltages[plain.mid], 1e-12)
  /**
   * And it is emphatically NOT the open the naive formula gives. An open would
   * put the whole 5 V on the node (nothing but gmin to pull it down), so this
   * separates the two answers by 2.7 V rather than by a tolerance.
   */
  truth('   and NOT the open circuit k/(1+kR) degenerates to at k = 0',
    Math.abs(wound.res.voltages[wound.mid] - VCC) > 2,
    `far from ${VCC} V`,
    `${wound.res.voltages[wound.mid].toFixed(5)} V`)

  // The same, for the Winding class a relay coil and a stepper phase are built from.
  const coilR = RELAY_MODULE_4CH.coilOhms
  const cw = new Circuit()
  const nw = cw.allocNet()
  cw.add(new VoltageSource('v', nw, GROUND, VCC))
  const coil = new Winding('coil', nw, GROUND, coilR, RELAY_MODULE_4CH.coilHenries)
  cw.add(coil)
  cw.solve()
  near('a relay coil at DC draws V/R = 71.43 mA',
    coil.current * 1e3, (VCC / coilR) * 1e3, 1e-9, 'mA')
}

// ── 12.2 INRUSH: i(t) = (V/R)·(1 − e^(−tR/L)) ─────────────────────────────────
{
  /**
   * The relay coil driven straight off a 5 V source, so the branch resistance is
   * the winding's own 70 Ω and nothing else:
   *
   *   τ = L/R = 50 mH / 70 Ω = 714.286 µs      i(∞) = 5/70 = 71.4286 mA
   *
   * Backward Euler on this branch collapses to the SAME geometric recurrence the
   * bare inductor gives in group 3.3, which is the independent oracle:
   *
   *   i_new = (k·V + i_prev)/(1 + k·R),  k = h/L
   *         ⇒  i_new − i(∞) = (i_prev − i(∞))/(1 + h/τ)
   *         ⇒  i(n·h) = i(∞)·(1 − ρ^n),  ρ = 1/(1 + h/τ)
   */
  const R = RELAY_MODULE_4CH.coilOhms
  const L = RELAY_MODULE_4CH.coilHenries
  const tau = L / R
  const iFinal = VCC / R
  const h = tau / 50
  const rho = 1 / (1 + h / tau)
  const beRise = (n: number) => iFinal * (1 - Math.pow(rho, n))

  const c = new Circuit()
  const n = c.allocNet()
  c.add(new VoltageSource('v', n, GROUND, VCC))
  const coil = new Winding('coil', n, GROUND, R, L)
  c.add(coil)

  near('τ of a 70 Ω / 50 mH coil on a stiff rail is 714.29 µs',
    (c.smallestTimeConstant() ?? 0) * 1e6, tau * 1e6, 1e-6, 'µs')

  c.beginTransient()
  truth('a winding starts at zero current, like the coil of a cold relay',
    coil.current === 0, '0 A', `${coil.current} A`)

  for (let k = 0; k < 50; k++) c.transientStep(h)
  near('i(τ) matches the exact backward-Euler recurrence',
    coil.current * 1e3, beRise(50) * 1e3, 1e-9, 'mA')
  near('   and is within 0.6 % of the continuous (V/R)(1 − e^−1) = 45.15 mA',
    coil.current * 1e3, iFinal * (1 - Math.exp(-1)) * 1e3, 0.3, 'mA')

  for (let k = 0; k < 200; k++) c.transientStep(h)
  near('i(5τ) has all but arrived at V/R = 71.43 mA',
    coil.current * 1e3, beRise(250) * 1e3, 1e-9, 'mA')
  // 1 - rho^250 = 1 - 1.02^-250 = 0.992926, so backward Euler is 0.707 % shy of
  // the DC answer after 5 tau. Both figures are on paper; neither is captured.
  nearRel('   which is the DC answer the resistor gave, to 0.71 %',
    coil.current, iFinal, 7.1e-3, 'A')

  /**
   * THE STEP SIZE ONLY COSTS ACCURACY, NEVER CORRECTNESS. A step five times the
   * time constant lands on the same steady state. That is the L-stability the
   * 20 µs floor in engine.ts is justified by.
   */
  const c2 = new Circuit()
  const n2 = c2.allocNet()
  c2.add(new VoltageSource('v', n2, GROUND, VCC))
  const coil2 = new Winding('coil', n2, GROUND, R, L)
  c2.add(coil2)
  c2.beginTransient()
  for (let k = 0; k < 25; k++) c2.transientStep(5 * tau)
  nearRel('a step 5x the time constant still lands on the same steady state',
    coil2.current, iFinal, 1e-6, 'A')
}

// ── 12.3 FLYBACK: the diode carries the coil current on release ───────────────
{
  /**
   * A coil across a 5 V rail with a switch on its low side and a 1N4148 flyback
   * diode from that node up to the rail — the relay board's own topology.
   *
   * While the switch is closed the diode is reverse-biased and the coil settles
   * at 5/70 = 71.4 mA. Open the switch and the current has nowhere else to go:
   * it must continue through the diode, which forces the coil's low side ABOVE
   * the rail by exactly the diode's forward drop at that current.
   */
  const R = RELAY_MODULE_4CH.coilOhms
  const L = RELAY_MODULE_4CH.coilHenries
  const c = new Circuit()
  const rail = c.allocNet()
  const low = c.allocNet()
  c.add(new VoltageSource('v', rail, GROUND, VCC))
  const coil = new Winding('coil', rail, low, R, L)
  const fly = new Diode('dfly', low, rail, DIODE_1N4148)
  const sw = new Resistor('sw', low, GROUND, 1e-3)
  c.add(coil, fly, sw)

  const tau = L / R
  const h = tau / 50
  c.beginTransient()
  for (let k = 0; k < 400; k++) c.transientStep(h)
  const iOn = coil.current
  nearRel('coil energised at 71.4 mA', iOn, VCC / R, 1e-3, 'A')
  truth('   with the flyback diode reverse-biased and inert',
    Math.abs(fly.current) < 1e-8, '|i| < 10 nA', `${(fly.current * 1e9).toFixed(2)} nA`)

  // Open the switch. One step.
  ;(sw as unknown as { ohms: number }).ohms = 1e9
  const rOff = c.transientStep(h)
  truth('on release the diode conducts — it is not inert any more',
    fly.current > 0.9 * iOn,
    `> ${(0.9 * iOn * 1e3).toFixed(1)} mA`,
    `${(fly.current * 1e3).toFixed(3)} mA`)
  /**
   * Kirchhoff at the open node: with the switch gone the coil branch and the
   * diode branch are the same loop, so the two currents are one current. They
   * agree to a few parts in ten thousand rather than exactly, because the diode
   * makes this a NONLINEAR solve that stops at Newton's reltol of 1e-3 — the
   * same reason onewire.test.ts loosens its ULN2003 chain tolerances.
   */
  nearRel('   and it carries the WHOLE coil current — Kirchhoff at the open node',
    fly.current, coil.current, 2e-3, 'A')
  /**
   * The clamp voltage is the diode equation solved at that current, computed
   * here from the 1N4148 constants rather than read off the node:
   *   v_low = VCC + n·VT·ln(i/Is + 1)
   */
  const vf = DIODE_1N4148.n * 0.025852 * Math.log(fly.current / DIODE_1N4148.is + 1)
  near('   pushing the coil node one forward drop ABOVE the 5 V rail',
    rOff.voltages[low], VCC + vf, 2e-3)
  truth('   which is above the rail, not below it — the sign of the kick',
    rOff.voltages[low] > VCC, `> ${VCC} V`, `${rOff.voltages[low].toFixed(4)} V`)

  const iAfter1 = coil.current
  for (let k = 0; k < 50; k++) c.transientStep(h)
  truth('and the stored current then decays away through it',
    coil.current < iAfter1 / 2 && coil.current > 0,
    `0 < i < ${(iAfter1 * 500).toFixed(1)} mA`,
    `${(coil.current * 1e3).toFixed(3)} mA`)
}

// ── 12.4 THE L298N's FREEWHEEL DIODES ─────────────────────────────────────────
{
  /**
   * The limitation this replaces said the bridge's flyback diodes "never conduct
   * and the bridge is never seen doing the job it is there for". They never
   * conducted for two reasons, both now fixed: the model had no diodes at all,
   * and its load could not store energy.
   *
   * Forward-drive a fully loaded motor from a 9 V supply, then drop the enable.
   * Both legs go open, the armature current keeps flowing, and one diode in each
   * leg has to pick it up: OUT_A is dragged BELOW ground and OUT_B ABOVE Vs.
   */
  const VS = 9
  const c = new Circuit()
  const vs = c.allocNet()
  const vss = c.allocNet()
  const o1 = c.allocNet()
  const o2 = c.allocNet()
  const in1 = c.allocNet()
  const in2 = c.allocNet()
  const en = c.allocNet()
  c.add(new VoltageSource('vs', vs, GROUND, VS))
  c.add(new VoltageSource('vss', vss, GROUND, VCC))
  c.add(new VoltageSource('pin1', in1, GROUND, VCC))
  c.add(new VoltageSource('pin2', in2, GROUND, 0))
  const pEn = new VoltageSource('pen', en, GROUND, VCC)
  c.add(pEn)
  const { devices, channels } = createL298N('l1', {
    in1,
    in2,
    ena: en,
    in3: c.allocNet(),
    in4: c.allocNet(),
    enb: c.allocNet(),
    out1: o1,
    out2: o2,
    vs,
    vss,
    gnd: GROUND,
  })
  c.add(...devices)
  const m = new DCMotor('m', o1, o2, 1)
  c.add(m)
  const byId = (id: string) => devices.find((d) => d.id === id) as Diode
  const dloA = byId('l1.dlo1')
  const dhiB = byId('l1.dhi2')

  truth('the board carries two freewheel diodes per wired output',
    devices.filter((d) => /^l1\.d(lo|hi)/.test(d.id)).length === 4,
    '4 for 2 wired outputs',
    String(devices.filter((d) => /^l1\.d(lo|hi)/.test(d.id)).length))

  const dc = c.solve()
  truth('at a DC operating point every one of them is reverse-biased',
    Math.abs(dloA.current) < 1e-9 && Math.abs(dhiB.current) < 1e-9,
    '|i| < 1 nA each',
    `${(dloA.current * 1e9).toFixed(3)} nA, ${(dhiB.current * 1e9).toFixed(3)} nA`)
  truth('   so adding them changed no DC answer: the bridge still drives forward',
    dc.ok && channels[0].mode === 'forward',
    'ok / forward',
    `${dc.ok} / ${channels[0].mode}`)

  const tau = HOBBY_MOTOR_6V.henries / m.effectiveOhms
  const h = tau / 50
  c.beginTransient()
  for (let k = 0; k < 400; k++) c.transientStep(h)
  const iRun = m.current
  truth('the motor runs', iRun > 0.5, '> 500 mA', `${(iRun * 1e3).toFixed(1)} mA`)

  pEn.volts = 0
  const rOff = c.transientStep(h)
  truth('dropping the enable coasts the bridge',
    channels[0].mode === 'coast', 'coast', channels[0].mode)
  truth('   and BOTH freewheel diodes conduct the armature current',
    dloA.current > 0.9 * iRun && dhiB.current > 0.9 * iRun,
    `both > ${(0.9 * iRun * 1e3).toFixed(0)} mA`,
    `${(dloA.current * 1e3).toFixed(1)} mA, ${(dhiB.current * 1e3).toFixed(1)} mA`)
  truth('   clamping OUT_A below ground and OUT_B above Vs, which is the job',
    rOff.voltages[o1] < 0 && rOff.voltages[o2] > VS,
    `v(OUT_A) < 0 < ${VS} < v(OUT_B)`,
    `${rOff.voltages[o1].toFixed(3)} V / ${rOff.voltages[o2].toFixed(3)} V`)
  /**
   * By exactly one forward drop each, computed from the diode's own constants —
   * Is derived in DIODE_L298N_FREEWHEEL from the L298 datasheet's "VF <= 1.2 V
   * at 2 A" line. That is what makes this the flyback path and not merely two
   * nodes that happen to have moved.
   */
  const vfFly = (i: number) =>
    DIODE_L298N_FREEWHEEL.n * 0.025852 * Math.log(i / DIODE_L298N_FREEWHEEL.is + 1)
  near('   by exactly one diode drop below 0 V',
    rOff.voltages[o1], -vfFly(dloA.current), 3e-3)
  near('   and one diode drop above Vs',
    rOff.voltages[o2], VS + vfFly(dhiB.current), 3e-3)
  /**
   * The clamp puts −(Vs + 2·Vf) ≈ −11 V across a 6 V motor for a step or two.
   * That is what a freewheel path DOES, and reporting it as a destroyed winding
   * would be the simulator failing a correctly built circuit — which is why
   * DCMotor.safety() measures the winding's own i·R rather than its terminals.
   */
  truth('   without the correctly built flyback path being called a dead motor',
    !rOff.faults.some((f) => f.deviceId === 'm' && f.severity === 'destructive'),
    'no destructive motor fault',
    rOff.faults.map((f) => `${f.deviceId}:${f.severity}`).join(',') || '(none)')

  const iFirst = m.current
  for (let k = 0; k < 20; k++) c.transientStep(h)
  truth('and the armature current decays through them',
    m.current < iFirst / 2,
    `< ${(iFirst * 500).toFixed(0)} mA`,
    `${(m.current * 1e3).toFixed(1)} mA`)
}

// ── 12.5 THE INDUCTANCE REACHES THE SOLVER ────────────────────────────────────
//
// The LED-colour defect in one sentence: a fully commented, fully tested
// datasheet table that no stamp() ever read. `henries` is a new field on
// MotorParams and it could fail exactly the same way, silently. Asserted by
// DIFFERENCE, the way prop-reachability.ts does it: change only that number and
// the answer has to move — while the DC answer must not move at all.
{
  const withL = (h: number): MotorParams => ({ ...HOBBY_MOTOR_6V, henries: h })
  const rig = (params: MotorParams) => {
    const c = new Circuit()
    const n = c.allocNet()
    c.add(new VoltageSource('v', n, GROUND, VCC))
    const m = new DCMotor('m', n, GROUND, 0, params)
    c.add(m)
    return { c, m }
  }
  const fast = rig(withL(2e-3))
  const slow = rig(withL(20e-3))

  fast.c.solve()
  slow.c.solve()
  near('ten times the inductance is the SAME motor at DC',
    fast.m.current * 1e3, slow.m.current * 1e3, 1e-12, 'mA')

  const R = fast.m.effectiveOhms
  const tauFast = 2e-3 / R
  const h = tauFast / 20
  fast.c.beginTransient()
  slow.c.beginTransient()
  for (let k = 0; k < 20; k++) {
    fast.c.transientStep(h)
    slow.c.transientStep(h)
  }
  // At t = τ_fast the 2 mH motor is at ~63 % and the 20 mH one at 1 − e^−0.1 ≈ 9.5 %.
  truth('   but a different motor in time — 10x L is 10x the rise time',
    fast.m.current > 4 * slow.m.current,
    'i(2 mH) > 4·i(20 mH)',
    `${(fast.m.current * 1e3).toFixed(3)} mA vs ${(slow.m.current * 1e3).toFixed(3)} mA`)
  nearRel('   and each sits on its own closed-form curve at that instant',
    fast.m.current,
    (VCC / R) * (1 - Math.pow(1 / (1 + h / tauFast), 20)),
    1e-9,
    'A')
  nearRel('   (the slow one likewise)',
    slow.m.current,
    (VCC / R) * (1 - Math.pow(1 / (1 + h / (20e-3 / R)), 20)),
    1e-9,
    'A')
}

// ── 12.6 THE TIMESTEP SEES THE NEW INDUCTANCES ────────────────────────────────
{
  /**
   * A motor straight off a pin. Whatever the pin is doing, the driving-point
   * resistance can only ADD to the armature's own 85.7 Ω, so
   *
   *   τ  ≤  L/R  =  2 mH / 85.714 Ω  =  23.33 µs
   *   τ/STEPS_PER_TAU  ≤  0.467 µs   <  MIN_STEP = 20 µs
   *
   * so the engine is REQUIRED to clamp to the floor here, and the assertion is
   * the inequality rather than a captured number. That is not a defect:
   * backward Euler is L-stable, so h > τ collapses to the steady state instead
   * of ringing, and a 23 µs electrical rise is orders below anything a student
   * can watch. What the winding buys on a motor is the switch-off kick.
   */
  const motorDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('m', 'dc_motor', { load: 0 })],
    wires: [w(['m', '1'], ['uno', 'D9']), w(['m', '2'], ['uno', 'GND.1'])],
  }
  const cm = compile(motorDoc)
  const tauMotor = cm.circuit.smallestTimeConstant()
  const tauCeiling = HOBBY_MOTOR_6V.henries / (6 / 0.07)
  truth('a compiled motor makes its circuit reactive',
    cm.circuit.hasReactive, 'true', String(cm.circuit.hasReactive))
  truth('   and the probe measures a real time constant for it',
    tauMotor !== null && tauMotor > 0 && tauMotor <= tauCeiling,
    `0 < τ ≤ L/R = ${(tauCeiling * 1e6).toFixed(2)} µs`,
    tauMotor === null ? 'null' : `${(tauMotor * 1e6).toFixed(3)} µs`)
  const engM = new SimulationEngine(firmware('blink.hex'), motorDoc)
  engM.run(1000)
  near('   the engine steps it at the 20 µs floor, as τ/50 < 20 µs demands',
    (engM.snapshot().transientStep ?? 0) * 1e6, MIN_STEP * 1e6, 1e-9, 'µs')

  /**
   * A stepper is the case where the probe changes the answer. Each phase is
   * 50 Ω / 300 mH, and RLBranch clamps the external rTh at the winding's own R
   * (see its note), so a de-energised phase reports
   *
   *   τ = L/(R + R) = 300 mH / 100 Ω = 3.000 ms      h = τ/50 = 60 µs
   *
   * — three times the floor, i.e. the engine does a third of the work it would
   * do if a switched-off coil were allowed to demand the smallest step there is.
   */
  const stepperDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('u', 'uln2003'), placeP('s', 'stepper_28byj48')],
    wires: [
      w(['u', 'GND'], ['uno', 'GND.1']),
      w(['u', 'COM'], ['uno', '5V']),
      w(['s', 'COM'], ['uno', '5V']),
      w(['u', 'IN1'], ['uno', 'D8']),
      w(['u', 'OUT1'], ['s', 'A']),
      w(['u', 'OUT2'], ['s', 'B']),
      w(['u', 'OUT3'], ['s', 'C']),
      w(['u', 'OUT4'], ['s', 'D']),
    ],
  }
  const cs = compile(stepperDoc)
  truth('a compiled stepper contributes FOUR reactive windings, one per phase',
    [...cs.reactive.keys()].filter((k) => k.startsWith('s.phase')).length === 4,
    '4',
    [...cs.reactive.keys()].filter((k) => k.startsWith('s.phase')).join(',') || '(none)')
  cs.circuit.solve()
  const tauStep = cs.circuit.smallestTimeConstant() ?? 0
  near('   whose time constant is L/(R + R) = 3.000 ms with the rTh clamp',
    tauStep * 1e3,
    (STEPPER_28BYJ48.phaseHenries / (2 * STEPPER_28BYJ48.phaseOhms)) * 1e3,
    1e-9,
    'ms')
  const engS = new SimulationEngine(firmware('blink.hex'), stepperDoc)
  engS.run(1000)
  const hStep = engS.snapshot().transientStep ?? 0
  near('   so the engine steps a stepper at 60 µs, NOT at the floor',
    hStep * 1e6, stepFor(tauStep) * 1e6, 1e-9, 'µs')
  truth('   which is three times the floor — the probe is doing real work',
    hStep > MIN_STEP * 2, `> ${(MIN_STEP * 2e6).toFixed(0)} µs`, `${(hStep * 1e6).toFixed(2)} µs`)

  /**
   * A relay board's coil, likewise: 70 Ω / 50 mH de-energised gives
   * 50 mH/140 Ω = 357 µs under the same clamp. τ/50 = 7 µs is under the floor,
   * so a relay board runs at 20 µs — the price of the flyback being real.
   */
  const relayDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'relay_4ch', { activeLow: 1 })],
    wires: [
      w(['r', 'VCC'], ['uno', '5V']),
      w(['r', 'GND'], ['uno', 'GND.1']),
      w(['r', 'IN1'], ['uno', 'D7']),
      w(['r', 'COM1'], ['uno', 'GND.2']),
      w(['r', 'NO1'], ['uno', 'D2']),
    ],
  }
  const cr = compile(relayDoc)
  truth('a relay board contributes its coil as a reactive winding',
    cr.reactive.has('r.coil1'), 'r.coil1', [...cr.reactive.keys()].join(',') || '(none)')
  cr.circuit.solve()
  const tauRelay = cr.circuit.smallestTimeConstant() ?? 0
  near('   at τ = L/(R + R) = 357 µs with the coil driver off',
    tauRelay * 1e6,
    (RELAY_MODULE_4CH.coilHenries / (2 * RELAY_MODULE_4CH.coilOhms)) * 1e6,
    1e-6,
    'µs')
  truth('   which is under the floor once divided by 50, so a relay runs at 20 µs',
    stepFor(tauRelay) === MIN_STEP,
    `${(MIN_STEP * 1e6).toFixed(0)} µs`,
    `${(stepFor(tauRelay) * 1e6).toFixed(2)} µs`)
}

// ── 12.7 THE STALE CLAIMS ARE GONE FROM THE COMPILED LIMITATIONS ──────────────
//
// Four limitation strings told the student that a transient "needs transient
// simulation, which the interactive engine does not run yet". The engine has run
// one since `this.transient = this.compiled.circuit.hasReactive` landed. A false
// warning is its own kind of wrong answer, and it is asserted away here rather
// than merely deleted, so it cannot come back.
{
  const motorDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('m', 'dc_motor', { load: 0 })],
    wires: [w(['m', '1'], ['uno', 'D9']), w(['m', '2'], ['uno', 'GND.1'])],
  }
  const relayDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('r', 'relay_4ch', { activeLow: 1 })],
    wires: [
      w(['r', 'VCC'], ['uno', '5V']),
      w(['r', 'GND'], ['uno', 'GND.1']),
      w(['r', 'IN1'], ['uno', 'D7']),
      w(['r', 'COM1'], ['uno', 'GND.2']),
      w(['r', 'NO1'], ['uno', 'D2']),
    ],
  }
  const stepperDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('u', 'uln2003'), placeP('s', 'stepper_28byj48')],
    wires: [
      w(['u', 'GND'], ['uno', 'GND.1']),
      w(['u', 'COM'], ['uno', '5V']),
      w(['s', 'COM'], ['uno', '5V']),
      w(['u', 'IN1'], ['uno', 'D8']),
      w(['u', 'OUT1'], ['s', 'A']),
      w(['u', 'OUT2'], ['s', 'B']),
      w(['u', 'OUT3'], ['s', 'C']),
      w(['u', 'OUT4'], ['s', 'D']),
    ],
  }
  const bridgeDoc: CircuitDoc = {
    parts: [placeP('uno', 'arduino_uno'), placeP('l', 'l298n'), placeP('m', 'dc_motor')],
    wires: [
      w(['l', 'VSS'], ['uno', '5V']),
      w(['l', 'GND'], ['uno', 'GND.1']),
      w(['l', 'VS'], ['uno', '5V']),
      w(['l', 'ENA'], ['uno', 'D9']),
      w(['l', 'IN1'], ['uno', 'D8']),
      w(['l', 'IN2'], ['uno', 'D7']),
      w(['l', 'OUT1'], ['m', '1']),
      w(['l', 'OUT2'], ['m', '2']),
    ],
  }
  const docs: Array<[string, CircuitDoc]> = [
    ['motor', motorDoc],
    ['relay', relayDoc],
    ['stepper', stepperDoc],
    ['l298n', bridgeDoc],
  ]
  for (const [name, doc] of docs) {
    const lim = compile(doc).limitations
    truth(`${name}: no limitation still claims the engine cannot run a transient`,
      !lim.some((l) => /does not run yet/i.test(l) || /solved at (a|its) /i.test(l)),
      'no stale DC-only claim',
      lim.join(' | ') || '(none)')
  }
  const l298 = compile(bridgeDoc).limitations
  truth('l298n: the flyback-diodes-never-conduct warning is gone entirely',
    !l298.some((l) => /flyback/i.test(l)),
    'no flyback warning',
    l298.join(' | ') || '(none)')
  const relay = compile(relayDoc).limitations
  truth('relay: but the PULL-IN DELAY warning survives — mechanical, not electrical',
    relay.some((l) => /pull-in/i.test(l) && /bounce/i.test(l)),
    'still warns about pull-in and bounce',
    relay.join(' | ') || '(none)')
  const stepper = compile(stepperDoc).limitations
  truth('stepper: and the lost-steps warning survives for the same reason',
    stepper.some((l) => /inductance/i.test(l) && /losing steps/i.test(l)),
    'inductance modelled, torque still not',
    stepper.join(' | ') || '(none)')
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
