/**
 * The operating point of a circuit with NO MICROCONTROLLER in it.
 *
 * ─── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────
 *
 * Both engines are built around a CPU. `SimulationEngine` owns an avr8js `CPU`
 * and advances the analog solve on pin edges; `PicoSimulationEngine` does the
 * same around rp2040js. Neither can be constructed without firmware, and the
 * editor's Start button is gated on `detectBoard(doc).board !== null` — so a
 * document with no board never reached a solver at all. The LED in a
 * battery-resistor-LED circuit stayed dark, no current appeared in Measurements,
 * and no fault could ever be raised, because nothing had solved anything.
 *
 * That was fine while a board was the only thing in the library that could push
 * a current. With batteries and a bench supply on the palette it is the
 * difference between "a student can build and run a circuit with no
 * microcontroller" being true and being a claim.
 *
 * ─── WHAT IT IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────────────
 *
 * ONE DC OPERATING POINT of the compiled circuit, read out through exactly the
 * same functions the two engines read theirs through: `Circuit.solve()` for the
 * numbers, `ledBrightnessFor()` for the glow, `analogDeviceStates()` for the
 * per-part readout. Nothing here re-derives anything, so a battery-lit LED and
 * an Uno-lit LED cannot disagree about what a milliamp looks like.
 *
 * IT DOES NOT ADVANCE TIME, and that is a real limit rather than an oversight. A
 * transient needs a clock, and in both engines the clock IS the CPU: `stepTransient`
 * is driven from `cpu.cycles`, and the step size comes from the circuit's own
 * smallest time constant measured between instruction batches. A free-running
 * time base for board-less documents is a feature, not a line of code, and
 * inventing one here would mean two different notions of simulated time in one
 * editor. So a capacitor in a board-less circuit sits at its DC limit — an open,
 * which is its true steady state — and `limitations` says so out loud rather
 * than letting a student wait for a charge curve that is never coming.
 */

import { analogDeviceStates, ledBrightnessFor } from './analog-state'
import type { DeviceState } from './behavioural'
import { compile, type CompileResult } from './model/compile'
import type { CircuitDoc } from './model/document'
import { getPart } from './model/parts'
import type { SolveFault } from './types'

export interface PassiveSolve {
  /** Part id → 0…1, for the canvas. */
  ledBrightness: Record<string, number>
  /** Part id → amps, for the Measurements panel. */
  currents: Record<string, number>
  /** Destructive conditions found in the converged solution. */
  faults: SolveFault[]
  /** Part id → what that part is doing, for the device readout. */
  deviceStates: Record<string, DeviceState>
  /** Set when the solve failed. Null on success. */
  solveError: string | null
  /** Matrix unknowns, so the same diagnostic line works on this path. */
  unknowns: number
  /** compile()'s problems and limitations, plus anything this path adds. */
  problems: string[]
  limitations: string[]
}

/**
 * True when this document has nothing that could run firmware.
 *
 * Asked of the DOCUMENT rather than of `detectBoard`, and the difference is the
 * two-board case: `detectBoard` refuses a document with two Unos in it, which is
 * a document that HAS boards and cannot be run. Solving that one passively would
 * put 5 V rails on the canvas from boards the editor has just said it will not
 * run, so it is left alone — the refusal is the honest state and it already has
 * a message.
 */
export function hasNoBoard(doc: CircuitDoc): boolean {
  return !doc.parts.some((p) => getPart(p.type).electrical.kind === 'mcu')
}

/**
 * Solve a board-less document and read out everything the panels show.
 *
 * Takes an already-compiled result when the caller has one — the editor compiles
 * every document on the main thread anyway for pin-hover highlighting, so on
 * that path this costs one `solve()` and nothing else.
 */
export function solvePassive(doc: CircuitDoc, compiled: CompileResult = compile(doc)): PassiveSolve {
  const res = compiled.circuit.solve()

  const currents: Record<string, number> = {}
  for (const [partId, dev] of compiled.meters) currents[partId] = dev.current

  const ledBrightness: Record<string, number> = {}
  for (const [partId, diode] of compiled.leds) {
    ledBrightness[partId] = ledBrightnessFor(diode.current)
  }

  const limitations = [...compiled.limitations]
  /**
   * The one thing this path cannot do, said only when it would actually bite.
   *
   * Pushed for a document that HOLDS a reactive element, not for every board-less
   * circuit: a battery, a resistor and a lamp have no time constant and no charge
   * curve, so a standing note about time would be a warning about nothing — the
   * exact noise the Checks panel's limitation footnotes were rewritten to stop.
   */
  if (compiled.circuit.hasReactive) {
    limitations.push(
      'Time does not advance in a circuit with no board in it: the clock this simulator ' +
        'integrates against is the microcontroller’s own, so with no MCU there is nothing to ' +
        'step. The capacitors and inductors here are solved at their steady state instead — a ' +
        'capacitor as an open circuit, an inductor as a wire, which is what each becomes once it ' +
        'has settled. Charge and discharge curves need a board on the canvas.',
    )
  }

  return {
    ledBrightness,
    currents,
    faults: res.faults,
    deviceStates: analogDeviceStates({
      doc,
      netOf: compiled.netOf,
      nets: compiled.nets,
      voltages: res.voltages,
      reactive: compiled.reactive,
      drivers: compiled.drivers,
      sources: compiled.sources,
      transient: false,
    }),
    solveError: res.ok ? null : (res.error ?? 'circuit did not solve'),
    unknowns: compiled.unknowns,
    problems: compiled.problems,
    limitations,
  }
}
