/**
 * Adversarial test suite for POWER SOURCES and for the DATUM they made necessary.
 *
 * Every expectation here is derived BY HAND from circuit theory in the comment
 * above it, from the datasheet figures in CELLS and from the piecewise-linear
 * V(I) law RegulatedSupply declares — never from anything the engine printed. A
 * resistive circuit is a divider anyone can do on paper; the one transcendental
 * case (a battery driving an LED) is solved here by BISECTION on the Shockley
 * equation, which is an independent method: it never forms a matrix, never runs
 * Newton, and would not agree with a solver that had converged to a wrong root.
 *
 * The suite is organised around what could break:
 *
 *   1  the datum        one reference per isolated circuit, and the four cases
 *                       that a global `gnd`-pin scan gets wrong
 *   2  cells and packs  series voltage, series ESR, the switch
 *   3  ratings          the faults ESR makes reportable
 *   4  bench supply     constant voltage, then constant current
 *   5  NO MICROCONTROLLER — the circuit this whole piece of work exists for
 *   6  reachability     every new prop moves the matrix
 *   7  limitations      what is unmodelled, said once and said accurately
 *
 * Run: npx tsx lib/simulator/__tests__/sources.test.ts
 */

import {
  CELLS,
  Battery,
  LED_SERIES_R,
  RegulatedSupply,
  Resistor,
  SUPPLY_OUTPUT_OHMS,
  SWITCH_CONTACT_OHMS,
  VoltageSource,
} from '../devices'
import { Circuit } from '../solver'
import { VT } from '../types'
import { compile } from '../model/compile'
import {
  LED_COLOURS,
  PALETTE,
  PART_LIBRARY,
  getPart,
  selectOptionLabel,
  sourceSetting,
} from '../model/parts'
import { propReachability } from '../model/prop-reachability'
import { analogDeviceStates, ledBrightnessFor } from '../analog-state'
import { hasNoBoard, solvePassive } from '../passive'
import type { CircuitDoc, PlacedPart } from '../model/document'

// ─── Harness (the table style the other suites use) ───────────────────────────

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
    `${expected.toPrecision(8)} ${unit} ±${tol.toExponential(1)}`,
    `${Number.isFinite(actual) ? actual.toPrecision(8) : String(actual)} ${unit}`,
    pass ? undefined : `err ${Math.abs(actual - expected).toExponential(2)}`,
  )
}
/**
 * `String(JSON.stringify(x))`, not `JSON.stringify(x)`. Stringifying `undefined`
 * returns the VALUE undefined rather than the text "undefined", which put a
 * non-string into a report column and took the whole run down with a TypeError
 * in the formatter — a test harness failing to print is indistinguishable from
 * the suite failing to run.
 */
function eq(name: string, actual: unknown, expected: unknown): void {
  const a = String(JSON.stringify(actual))
  const e = String(JSON.stringify(expected))
  record(name, a === e, e, a)
}

// ─── Document helpers ────────────────────────────────────────────────────────

let seq = 0
function place(id: string, type: string, props: Record<string, number | string> = {}): PlacedPart {
  seq += 1
  return { id, type, x: seq * 200, y: 0, rotation: 0, props }
}
function doc(
  parts: PlacedPart[],
  wires: Array<[string, string, string, string]>,
): CircuitDoc {
  return {
    parts,
    wires: wires.map(([fp, fpin, tp, tpin], i) => ({
      id: `w${i}`,
      from: { partId: fp, pinId: fpin },
      to: { partId: tp, pinId: tpin },
      color: '#000',
    })),
  }
}
/** Compile, solve, and return everything a test wants to look at. */
function run(d: CircuitDoc) {
  const c = compile(d)
  const res = c.circuit.solve()
  const v = (partId: string, pinId: string): number => {
    const net = c.netOf.get(`${partId} ${pinId}`)
    return net === undefined ? NaN : res.voltages[net]
  }
  return { c, res, v, netOf: c.netOf }
}

