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
  dbBoard: 'arduino_uno' | 'arduino_nano' | 'rp2040' | 'arduino_mega'
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
  /**
   * The Arduino Mega shares the Uno's TRACK and differs only in its chip.
   *
   * That is the whole reason this file did not have to become a plugin
   * framework to take a third board: same emulator, same worker, same .hex
   * toolchain, same 5 V logic. Which ATmega runs is chosen one level down, by
   * chipForDoc() in lib/simulator/avr/chip.ts, off the same document.
   *
   * `dbBoard: 'arduino_mega'` is a value migration 015's check constraint did
   * NOT originally allow — it permitted ('arduino_uno','arduino_nano','rp2040')
   * only. Migration 025 widens it additively before inserting anything.
   */
  arduino_mega: {
    type: 'arduino_mega',
    label: 'Arduino Mega 2560',
    logicVolts: 5,
    track: 'avr',
    language: 'arduino_c',
    dbBoard: 'arduino_mega',
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
    const names = (Object.keys(BOARDS) as BoardType[]).map((b) => BOARDS[b].label)
    return {
      board: null,
      present,
      problem: `No microcontroller in the circuit — add ${listOf(names)}.`,
    }
  }
  /**
   * Two boards, listed by name rather than hardcoded.
   *
   * The reason holds even for two boards on the SAME track: an Uno and a Mega
   * are both avr8js, but they are still two CPUs with two independent clocks,
   * and one engine advances one of them. Naming the actual pair matters now
   * that there are three boards and therefore three possible pairs.
   */
  return {
    board: null,
    present,
    problem:
      `This circuit has ${listOf(present.map((b) => `an ${BOARDS[b].label}`))}. ` +
      `Only one board can run at a time — each is its own CPU with its own ` +
      `clock, and the engine advances one. Remove all but one.`,
  }
}

/** "a, b and c" — for a problem sentence a student reads. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
