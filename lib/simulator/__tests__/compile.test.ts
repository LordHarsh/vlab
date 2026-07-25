/**
 * Regression tests for the DOCUMENT → CIRCUIT path (model/compile.ts).
 *
 * solver.test.ts covers the raw Circuit API; document.test.ts covers ids and
 * structure. Neither one checks that a CircuitDoc a student could actually build
 * turns into the right electrical network — which is where silent wrongness
 * hides, because a mis-derived net produces a perfectly convergent solve of the
 * wrong circuit.
 *
 * Every expected value below is derived from closed-form circuit theory written
 * out in the comment above it, or from `ledCurrent()` — a bisection on the exact
 * scalar KVL equation, which is an independent algorithm from Newton on a
 * linearised companion model. Nothing is asserted against the solver's own
 * output.
 *
 * TOLERANCE RULE, stated once. The engine deliberately stamps gmin = 1e-12 S
 * from every node to ground, so a comparison against IDEAL theory carries an
 * error of order gmin*R. Ideal comparisons therefore get tol = 4*gmin*Rmax;
 * comparisons against the engine's own declared model (gmin included) get 1e-9.
 * Nonlinear results get the solver's own configured reltol.
 *
 * Run: npx tsx lib/simulator/__tests__/compile.test.ts
 */

import fs from 'node:fs'
import path from 'node:path'
import { analogDeviceStates } from '../analog-state'
import { compile } from '../model/compile'
import type { CircuitDoc, DocWire, PlacedPart } from '../model/document'
import { EXPERIMENT_01 } from '../model/examples'
import { PART_LIBRARY, getPart } from '../model/parts'
import {
  probedPartTypes,
  propReachability,
  propReachabilityProblems,
} from '../model/prop-reachability'
import { LED_RED, LED_SERIES_R, MIN_RESISTANCE } from '../devices'
import { DEFAULT_OPTIONS, VT } from '../types'

const GMIN = DEFAULT_OPTIONS.gmin

/**
 * The AVR pin model from engine.ts §2.6, restated here on purpose.
 *
 * engine.ts owns these as module-private constants; a test that imported them
 * could not detect a change to them. Restating them means this file asserts the
 * pin behaves like a 5 V source behind 25 Ω, which is the electrical claim the
 * experiments depend on, not merely that it behaves like whatever engine.ts
 * currently says.
 */
const R_DRIVE = 25
const R_PULLUP = 20_000
const G_FLOAT = 1e-8
const VCC = 5

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
  if (!Number.isFinite(x)) return String(x)
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return x.toExponential(6)
  return x.toPrecision(10)
}

function record(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass, note })
}

/** Assert against a theory value, absolute tolerance. NaN/Infinity always fails. */
function near(name: string, actual: number, expected: number, tol: number, unit = 'V'): void {
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tol
  record(name, pass, `${fmt(expected)} ${unit} ±${fmt(tol)}`, `${fmt(actual)} ${unit}`,
    pass ? undefined : `err ${Math.abs(actual - expected).toExponential(3)} > tol ${tol.toExponential(3)}`)
}

/** Assert against a theory value, relative tolerance. */
function nearRel(name: string, actual: number, expected: number, rel: number, unit = 'A'): void {
  const scale = Math.max(Math.abs(actual), Math.abs(expected))
  const r = scale === 0 ? 0 : Math.abs(actual - expected) / scale
  const pass = Number.isFinite(actual) && r <= rel
  record(name, pass, `${fmt(expected)} ${unit} (rel ≤ ${rel.toExponential(1)})`,
    `${fmt(actual)} ${unit}, rel ${r.toExponential(2)}`,
    pass ? undefined : `relative error ${r.toExponential(2)} exceeds ${rel.toExponential(1)}`)
}

function truth(name: string, pass: boolean, expected: string, actual: string, note?: string): void {
  record(name, pass, expected, actual, note)
}

// ─── Document builders ────────────────────────────────────────────────────────

let wireSeq = 0
function wire(from: [string, string], to: [string, string]): DocWire {
  return {
    id: `tw${++wireSeq}`,
    from: { partId: from[0], pinId: from[1] },
    to: { partId: to[0], pinId: to[1] },
    color: '#111827',
  }
}
function place(id: string, type: string, props: Record<string, number | string> = {}): PlacedPart {
  return { id, type, x: 0, y: 0, rotation: 0, props }
}

type Drive = 'high' | 'low' | 'float' | 'pullup'

/**
 * Compile, set every MCU pin to a Norton pair matching `drives`, and solve.
 * This is exactly what SimulationEngine.evaluate() does with the pin states.
 */
function solveDoc(doc: CircuitDoc, drives: Record<string, Drive> = {}) {
  const c = compile(doc)
  for (const [name, port] of c.mcuPorts) {
    switch (drives[name] ?? 'float') {
      case 'high': port.set(1 / R_DRIVE, VCC / R_DRIVE); break
      case 'low': port.set(1 / R_DRIVE, 0); break
      case 'pullup': port.set(1 / R_PULLUP, VCC / R_PULLUP); break
      default: port.set(G_FLOAT, 0)
    }
  }
  return { c, res: c.circuit.solve() }
}

// ─── Independent oracle: the LED, by bisection ────────────────────────────────

/**
 * Thermal voltage of the LED junction. Derived from the published model
 * parameters, not read back from any Diode instance.
 */
const VTE = LED_RED.n * VT // 1.8 × 0.025852 = 0.0465336 V

/**
 * Solve  V = I·Rtot + n·Vt·ln(I/Is + 1)  for I.
 *
 * Bisection on a strictly increasing function: no derivative, no linearisation,
 * no companion model — a genuinely different algorithm from the solver's Newton
 * loop, so agreement between them is evidence rather than tautology.
 */