// ══════════════════════════════════════════════════════════════════════════════
group('1. The datum: one voltage reference per isolated circuit')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * 1.0 THE COUNTERFACTUAL, so the rest of this group is not asserting a
   * tautology.
   *
   * The same 9 V / 220 Ω / 220 Ω loop built with NO net touching ground at all —
   * which is exactly what a battery circuit compiled to before chooseReferences()
   * existed. It is NOT singular, because Circuit.newton() puts gmin from every
   * node to ground, so it solves and returns confident numbers. What it cannot
   * do is put the battery's negative terminal at 0 V: summing the KCL rows makes
   * every internal current cancel and leaves gmin·Σv = 0, so the whole island
   * floats at whatever offset makes the node voltages add to zero. That is the
   * defect — not a failure, a plausible wrong answer.
   */
  const floating = new Circuit()
  const fNeg = floating.allocNet()
  const fInternal = floating.allocNet()
  const fMid = floating.allocNet()
  const fPos = floating.allocNet()
  floating.add(
    new VoltageSource('emf', fInternal, fNeg, 9),
    new Resistor('esr', fInternal, fPos, 1.7),
    new Resistor('r1', fPos, fMid, 220),
    new Resistor('r2', fMid, fNeg, 220),
  )
  const fRes = floating.solve()
  const sumV = fRes.voltages[fNeg] + fRes.voltages[fInternal] + fRes.voltages[fMid] + fRes.voltages[fPos]
  truth('1.0a an unreferenced island still SOLVES — the bug was never a failure',
    fRes.ok, 'ok:true', `ok:${fRes.ok} ${fRes.error ?? ''}`)
  /**
   * Tolerance 1e-2 and not 1e-9, and the reason is the point being made:
   * Σv = 0 is EXACT in theory, and the matrix that has to express it puts a
   * 1e-12 S gmin against loop conductances of ~5e-3 S — ten decades apart. A
   * datum that is only pinned to four figures by a term ten orders below
   * everything else is the whole objection to leaving an island floating.
   */
  near('1.0b ...and gmin pins it only by Σv = 0, which is meaningless', sumV, 0, 1e-2)
  truth('1.0c ...so its negative terminal is NOT at 0 V — it is metres from it',
    Math.abs(fRes.voltages[fNeg]) > 1,
    '|v(NEG)| > 1 V', `${fRes.voltages[fNeg].toPrecision(6)} V`)
  near('1.0d ...while the terminal-to-terminal voltage is still perfectly right',
    fRes.voltages[fPos] - fRes.voltages[fNeg], 9 * (440 / 441.7), 1e-6)

  /**
   * 1.1 A LONE BATTERY. Its negative terminal is the reference, so it reads
   * exactly 0 and the positive terminal reads the cell's own EMF — 9.000 V,
   * because nothing is drawing current and i·ESR is therefore zero.
   */
  const lone = run(doc([place('b', 'battery_9v')], []))
  eq('1.1a a lone battery: NEG is net 0', lone.netOf.get('b NEG'), 0)
  near('1.1b ...so NEG reads exactly 0 V', lone.v('b', 'NEG'), 0, 1e-9)
  near('1.1c ...and POS reads the open-circuit EMF', lone.v('b', 'POS'), 9, 1e-9)

  /**
   * 1.2 TWO CELLS IN SERIES. One island, so exactly ONE datum: taking both
   * negatives would force 0 V on each and put the lower cell's own terminals
   * together — a dead short across a cell, produced silently by the compiler.
   *
   * Hand-derived: two 1-cell AA packs with no switch, 100 Ω load.
   *   EMF   = 2 × 1.5      = 3.0 V
   *   R     = 0.15 + 0.15 + 100 = 100.3 Ω
   *   I     = 3.0 / 100.3  = 29.910269 mA
   *   v(b1.POS) = 1.5 − I×0.15 = 1.4955135 V
   *   v(b2.POS) = 3.0 − I×0.30 = 2.9910269 V
   */
  const seriesWires: Array<[string, string, string, string]> = [
    ['b1', 'POS', 'b2', 'NEG'],
    ['b2', 'POS', 'r', '1'],
    ['r', '2', 'b1', 'NEG'],
  ]
  const cellProps = { cells: 1, switch: 'none' }
  const stack = run(
    doc(
      [
        place('b1', 'battery_pack_1v5', cellProps),
        place('b2', 'battery_pack_1v5', cellProps),
        place('r', 'resistor', { ohms: 100 }),
      ],
      seriesWires,
    ),
  )
  const iStack = 3.0 / 100.3
  near('1.2a series stack: the BOTTOM cell is the datum', stack.v('b1', 'NEG'), 0, 1e-9)
  near('1.2b lower cell terminal', stack.v('b1', 'POS'), 1.5 - iStack * 0.15, 1e-9)
  near('1.2c the two cells really are in series', stack.v('b2', 'NEG'), stack.v('b1', 'POS'), 1e-12)
  near('1.2d stack terminal is the SUM, minus both ESRs', stack.v('b2', 'POS'), 3.0 - iStack * 0.3, 1e-9)
  near('1.2e loop current', stack.c.meters.get('b1')!.current, iStack, 1e-9, 'A')
  truth('1.2f neither cell is shorted: both carry the SAME loop current',
    Math.abs(stack.c.meters.get('b1')!.current - stack.c.meters.get('b2')!.current) < 1e-9,
    'equal to a nanoamp', `${stack.c.meters.get('b1')!.current} vs ${stack.c.meters.get('b2')!.current}`)

  /**
   * 1.3 ...AND IT DOES NOT DEPEND ON DOCUMENT ORDER. Which cell of a stack is
   * chosen would otherwise be an artefact of the order the student dropped them
   * on the canvas: picking the upper one is not wrong (currents are identical,
   * voltages differ by a constant) but it puts the pack's terminals at −1.5 V
   * and +1.5 V, which is not what a meter on the pack reads.
   */
  const reversed = run(
    doc(
      [
        place('b2', 'battery_pack_1v5', cellProps),
        place('b1', 'battery_pack_1v5', cellProps),
        place('r', 'resistor', { ohms: 100 }),
      ],
      seriesWires,
    ),
  )
  near('1.3 the same stack authored in the other order gives the same voltages',
    reversed.v('b1', 'NEG'), 0, 1e-9)

  /**
   * 1.4 A BATTERY AND A BOARD, WIRED TOGETHER. The island holds a `gnd` pin, so
   * rule 2 fires and the board's GND is the datum. The battery's negative sits
   * at 0 V because the student wired it there, not because the compiler decided.
   */
  /**
   * `ru` — a 1 kΩ from the Uno's 5V pad to one of its grounds — is not padding.
   * compile() prunes any net with fewer than two component terminals on it, so
   * an UNWIRED 5V pin earns no net and its VoltageSource is never stamped at
   * all. Without a load the rail does not exist to be asserted about.
   */
  const wired = run(
    doc(
      [
        place('u', 'arduino_uno'), place('b', 'battery_9v'),
        place('r', 'resistor', { ohms: 1000 }), place('ru', 'resistor', { ohms: 1000 }),
      ],
      [
        ['b', 'NEG', 'u', 'GND.1'], ['b', 'POS', 'r', '1'], ['r', '2', 'u', 'GND.2'],
        ['u', '5V', 'ru', '1'], ['ru', '2', 'u', 'GND.3'],
      ],
    ),
  )
  eq('1.4a battery wired to a board: one net, and it is net 0',
    wired.netOf.get('b NEG') === 0 && wired.netOf.get('u GND.1') === 0, true)
  near('1.4b ...and the board still holds its own 5 V rail', wired.v('u', '5V'), 5, 1e-9)
  near('1.4c ...with the battery referenced to that same ground', wired.v('b', 'NEG'), 0, 1e-12)

  /**
   * 1.5 A BATTERY AND A BOARD, **NOT** WIRED TOGETHER — the case a single global
   * datum gets silently wrong.
   *
   * Both references become net 0, which joins the two islands at exactly ONE
   * point. A single tie point completes no loop, so no current can cross: the
   * proof is that the battery's current and the board's rail are BIT-IDENTICAL
   * to the same circuit with the board deleted. If anything were shorting, this
   * is the assertion that would catch it.
   */
  const apart = run(
    doc(
      [
        place('u', 'arduino_uno'), place('b', 'battery_9v'),
        place('r', 'resistor', { ohms: 1000 }), place('ru', 'resistor', { ohms: 1000 }),
      ],
      [
        ['b', 'POS', 'r', '1'], ['r', '2', 'b', 'NEG'],
        ['u', '5V', 'ru', '1'], ['ru', '2', 'u', 'GND.3'],
      ],
    ),
  )
  const alone = run(
    doc(
      [place('b', 'battery_9v'), place('r', 'resistor', { ohms: 1000 })],
      [['b', 'POS', 'r', '1'], ['r', '2', 'b', 'NEG']],
    ),
  )
  const iAlone = 9 / 1001.7
  near('1.5a unwired battery beside a board: its loop current is unaffected',
    apart.c.meters.get('b')!.current, iAlone, 1e-9, 'A')
  truth('1.5b ...to the last bit, against the same circuit with no board at all',
    apart.c.meters.get('b')!.current === alone.c.meters.get('b')!.current,
    'identical', `${apart.c.meters.get('b')!.current} vs ${alone.c.meters.get('b')!.current}`)
  near('1.5c ...and the board’s 5 V rail is untouched', apart.v('u', '5V'), 5, 1e-9)
  near('1.5d ...and the battery still reads 0 V at its own negative post',
    apart.v('b', 'NEG'), 0, 1e-9)
  eq('1.5e nothing on the board is reported as shorted', apart.c.shortedPins, [])

  /**
   * 1.6 THREE ISLANDS, THREE SOURCES. The half-built-circuit-off-to-one-side
   * case, three times over. Each island gets its own reference and each source
   * reads its own EMF, with no interaction between them.
   */
  const three = run(
    doc(
      [
        place('a', 'battery_9v'),
        place('ra', 'resistor', { ohms: 1000 }),
        place('b', 'coin_cell_3v'),
        place('rb', 'resistor', { ohms: 1000 }),
        place('c', 'battery_pack_1v5', { switch: 'none' }),
        place('rc', 'resistor', { ohms: 1000 }),
      ],
      [
        ['a', 'POS', 'ra', '1'], ['ra', '2', 'a', 'NEG'],
        ['b', 'POS', 'rb', '1'], ['rb', '2', 'b', 'NEG'],
        ['c', 'POS', 'rc', '1'], ['rc', '2', 'c', 'NEG'],
      ],
    ),
  )
  for (const [id, emf, esr] of [['a', 9, 1.7], ['b', 3, 10], ['c', 6, 0.6]] as const) {
    near(`1.6 island "${id}": NEG at 0 V`, three.v(id, 'NEG'), 0, 1e-9)
    near(`1.6 island "${id}": POS at EMF − i·ESR`, three.v(id, 'POS'), emf * (1000 / (1000 + esr)), 1e-9)
  }

  /**
   * 1.7 AN ISLAND WITH NO SOURCE needs no datum: nothing is pushing, so every
   * node in it genuinely is at 0 V and gmin says so. Spending a chosen reference
   * to prove that would change nothing, so rule 4 leaves it alone.
   */
  const passiveIsland = run(
    doc(
      [
        place('b', 'battery_9v'), place('r0', 'resistor', { ohms: 1000 }),
        place('r1', 'resistor', { ohms: 470 }), place('r2', 'resistor', { ohms: 470 }),
      ],
      [['b', 'POS', 'r0', '1'], ['r0', '2', 'b', 'NEG'], ['r1', '2', 'r2', '1']],
    ),
  )
  truth('1.7 an unpowered island beside a powered one solves, at 0 V throughout',
    passiveIsland.res.ok &&
      Math.abs(passiveIsland.v('r1', '2')) < 1e-9 &&
      Math.abs(passiveIsland.v('r2', '1')) < 1e-9,
    'ok, 0 V', `ok:${passiveIsland.res.ok} ${passiveIsland.v('r1', '2')}`)

  /**
   * 1.8 THE PROBLEM MESSAGE. A reference now comes from a `gnd` pin OR from any
   * source's negative terminal, so "no reference" means exactly "no board and
   * nothing supplying power" — which is what it now says. The old sentence told
   * a student with a battery and a lamp to add an Arduino.
   */
  const unpowered = compile(doc([place('r', 'resistor', { ohms: 220 })], []))
  truth('1.8a nothing supplying power is reported as exactly that',
    unpowered.problems.some((p) => p.includes('supplying power')),
    'a power problem', JSON.stringify(unpowered.problems))
  truth('1.8b ...and the word "ground" no longer appears anywhere in it',
    !unpowered.problems.some((p) => /ground|GND|Arduino/i.test(p)),
    'no ground advice', JSON.stringify(unpowered.problems))
  eq('1.8c a battery-powered circuit reports nothing at all', alone.c.problems, [])

  /**
   * 1.9 A BATTERY'S TERMINALS WIRED TO EACH OTHER. This used to be the shape
   * that produced a singular matrix — a source stamped from a net to itself is a
   * degenerate branch row, which is why compile.ts has to special-case a board's
   * shorted 5 V pin. The ESR removes the whole problem: the EMF and the resistor
   * meet at an internal node, so the branch row is never degenerate and the
   * answer is the finite, correct, reportable 9 V / 1.7 Ω.
   */
  const shorted = run(doc([place('b', 'battery_9v')], [['b', 'POS', 'b', 'NEG']]))
  truth('1.9a a battery shorted across itself still solves', shorted.res.ok,
    'ok:true', `ok:${shorted.res.ok} ${shorted.res.error ?? ''}`)
  near('1.9b ...at exactly EMF / ESR', shorted.c.meters.get('b')!.current, 9 / 1.7, 1e-9, 'A')
}

