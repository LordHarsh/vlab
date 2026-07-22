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

import { compile } from '../model/compile'
import type { CircuitDoc, DocWire, PlacedPart } from '../model/document'
import { EXPERIMENT_01 } from '../model/examples'
import { PART_LIBRARY, getPart } from '../model/parts'
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
  c.behavioural[0].port.set(1 / 40, 0)
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
   * A capacitor is stamped as a 1e12 Ω resistor — its true DC steady state, and
   * the wrong answer for everything a student puts a capacitor there to do. The
   * contract in §2.3 is that the engine says so rather than letting the part sit
   * there quietly, so the limitation must reach the caller.
   */
  const doc: CircuitDoc = {
    parts: [place('uno', 'arduino_uno'), place('r', 'resistor', { ohms: 10000 }),
      place('c', 'capacitor', { microfarads: 100 })],
    wires: [wire(['uno', '5V'], ['r', '1']), wire(['r', '2'], ['c', '1']),
      wire(['c', '2'], ['uno', 'GND.1'])],
  }
  const { c, res } = solveDoc(doc)
  truth('placing a capacitor surfaces exactly one limitation', c.limitations.length === 1,
    '1 limitation', JSON.stringify(c.limitations))
  truth('the limitation says timing is not simulated',
    /transient simulation, which is not available yet/.test(c.limitations[0] ?? ''),
    'names transient simulation', c.limitations[0] ?? '(none)')

  // Node between the resistor and the cap: 1e-4 S to 5 V, 1e-12 S (cap) plus
  // 1e-12 S (gmin) to ground. V = 5e-4/(1e-4 + 2e-12) = 4.99999990 V.
  near('a capacitor is an open circuit at DC', res.voltages[c.netOf.get('c 1')!],
    5e-4 / (1e-4 + 1e-12 + GMIN), 1e-7)

  // An unwired capacitor still warns — the student must never see a capacitor on
  // the canvas with nothing said about it.
  const alone = compile({ parts: [place('uno', 'arduino_uno'), place('c', 'capacitor')], wires: [] })
  truth('an unwired capacitor still warns', alone.limitations.length === 1,
    '1 limitation', JSON.stringify(alone.limitations))

  // And a circuit with no capacitor must not warn.
  const none = compile(EXPERIMENT_01)
  truth('a circuit with no capacitor carries no limitation', none.limitations.length === 0,
    '[]', JSON.stringify(none.limitations))
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