function ledCurrent(V: number, Rtot: number): number {
  const f = (I: number) => I * Rtot + VTE * Math.log(I / LED_RED.is + 1) - V
  let lo = 0
  let hi = 20
  for (let k = 0; k < 400; k++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}
/** Junction voltage at a given current. */
const ledVd = (I: number) => VTE * Math.log(I / LED_RED.is + 1)

// ══════════════════════════════════════════════════════════════════════════════
group('1. breadboard topology')
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Which net root each breadboard hole lands on, for a board sitting alone in a
 * document. Inert breadboard-only nets get no matrix row, so this reads the
 * `nets` grouping rather than `netOf`.
 */
function holeRoots(): Map<string, number> {
  const bare = compile({ parts: [place('bb', 'breadboard')], wires: [] })
  const m = new Map<string, number>()
  bare.nets.forEach((n, i) => n.pins.forEach((p) => m.set(p.pinId, i)))
  return m
}

/**
 * The topology contract, expressed over a bus list so it can be run against a
 * deliberately broken board as well (see the teeth section).
 */
function topologyVerdict(buses: string[][]): { channel: boolean; halfRows: boolean; rails: boolean } {
  const root = new Map<string, number>()
  buses.forEach((b, i) => b.forEach((p) => root.set(p, i)))
  let channel = true
  let halfRows = true
  for (let c = 1; c <= 30; c++) {
    const lower = ['a', 'b', 'c', 'd', 'e'].map((r) => root.get(r + c))
    const upper = ['f', 'g', 'h', 'i', 'j'].map((r) => root.get(r + c))
    if (new Set(lower).size !== 1 || new Set(upper).size !== 1) halfRows = false
    if (lower[0] === upper[0]) channel = false
  }
  const railRoots = ['tp', 'tn', 'bp', 'bn'].map((r) => root.get(r + '1'))
  const rails =
    new Set(railRoots).size === 4 &&
    ['tp', 'tn', 'bp', 'bn'].every((r) => root.get(r + '1') === root.get(r + '30')) &&
    !railRoots.includes(root.get('a1')) &&
    !railRoots.includes(root.get('j1'))
  return { channel, halfRows, rails }
}

{
  const roots = holeRoots()
  const bb = getPart('breadboard')

  truth('exposes 30 columns × 10 rows + 4 × 30 rail holes', bb.pins.length === 420,
    '420 tie points', String(bb.pins.length))

  // The centre channel. A connection to a5 and one to j5 are NOT connected —
  // this is the single most consequential fact about a breadboard, and getting
  // it wrong makes a broken build appear to work.
  truth('a5 and j5 are different nets', roots.get('a5') !== roots.get('j5'),
    'different roots', `a5=${roots.get('a5')} j5=${roots.get('j5')}`)
  truth('e5 and f5 are different nets (across the channel)', roots.get('e5') !== roots.get('f5'),
    'different roots', `e5=${roots.get('e5')} f5=${roots.get('f5')}`)

  const v = topologyVerdict(bb.buses ?? [])
  truth('the channel separates all 30 columns', v.channel, '30/30 separated', v.channel ? '30/30' : 'MERGED')
  truth('a–e and f–j are 5-hole strips in all 30 columns', v.halfRows, '5-hole strips',
    v.halfRows ? 'yes' : 'BROKEN')
  truth('adjacent columns are separate', roots.get('a5') !== roots.get('a6'),
    'different roots', `${roots.get('a5')} vs ${roots.get('a6')}`)

  // Power rails: full length of the board, four of them, none of them touching
  // the tie-point rows.
  truth('four rails, each spanning column 1..30, all distinct and disjoint from the rows',
    v.rails, '4 full-length distinct rails', v.rails ? 'yes' : 'BROKEN')
  truth('+ rail spans the board', roots.get('tp1') === roots.get('tp30'),
    'tp1 == tp30', `${roots.get('tp1')} vs ${roots.get('tp30')}`)
  truth('+ and − rails are not the same net', roots.get('tp1') !== roots.get('tn1'),
    'different roots', `tp=${roots.get('tp1')} tn=${roots.get('tn1')}`)

  // Teeth: the same predicate must REJECT a board whose banks were merged.
  const merged: string[][] = []
  for (let c = 1; c <= 30; c++) {
    merged.push(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((r) => `${r}${c}`))
  }
  for (const rail of ['tp', 'tn', 'bp', 'bn']) {
    merged.push(Array.from({ length: 30 }, (_, i) => `${rail}${i + 1}`))
  }
  const mv = topologyVerdict(merged)
  truth('teeth: the channel check rejects a board with merged banks', !mv.channel,
    'rejected', mv.channel ? 'ACCEPTED — the check has no teeth' : 'rejected')

  // Teeth: and it must reject a board whose rails are one net.
  const shortedRails = (bb.buses ?? []).filter((b) => !/^(tp|tn|bp|bn)/.test(b[0]))
  shortedRails.push(['tp', 'tn', 'bp', 'bn'].flatMap((r) => Array.from({ length: 30 }, (_, i) => `${r}${i + 1}`)))
  truth('teeth: the rail check rejects rails shorted together', !topologyVerdict(shortedRails).rails,
    'rejected', topologyVerdict(shortedRails).rails ? 'ACCEPTED — no teeth' : 'rejected')
}

// ══════════════════════════════════════════════════════════════════════════════
group('2. experiment 01 — D13 → 220 Ω → LED → GND on a breadboard')
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Hand derivation, used by everything in this group.
 *
 * A pin driven HIGH is stamped as a Norton pair (g = 1/25 S, i = 5/25 A), whose
 * Thévenin equivalent is a 5 V source behind 25 Ω. The LED is a diode plus a
 * 2 Ω bulk resistance. So the loop is
 *     5 = I·(25 + 220 + 2) + n·Vt·ln(I/Is + 1)
 * which the bisection oracle solves as I ≈ 12.394 mA, with the LED terminal
 * voltage Vf = Vd(I) + 2·I ≈ 1.963 V.
 */
const I_EXP01 = ledCurrent(VCC, R_DRIVE + 220 + LED_SERIES_R)
const VF_EXP01 = ledVd(I_EXP01) + I_EXP01 * LED_SERIES_R

{
  const { c, res } = solveDoc(EXPERIMENT_01, { D13: 'high' })
  truth('the authored starter circuit solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  truth('no problems reported for a correct build', c.problems.length === 0, '[]', JSON.stringify(c.problems))
  truth('stays inside the ~15 unknown budget', c.unknowns <= 15, '≤ 15', String(c.unknowns))

  nearRel('LED current with D13 HIGH', c.leds.get('led1')!.current, I_EXP01, DEFAULT_OPTIONS.reltol)

  const anode = c.netOf.get('led1 A')!
  const pin = c.netOf.get('uno D13')!
  near('LED forward voltage', res.voltages[anode], VF_EXP01, 1e-3)
  // The pin's own 25 Ω drops I·25, so the driven node sits below the rail.
  near('D13 node voltage = 5 − 25·I', res.voltages[pin], VCC - I_EXP01 * R_DRIVE, 1e-3)

  /**
   * Physical plausibility, asserted WITHOUT the model constants: a red LED at
   * 10–20 mA drops roughly 1.8–2.2 V. This is the check that survives someone
   * editing LED_RED, which the oracle above cannot catch because it shares
   * those parameters.
   */
  truth('forward drop is physical for a red LED at ~12 mA',
    res.voltages[anode] > 1.8 && res.voltages[anode] < 2.2 &&
    c.leds.get('led1')!.current > 0.010 && c.leds.get('led1')!.current < 0.020,
    'Vf ∈ 1.8–2.2 V at 10–20 mA',
    `${res.voltages[anode].toFixed(4)} V at ${(c.leds.get('led1')!.current * 1000).toFixed(2)} mA`)
  truth('teeth: the plausibility band rejects a 1.2 V and a 3.0 V drop',
    !(1.2 > 1.8 && 1.2 < 2.2) && !(3.0 > 1.8 && 3.0 < 2.2), 'both rejected', 'both rejected')

  /**
   * Kirchhoff at the anode node. The resistor current and the diode current are
   * recomputed independently from the SAME converged voltages, so they may
   * differ only by the gmin leak (Vanode·gmin ≈ 2 pA) plus the Newton residual
   * the configured reltol allows. Anything larger is a mis-stamped device.
   */
  const kcl = c.meters.get('r1')!.current - c.leds.get('led1')!.current
  near('KCL at the anode: I(220 Ω) − I(LED)', kcl, res.voltages[anode] * GMIN,
    DEFAULT_OPTIONS.reltol * I_EXP01, 'A')

  // The breadboard strips, not the wires, are what connect this circuit.
  truth('a5..e5 all carry the D13 net',
    ['a5', 'b5', 'c5', 'd5', 'e5'].every((h) => c.netOf.get('bb ' + h) === pin),
    'all == D13 net', ['a5', 'b5', 'c5', 'd5', 'e5'].map((h) => c.netOf.get('bb ' + h)).join(','))
  truth('f5..j5 carry nothing (other side of the channel)',
    ['f5', 'g5', 'h5', 'i5', 'j5'].every((h) => c.netOf.get('bb ' + h) === undefined),
    'no net', ['f5', 'g5', 'h5', 'i5', 'j5'].map((h) => String(c.netOf.get('bb ' + h))).join(','))
}

{
  // Pin LOW: Thévenin 0 V behind 25 Ω, so the junction sees 0 V and I = Is(e⁰−1) = 0.
  const { c, res } = solveDoc(EXPERIMENT_01, { D13: 'low' })
  truth('LED is dark with D13 LOW', res.ok && Math.abs(c.leds.get('led1')!.current) < 1e-12,
    '≈ 0 A', c.leds.get('led1')!.current.toExponential(3) + ' A')
}

{
  /**
   * The same build wired WRONGLY across the centre channel: D13 goes to j5 while
   * the resistor stays on b5. The two banks are electrically separate, so no
   * current can flow and the LED must be dark. If this ever lights, the netlist
   * has merged the banks.
   */
  const broken: CircuitDoc = {
    ...EXPERIMENT_01,
    wires: EXPERIMENT_01.wires.map((x) =>
      x.id === 'w1' ? { ...x, to: { partId: 'bb', pinId: 'j5' } } : x),
  }
  const { c, res } = solveDoc(broken, { D13: 'high' })
  truth('a build wired across the channel does not light',
    res.ok && Math.abs(c.leds.get('led1')!.current) < 1e-12,
    '≈ 0 A', c.leds.get('led1')!.current.toExponential(3) + ' A')
  truth('and D13 is not even given a net', c.netOf.get('uno D13') === undefined,
    'undefined', String(c.netOf.get('uno D13')))

  // A deliberate jumper across the channel restores it.
  const bridged: CircuitDoc = { ...broken, wires: [...broken.wires, wire(['bb', 'j5'], ['bb', 'a5'])] }
  const fixed = solveDoc(bridged, { D13: 'high' })
  nearRel('a j5→a5 jumper restores the circuit', fixed.c.leds.get('led1')!.current, I_EXP01,
    DEFAULT_OPTIONS.reltol)
}

// ══════════════════════════════════════════════════════════════════════════════
group('3. traffic light — three LEDs on three pins')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Three independent branches sharing only ideal ground. Each pin is its own
   * Thévenin source, so every lit branch must carry EXACTLY the single-LED
   * current — any difference is cross-talk through a net that should not exist.
   */
  const parts: PlacedPart[] = [place('uno', 'arduino_uno')]
  const wires: DocWire[] = []
  const pins = ['D8', 'D9', 'D10']
  pins.forEach((p, i) => {
    parts.push(place('r' + i, 'resistor', { ohms: 220 }), place('led' + i, 'led'))
    wires.push(wire(['uno', p], ['r' + i, '1']), wire(['r' + i, '2'], ['led' + i, 'A']),
      wire(['led' + i, 'C'], ['uno', 'GND.' + ((i % 3) + 1)]))
  })

  const one = solveDoc({ parts, wires }, { D8: 'high', D9: 'low', D10: 'float' })
  truth('red/amber/green build solves', one.res.ok, 'ok:true', `ok:${one.res.ok} ${one.res.error ?? ''}`)
  nearRel('lit LED (D8 HIGH)', one.c.leds.get('led0')!.current, I_EXP01, DEFAULT_OPTIONS.reltol)
  truth('LED on a LOW pin is dark', Math.abs(one.c.leds.get('led1')!.current) < 1e-12,
    '≈ 0 A', one.c.leds.get('led1')!.current.toExponential(3) + ' A')
  truth('LED on a floating pin is dark', Math.abs(one.c.leds.get('led2')!.current) < 1e-12,
    '≈ 0 A', one.c.leds.get('led2')!.current.toExponential(3) + ' A')
  truth('three GND pins are one net', one.c.netOf.get('uno GND.1') === 0 &&
    one.c.netOf.get('uno GND.3') === 0, 'all net 0',
    `${one.c.netOf.get('uno GND.1')},${one.c.netOf.get('uno GND.3')}`)

  const all = solveDoc({ parts, wires }, { D8: 'high', D9: 'high', D10: 'high' })
  for (let i = 0; i < 3; i++) {
    nearRel(`all three lit — LED${i} carries the same current`, all.c.leds.get('led' + i)!.current,
      I_EXP01, DEFAULT_OPTIONS.reltol)
  }
  truth('three-LED build stays inside the unknown budget', all.c.unknowns <= 15, '≤ 15', String(all.c.unknowns))
}

// ══════════════════════════════════════════════════════════════════════════════
group('4. DHT11 data line with its 10 kΩ pull-up')
// ══════════════════════════════════════════════════════════════════════════════
{
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('dht', 'dht11'), place('rp', 'resistor', { ohms: 10000 })],
    wires: [
      wire(['dht', 'VCC'], ['uno', '5V']),
      wire(['dht', 'GND'], ['uno', 'GND.1']),
      wire(['dht', 'DATA'], ['uno', 'D2']),
      wire(['rp', '1'], ['dht', 'DATA']),
      wire(['rp', '2'], ['uno', '5V']),
    ],
  }
  const { c, res } = solveDoc(doc, { D2: 'float' })
  const data = c.netOf.get('dht DATA')!

  /**
   * Idle. Everything on the DATA node, as conductances to ground:
   *   pull-up   1/10 kΩ  = 1e-4 S, driven to 5 V  → injects 5e-4 A
   *   MCU input G_FLOAT  = 1e-8 S
   *   sensor released    = 1e-9 S   (NortonPort in compile.ts)
   *   gmin               = 1e-12 S
   * V = 5e-4 / (1e-4 + 1e-8 + 1e-9 + 1e-12) = 4.999450010 V
   */
  const idle = 5e-4 / (1e-4 + G_FLOAT + 1e-9 + GMIN)
  truth('DHT11 build solves', res.ok, 'ok:true', `ok:${res.ok} ${res.error ?? ''}`)
  near('DATA idles high through the pull-up', res.voltages[data], idle, 1e-9)
  truth('and reads as a logic HIGH (VIH = 0.6·Vcc = 3 V)', res.voltages[data] > 3,
    '> 3 V', res.voltages[data].toFixed(6) + ' V')
  // Pull-up current = (5 − V)/10 kΩ = 5.4999e-8 A. Sign follows pin 1 → pin 2,
  // and this wire runs DATA → 5 V, so the reported value is negative.
  near('pull-up current magnitude', Math.abs(c.meters.get('rp')!.current), (5 - idle) / 10000, 1e-12, 'A')

  /**
   * Sensor asserts the line: its Norton port becomes 1/40 S (R_PULLDOWN) to
   * ground. V = 5e-4 / (1e-4 + 1/40 + 1e-8 + 1e-12) = 0.019920 V.
   */
  c.behavioural[0].ports.DATA.set(1 / 40, 0)
  const low = c.circuit.solve()
  near('DATA pulled low by the sensor', low.voltages[data],
    5e-4 / (1e-4 + 1 / 40 + G_FLOAT + GMIN), 1e-9)
  truth('and reads as a logic LOW (the DHT11 model uses 1.5 V)',
    low.voltages[data] < 1.5, '< 1.5 V', low.voltages[data].toFixed(6) + ' V')
}