// ══════════════════════════════════════════════════════════════════════════════
group('2. Cells and packs: series voltage, series ESR, the switch')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * 2.1 CELLS IN SERIES ADD. Four AA cells read 6.000 V open-circuit — no
   * current, so no i·R anywhere and the ESR is invisible. This is the reading a
   * meter across an unloaded pack gives and it is the only voltage in this suite
   * that does not depend on a load.
   */
  for (const n of [1, 2, 3, 4]) {
    const open = run(doc([place('p', 'battery_pack_1v5', { cells: n })], []))
    near(`2.1 ${n} AA cell(s), open circuit`, open.v('p', 'POS'), 1.5 * n, 1e-9)
  }

  /**
   * 2.2 AND SO DO THEIR INTERNAL RESISTANCES — which is what makes the loaded
   * reading fall BELOW 6.0 V. Hand-derived for four AA cells into 100 Ω with the
   * pack's switch fitted and closed:
   *
   *   EMF      = 4 × 1.5                        = 6.0 V
   *   R_int    = 4 × 0.15 + 0.03 (switch)       = 0.63 Ω
   *   I        = 6.0 / (0.63 + 100)             = 59.624366 mA
   *   V_term   = 6.0 − I × 0.63                 = 5.9624366 V
   *
   * The terminal voltage is 37.6 mV below the open-circuit figure, and that drop
   * is the whole reason ESR is modelled at all.
   */
  const packR = 4 * CELLS.aa.ohms + SWITCH_CONTACT_OHMS
  const iPack = 6.0 / (packR + 100)
  const loaded = run(
    doc(
      [place('p', 'battery_pack_1v5'), place('r', 'resistor', { ohms: 100 })],
      [['p', 'POS', 'r', '1'], ['r', '2', 'p', 'NEG']],
    ),
  )
  near('2.2a four AA into 100 Ω: current', loaded.c.meters.get('p')!.current, iPack, 1e-9, 'A')
  near('2.2b ...terminal voltage', loaded.v('p', 'POS'), 6.0 - iPack * packR, 1e-9)
  truth('2.2c ...and it is genuinely BELOW the 6.0 V open-circuit figure',
    loaded.v('p', 'POS') < 6.0 - 0.03,
    '< 5.97 V', `${loaded.v('p', 'POS').toPrecision(8)} V`)

  /**
   * 2.3 AA VERSUS AAA. Same chemistry, same 1.5 V, smaller can — so a higher
   * internal resistance and a harder sag. Four AAA into the same 100 Ω:
   *   R_int = 4 × 0.25 + 0.03 = 1.03 Ω,  I = 6.0/101.03 = 59.3883 mA
   */
  const aaaR = 4 * CELLS.aaa.ohms + SWITCH_CONTACT_OHMS
  const iAaa = 6.0 / (aaaR + 100)
  const aaa = run(
    doc(
      [place('p', 'battery_pack_1v5', { type: 'aaa' }), place('r', 'resistor', { ohms: 100 })],
      [['p', 'POS', 'r', '1'], ['r', '2', 'p', 'NEG']],
    ),
  )
  near('2.3a four AAA into 100 Ω: current', aaa.c.meters.get('p')!.current, iAaa, 1e-9, 'A')
  truth('2.3b AAA sags harder than AA at the same load and the same voltage',
    aaa.v('p', 'POS') < loaded.v('p', 'POS'),
    'V(AAA) < V(AA)', `${aaa.v('p', 'POS').toPrecision(6)} < ${loaded.v('p', 'POS').toPrecision(6)}`)

  /**
   * 2.4 THE BUILT-IN SWITCH, all three of its states.
   *
   *   fitted + ON   adds SWITCH_CONTACT_OHMS to the loop, so it draws very
   *                 slightly LESS than a pack with no switch at all;
   *   fitted + OFF  is an open circuit: no current, and 0 V at the terminals,
   *                 because a series switch breaks the connection to the cells
   *                 rather than draining them;
   *   none          is the pack wired straight through.
   */
  const noSwitchR = 4 * CELLS.aa.ohms
  const noSwitch = run(
    doc(
      [place('p', 'battery_pack_1v5', { switch: 'none' }), place('r', 'resistor', { ohms: 100 })],
      [['p', 'POS', 'r', '1'], ['r', '2', 'p', 'NEG']],
    ),
  )
  near('2.4a no switch fitted: current', noSwitch.c.meters.get('p')!.current,
    6.0 / (noSwitchR + 100), 1e-9, 'A')
  truth('2.4b ...and a fitted, closed switch really does cost its contact resistance',
    noSwitch.c.meters.get('p')!.current > loaded.c.meters.get('p')!.current,
    'more current with no switch',
    `${noSwitch.c.meters.get('p')!.current} vs ${loaded.c.meters.get('p')!.current}`)

  const off = run(
    doc(
      [place('p', 'battery_pack_1v5', { switch: 'off' }), place('r', 'resistor', { ohms: 100 })],
      [['p', 'POS', 'r', '1'], ['r', '2', 'p', 'NEG']],
    ),
  )
  truth('2.4c switched OFF: no current flows', Math.abs(off.c.meters.get('p')!.current) < 1e-9,
    '< 1 nA', `${off.c.meters.get('p')!.current.toExponential(2)} A`)
  near('2.4d ...and its terminals read 0 V, not the 6 V still inside it',
    off.v('p', 'POS'), 0, 1e-9)
  truth('2.4e ...while the pack still knows what it is set to',
    sourceSetting(getPart('battery_pack_1v5'), { switch: 'off' }).setVolts === 6,
    '6 V set', String(sourceSetting(getPart('battery_pack_1v5'), { switch: 'off' }).setVolts))

  /**
   * 2.5 THE OTHER TWO CELLS, open circuit — the figures the parts declare, read
   * back out through the solver rather than trusted from the table.
   */
  const nine = run(doc([place('b', 'battery_9v')], []))
  near('2.5a a 9 V PP3 reads 9.000 V open-circuit', nine.v('b', 'POS'), 9, 1e-9)
  const coin = run(doc([place('b', 'coin_cell_3v')], []))
  near('2.5b a CR2032 reads 3.000 V open-circuit', coin.v('b', 'POS'), 3, 1e-9)

  /**
   * 2.6 A COIN CELL'S 10 Ω IS THE PART OF IT WORTH TEACHING. Into 100 Ω a
   * CR2032 loses 9 % of its terminal voltage where an AA pack would lose 0.6 %:
   *   I = 3.0/110 = 27.2727 mA,  V = 3.0 × 100/110 = 2.72727 V
   */
  const coinLoaded = run(
    doc(
      [place('b', 'coin_cell_3v'), place('r', 'resistor', { ohms: 100 })],
      [['b', 'POS', 'r', '1'], ['r', '2', 'b', 'NEG']],
    ),
  )
  near('2.6 a CR2032 into 100 Ω sags to 100/110 of its EMF',
    coinLoaded.v('b', 'POS'), 3.0 * (100 / 110), 1e-9)
}

