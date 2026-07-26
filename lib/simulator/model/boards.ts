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
  /**
   * Count MCU *parts*, not distinct board TYPES.
   *
   * This used to collect into a `Set<BoardType>`, which meant two Arduino Unos
   * collapsed to a single entry and the function reported one valid board and
   * no problem at all — the exact silent-and-wired outcome the doc comment
   * above says we refuse to produce. And it hit the commonest way a student
   * draws two boards: dragging the same one in twice. An Uno beside a Mega was
   * caught; an Uno beside an Uno was not.
   *
   * It was not cosmetic. compile.ts registers MCU pins into `mcuPorts` keyed by
   * bare pin name, so a second Uno's "D13" overwrote the first's and the engine
   * drove whichever board happened to come last in `doc.parts`. The other one
   * sat there looking connected and doing nothing.
   */
  const mcus: BoardType[] = []
  for (const part of doc.parts) {
    const el = getPart(part.type).electrical
    if (el.kind === 'mcu') mcus.push(el.board)
  }
  const present = (Object.keys(BOARDS) as BoardType[]).filter((b) => mcus.includes(b))

  if (mcus.length === 1) return { board: BOARDS[mcus[0]], present, problem: null }
  if (mcus.length === 0) {
    /**
     * NOT AN ERROR ANY MORE, and the wording had to stop implying it was.
     *
     * This sentence used to be the whole answer for a board-less document,
     * back when a board was the only thing in the library that could push a
     * current — no MCU meant nothing to run AND nothing to solve. With
     * batteries and a bench supply on the palette that is no longer true: the
     * circuit is solved on the main thread (see passive.ts) and its LEDs light.
     * What is genuinely missing is a place to put CODE, so that is what it
     * says, and it offers the boards rather than demanding one.
     */
    /**
     * "or", not `listOf`'s "and". The list is a CHOICE of one board, and the
     * multi-board branch below refuses a document that takes two of them — so
     * "add an Arduino Uno, an Arduino Mega and a Pico" is advice this same
     * function would then reject.
     */
    const names = (Object.keys(BOARDS) as BoardType[]).map((b) => BOARDS[b].label)
    const choice = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
    return {
      board: null,
      present,
      problem:
        `No microcontroller in the circuit, so there is no code to run — the circuit itself ` +
        `is still solved. Add ${choice} if you want to program it.`,
    }
  }
  /**
   * More than one board, named and COUNTED rather than hardcoded.
   *
   * The reason holds even for two boards on the same track: an Uno and a Mega
   * are both avr8js, but they are still two CPUs with two independent clocks,
   * and one engine advances one of them. It holds just as hard for two of the
   * SAME board, which is why the count is spelled out — "This circuit has 2
   * Arduino Unos" is the sentence a student who dragged one in twice needs, and
   * naming the type alone would read as though one of them were fine.
   */
  const count = new Map<BoardType, number>()
  for (const b of mcus) count.set(b, (count.get(b) ?? 0) + 1)
  const named = present.map((b) => {
    const n = count.get(b) ?? 0
    return n === 1 ? `${article(BOARDS[b].label)} ${BOARDS[b].label}` : `${n} ${BOARDS[b].label}s`
  })
  return {
    board: null,
    present,
    problem:
      `This circuit has ${listOf(named)}. ` +
      `Only one board can run at a time — each is its own CPU with its own ` +
      `clock, and the engine advances one. Remove all but one.`,
  }
}

/**
 * "an Arduino Uno", but "a Raspberry Pi Pico".
 *
 * The article used to be a hardcoded "an", which was right for both Arduinos
 * and wrong for the Pico from the day it was added.
 */
function article(label: string): string {
  return /^[aeiou]/i.test(label) ? 'an' : 'a'
}

/** "a, b and c" — for a problem sentence a student reads. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