// ══════════════════════════════════════════════════════════════════════════════
group('5. potentiometer → analogRead')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The track is split by the wiper: lo = 10 kΩ·pos between pin 1 and the wiper,
   * hi = 10 kΩ·(1−pos) between the wiper and pin 3, each floored at 0.5 Ω. With
   * pin 1 at ground and pin 3 at 5 V the ideal wiper voltage is 5·pos, and the
   * A0 input model (1e-8 S) plus gmin load it slightly:
   *     Vw = 5·(1/hi) / (1/hi + 1/lo + 1e-8 + 1e-12)
   */
  for (const pos of [0, 25, 50, 75, 100]) {
    const doc: CircuitDoc = {
      parts: [place('uno', 'arduino_uno'), place('pot', 'potentiometer', { position: pos })],
      wires: [
        wire(['pot', '1'], ['uno', 'GND.1']),
        wire(['pot', '3'], ['uno', '5V']),
        wire(['pot', '2'], ['uno', 'A0']),
      ],
    }
    const { c, res } = solveDoc(doc)
    const lo = Math.max(10000 * (pos / 100), 0.5)
    const hi = Math.max(10000 * (1 - pos / 100), 0.5)
    const vw = 5 * (1 / hi) / (1 / hi + 1 / lo + G_FLOAT + GMIN)
    const w = c.netOf.get('pot 2')!
    near(`knob ${pos}% → wiper voltage`, res.voltages[w], vw, 1e-9)

    // The knob must track the ideal divider: within 1 LSB of a 10-bit ADC.
    const counts = Math.round((res.voltages[w] / 5) * 1023)
    const ideal = Math.round((pos / 100) * 1023)
    truth(`knob ${pos}% → analogRead within 1 LSB of 5·pos`, Math.abs(counts - ideal) <= 1,
      `${ideal} ±1`, String(counts))
  }

  // Direction: turning the knob up must raise the wiper, not lower it. A swapped
  // lo/hi would still pass every symmetric check above at 50%.
  const at25 = solveDoc({
    parts: [place('uno', 'arduino_uno'), place('pot', 'potentiometer', { position: 25 })],
    wires: [wire(['pot', '1'], ['uno', 'GND.1']), wire(['pot', '3'], ['uno', '5V']),
      wire(['pot', '2'], ['uno', 'A0'])],
  })
  near('knob at 25% reads 1.25 V, not 3.75 V', at25.res.voltages[at25.c.netOf.get('pot 2')!], 1.25, 1e-3)

  // A0 really is registered as an ADC channel.
  truth('the wiper net is published to the ADC as A0',
    at25.c.analogNets.get('A0') === at25.c.netOf.get('pot 2'),
    'analogNets.A0 == wiper net',
    `${at25.c.analogNets.get('A0')} vs ${at25.c.netOf.get('pot 2')}`)
}

// ══════════════════════════════════════════════════════════════════════════════
group('6. push button with the internal pull-up')
// ══════════════════════════════════════════════════════════════════════════════
{
  const mk = (pressed: number): CircuitDoc => ({
    parts: [place('uno', 'arduino_uno'), place('btn', 'push_button', { pressed })],
    wires: [wire(['uno', 'D2'], ['btn', '1a']), wire(['btn', '2a'], ['uno', 'GND.1'])],
  })

  // Released: switch = 1e12 Ω. Pull-up 20 kΩ to 5 V, plus gmin at the node and
  // through the open switch. V = 5·(1/20 kΩ)/(1/20 kΩ + 1e-12 + 1e-12) ≈ 5.0 V.
  const up = solveDoc(mk(0), { D2: 'pullup' })
  const nUp = up.c.netOf.get('uno D2')!
  near('released → held at Vcc by the pull-up', up.res.voltages[nUp],
    5 * (1 / R_PULLUP) / (1 / R_PULLUP + 1e-12 + GMIN), 1e-9)
  truth('released reads HIGH', up.res.voltages[nUp] > 3, '> 3 V', up.res.voltages[nUp].toFixed(6))

  // Pressed: switch = 0.05 Ω to ground.
  // V = 5·(1/20 kΩ)/(1/20 kΩ + 1/0.05 + 1e-12) = 1.25e-5 V.
  const down = solveDoc(mk(1), { D2: 'pullup' })
  const nDn = down.c.netOf.get('uno D2')!
  near('pressed → pulled to ground', down.res.voltages[nDn],
    5 * (1 / R_PULLUP) / (1 / R_PULLUP + 1 / 0.05 + GMIN), 1e-9)
  truth('pressed reads LOW', down.res.voltages[nDn] < 1.5, '< 1.5 V', down.res.voltages[nDn].toExponential(3))

  // The two legs of each side are bridged inside the switch body.
  truth('1a and 1b are the same net', up.c.netOf.get('btn 1a') === up.c.netOf.get('btn 1b'),
    'same net', `${up.c.netOf.get('btn 1a')} vs ${up.c.netOf.get('btn 1b')}`)
}