// ══════════════════════════════════════════════════════════════════════════════
group('3. Ratings: the faults an internal resistance makes reportable')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * A load resistance chosen so the current lands on a named side of a rating.
   * `R = V/I − ESR` is Ohm's law rearranged; nothing here is fitted.
   */
  function loadFor(volts: number, ohms: number, amps: number): number {
    return volts / amps - ohms
  }

  function faultsFor(type: string, ohms: number) {
    const { res } = run(
      doc(
        [place('b', type), place('r', 'resistor', { ohms })],
        [['b', 'POS', 'r', '1'], ['r', '2', 'b', 'NEG']],
      ),
    )
    return res.faults.filter((f) => f.deviceId === 'b.cell')
  }

  /**
   * 3.1 A CR2032 IS RATED FOR 3 mA CONTINUOUS AND 20 mA IN PULSES (Energizer's
   * own figures). Three loads, straddling both thresholds:
   *   2 mA  → silent;  10 mA → caution;  50 mA → destructive.
   */
  const coinCases = [
    [0.002, 0, 'nothing'],
    [0.01, 1, 'caution'],
    [0.05, 1, 'destructive'],
  ] as const
  for (const [amps, count, severity] of coinCases) {
    const f = faultsFor('coin_cell_3v', loadFor(3, CELLS.cr2032.ohms, amps))
    truth(`3.1 a CR2032 at ${(amps * 1000).toFixed(0)} mA reports ${severity}`,
      f.length === count && (count === 0 || f[0].severity === severity),
      `${count} fault, ${severity}`,
      f.length === 0 ? 'none' : `${f.length}, ${f[0].severity}`)
  }

  /**
   * 3.2 ...AND THE DESTRUCTIVE ONE SAYS SOMETHING TRUE AND SPECIFIC rather than
   * the generic "this destroys the board or the supply" a bare VoltageSource
   * raises. A cell asked for thirty times its rating does not destroy a board;
   * it gets hot and goes flat, and a lithium coin cell can vent.
   */
  const hot = faultsFor('coin_cell_3v', loadFor(3, CELLS.cr2032.ohms, 0.05))[0]
  truth('3.2a it names the cell rather than "a supply"', hot.message.includes('CR2032 coin cell'),
    'names CR2032', hot.message.slice(0, 60))
  truth('3.2b it quotes the rating it is past', hot.message.includes('3 mA'),
    'quotes 3 mA', hot.message.slice(0, 90))
  truth('3.2c it says what actually happens to a cell, not to a board',
    /vent|hot|burn/.test(hot.message) && !/destroys the board/.test(hot.message),
    'battery consequences', hot.message.slice(-80))

  /**
   * 3.3 A 9 V PP3 SHORTED BY A WIRE. Its ESR is what makes the answer finite and
   * the answer is 9/1.7 = 5.29 A — well past the 0.5 A the cell can survive, so
   * it is destructive. Without the ESR this would be a 1 mΩ short delivering
   * 9000 A, i.e. a number set by the solver's numerical floor rather than by any
   * property of the battery.
   */
  const dead = run(doc([place('b', 'battery_9v')], [['b', 'POS', 'b', 'NEG']]))
  near('3.3a a shorted PP3 delivers EMF/ESR', dead.c.meters.get('b')!.current, 9 / 1.7, 1e-9, 'A')
  truth('3.3b ...and that is a destructive fault',
    dead.res.faults.some((f) => f.deviceId === 'b.cell' && f.severity === 'destructive'),
    'destructive', JSON.stringify(dead.res.faults.map((f) => f.severity)))
  /**
   * 3.3c ...AND IT IS THE ONLY THING SAID. Found in the browser: the ESR is
   * stamped as a `Resistor`, which carries a 0.25 W rating and a safety() of its
   * own, so a shorted battery reported the true fault and then, under it,
   * "Resistor is dissipating 47.65 W — it is rated for 0.25 W and would burn
   * out" — against a part that is not on the canvas and cannot be swapped for a
   * bigger one. Exactly one fault, and it is the battery's.
   */
  eq('3.3c ...and the internal resistance does not ALSO report as a burnt resistor',
    dead.res.faults.map((f) => f.deviceId), ['b.cell'])

  /**
   * 3.4 A HEALTHY CIRCUIT STAYS SILENT. A 9 V battery through 220 Ω into a red
   * LED draws ~31 mA, which is under the PP3's 50 mA rating, so the BATTERY says
   * nothing — even though the LED itself has plenty to say about 31 mA. Two
   * different parts with two different datasheets, and only the one being abused
   * should speak.
   */
  const lamp = run(
    doc(
      [place('b', 'battery_9v'), place('r', 'resistor', { ohms: 220 }), place('d', 'led')],
      [['b', 'POS', 'r', '1'], ['r', '2', 'd', 'A'], ['d', 'C', 'b', 'NEG']],
    ),
  )
  eq('3.4 a 31 mA lamp circuit raises no BATTERY fault',
    lamp.res.faults.filter((f) => f.deviceId === 'b.cell').length, 0)
}

