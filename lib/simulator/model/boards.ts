/**
 * Which emulator runs this document.
 *
 * The two tracks are genuinely different machines, not two configurations of
 * one: `avr8js` executing a .hex avr-gcc produced, versus `rp2040js` executing
 * a prebuilt MicroPython that the student's .py is typed into over an emulated
 * USB REPL. They do not even share a snapshot shape — an Uno reports 10-bit ADC
 * counts and behavioural device states, a Pico additionally reports the REPL
 * phase and the on-board LED.
 *
 * So this file is deliberately NOT a plugin framework. It is a lookup table
 * over the closed BoardType union plus one function that reads the document,
 * which is the whole of what "board-aware engine selection" needs for two
 * boards. A third board is a new emulator, a new worker and a new toolchain;
 * pretending otherwise here would cost more than it saved.
 */

import type { CircuitDoc } from './document'
import { getPart, type BoardType } from './parts'

export interface BoardProfile {
  type: BoardType
  label: string
  /** What a pin driving HIGH puts on the wire. Mirrors PartDefinition. */
  logicVolts: number
  /** Which emulator and worker run it. */
  track: 'avr' | 'rp2040'
  /** What the student writes, and therefore how firmware reaches the board. */
  language: 'arduino_c' | 'micropython'
  /**
   * The value `circuits.board` must carry in the database.
   *
   * NOT the same string as `type`, and that is not an oversight: migration 015
   * created the column with `check (board in ('arduino_uno','arduino_nano',
   * 'rp2040'))` long before this part existed, so a row saying
   * 'raspberry_pi_pico' is rejected outright. Recording the mapping here means
   * the authoring migration reads it off a named field instead of a migration
   * author guessing — and if the constraint is ever widened, this is the one
   * line that changes.
   */
  dbBoard: 'arduino_uno' | 'arduino_nano' | 'rp2040'
}

export const BOARDS: Record<BoardType, BoardProfile> = {
  arduino_uno: {
    type: 'arduino_uno',
    label: 'Arduino Uno',
    logicVolts: 5,
    track: 'avr',
    language: 'arduino_c',
    dbBoard: 'arduino_uno',
  },
  raspberry_pi_pico: {
    type: 'raspberry_pi_pico',
    label: 'Raspberry Pi Pico',
    logicVolts: 3.3,
    track: 'rp2040',
    language: 'micropython',
    dbBoard: 'rp2040',
  },
}

export interface BoardDetection {
  /** The board to run, or null if there is not exactly one. */
  board: BoardProfile | null
  /** Every distinct board type placed in the document, in palette order. */
  present: BoardType[]
  /**
   * Why `board` is null, in a sentence fit for the Checks panel — or null when
   * there is nothing wrong. Reported rather than thrown: a half-built document
   * with no board yet is the normal state of a blank canvas, not an error.
   */
  problem: string | null
}

/**
 * Which board this document runs on.
 *
 * Two boards in one document is a real thing a student can draw and the honest
 * answer is that we cannot run it: the two emulators own their own clocks, and
 * co-simulating them would mean interleaving two independent time bases through
 * one solver. Saying so is better than silently picking whichever was placed
 * first and leaving the other board inert but wired.
 */
export function detectBoard(doc: CircuitDoc): BoardDetection {
  const seen = new Set<BoardType>()
  for (const part of doc.parts) {
    const el = getPart(part.type).electrical
    if (el.kind === 'mcu') seen.add(el.board)
  }
  const present = (Object.keys(BOARDS) as BoardType[]).filter((b) => seen.has(b))

  if (present.length === 1) return { board: BOARDS[present[0]], present, problem: null }
  if (present.length === 0) {
    return {
      board: null,
      present,
      problem: 'No microcontroller in the circuit — add an Arduino Uno or a Raspberry Pi Pico.',
    }
  }
  return {
    board: null,
    present,
    problem:
      `This circuit has both an ${BOARDS.arduino_uno.label} and a ` +
      `${BOARDS.raspberry_pi_pico.label}. Only one board can run at a time — ` +
      `they are separate emulators with their own clocks. Remove one.`,
  }
}