// ══════════════════════════════════════════════════════════════════════════════
group('7. LED across the resistor palette')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Every resistance the inspector offers, driven from the 5 V rail.
   *   5 = I·(R + 2) + n·Vt·ln(I/Is + 1)
   * Currents, from the bisection oracle: 29.62 / 13.77 / 9.26 / 6.55 / 3.12 /
   * 1.44 / 0.68 / 0.32 / 0.033 mA for 100 Ω … 100 kΩ.
   */
  for (const R of [100, 220, 330, 470, 1000, 2200, 4700, 10000, 100000]) {
    const doc: CircuitDoc = {
      parts: [place('uno', 'arduino_uno'), place('r1', 'resistor', { ohms: R }), place('led1', 'led')],
      wires: [wire(['uno', '5V'], ['r1', '1']), wire(['r1', '2'], ['led1', 'A']),
        wire(['led1', 'C'], ['uno', 'GND.1'])],
    }
    const { c, res } = solveDoc(doc)
    const I = ledCurrent(VCC, R + LED_SERIES_R)
    nearRel(`${R} Ω → LED current`, c.leds.get('led1')!.current, I, DEFAULT_OPTIONS.reltol)

    const va = res.voltages[c.netOf.get('led1 A')!]
    near(`${R} Ω → LED forward voltage`, va, ledVd(I) + I * LED_SERIES_R, 1e-3)

    /**
     * KCL at the anode. Allowed slack is the gmin leak plus the Newton residual
     * the configured reltol permits on the branch current; measured worst across
     * this sweep is ~1.6e-4 relative.
     */
    near(`${R} Ω → KCL at the anode`, c.meters.get('r1')!.current - c.leds.get('led1')!.current,
      va * GMIN, DEFAULT_OPTIONS.reltol * I, 'A')
  }

  // Reverse-biased: Is = 1e-20 A, so the reverse current is −Is and the LED
  // must not light.
  const rev: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: 220 }), place('led', 'led')],
    wires: [wire(['uno', '5V'], ['r', '1']), wire(['r', '2'], ['led', 'C']),
      wire(['led', 'A'], ['uno', 'GND.1'])],
  }
  const r = solveDoc(rev)
  truth('a backwards LED does not light', r.res.ok && r.c.leds.get('led')!.current <= 0,
    '≤ 0 A', r.c.leds.get('led')!.current.toExponential(3) + ' A')
}

// ══════════════════════════════════════════════════════════════════════════════
group('8. destructive and malformed circuits')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * A 0 Ω resistor is a PALETTE OPTION, so a student can select it. It is
   * clamped to MIN_RESISTANCE = 1e-3 Ω, which across 5 V is 5000 A and 25 kW.
   * The numbers are right; the point of the fault list is that the engine says
   * so out loud instead of returning them silently.
   */
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r0', 'resistor', { ohms: 0 })],
    wires: [wire(['uno', '5V'], ['r0', '1']), wire(['r0', '2'], ['uno', 'GND.1'])],
  }
  const { c, res } = solveDoc(doc)
  nearRel('0 Ω across 5 V draws 5/MIN_RESISTANCE', Math.abs(c.meters.get('r0')!.current),
    VCC / MIN_RESISTANCE, 1e-9)
  truth('and raises a short_circuit fault', res.faults.some((f) => f.kind === 'short_circuit'),
    'short_circuit', JSON.stringify(res.faults.map((f) => f.kind)))
  truth('and an over_power fault', res.faults.some((f) => f.kind === 'over_power'),
    'over_power', JSON.stringify(res.faults.map((f) => f.kind)))

  // Invalid resistances are REJECTED, never reinterpreted — a clamped negative
  // resistance would be a silent 1 mΩ short returning a plausible 0 V.
  for (const bad of [-100, NaN, Infinity, 'abc'] as Array<number | string>) {
    const d: CircuitDoc = {
      parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: bad })],
      wires: [wire(['uno', '5V'], ['r', '1']), wire(['r', '2'], ['uno', 'GND.1'])],
    }
    const out = solveDoc(d)
    truth(`ohms = ${String(bad)} → ok:false`, !out.res.ok, 'ok:false',
      `ok:${out.res.ok} "${out.res.error ?? ''}"`)
  }

  // Two ideal sources on one net (5 V wired to 3.3 V) must not silently succeed.
  const clash: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: 1000 })],
    wires: [wire(['uno', '5V'], ['uno', '3.3V']), wire(['uno', '5V'], ['r', '1']),
      wire(['r', '2'], ['uno', 'GND.1'])],
  }
  const cl = solveDoc(clash)
  truth('5 V wired to 3.3 V → ok:false', !cl.res.ok, 'ok:false', `ok:${cl.res.ok} "${cl.res.error ?? ''}"`)

  // A circuit with no ground at all is called out before solving.
  const gnd = compile({
    parts: [place('r1', 'resistor', { ohms: 220 }), place('r2', 'resistor', { ohms: 220 })],
    wires: [wire(['r1', '2'], ['r2', '1'])],
  })
  truth('a circuit with no ground is flagged', gnd.problems.some((p) => /ground/i.test(p)),
    'a ground problem', JSON.stringify(gnd.problems))
}

// ══════════════════════════════════════════════════════════════════════════════
group('9. capacitor honesty')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * A capacitor is now a REAL reactive element: both engines advance it with
   * backward-Euler steps synchronised to the MCU clock (engine.ts stepTransient,
   * pico/engine.ts). So the "charging and timing are not simulated" banner that
   * this group used to require is gone, and its ABSENCE is what is asserted now
   * — leaving a warning up after it stopped being true is its own dishonesty,
   * and it is the kind that survives for years because nothing tests for it.
   *
   * What has NOT changed is the DC path. A plain `solve()` still stamps the cap
   * as a 1e12 Ω open, because that is its true steady state, so every caller
   * that only ever solves an operating point is unaffected. Both halves are
   * pinned below.
   */
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: 10000 }),
      place('c', 'capacitor', { microfarads: 100 })],
    wires: [wire(['uno', '5V'], ['r', '1']), wire(['r', '2'], ['c', '1']),
      wire(['c', '2'], ['uno', 'GND.1'])],
  }
  const { c, res } = solveDoc(doc)
  truth('a capacitor no longer carries a "not simulated" limitation', c.limitations.length === 0,
    '[]', JSON.stringify(c.limitations))
  truth('the compiled circuit is flagged reactive, so the engines step it in time',
    c.circuit.hasReactive, 'true', String(c.circuit.hasReactive))
  truth('the capacitor is exposed by part id, so a rewire can carry its charge',
    c.reactive.get('c') !== undefined, 'a reactive device', String(c.reactive.get('c')?.id))
  truth('the capacitor is metered, so its current reaches the readout',
    c.meters.get('c') !== undefined, 'a meter', String(c.meters.get('c')?.id))

  // Node between the resistor and the cap: 1e-4 S to 5 V, 1e-12 S (cap) plus
  // 1e-12 S (gmin) to ground. V = 5e-4/(1e-4 + 2e-12) = 4.99999990 V.
  near('a capacitor is STILL an open circuit at DC', res.voltages[c.netOf.get('c 1')!],
    5e-4 / (1e-4 + 1e-12 + GMIN), 1e-7)

  // τ = R·C measured as a driving-point resistance, not read off any document
  // field: the cap sees the 10 kΩ back to the (small-signal short) 5 V rail, so
  // τ = 10e3 × 100e-6 = 1.0 s. This is the number that sizes the engine's step.
  const tau = c.circuit.smallestTimeConstant()
  near('the driving-point probe recovers τ = R·C = 1.0 s', tau ?? NaN, 1.0, 1e-3, 's')

  // A circuit with no reactive part has no time constant to report, and must not
  // invent one — the engines read null as "solve a DC operating point".
  const none = compile(EXPERIMENT_01)
  truth('a circuit with no capacitor carries no limitation', none.limitations.length === 0,
    '[]', JSON.stringify(none.limitations))
  truth('a purely resistive circuit reports no time constant',
    none.circuit.smallestTimeConstant() === null, 'null', String(none.circuit.smallestTimeConstant()))
  truth('a purely resistive circuit is not flagged reactive', !none.circuit.hasReactive,
    'false', String(none.circuit.hasReactive))
}

// ══════════════════════════════════════════════════════════════════════════════
group('10. numerical constants stay mutually consistent')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * MIN_RESISTANCE and gmin bracket the conductance range the MNA matrix has to
   * hold at once: 1/MIN_RESISTANCE at the top, gmin at the bottom. LU with
   * partial pivoting loses whatever falls below the pivot's last bit, so the
   * ratio must stay inside double precision's 1/eps ≈ 4.5e15.
   *
   * At 1e-3 Ω and 1e-12 S the ratio is 1e15 — inside the limit, but with only
   * ~4.5x headroom. This assertion exists so that lowering MIN_RESISTANCE or
   * lowering gmin "just a bit" trips a test rather than quietly returning wrong
   * node voltages with ok:true. Measured: a divider bridged by a 0 Ω resistor
   * is accurate to 1.3e-5 at 1 GΩ and 2.3e-2 at 1 TΩ.
   */
  const range = (1 / MIN_RESISTANCE) / GMIN
  truth('conductance range 1/MIN_RESISTANCE ÷ gmin fits in double precision',
    range <= 1 / Number.EPSILON, `≤ ${(1 / Number.EPSILON).toExponential(2)}`,
    range.toExponential(2))

  /**
   * The 1e12 Ω "open" used for a capacitor and for an open push button is the
   * same magnitude as 1/gmin. It must stay at or above gmin, or an open switch
   * would conduct less than the solver's own numerical floor and stop being
   * distinguishable from it.
   */
  truth('the 1e12 Ω open is not below gmin', 1e-12 >= GMIN, `≥ ${GMIN}`, '1e-12 S')

  // A 0 Ω resistor beside a 10 kΩ divider must still read 2.5 V. This is the
  // circuit devices.ts records as returning 2.048 V with the old 1e-12 Ω clamp.
  const c = compile({
    parts: [place('uno', 'arduino_uno'), place('r1', 'resistor', { ohms: 10000 }),
      place('sh', 'resistor', { ohms: 0 }), place('r2', 'resistor', { ohms: 10000 })],
    wires: [wire(['uno', '5V'], ['r1', '1']), wire(['r1', '2'], ['sh', '1']),
      wire(['sh', '2'], ['r2', '1']), wire(['r2', '2'], ['uno', 'GND.1'])],
  })
  for (const [, p] of c.mcuPorts) p.set(G_FLOAT, 0)
  const res = c.circuit.solve()
  // Hand: the 1 mΩ bridge is negligible against 10 kΩ, so both mid nodes sit at
  // 5·(10 kΩ + 0.5 mΩ)/(20 kΩ + 1 mΩ) = 2.5000000 V, minus the gmin leak.
  near('a 0 Ω bridge inside a 10k/10k divider still reads 2.5 V',
    res.voltages[c.netOf.get('sh 1')!], 2.5, 4 * GMIN * 1e4 + 1e-6)
}