// ══════════════════════════════════════════════════════════════════════════════
group('4. The bench supply: constant voltage, then constant current')
// ══════════════════════════════════════════════════════════════════════════════
{
  function supply(props: Record<string, number | string>, ohms: number | null) {
    const parts = [place('s', 'power_supply', props)]
    const wires: Array<[string, string, string, string]> = []
    if (ohms !== null) {
      parts.push(place('r', 'resistor', { ohms }))
      wires.push(['s', 'POS', 'r', '1'], ['r', '2', 's', 'NEG'])
    }
    return run(doc(parts, wires))
  }

  const R_CC = 1e6 // RegulatedSupply's CC-region output resistance.

  /**
   * 4.1 OPEN CIRCUIT: no current, so no i·Rout, so the terminals are at exactly
   * the set voltage. This is the assertion a series-resistor-only model of a
   * current limit could not pass at any useful limit setting.
   */
  const open = supply({ voltage: 12, current: 5 }, null)
  near('4.1a set to 12 V, unloaded, reads 12.000 V', open.v('s', 'POS'), 12, 1e-9)
  near('4.1b ...and its negative post is the datum', open.v('s', 'NEG'), 0, 1e-12)

  /**
   * 4.2 CONSTANT VOLTAGE INTO A LOAD. A plain divider against the 10 mΩ output
   * impedance:  I = 12/(0.01 + 100) = 119.98800 mA,  V = 12 − I×0.01 = 11.99880 V.
   * The droop is 1.2 mV — a regulated supply, which is the point.
   */
  const cv = supply({ voltage: 12, current: 5 }, 100)
  const iCv = 12 / (SUPPLY_OUTPUT_OHMS + 100)
  near('4.2a 12 V into 100 Ω: current', cv.c.meters.get('s')!.current, iCv, 1e-9, 'A')
  near('4.2b ...terminal voltage', cv.v('s', 'POS'), 12 - iCv * SUPPLY_OUTPUT_OHMS, 1e-9)
  truth('4.2c ...and it holds its set voltage to within 2 mV',
    Math.abs(cv.v('s', 'POS') - 12) < 2e-3, '< 2 mV droop',
    `${((12 - cv.v('s', 'POS')) * 1e3).toPrecision(4)} mV`)
  eq('4.2d a supply inside its limit raises no fault',
    cv.res.faults.filter((f) => f.deviceId === 's').length, 0)

  /**
   * 4.3 THE CURRENT LIMIT ENGAGES. 12 V, 0.5 A limit, 10 Ω load: Ohm's law alone
   * would give 1.199 A, so the supply leaves constant voltage.
   *
   * On the constant-current segment RegulatedSupply declares
   *   V(d) = Vset − Ilim·Rout − (d − Ilim)·R_CC
   * and the load line is V = d·R, so
   *   d = (Vset − Ilim·Rout + Ilim·R_CC) / (R_CC + R)
   *     = (12 − 0.005 + 500000) / 1000010 = 0.50000699 A
   * and the terminals sit at d×10 = 5.0000699 V — which is Ilim·R to five
   * figures, i.e. a current source, which is what constant current means.
   */
  const cc = supply({ voltage: 12, current: 0.5 }, 10)
  const dCc = (12 - 0.5 * SUPPLY_OUTPUT_OHMS + 0.5 * R_CC) / (R_CC + 10)
  near('4.3a in current limit: the delivered current', cc.c.meters.get('s')!.current, dCc, 1e-9, 'A')
  near('4.3b ...which is the dialled limit to within 15 µA', cc.c.meters.get('s')!.current, 0.5, 1.5e-5, 'A')
  near('4.3c ...and the terminals fall to I×R, not the 12 V on the dial',
    cc.v('s', 'POS'), 0.5 * 10, 2e-4)
  truth('4.3d ...and it SAYS it is no longer holding the voltage',
    cc.res.faults.some((f) => f.deviceId === 's' && f.kind === 'supply_range'),
    'a supply_range note', JSON.stringify(cc.res.faults.map((f) => f.kind)))

  /**
   * 4.4 A DEAD SHORT ACROSS A BENCH SUPPLY is the case a plain series resistor
   * cannot report honestly: with a real 10 mΩ output impedance it would be
   * 1200 A. A real supply folds back to its limit, and so does this one. The
   * load is a 0 Ω resistor, which Resistor.stamp clamps to MIN_RESISTANCE.
   *   d = (12 − 0.05 + 5×10⁶)/(10⁶ + 10⁻³) = 5.0000119 A
   */
  const short = supply({ voltage: 12, current: 5 }, 0)
  const dShort = (12 - 5 * SUPPLY_OUTPUT_OHMS + 5 * R_CC) / (R_CC + 1e-3)
  truth('4.4a a shorted supply still converges, without gmin stepping',
    short.res.ok && !short.res.usedGminStepping,
    'ok, direct', `ok:${short.res.ok} gmin:${short.res.usedGminStepping} ${short.res.error ?? ''}`)
  near('4.4b ...at its current limit, not at V/Rout', short.c.meters.get('s')!.current, dShort, 1e-9, 'A')
  truth('4.4c ...which is 5 A rather than the 1200 A an unlimited supply would give',
    Math.abs(short.c.meters.get('s')!.current - 5) < 1e-4,
    '5 A', `${short.c.meters.get('s')!.current.toPrecision(8)} A`)

  /**
   * 4.5 THE LIMIT IS A REAL DIAL. Halving it halves the current a shorted supply
   * delivers — which is what makes it a control rather than a label.
   */
  for (const limit of [0.1, 0.5, 1, 2, 5]) {
    const s = supply({ voltage: 12, current: limit }, 0)
    near(`4.5 limit ${limit} A → shorted current`, s.c.meters.get('s')!.current, limit, 2e-5, 'A')
  }

  /** 4.6 THE OUTPUT SWITCH. Off is an open circuit at 0 V, not a flat supply. */
  const offSupply = supply({ voltage: 12, current: 5, on: 0 }, 100)
  truth('4.6a output off: no current',
    Math.abs(offSupply.c.meters.get('s')!.current) < 1e-9,
    '< 1 nA', `${offSupply.c.meters.get('s')!.current.toExponential(2)} A`)
  near('4.6b ...and 0 V at the terminals', offSupply.v('s', 'POS'), 0, 1e-9)

  /**
   * 4.7 EXPERIMENT 09's ACTUAL REQUIREMENT: 12 V into an L298N's motor rail.
   * The starter for `motor-control-rpi` has carried a comment saying "THERE IS
   * NO 12 V SUPPLY" and settling for the Pico's 5 V VBUS. There is now.
   *
   * An L298N needs Vs at least VIH + 2.5 V; 12 V clears that by a mile, where
   * 5 V cleared it by 0.2 V. The bridge's own ~2.5 V drop then leaves the motor
   * about 9.4 V instead of about 2.4 V.
   */
  const exp9 = run(
    doc(
      [
        place('s', 'power_supply', { voltage: 12, current: 5 }),
        place('l', 'l298n'),
        place('m', 'dc_motor'),
      ],
      [
        ['s', 'POS', 'l', 'VS'], ['s', 'NEG', 'l', 'GND'],
        ['l', 'OUT1', 'm', '1'], ['l', 'OUT2', 'm', '2'],
      ],
    ),
  )
  near('4.7a a 12 V supply really puts 12 V on an L298N’s VS',
    exp9.v('l', 'VS'), 12, 1e-2)
  truth('4.7b ...and the bridge reports its supply as in range',
    exp9.c.drivers.get('l')?.kind === 'h_bridge' &&
      (exp9.c.drivers.get('l') as { channels: Array<{ supplyOk: boolean }> }).channels[0].supplyOk,
    'supplyOk', String(
      exp9.c.drivers.get('l')?.kind === 'h_bridge' &&
        (exp9.c.drivers.get('l') as { channels: Array<{ supplyOk: boolean }> }).channels[0].supplyOk,
    ))
}

