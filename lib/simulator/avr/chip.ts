/**
 * Which AVR the engine is emulating.
 *
 * SimulationEngine used to BE an ATmega328P: `new CPU(program)` with avr8js's
 * default flash size, three hardcoded ports, `for (let ch = 0; ch < 6; ch++)`
 * for the ADC, and a module-level PIN_MAP of an Uno's twenty pins. All of that
 * was correct and none of it was named, so an Arduino Mega could not be added
 * without either rewriting the engine or copying it.
 *
 * This file gives the chip-specific half a name and one shape. It is a lookup
 * table over a two-entry union, in the same spirit as model/boards.ts and for
 * the same reason: two AVRs share an emulator, an instruction decoder and a
 * PinBridge, so the difference between them really is data. A third TRACK (the
 * Pico) is not data and does not appear here — that is `BoardProfile.track`'s
 * job, one level up.
 *
 * The ATmega2560 half lives in ./atmega2560.ts, with the datasheet table for
 * every address; this file holds the interface and the ATmega328P, which is
 * just avr8js's own exported configuration under a name.
 */

import {
  adcConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  type ADCConfig,
  type AVRPortConfig,
  type AVRTimerConfig,
} from 'avr8js'
import type { CircuitDoc } from '../model/document'
import { getPart, type BoardType } from '../model/parts'
import { ATMEGA2560 } from './atmega2560'

/**
 * avr8js exports `usart0Config` but not its interface, so the shape is taken
 * from the value. Structurally identical to the library's own USARTConfig.
 */
export type USARTConfig = typeof usart0Config

export interface AvrChip {
  id: 'atmega328p' | 'atmega2560'
  label: string
  /**
   * Program memory size in BYTES.
   *
   * Also decides the PC width: avr8js sets `pc22Bits` from
   * `progBytes.length > 0x20000`, and pc22Bits is what makes CALL/RET/RETI and
   * avrInterrupt() push a three-byte return address. Under-sizing a 2560's
   * flash therefore corrupts the stack on the first interrupt, not merely
   * truncates the program.
   */
  flashBytes: number
  /** The `sramBytes` argument to `new CPU()`. Data memory is this plus 0x100. */
  cpuSramBytes: number
  /** Board silkscreen pin id ("D13", "A0") → (port letter, bit 0–7). */
  pinMap: Readonly<Record<string, readonly [string, number]>>
  /** Port letter → its avr8js port configuration. */
  ports: Readonly<Record<string, AVRPortConfig>>
  /** Every timer to instantiate, in numeric order. */
  timers: readonly AVRTimerConfig[]
  /** The USART behind `Serial`. */
  usart0: USARTConfig
  adc: ADCConfig
  /** Analog pin id → ADC channel, in the order the readout lists them. */
  adcPins: ReadonlyArray<readonly [string, number]>
}

/** Arduino Uno silkscreen name → (port, bit). */
const UNO_PIN_MAP: Record<string, readonly [string, number]> = {
  D0: ['D', 0], D1: ['D', 1], D2: ['D', 2], D3: ['D', 3],
  D4: ['D', 4], D5: ['D', 5], D6: ['D', 6], D7: ['D', 7],
  D8: ['B', 0], D9: ['B', 1], D10: ['B', 2], D11: ['B', 3],
  D12: ['B', 4], D13: ['B', 5],
  A0: ['C', 0], A1: ['C', 1], A2: ['C', 2],
  A3: ['C', 3], A4: ['C', 4], A5: ['C', 5],
}

/**
 * The ATmega328P, entirely from avr8js's own exports.
 *
 * `cpuSramBytes` is 8192 — avr8js's default, and what `new CPU(program)` has
 * always allocated here. A real 328P has 2 KB and RAMEND 0x08FF, so the reset
 * stack pointer this produces is too high; it has never mattered because
 * avr-gcc's .init2 assigns SP from RAMEND before any code runs, and every
 * .hex in public/sim/ does exactly that. It is left alone deliberately:
 * tightening it changes the reset state of the board students are already
 * running, to fix something no firmware can observe.
 */
export const ATMEGA328P: AvrChip = {
  id: 'atmega328p',
  label: 'ATmega328P',
  flashBytes: 0x8000,
  cpuSramBytes: 8192,
  pinMap: UNO_PIN_MAP,
  ports: { B: portBConfig, C: portCConfig, D: portDConfig },
  timers: [timer0Config, timer1Config, timer2Config],
  usart0: usart0Config,
  adc: adcConfig,
  adcPins: Array.from({ length: 6 }, (_, ch) => [`A${ch}`, ch] as const),
}

/** Every AVR the engine can run, keyed by the board that carries it. */
export const CHIP_OF_BOARD: Partial<Record<BoardType, AvrChip>> = {
  arduino_uno: ATMEGA328P,
  arduino_mega: ATMEGA2560,
}

/**
 * Which AVR this document contains.
 *
 * Deliberately NOT detectBoard(): that lives in model/boards.ts, returns a
 * BoardProfile (label, track, dbBoard) and is the editor's concern. This is the
 * emulator's concern and answers a narrower question, so it can be called from
 * the worker before an engine exists — which it has to be, because
 * parseIntelHex() needs the flash size before the CPU is built.
 *
 * Falls back to the ATmega328P for a document with no AVR at all. That is not a
 * guess that papers over a mistake: useBoardSimulator only ever starts the AVR
 * worker for a document whose board is on the `avr` track, so the fallback is
 * reached only by a direct SimulationEngine construction (tests, the dev
 * harness) where an Uno is the historical default.
 */
export function chipForDoc(doc: CircuitDoc): AvrChip {
  for (const part of doc.parts) {
    const el = getPart(part.type).electrical
    if (el.kind !== 'mcu') continue
    const chip = CHIP_OF_BOARD[el.board]
    if (chip) return chip
  }
  return ATMEGA328P
}