// ══════════════════════════════════════════════════════════════════════════════
group('11. hardware-safety diagnostics — the four silent gaps')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * GAP 1 — LED over-current is GRADUATED. A red 5 mm LED is rated 20 mA
   * (recommended) with a 30 mA absolute maximum. The independent bisection
   * oracle gives the loop current for the 5 V rail through R + the 2 Ω bulk
   * resistance; it is compared against the DATASHEET thresholds (20 / 30 mA),
   * never against the solver. An LED junction's deviceId is `${part}.d`.
   */
  const ledDoc = (R: number): CircuitDoc => ({
    parts: [place('uno', 'arduino_uno'), place('r1', 'resistor', { ohms: R }), place('led1', 'led')],
    wires: [wire(['uno', '5V'], ['r1', '1']), wire(['r1', '2'], ['led1', 'A']),
      wire(['led1', 'C'], ['uno', 'GND.1'])],
  })
  const ledFault = (R: number) => solveDoc(ledDoc(R)).res.faults.find((f) => f.deviceId === 'led1.d')

  // 100 Ω → 29.6 mA: above the 20 mA rating, below the 30 mA absolute max.
  const i100 = ledCurrent(VCC, 100 + LED_SERIES_R)
  truth('LED at 100 Ω draws a caution-band current (20 < I ≤ 30 mA)',
    i100 > 0.020 && i100 <= 0.030, '20 mA < I ≤ 30 mA', `${(i100 * 1000).toFixed(2)} mA`)
  const f100 = ledFault(100)
  truth('and the engine raises a NON-destructive caution',
    f100?.kind === 'over_current' && f100?.severity === 'caution',
    'over_current / caution', f100 ? `${f100.kind} / ${f100.severity}` : 'no fault')
  truth('the caution says its life is shortened, not that it is destroyed',
    !!f100 && /shortens its life/.test(f100.message) && !/destroyed/.test(f100.message),
    'warns without alarming', f100?.message ?? '(none)')

  // 50 Ω → 57 mA: past the 30 mA absolute max → destruction.
  const i50 = ledCurrent(VCC, 50 + LED_SERIES_R)
  truth('LED at 50 Ω draws past the 30 mA absolute max', i50 > 0.030, 'I > 30 mA',
    `${(i50 * 1000).toFixed(2)} mA`)
  const f50 = ledFault(50)
  truth('and the engine raises the destructive over_current',
    f50?.kind === 'over_current' && f50?.severity === 'destructive',
    'over_current / destructive', f50 ? `${f50.kind} / ${f50.severity}` : 'no fault')

  // 1 kΩ → 3.1 mA: below the rating → nothing at all.
  const i1k = ledCurrent(VCC, 1000 + LED_SERIES_R)
  truth('LED at 1 kΩ draws below the 20 mA rating', i1k < 0.020, 'I < 20 mA',
    `${(i1k * 1000).toFixed(2)} mA`)
  truth('and the LED raises no fault', ledFault(1000) === undefined, 'no LED fault',
    String(ledFault(1000)?.kind))
}

{
  /**
   * GAP 2 — every MCU pin is rated-checked. The ATmega328P I/O pin is 20 mA
   * recommended, 40 mA absolute max. A pin driven HIGH is a 5 V source behind
   * 25 Ω, so a plain resistor load fixes the sourced current in closed form:
   * I = 5 / (25 + R). Thresholds (20 / 40 mA) are the datasheet's.
   */
  const pinDoc = (R: number): CircuitDoc => ({
    parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: R })],
    wires: [wire(['uno', 'D13'], ['r', '1']), wire(['r', '2'], ['uno', 'GND.1'])],
  })
  const pinFault = (R: number, drives: Record<string, Drive> = { D13: 'high' }) =>
    solveDoc(pinDoc(R), drives).res.faults.find((f) => f.deviceId === 'uno.D13')

  // R = 0 Ω (clamped to MIN_RESISTANCE): I ≈ 5/25 = 200 mA → destruction. The repro.
  const i200 = VCC / (R_DRIVE + MIN_RESISTANCE)
  truth('D13 driving into ~0 Ω sources ~200 mA', i200 > 0.040, 'I > 40 mA',
    `${(i200 * 1000).toFixed(1)} mA`)
  const f200 = pinFault(0)
  truth('a pin at 200 mA is a destructive over_current',
    f200?.kind === 'over_current' && f200?.severity === 'destructive',
    'over_current / destructive', f200 ? `${f200.kind} / ${f200.severity}` : 'no fault')
  truth('the pin message quantifies it against the 40 mA rating',
    !!f200 && /40 mA/.test(f200.message) && /pin/.test(f200.message) && /On real hardware/.test(f200.message),
    'names 40 mA + consequence', f200?.message ?? '(none)')

  // R = 175 Ω: I = 5/200 = 25 mA → caution.
  const i25 = VCC / (R_DRIVE + 175)
  truth('D13 into 175 Ω sources 25 mA (caution band)', i25 > 0.020 && i25 <= 0.040,
    '20 mA < I ≤ 40 mA', `${(i25 * 1000).toFixed(2)} mA`)
  const f25 = pinFault(175)
  truth('a pin at 25 mA is a NON-destructive caution',
    f25?.kind === 'over_current' && f25?.severity === 'caution',
    'over_current / caution', f25 ? `${f25.kind} / ${f25.severity}` : 'no fault')

  // Experiment 01: D13 sources 12.4 mA → nothing.
  truth('Experiment 01 sources 12.4 mA, below the 20 mA rating', I_EXP01 < 0.020, 'I < 20 mA',
    `${(I_EXP01 * 1000).toFixed(2)} mA`)
  const fExp = solveDoc(EXPERIMENT_01, { D13: 'high' }).res.faults.find((f) => f.deviceId === 'uno.D13')
  truth('and D13 raises no fault in the authored circuit', fExp === undefined, 'no pin fault',
    String(fExp?.kind))
  // A pin only faults while SOURCING: the identical 0 Ω load with the pin left
  // FLOATING (an input) must stay silent.
  truth('the identical 0 Ω load with D13 FLOATING raises no pin fault',
    pinFault(0, { D13: 'float' }) === undefined, 'no fault when not driving',
    String(pinFault(0, { D13: 'float' })?.kind))
}

{
  /**
   * GAP 3 — a dangling lead is a connectivity problem. 5 V → 220 Ω → nothing:
   * the resistor's second pin is the only terminal on its net, so no current can
   * flow. Purely topological — it needs no solve, and it must be per-pin so a
   * correctly-wired part stays silent.
   */
  const dangling: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r1', 'resistor', { ohms: 220 })],
    wires: [wire(['uno', '5V'], ['r1', '1'])], // r1 pin 2 left open
  }
  const cd = compile(dangling)
  truth('a dangling resistor lead is reported as a problem',
    cd.problems.some((p) => /Resistor "r1" has a lead/.test(p) && /pin 2/.test(p)),
    'names the open lead', JSON.stringify(cd.problems))
  truth('the authored Experiment 01 reports no connectivity problem',
    compile(EXPERIMENT_01).problems.length === 0, '[]', JSON.stringify(compile(EXPERIMENT_01).problems))
}