// ══════════════════════════════════════════════════════════════════════════════
group('5. A COMPLETE CIRCUIT WITH NO MICROCONTROLLER')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * THIS IS THE ONE THAT MATTERS. Battery, resistor, LED — the first circuit in
   * any electronics course, and until sources existed it could not be built
   * here at all.
   *
   * ─── THE EXPECTATION, DERIVED INDEPENDENTLY ──────────────────────────────────
   *
   * compile() builds the LED as a Shockley junction in series with LED_SERIES_R
   * of bulk resistance (createLED). Around the loop, with I the current:
   *
   *     9 = I·R_esr + I·R_series + I·LED_SERIES_R + n·V_T·ln(I/I_s + 1)
   *
   * with R_esr = 1.7 Ω (the PP3's), R_series = 220 Ω, LED_SERIES_R = 2 Ω, and
   * red's n = 1.8, I_s = 1e-20 A from LED_COLOURS. Every one of those is a
   * declared constant, not a fitted one.
   *
   * `solveLoop` below finds I by BISECTION on that equation. It is an
   * independent method — no matrix, no Newton, no linearisation, no gmin — so
   * agreement is evidence about the answer and not about the algorithm. The two
   * agree to well under a microamp.
   */
  const red = LED_COLOURS[0]
  function ledVolts(i: number): number {
    return red.n * VT * Math.log(i / red.is + 1)
  }
  function solveLoop(emf: number, ohms: number): number {
    // f(I) = emf − I·R − V_led(I) is strictly decreasing, so bisection is exact
    // to machine precision in ~60 halvings and cannot land on a wrong root.
    let lo = 0
    let hi = emf / ohms
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2
      if (emf - mid * ohms - ledVolts(mid) > 0) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }

  const lampDoc = doc(
    [
      place('bat', 'battery_9v'),
      place('r', 'resistor', { ohms: 220 }),
      place('led', 'led', { color: 'red' }),
    ],
    [['bat', 'POS', 'r', '1'], ['r', '2', 'led', 'A'], ['led', 'C', 'bat', 'NEG']],
  )
  const lamp = run(lampDoc)
  const expectedI = solveLoop(9, CELLS.pp3_9v.ohms + 220 + LED_SERIES_R)

  eq('5.1 it compiles with no problems at all', lamp.c.problems, [])
  truth('5.2 it SOLVES', lamp.res.ok, 'ok:true', `ok:${lamp.res.ok} ${lamp.res.error ?? ''}`)
  near('5.3 the LED current matches the bisected loop equation',
    lamp.c.leds.get('led')!.current, expectedI, 1e-7, 'A')
  near('5.4 the LED sits at its real forward voltage',
    lamp.v('r', '2') - lamp.v('led', 'C') - expectedI * LED_SERIES_R,
    ledVolts(expectedI), 1e-6)
  truth('5.5 ...which is a plausible red-LED forward voltage, 1.9–2.2 V',
    ledVolts(expectedI) > 1.9 && ledVolts(expectedI) < 2.2,
    '1.9–2.2 V', `${ledVolts(expectedI).toPrecision(5)} V`)
  near('5.6 KVL closes around the whole loop',
    lamp.v('bat', 'POS') - lamp.v('bat', 'NEG') -
      (expectedI * 220 + expectedI * LED_SERIES_R + ledVolts(expectedI)),
    0, 1e-6)
  near('5.7 the battery sags by exactly i·ESR', lamp.v('bat', 'POS'),
    9 - expectedI * CELLS.pp3_9v.ohms, 1e-6)

  /** 5.8 AND THE LED LIGHTS — which is the whole point of the exercise. */
  truth('5.8a the LED is drawing real current, not gmin leakage',
    lamp.c.leds.get('led')!.current > 0.01,
    '> 10 mA', `${(lamp.c.leds.get('led')!.current * 1000).toPrecision(5)} mA`)
  truth('5.8b ...so the canvas gets a brightness at full scale',
    ledBrightnessFor(lamp.c.leds.get('led')!.current) >= 1,
    'brightness 1.0', String(ledBrightnessFor(lamp.c.leds.get('led')!.current)))

  /**
   * 5.9 AND IT GETS THERE THROUGH THE PATH THE EDITOR USES. Everything above
   * goes through compile() and Circuit.solve() directly; this asserts the
   * board-less path the browser actually takes — `hasNoBoard` recognises the
   * document, `solvePassive` solves it, and the LED brightness and the device
   * readout come out the far end.
   */
  truth('5.9a the editor recognises a document with no MCU in it', hasNoBoard(lampDoc), 'true',
    String(hasNoBoard(lampDoc)))
  const passive = solvePassive(lampDoc)
  truth('5.9b ...solves it without error', passive.solveError === null, 'null',
    String(passive.solveError))
  near('5.9c ...publishes the LED at full brightness', passive.ledBrightness.led, 1, 1e-12, '')
  near('5.9d ...and the same current the direct solve found',
    passive.currents.led, expectedI, 1e-7, 'A')
  truth('5.9e ...and the battery reports its own terminal voltage',
    Math.abs(Number(passive.deviceStates.bat?.volts) - (9 - expectedI * CELLS.pp3_9v.ohms)) < 1e-6,
    'terminal V', String(passive.deviceStates.bat?.volts))

  /**
   * 5.10 POLARITY IS REAL. Turn the LED round and the same circuit goes dark —
   * the reverse leakage of a 1e-20 A junction is nine orders below anything
   * visible. A simulator in which an LED lights either way teaches the single
   * most common beginner mistake as a non-event.
   */
  const backwards = run(
    doc(
      [place('bat', 'battery_9v'), place('r', 'resistor', { ohms: 220 }), place('led', 'led')],
      [['bat', 'POS', 'r', '1'], ['r', '2', 'led', 'C'], ['led', 'A', 'bat', 'NEG']],
    ),
  )
  truth('5.10a an LED wired backwards passes essentially nothing',
    Math.abs(backwards.c.leds.get('led')!.current) < 1e-9,
    '< 1 nA', `${backwards.c.leds.get('led')!.current.toExponential(2)} A`)
  near('5.10b ...and is drawn dark', ledBrightnessFor(backwards.c.leds.get('led')!.current), 0, 1e-12, '')

  /**
   * 5.11 AND THE SWITCH ON THE PACK REALLY IS A SWITCH. Same lamp, run from a
   * 4-cell pack: closed it lights, open it does not. This is the prop travelling
   * all the way from the inspector to a photon.
   */
  function packLamp(sw: string) {
    const d = doc(
      [
        place('p', 'battery_pack_1v5', { switch: sw }),
        place('r', 'resistor', { ohms: 220 }),
        place('led', 'led'),
      ],
      [['p', 'POS', 'r', '1'], ['r', '2', 'led', 'A'], ['led', 'C', 'p', 'NEG']],
    )
    return solvePassive(d).ledBrightness.led
  }
  truth('5.11a pack switch ON: the LED lights', packLamp('on') > 0.5, '> 0.5',
    String(packLamp('on')))
  near('5.11b pack switch OFF: it goes out', packLamp('off'), 0, 1e-9, '')

  /**
   * 5.12 THE MEASUREMENTS PANEL HAS SOMETHING TO SHOW. A source reports what it
   * is set to AND what its terminals are at, which are the same number only when
   * nothing is drawing from it.
   */
  const states = analogDeviceStates({
    doc: lampDoc,
    netOf: lamp.c.netOf,
    nets: lamp.c.nets,
    voltages: lamp.res.voltages,
    reactive: lamp.c.reactive,
    drivers: lamp.c.drivers,
    sources: lamp.c.sources,
    transient: false,
  })
  truth('5.12a the battery reports as connected', states.bat?.connected === true, 'true',
    String(states.bat?.connected))
  near('5.12b ...at its loaded terminal voltage', Number(states.bat?.volts),
    9 - expectedI * CELLS.pp3_9v.ohms, 1e-6)
  near('5.12c ...delivering the loop current', Number(states.bat?.amps), expectedI, 1e-7, 'A')
  truth('5.12d ...and it is BELOW the 9 V it is nominally set to',
    Number(states.bat?.volts) < Number(states.bat?.setVolts),
    'loaded < open-circuit',
    `${Number(states.bat?.volts).toPrecision(6)} < ${Number(states.bat?.setVolts)}`)
}

