/**
 * Raspberry Pi Pico — the GPIO/ADC maps the emulator bridge needs.
 *
 * The board's GEOMETRY (40 header pins, the GND bus, the SVG, the 3.3 V rail)
 * now lives in model/parts.ts next to the Uno, where a placeable part belongs;
 * this file is only the RP2040-specific lookup tables that turn a document pin
 * id into something rp2040js understands. Splitting it that way is what keeps
 * the imports acyclic: parts.ts owns the data, this file reads it, and
 * pico/engine.ts reads this file.
 *
 * There used to be a `registerPicoPart()` here that spliced the Pico into
 * PART_LIBRARY and PALETTE at import time, because parts.ts was owned by
 * another workstream. That stopgap is gone — the part is registered normally.
 */

import { getPart, type PartDefinition } from '../model/parts'

export const PICO_PART_TYPE = 'raspberry_pi_pico'

/** The placeable part, as registered in PART_LIBRARY. */
export const PICO_PART: PartDefinition = getPart(PICO_PART_TYPE)

/**
 * GPIO pins that are wired out to the header, in id order.
 *
 * The engine walks this rather than 0..29 so that a document naming, say, GP23
 * (which exists on the die but has no pad on a Pico) can never be stamped into
 * the solver as if a student could reach it.
 */
export const PICO_HEADER_GPIOS: readonly string[] = PICO_PART.pins
  .filter((p) => p.type === 'digital' || p.type === 'analog')
  .map((p) => p.id)

/** `GP15` → 15. Returns null for anything that is not a GPIO pad. */
export function gpioIndexOf(pinId: string): number | null {
  const m = /^GP(\d{1,2})$/.exec(pinId)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 29 ? n : null
}

/**
 * ADC channel for a pin id, or null. Channels 0–3 are GP26–GP29 and channel 4
 * is the on-die temperature sensor; only GP26–GP28 reach the Pico header.
 */
export function adcChannelOf(pinId: string): number | null {
  const gp = gpioIndexOf(pinId)
  if (gp === null || gp < 26 || gp > 29) return null
  return gp - 26
}

/** The three header pins that reach the ADC, in channel order. */
export const PICO_ADC_PINS: readonly string[] = ['GP26', 'GP27', 'GP28']

/**
 * GP25 drives the Pico's on-board LED. It has no header pad, so it is not a
 * PartDefinition pin — the engine reports its state in the snapshot instead, so
 * a "blink the built-in LED" script is still observable with nothing wired.
 */
export const PICO_ONBOARD_LED_GPIO = 25