{
  /**
   * GAP 4 — a build wired across the centre channel is diagnosed, not silent.
   * D13 → j5 while the resistor stays on b5: same column, opposite banks, so
   * nothing connects and the LED is dark. This is the exact broken build group 2
   * proves computes-but-does-not-light; here we prove it now SPEAKS, and does so
   * once (not also as a plain dangling lead).
   */
  const broken: CircuitDoc = {
    ...EXPERIMENT_01,
    wires: EXPERIMENT_01.wires.map((x) =>
      x.id === 'w1' ? { ...x, to: { partId: 'bb', pinId: 'j5' } } : x),
  }
  const cb = compile(broken)
  truth('a channel-crossed build produces a clear hint',
    cb.problems.some((p) => /centre channel/.test(p) && /jumper/.test(p)),
    'names the channel + fix', JSON.stringify(cb.problems))
  truth('the crossing is not ALSO double-reported as a plain dangling lead',
    cb.problems.filter((p) => /channel/i.test(p)).length === 1 &&
      !cb.problems.some((p) => /has a lead \(pin/.test(p)),
    'one channel hint, no dangling dup', JSON.stringify(cb.problems))

  // Correctly wired: silent. And a fully-wired but switched-OFF circuit is silent
  // too — connectivity is topological, not about whether current happens to flow.
  truth('the correctly-wired Experiment 01 stays silent',
    compile(EXPERIMENT_01).problems.length === 0, '[]', JSON.stringify(compile(EXPERIMENT_01).problems))
  const offButton: CircuitDoc = {
    parts: [...EXPERIMENT_01.parts, place('btn', 'push_button', { pressed: 0 })],
    wires: [...EXPERIMENT_01.wires, wire(['uno', 'D2'], ['btn', '1a']), wire(['btn', '2a'], ['uno', 'GND.1'])],
  }
  truth('an OPEN button (switched off) raises no connectivity problem',
    compile(offButton).problems.length === 0, '[]', JSON.stringify(compile(offButton).problems))
}

// ══════════════════════════════════════════════════════════════════════════════
group('12. sensors can be damaged, and the fault names the SENSOR')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * Seven `kind:'sensor'` parts used to compile to a Norton port and NOTHING
   * ELSE, so none of them had a safety() at all: 12 V on a DHT11's VCC, or a
   * DS18B20 with GND and VDD swapped — "the classic way to cook one of these",
   * in the part's own comment — left the Checks panel green.
   *
   * Datasheet supply windows, restated here rather than imported so this file
   * asserts the model against the SHEET and not against itself:
   *
   *   DHT11     3.3-5.5 V operating   (abs max 6.0 V, judged — no sheet figure)
   *   DS18B20   3.0-5.5 V operating   (abs max +6.0 V, -0.5 V any pin: SHEET)
   *   HC-SR04   4.5-5.5 V working     (abs max 6.0 V, judged)
   *   HC-SR501  4.5-20 V working      (abs max 24 V, judged: HT7133 LDO input)
   *   YF-S201   5-18 V working        (abs max 24 V, judged)
   *   pulse     3.0-5.5 V operating   (abs max 7.0 V: MCP6001 VDD-VSS, SHEET)
   *   MCP3008   2.7-5.5 V operating   (abs max 7.0 V: SHEET)
   */
  const SUPPLY_SHEET: Record<string, { min: number; max: number; absMax: number; pin: string }> = {
    dht11: { min: 3.3, max: 5.5, absMax: 6.0, pin: 'VCC' },
    ds18b20: { min: 3.0, max: 5.5, absMax: 6.0, pin: 'VDD' },
    hc_sr04: { min: 4.5, max: 5.5, absMax: 6.0, pin: 'VCC' },
    pir_motion: { min: 4.5, max: 20, absMax: 24, pin: 'VCC' },
    flow_sensor: { min: 5, max: 18, absMax: 24, pin: 'VCC' },
    pulse_sensor: { min: 3.0, max: 5.5, absMax: 7.0, pin: 'VCC' },
    mcp3008: { min: 2.7, max: 5.5, absMax: 7.0, pin: 'VDD' },
  }
  /** The ground pin each part declares — MCP3008 has two and DGND is the one. */
  const GROUND_PIN: Record<string, string> = { mcp3008: 'DGND' }

  /**
   * A sensor across a bench supply of `volts`, with nothing else in the circuit.
   *
   * An ideal VoltageSource straight across the part's own supply and ground
   * pins, so the node voltage IS the number under test and no divider has to be
   * solved for. Reversing the source is how the polarity case is built — which
   * is exactly what swapping two wires does on a bench.
   */
  function supplyFault(type: string, volts: number, reversed = false) {
    const gnd = GROUND_PIN[type] ?? 'GND'
    const doc: CircuitDoc = {
      parts: [place('uno', 'arduino_uno'), place('s', type)],
      wires: reversed
        ? [wire(['uno', '5V'], ['s', gnd]), wire(['s', SUPPLY_SHEET[type].pin], ['uno', 'GND.1'])]
        : [wire(['uno', '5V'], ['s', SUPPLY_SHEET[type].pin]), wire(['s', gnd], ['uno', 'GND.1'])],
    }
    const c = compile(doc)
    // Drive the rail at `volts` rather than the Uno's fixed 5 V: the point is
    // the SENSOR's window, not the board's, and a PIR is specified to 20 V.
    for (const d of (c.circuit as unknown as { devices: Array<{ id: string; volts?: number }> })
      .devices) {
      if (d.id === 'uno.5V') d.volts = volts
    }
    for (const [, p] of c.mcuPorts) p.set(G_FLOAT, 0)
    const res = c.circuit.solve()
    return res.faults.find((f) => f.deviceId === 's.supply') ?? null
  }

  /**
   * Both declared thresholds are STRADDLED, not merely bracketed.
   *
   * A mid-band point on its own is a weak assertion: moving `absMaxVolts` by a
   * factor of ten still leaves it in the right band about half the time. A pair
   * 50 mV either side of each declared number means any move of either fails.
   */
  const EPS = 0.05
  for (const [type, sheet] of Object.entries(SUPPLY_SHEET)) {
    const cases: Array<[string, number, 'none' | 'caution' | 'destructive']> = [
      [`in the middle of its ${sheet.min}-${sheet.max} V window`, (sheet.min + sheet.max) / 2, 'none'],
      [`${EPS} V UNDER its ${sheet.max} V spec top`, sheet.max - EPS, 'none'],
      [`${EPS} V OVER its ${sheet.max} V spec top`, sheet.max + EPS, 'caution'],
      ['between the spec top and the absolute maximum', (sheet.max + sheet.absMax) / 2, 'caution'],
      [`${EPS} V UNDER its ${sheet.absMax} V absolute maximum`, sheet.absMax - EPS, 'caution'],
      [`${EPS} V OVER its ${sheet.absMax} V absolute maximum`, sheet.absMax + EPS, 'destructive'],
    ]
    for (const [what, volts, want] of cases) {
      const f = supplyFault(type, volts)
      const got = f === null ? 'none' : f.severity
      truth(`${type} at ${volts} V — ${what} — is ${want}`,
        got === want && (want !== 'caution' || !/destroy/.test(f?.message ?? '')),
        want, f === null ? 'no fault' : `${got}: ${f.message}`)
    }

    // The message names THIS part, quotes ITS numbers, and names ITS supply pin
    // — not "a sensor", and above all not an ATmega pad.
    const fDead = supplyFault(type, sheet.absMax + 1)
    truth(`${type}'s over-voltage fault quotes its own ${sheet.max} V / ${sheet.absMax} V figures`,
      !!fDead && fDead.message.includes(`${sheet.absMax} V`) &&
        fDead.message.includes(`${sheet.max} V`) && fDead.message.includes(sheet.pin),
      `"${sheet.absMax} V", "${sheet.max} V" and "${sheet.pin}"`, fDead?.message ?? '(none)')

    // Supply and ground swapped: destroyed, and the message says which two pins.
    // Straddled too — a sensor 0.05 V "backwards" is noise, not a mistake.
    const revTol = type === 'mcp3008' ? 0.6 : type === 'pulse_sensor' ? 0.3 : 0.5
    truth(`${type} ${EPS} V under its ${revTol} V reverse limit is silent`,
      supplyFault(type, revTol - EPS, true) === null, 'no fault',
      JSON.stringify(supplyFault(type, revTol - EPS, true)?.message ?? null))
    const fRev = supplyFault(type, 5, true)
    truth(`${type} with ${sheet.pin} and GND swapped is DESTRUCTIVE`,
      fRev?.severity === 'destructive' && /BACKWARDS/.test(fRev.message) &&
        /swapped/.test(fRev.message) && fRev.message.includes(`${revTol} V reverse`),
      `destructive, names the swap and its ${revTol} V limit`,
      fRev ? `${fRev.severity}: ${fRev.message}` : 'no fault')
  }

  /**
   * THE MISATTRIBUTION, before and after.
   *
   * A sensor's driven pin used to be a plain NortonPort, whose safety() carries
   * the ATmega328P's 20/40 mA pad ratings AND the ATmega328P's wording. Loading
   * an HC-SR04's ECHO therefore produced "…mA through a pin rated for 40 mA. On
   * real hardware this pin is destroyed." attributed to `hcs.echo`.
   *
   * The HC-SR04 drives ECHO push-pull at 5 V through the engine's own drive
   * resistance. Loading it with 47 Ω to ground gives, by hand, a current of
   * 5/(25 + 47) = 69.4 mA — past the module's 25 mA absolute maximum and past
   * the ATmega's 40 mA one too, so BOTH the old wording and the new one would
   * fire and only the ATTRIBUTION distinguishes them.
   */
  const R_LOAD = 47
  const echoDoc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('hcs', 'hc_sr04'), place('rl', 'resistor', { ohms: R_LOAD })],
    wires: [
      wire(['uno', '5V'], ['hcs', 'VCC']), wire(['hcs', 'GND'], ['uno', 'GND.1']),
      wire(['hcs', 'ECHO'], ['rl', '1']), wire(['rl', '2'], ['uno', 'GND.1']),
    ],
  }
  {
    const c = compile(echoDoc)
    for (const [, p] of c.mcuPorts) p.set(G_FLOAT, 0)
    // Drive ECHO as the behavioural model does: 5 V behind the 25 Ω pin model.
    const echo = c.behavioural.find((b) => b.partId === 'hcs')?.ports.ECHO
    echo?.set(1 / R_DRIVE, VCC / R_DRIVE)
    const res = c.circuit.solve()
    const iHand = VCC / (R_DRIVE + R_LOAD)
    nearRel('ECHO into 47 Ω carries the hand-computed 5/(25+47) A', iHand, 0.0694444, 1e-3)
    const f = res.faults.find((x) => x.deviceId === 'hcs.echo')
    truth('overloading ECHO still faults',
      f?.severity === 'destructive', 'destructive', f ? f.severity : 'no fault')
    truth('and the fault names the HC-SR04 and its ECHO pin',
      !!f && /HC-SR04/.test(f.message) && /ECHO/.test(f.message),
      'names the sensor', f?.message ?? '(none)')
    truth('and NO LONGER claims an I/O pin rated for 40 mA was destroyed',
      !!f && !/40 mA/.test(f.message) && !/I\/O pin/.test(f.message) &&
        !/this pin is destroyed/.test(f.message),
      'no ATmega wording', f?.message ?? '(none)')
    truth('the quoted rating is the sensor\'s own 25 mA absolute maximum',
      !!f && /25 mA/.test(f.message), 'mentions 25 mA', f?.message ?? '(none)')
  }

  // A correctly built sensor draws its datasheet supply current and nothing
  // faults. DHT11: 0.3 mA measuring, so G = 0.3 mA / 5.5 V and at 5 V the part
  // draws 5 * 0.3e-3/5.5 = 0.2727 mA. That is the whole load it presents.
  {
    const doc: CircuitDoc = {
      parts: [place('uno', 'arduino_uno'), place('d', 'dht11')],
      wires: [wire(['uno', '5V'], ['d', 'VCC']), wire(['d', 'GND'], ['uno', 'GND.1'])],
    }
    const c = compile(doc)
    for (const [, p] of c.mcuPorts) p.set(G_FLOAT, 0)
    const res = c.circuit.solve()
    truth('a correctly powered DHT11 raises no fault at all',
      res.faults.length === 0, '[]', JSON.stringify(res.faults.map((f) => f.message)))
    const supply = (c.circuit as unknown as { devices: Array<{ id: string; current?: number }> })
      .devices.find((d) => d.id === 'd.supply')
    nearRel('and it draws its datasheet 0.3 mA/5.5 V conductance at 5 V',
      Math.abs(supply?.current ?? 0), (5 * 0.3e-3) / 5.5, 1e-6)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('13. the driver ICs report what they are doing')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * L298N truth table (ST L298 datasheet), restated:
   *   Ven H, C H, D L  Forward     Ven H, C = D    Fast Motor Stop (brake)
   *   Ven H, C L, D H  Reverse     Ven L           Free Running Stop (coast)
   * Vss (logic) 4.5-7 V; Vs (motor) >= VIH + 2.5 V = 2.3 + 2.5 = 4.8 V.
   */
  const VIH = 2.3
  const HEADROOM = 2.5
  const MIN_VS = VIH + HEADROOM

  /**
   * An L298N with a 100 Ω "motor" between OUT1 and OUT2, ENA and IN1 driven high
   * from D9/D8, IN2 low, Vss from the Uno's 5 V and Vs from a rail the test can
   * move. `vs` of 0 means "not wired at all".
   */
  function bridge(vs: number | null, vss: number | null = VCC) {
    const parts: PlacedPart[] = [
      place('uno', 'arduino_uno'), place('drv', 'l298n'), place('m', 'resistor', { ohms: 100 }),
    ]
    const wires: DocWire[] = [
      wire(['uno', 'GND.1'], ['drv', 'GND']),
      wire(['uno', 'D9'], ['drv', 'ENA']),
      wire(['uno', 'D8'], ['drv', 'IN1']),
      wire(['uno', 'D7'], ['drv', 'IN2']),
      wire(['drv', 'OUT1'], ['m', '1']), wire(['m', '2'], ['drv', 'OUT2']),
    ]
    // Both supplies are fed from the 5 V rail and then over-driven below, so the
    // topology is the same in every case and only the voltages move.
    if (vss !== null) wires.push(wire(['uno', '5V'], ['drv', 'VSS']))
    if (vs !== null) wires.push(wire(['uno', '3.3V'], ['drv', 'VS']))
    const c = compile({ parts, wires })
    for (const d of (c.circuit as unknown as { devices: Array<{ id: string; volts?: number }> })
      .devices) {
      if (d.id === 'uno.5V' && vss !== null) d.volts = vss
      if (d.id === 'uno.3V3' && vs !== null) d.volts = vs
    }
    for (const [name, p] of c.mcuPorts) {
      // ENA and IN1 high, IN2 low, everything else floating.
      if (name === 'D9' || name === 'D8') p.set(1 / R_DRIVE, VCC / R_DRIVE)
      else p.set(G_FLOAT, 0)
    }
    const res = c.circuit.solve()
    const drv = c.drivers.get('drv')
    return { c, res, drv, faults: res.faults.filter((f) => f.deviceId.startsWith('drv.')) }
  }

  {
    // A healthy bridge: Vs at 12 V, Vss at 5 V, ENA and IN1 high.
    const { drv, faults } = bridge(12)
    truth('compile() now hands the L298N\'s channels to the engine',
      drv?.kind === 'h_bridge' && drv.channels.length === 2,
      'h_bridge, 2 channels', drv ? `${drv.kind}, ${drv.channels.length}` : 'absent')
    const a = drv?.kind === 'h_bridge' ? drv.channels[0] : null
    truth('and channel A reports FORWARD from the datasheet truth table (Ven H, C H, D L)',
      a?.mode === 'forward', 'forward', String(a?.mode))
    truth('with both supply verdicts good',
      a?.logicOk === true && a?.supplyOk === true, 'logicOk + supplyOk',
      `${a?.logicOk} / ${a?.supplyOk}`)
    truth('a healthy bridge raises no fault',
      faults.length === 0, '[]', JSON.stringify(faults.map((f) => f.message)))
    // The drop IS the lesson: 12 V in, VCEsat(H) 1.35 + VCEsat(L) 1.2 out, plus
    // 2 x 0.15 Ω of bulk against a 100 Ω load ≈ 12 − 2.55 = 9.45 V, i.e. 94.2 mA.
    const iHand = (12 - 1.35 - 1.2) / (100 + 2 * 0.15)
    nearRel('and its current is the load line with the 2.55 V transistor tax taken off',
      Math.abs(a?.current ?? 0), iHand, 2e-3)
  }

  {
    // Vs on the 3.3 V rail: below VIH + 2.5 = 4.8 V, so nothing drives.
    const { drv, faults } = bridge(3.3)
    const a = drv?.kind === 'h_bridge' ? drv.channels[0] : null
    truth(`Vs at 3.3 V is below the datasheet's VIH + ${HEADROOM} = ${MIN_VS} V`,
      3.3 < MIN_VS, `< ${MIN_VS} V`, '3.3 V')
    truth('so the bridge coasts even though it was told to go forward',
      a?.mode === 'coast' && a?.commandedMode === 'forward',
      'mode coast / asked forward', `${a?.mode} / ${a?.commandedMode}`)
    const f = faults.find((x) => /Vs/.test(x.message))
    truth('and the Checks panel now SAYS SO, as a caution',
      f?.severity === 'caution' && /MOTOR supply/.test(f.message) && /\+12V/.test(f.message),
      'caution naming Vs', f ? f.message : 'no fault')
  }

  {
    // Vss left unwired entirely: the logic is dead whatever Vs is doing.
    const { drv, faults } = bridge(12, null)
    const a = drv?.kind === 'h_bridge' ? drv.channels[0] : null
    truth('with no Vss the logic supply is out of range',
      a?.logicOk === false, 'logicOk false', String(a?.logicOk))
    const f = faults.find((x) => /Vss/.test(x.message))
    truth('and the caution names Vss, the "+5V" screw, and says the outputs cannot switch',
      f?.severity === 'caution' && /LOGIC supply/.test(f.message) && /\+5V/.test(f.message),
      'caution naming Vss', f ? f.message : 'no fault')
  }

  {
    // Enable low: this is a deliberate coast, not a fault. Nothing is said.
    const parts: PlacedPart[] = [place('uno', 'arduino_uno'), place('drv', 'l298n')]
    const c = compile({
      parts,
      wires: [wire(['uno', 'GND.1'], ['drv', 'GND']), wire(['uno', '5V'], ['drv', 'VSS'])],
    })
    for (const [, p] of c.mcuPorts) p.set(G_FLOAT, 0)
    const res = c.circuit.solve()
    truth('an L298N whose enable is low raises NO fault — that is a deliberate coast',
      res.faults.filter((f) => f.deviceId.startsWith('drv.')).length === 0,
      '[]', JSON.stringify(res.faults.map((f) => f.message)))
  }

  {
    /**
     * A ULN2003 with IN2 and IN5 driven high from D8/D9 and 220 Ω from COM
     * (on 5 V) into each of OUT2 and OUT5. Everything else is unwired, so only
     * two of the seven channels are built at all — which is the case that
     * matters, because printing the other five as "off" would claim knowledge of
     * channels the compiler never instantiated.
     */
    const ulnDoc: CircuitDoc = {
      parts: [
        place('uno', 'arduino_uno'), place('u', 'uln2003'),
        place('r2', 'resistor', { ohms: 220 }), place('r5', 'resistor', { ohms: 220 }),
      ],
      wires: [
        wire(['uno', 'GND.1'], ['u', 'GND']), wire(['uno', '5V'], ['u', 'COM']),
        wire(['uno', 'D8'], ['u', 'IN2']), wire(['uno', 'D9'], ['u', 'IN5']),
        wire(['uno', '5V'], ['r2', '1']), wire(['r2', '2'], ['u', 'OUT2']),
        wire(['uno', '5V'], ['r5', '1']), wire(['r5', '2'], ['u', 'OUT5']),
      ],
    }
    const c = compile(ulnDoc)
    for (const [name, p] of c.mcuPorts) {
      if (name === 'D8') p.set(1 / R_DRIVE, VCC / R_DRIVE)
      else p.set(G_FLOAT, 0)
    }
    c.circuit.solve()
    const drv = c.drivers.get('u')
    truth('compile() hands the ULN2003\'s channels over, numbered as the package numbers them',
      drv?.kind === 'darlington_array' && drv.indices.join(',') === '1,2,3,4,5,6,7' &&
        drv.channels.length === drv.indices.length,
      '7 channels, 1..7',
      drv?.kind === 'darlington_array' ? `${drv.channels.length}, [${drv.indices}]` : 'absent')
    const ch = drv?.kind === 'darlington_array' ? drv.channels : []
    truth('IN2 high turns channel 2 on and IN5 low leaves channel 5 off',
      ch[1]?.on === true && ch[4]?.on === false,
      'ch2 on, ch5 off', `${ch[1]?.on} / ${ch[4]?.on}`)
    // 5 V through 220 Ω into a saturated Darlington: VCE(sat) = 0.7 + 2*I, so
    // I = (5 − 0.7)/(220 + 2) = 19.37 mA, from the two datasheet points alone.
    nearRel('and its collector current is the 220 Ω load line against VCE(sat)',
      ch[1]?.current ?? 0, (5 - 0.7) / (220 + 2), 2e-3)
    /**
     * Only the WIRED channels are metered. All seven are stamped — a ULN2003 pin
     * earns a net whatever the student did — but five rows of 0.00 mA over the
     * channels nobody touched is the noise that trains people to stop reading
     * the panel.
     */
    truth('and only the two channels with a wired input are metered',
      c.meters.has('u.ch2') && c.meters.has('u.ch5') &&
        [...c.meters.keys()].filter((k) => k.startsWith('u.')).length === 2,
      'u.ch2 + u.ch5 only', [...c.meters.keys()].filter((k) => k.startsWith('u.')).join(','))

    /**
     * The pattern the student reads: `-` for a channel whose IN reaches nothing,
     * `#` for one conducting, `·` for one that is wired and off. IN2 is high and
     * IN5 is low, so `-#--·--`… i.e. dashes everywhere except positions 2 and 5.
     */
    const state = analogDeviceStates({
      doc: ulnDoc, netOf: c.netOf, nets: c.nets,
      voltages: c.circuit.solve().voltages, reactive: c.reactive, drivers: c.drivers,
      transient: false,
    })
    truth('the reported pattern dashes the five channels nobody wired',
      state.u?.pattern === '-#--·--' && state.u?.conducting === '2' && state.u?.channels === 2,
      "'-#--·--', conducting 2, 2 wired",
      `'${String(state.u?.pattern)}', conducting '${String(state.u?.conducting)}', ${String(state.u?.channels)} wired`)
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('14. every declared prop reaches the solver or a model')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * THE GUARD THIS PROJECT DID NOT HAVE.
   *
   * propDeclarationProblems() catches declared-but-unrenderable. Nothing caught
   * declared-but-inert, which is the half that shipped twice: led.color had a
   * correct datasheet table and a working <select> while compile.ts never passed
   * it, so every LED in every document solved as red.
   *
   * See model/prop-reachability.ts for how the differential probe works and for
   * why the behavioural half cannot be closed the same way.
   */
  const reach = propReachability()
  truth('the guard is non-vacuous: it probes every part that declares a prop',
    probedPartTypes().length >= 12 && reach.length >= 20,
    '>= 12 parts, >= 20 props', `${probedPartTypes().length} parts, ${reach.length} props`)
  truth('and it can tell the two apart: some props reach the solver, some a model',
    reach.some((r) => r.reach === 'solver') && reach.some((r) => r.reach === 'behavioural'),
    'both classes present',
    `${reach.filter((r) => r.reach === 'solver').length} solver / ` +
      `${reach.filter((r) => r.reach === 'behavioural').length} behavioural`)
  truth('NO declared prop reaches nothing at all',
    propReachabilityProblems().length === 0, '[]', propReachabilityProblems().join(' | '))

  // The specific prop the bug was in, called out by name so a regression is
  // unmissable in the failure list rather than one line in a table.
  truth('led.color specifically reaches the solver',
    reach.find((r) => r.type === 'led' && r.key === 'color')?.reach === 'solver',
    'solver', String(reach.find((r) => r.type === 'led' && r.key === 'color')?.reach))

  /**
   * THE BEHAVIOURAL HALF, closed at the source level.
   *
   * A prop the probe classifies as `behavioural` is legitimately invisible to
   * compile() — it reaches a model that runs on the CPU clock, and a DHT11's
   * temperature only reaches the wire once a host has spent 18 ms asking for it,
   * which no pair of compiles can reproduce. What CAN be checked without a CPU
   * is that some model reads that exact key: every read in behavioural.ts goes
   * through `numProp(<props>, 'key', <fallback>)`, so the key must appear in
   * that position or nothing reads it at all.
   *
   * Weaker than the differential probe — a literal is not proof the read happens
   * on any particular path — and stated as such. It still catches the failure
   * that actually occurs: a control declared, rendered, stored, and read by
   * nobody.
   */
  const behaviouralSource = fs.readFileSync(
    path.join(process.cwd(), 'lib/simulator/behavioural.ts'), 'utf8')
  for (const r of reach) {
    if (r.reach !== 'behavioural') continue
    // `[\s\S]{0,80}?` rather than `[^)]*`: the commonest read in the file is
    // `numProp(this.ctx.props(), 'key', …)`, whose first argument contains a
    // closing paren of its own — a naive [^)]* stops dead at it and reports a
    // read that is right there as missing. Bounded and lazy so it cannot run on
    // into the NEXT numProp call and match the wrong key.
    const read = new RegExp(`numProp\\([\\s\\S]{0,80}?'${r.key}'\\s*,`).test(behaviouralSource)
    truth(`${r.type}.${r.key} is read by a behavioural model`,
      read, `numProp(…, '${r.key}', …) in behavioural.ts`, read ? 'found' : 'NOT READ ANYWHERE')
  }
}

// ══════════════════════════════════════════════════════════════════════════════
group('15. the dead kind:\'load\' variant is gone')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * `{kind:'load'; ohms; label}` was how the buzzer and the motor were first
   * stamped. Both got real device models long ago, and by the time it was
   * removed no part used the variant while compile() still carried a live branch
   * for it — dead code shaped like a supported feature.
   *
   * The union no longer has the member, so a part declaring one would not
   * compile at all; this asserts the other direction, that nothing in the
   * library is quietly still using the string.
   */
  const kinds = new Set(Object.values(PART_LIBRARY).map((d) => d.electrical.kind))
  truth('no part in the library declares kind:\'load\'',
    !kinds.has('load' as never), 'absent', [...kinds].sort().join(', '))
  truth('the buzzer and the motor both have real device models instead',
    getPart('buzzer').electrical.kind === 'buzzer' &&
      getPart('dc_motor').electrical.kind === 'motor',
    'buzzer + motor', `${getPart('buzzer').electrical.kind} + ${getPart('dc_motor').electrical.kind}`)
}

// ─── Report ───────────────────────────────────────────────────────────────────

const nameW = Math.max(44, ...rows.map((r) => r.name.length))
const expW = Math.max(20, ...rows.map((r) => r.expected.length))
const actW = Math.max(20, ...rows.map((r) => r.actual.length))

let lastGroup = ''
for (const r of rows) {
  if (r.group !== lastGroup) {
    lastGroup = r.group
    console.log('\n' + r.group)
    console.log('-'.repeat(nameW + expW + actW + 14))
  }
  console.log(`${r.name.padEnd(nameW)}  ${r.expected.padEnd(expW)}  ${r.actual.padEnd(actW)}  ` +
    (r.pass ? 'PASS' : '*** FAIL ***'))
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