// ══════════════════════════════════════════════════════════════════════════════
group('6. Every new prop provably reaches the solver')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * The differential probe in prop-reachability.ts, applied by name to the six
   * props these four parts declare. `solver` means compiling the part at two
   * different declared values produces two DIFFERENT circuits — which is the
   * only evidence that a control is wired to anything at all.
   *
   * This is the guard that did not exist when led.color shipped with a complete,
   * commented, tested datasheet table that compile.ts never read.
   */
  const reach = propReachability()
  const expected: Array<[string, string]> = [
    ['battery_pack_1v5', 'cells'],
    ['battery_pack_1v5', 'type'],
    ['battery_pack_1v5', 'switch'],
    ['power_supply', 'voltage'],
    ['power_supply', 'current'],
    ['power_supply', 'on'],
  ]
  for (const [type, key] of expected) {
    const r = reach.find((x) => x.type === type && x.key === key)
    truth(`6.1 ${type}.${key} reaches the SOLVER`, r?.reach === 'solver', 'solver',
      `${r?.reach ?? 'NOT PROBED'} (probed ${r?.probed.join(' vs ') ?? '—'})`)
  }

  /** 6.2 The two fixed cells declare no props, matching Tinkercad's own inspector. */
  for (const type of ['battery_9v', 'coin_cell_3v']) {
    eq(`6.2 ${type} declares no props`, (getPart(type).props ?? []).length, 0)
  }

  /** 6.3 All four are in the library AND on the palette — placeable, not just declared. */
  for (const type of ['battery_9v', 'coin_cell_3v', 'battery_pack_1v5', 'power_supply']) {
    truth(`6.3 ${type} is in the library and on the palette`,
      PART_LIBRARY[type] !== undefined && PALETTE.includes(type),
      'both', `library:${PART_LIBRARY[type] !== undefined} palette:${PALETTE.includes(type)}`)
  }

  /**
   * 6.4 THE INSPECTOR SHOWS WHAT THE ENGINE USES. Every prop's declared default
   * has to equal what sourceSetting() falls back to for a document that carries
   * no value for it — the resistor's old trap, where the panel showed 0 Ω over a
   * part compile.ts was solving at 220 Ω.
   */
  for (const type of ['battery_pack_1v5', 'power_supply']) {
    const def = getPart(type)
    const declared: Record<string, number | string> = {}
    for (const p of def.props ?? []) declared[p.key] = p.default as number | string
    eq(`6.4 ${type}: declared defaults compile to the same source as no props at all`,
      sourceSetting(def, declared), sourceSetting(def, {}))
  }

  /**
   * 6.5 THE PACK'S ARTWORK FOLLOWS ITS COUNT. The canvas hides bays 2–4 from
   * `sourceSetting(...).count`, so the SVG has to declare the custom properties
   * it reads. A picture that could not respond to the selectbox would be the
   * LED-colour bug with better graphics.
   */
  const packSvg = getPart('battery_pack_1v5').svg
  for (const cell of [2, 3, 4]) {
    truth(`6.5 the pack artwork reads --pack-cell-${cell}`,
      packSvg.includes(`var(--pack-cell-${cell}`), 'present',
      packSvg.includes(`var(--pack-cell-${cell}`) ? 'present' : 'MISSING')
  }
  /**
   * 6.6 A `select` WITH NO UNIT READS AS A NUMBER. Found in the browser: the
   * inspector appended `prop.unit` unconditionally, so the pack's `Count`
   * rendered as "1 undefined / 2 undefined / …". Every select in the library was
   * a resistance or a capacitance until this one, so nothing had exposed it.
   * `unit` is optional on PropSpec and now behaves that way — and the two
   * special cases stay attached to the unit that gives them meaning: "none
   * (wire)" is about 0 Ω and says nothing about 0 cells, and "4 k" with nothing
   * after it is not a value.
   */
  eq('6.6a a unitless select option is just the number',
    [1, 2, 4].map((n) => selectOptionLabel(n, undefined)), ['1', '2', '4'])
  eq('6.6b ...and a unit-bearing one keeps every affordance it had',
    [0, 220, 4700].map((n) => selectOptionLabel(n, 'Ω')), ['none (wire)', '220 Ω', '4.7 kΩ'])
  eq('6.6c the pack’s Count declares no unit, which is why it is now readable',
    (getPart('battery_pack_1v5').props ?? []).find((p) => p.key === 'cells')?.unit, undefined)

  truth('6.5 the supply artwork reads its knob angle',
    getPart('power_supply').svg.includes('var(--supply-knob'), 'present',
    getPart('power_supply').svg.includes('var(--supply-knob') ? 'present' : 'MISSING')
}

// ══════════════════════════════════════════════════════════════════════════════
group('7. Limitations: what is NOT modelled, said once and said accurately')
// ══════════════════════════════════════════════════════════════════════════════
{
  const one = compile(doc([place('b', 'battery_9v')], []))
  eq('7.1 a source pushes exactly one limitation', one.limitations.length, 1)
  truth('7.2 ...and it is about capacity and runtime, which really are unmodelled',
    /never run down/.test(one.limitations[0]) &&
      /capacity/.test(one.limitations[0]) &&
      /runtime/.test(one.limitations[0]),
    'capacity + runtime', one.limitations[0].slice(0, 70))
  truth('7.3 ...and it is careful to say the voltage drop under load IS modelled',
    /voltage drop under load IS modelled/.test(one.limitations[0]),
    'names what works', one.limitations[0].slice(-90))

  const four = compile(
    doc(
      [place('a', 'battery_9v'), place('b', 'coin_cell_3v'),
        place('c', 'battery_pack_1v5'), place('d', 'power_supply')],
      [],
    ),
  )
  eq('7.4 four sources still push exactly one', four.limitations.length, 1)

  const none = compile(doc([place('r', 'resistor', { ohms: 220 })], []))
  eq('7.5 a circuit with no source pushes none', none.limitations.length, 0)

  /**
   * 7.6 THE BOARD-LESS PATH ADDS ONE MORE, and only when it would bite. Time
   * does not advance without an MCU (the clock IS the CPU), so a capacitor in a
   * board-less circuit sits at its DC steady state. A battery and a lamp have no
   * time constant, so that note would be a warning about nothing.
   */
  const withCap = solvePassive(
    doc(
      [place('b', 'battery_9v'), place('c', 'capacitor', { microfarads: 100 })],
      [['b', 'POS', 'c', '1'], ['c', '2', 'b', 'NEG']],
    ),
  )
  truth('7.6a a board-less circuit WITH a capacitor is told time is not advancing',
    withCap.limitations.some((l) => /Time does not advance/.test(l)),
    'a timing note', JSON.stringify(withCap.limitations.length))
  const noCap = solvePassive(
    doc(
      [place('b', 'battery_9v'), place('r', 'resistor', { ohms: 1000 })],
      [['b', 'POS', 'r', '1'], ['r', '2', 'b', 'NEG']],
    ),
  )
  truth('7.6b ...and one without is not warned about nothing',
    !noCap.limitations.some((l) => /Time does not advance/.test(l)),
    'no timing note', JSON.stringify(noCap.limitations.length))
}

// ══════════════════════════════════════════════════════════════════════════════
group('8. Device-level algebra, away from the compiler')
// ══════════════════════════════════════════════════════════════════════════════
{
  /**
   * 8.1 RegulatedSupply's V(I) law, checked segment by segment against three
   * load lines solved on paper. Built by hand so the compiler is not in the way.
   */
  for (const [rLoad, limit, name] of [
    [1000, 5, 'far inside CV'],
    [1, 5, 'just inside CV'],
    [1, 0.5, 'in CC'],
  ] as const) {
    const c = new Circuit()
    const pos = c.allocNet()
    const s = new RegulatedSupply('s', pos, 0, 10, limit, SUPPLY_OUTPUT_OHMS)
    c.add(s, new Resistor('r', pos, 0, rLoad))
    const res = c.solve()
    const cvI = 10 / (SUPPLY_OUTPUT_OHMS + rLoad)
    const ccI = (10 - limit * SUPPLY_OUTPUT_OHMS + limit * 1e6) / (1e6 + rLoad)
    const want = cvI <= limit ? cvI : ccI
    near(`8.1 ${name}: R=${rLoad} Ω, limit ${limit} A`, s.current, want, 1e-9, 'A')
    truth(`8.1 ${name}: converged`, res.ok, 'ok', `${res.ok} ${res.error ?? ''}`)
  }

  /**
   * 8.2 Battery.safety() judges the MAGNITUDE, so a cell being charged backwards
   * by a bigger source is called out in the same numbers as one being drained.
   * A 9 V PP3 wired across a 12 V supply is pushed at (12−9)/1.7 = 1.76 A, well
   * past its 0.5 A absolute maximum.
   */
  const c = new Circuit()
  const mid = c.allocNet()
  const top = c.allocNet()
  const emf = new Battery('b.cell', mid, 0, 9, CELLS.pp3_9v)
  c.add(
    emf,
    new Resistor('b.esr', mid, top, CELLS.pp3_9v.ohms),
    new RegulatedSupply('s', top, 0, 12, 5, SUPPLY_OUTPUT_OHMS),
  )
  const back = c.solve()
  const ctx = { voltage: (n: number) => (n === 0 ? 0 : back.voltages[n]), x: back.x } as never
  const f = emf.safety(ctx)
  near('8.2a a 9 V cell across a 12 V supply is charged at (12−9)/R',
    Math.abs(emf.current), 3 / (CELLS.pp3_9v.ohms + SUPPLY_OUTPUT_OHMS), 1e-6, 'A')
  truth('8.2b ...and that is destructive, in the same words as a discharge',
    f?.severity === 'destructive', 'destructive', String(f?.severity))
}

// ─── Report ──────────────────────────────────────────────────────────────────

const nameW = Math.max(30, ...rows.map((r) => r.name.length))
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
