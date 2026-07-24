/**
 * Raspberry Pi Pico board definition.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * It structurally belongs next to makeUno() in model/parts.ts, but that file is
 * owned by another workstream this session. Everything here is written so that
 * moving it is a copy-paste plus three one-line edits, listed at the bottom of
 * this comment. Until then the definition registers itself into PART_LIBRARY on
 * import, which is exactly what getPart() consults — see registerPicoPart().
 *
 * WHAT A PICO IS, ELECTRICALLY, AND WHY IT IS NOT AN UNO
 * -----------------------------------------------------
 * The single most important difference is the rail: the Pico's GPIO run at
 * 3.3 V, not 5 V, and it is NOT 5 V tolerant. Every downstream number moves —
 * an LED through 220 Ω draws roughly 4.8 mA here against 12.4 mA on an Uno,
 * because the LED's ~2 V forward drop eats a much larger share of a 3.3 V
 * budget. Copying the Uno's resistor values across would teach students a
 * circuit that is more than twice as dim as they expect, so nothing about the
 * drive model is inherited: R_DRIVE, the pull resistors and the logic
 * thresholds are all re-derived from the RP2040 datasheet in ./engine.ts.
 *
 * The header is the physical 40-pin layout, in silkscreen order, so a student
 * counting pins on a photo of a real Pico finds the same thing here. GP23/GP24/
 * GP25 exist on the die but are NOT brought out to the header on a Pico, so
 * they are absent — GP25 is the on-board LED, which ./engine.ts reports
 * separately rather than pretending it is wireable.
 *
 * TO FOLD THIS INTO parts.ts LATER (three edits, all in parts.ts):
 *   1. widen PartDefinition['electrical'] to
 *        { kind: 'mcu'; board: 'arduino_uno' | 'raspberry_pi_pico' }
 *      which lets PICO_BOARD_ELECTRICAL below drop its cast;
 *   2. add `raspberry_pi_pico: PICO_PART` to PART_LIBRARY;
 *   3. add 'raspberry_pi_pico' to PALETTE.
 * There is also one edit needed in model/compile.ts — see PICO_COMPILE_TODO.
 */

import { PART_LIBRARY, PALETTE, type PartDefinition, type PinGeometry } from '../model/parts'

/** Grid units per 0.1 inch, matching parts.ts. */
const PITCH = 10

export const PICO_PART_TYPE = 'raspberry_pi_pico'

/**
 * Physical header, pin 1 → pin 40, exactly as silkscreened.
 *
 * `null` marks a header position whose id is derived below (the GND pins are
 * numbered in order so they can be bussed); everything else is the literal pin
 * id the netlist will use.
 */
type HeaderEntry = [id: string, name: string, type: PinGeometry['type']]

const LEFT_HEADER: HeaderEntry[] = [
  ['GP0', 'GP0', 'digital'],
  ['GP1', 'GP1', 'digital'],
  ['GND.1', 'GND', 'gnd'],
  ['GP2', 'GP2', 'digital'],
  ['GP3', 'GP3', 'digital'],
  ['GP4', 'GP4', 'digital'],
  ['GP5', 'GP5', 'digital'],
  ['GND.2', 'GND', 'gnd'],
  ['GP6', 'GP6', 'digital'],
  ['GP7', 'GP7', 'digital'],
  ['GP8', 'GP8', 'digital'],
  ['GP9', 'GP9', 'digital'],
  ['GND.3', 'GND', 'gnd'],
  ['GP10', 'GP10', 'digital'],
  ['GP11', 'GP11', 'digital'],
  ['GP12', 'GP12', 'digital'],
  ['GP13', 'GP13', 'digital'],
  ['GND.4', 'GND', 'gnd'],
  ['GP14', 'GP14', 'digital'],
  ['GP15', 'GP15', 'digital'],
]

/**
 * Right header, listed pin 21 → pin 40, i.e. BOTTOM to TOP on the rendered
 * board — the same direction a real Pico is numbered.
 *
 * `3.3V` and `5V` are deliberately named for the VOLTAGE and not the silkscreen
 * (`3V3(OUT)` and `VBUS`), because model/compile.ts keys its rail stamping off
 * exactly those two pin ids. The human-facing `name` keeps the real label.
 */
const RIGHT_HEADER: HeaderEntry[] = [
  ['GP16', 'GP16', 'digital'],
  ['GP17', 'GP17', 'digital'],
  ['GND.5', 'GND', 'gnd'],
  ['GP18', 'GP18', 'digital'],
  ['GP19', 'GP19', 'digital'],
  ['GP20', 'GP20', 'digital'],
  ['GP21', 'GP21', 'digital'],
  ['GND.6', 'GND', 'gnd'],
  ['GP22', 'GP22', 'digital'],
  ['RUN', 'RUN', 'passive'],
  ['GP26', 'GP26/A0', 'analog'],
  ['GP27', 'GP27/A1', 'analog'],
  ['AGND', 'AGND', 'gnd'],
  ['GP28', 'GP28/A2', 'analog'],
  ['ADC_VREF', 'ADC_VREF', 'passive'],
  ['3.3V', '3V3(OUT)', 'power'],
  ['3V3_EN', '3V3_EN', 'passive'],
  ['GND.7', 'GND', 'gnd'],
  ['VSYS', 'VSYS', 'passive'],
  ['5V', 'VBUS', 'power'],
]

const BOARD_W = 90
const BOARD_H = 220
const LEFT_X = 10
const RIGHT_X = 80
const TOP_Y = 15

function buildPins(): PinGeometry[] {
  const pins: PinGeometry[] = []
  LEFT_HEADER.forEach(([id, name, type], i) => {
    pins.push({ id, name, x: LEFT_X, y: TOP_Y + i * PITCH, type })
  })
  // Pin 21 sits at the BOTTOM right and the numbering walks upward to pin 40.
  RIGHT_HEADER.forEach(([id, name, type], i) => {
    pins.push({ id, name, x: RIGHT_X, y: TOP_Y + (19 - i) * PITCH, type })
  })
  return pins
}

const PINS = buildPins()

/**
 * Cast, not a lie in the data.
 *
 * parts.ts currently types `board` as the literal 'arduino_uno', so the honest
 * value does not typecheck until edit (1) above lands. Writing 'arduino_uno'
 * here WOULD typecheck and would be far worse: nothing reads the field today,
 * so the mislabel would sit undetected until the first piece of code that
 * branches on board type silently treated a Pico as a 5 V Uno. The cast fails
 * loudly the day someone tightens the union, which is the correct trade.
 */
const PICO_BOARD_ELECTRICAL = { kind: 'mcu', board: PICO_PART_TYPE } as unknown as PartDefinition['electrical']

function pinHoles(): string {
  return PINS.map(
    (p) =>
      `<rect x="${p.x - 3.5}" y="${p.y - 3.5}" width="7" height="7" rx="1.2" ` +
      `fill="#c9a227" stroke="#8a6d14" stroke-width="0.5"/>` +
      `<circle cx="${p.x}" cy="${p.y}" r="2" fill="#2b2b2b"/>`,
  ).join('')
}

export const PICO_PART: PartDefinition = {
  type: PICO_PART_TYPE,
  label: 'Raspberry Pi Pico',
  width: BOARD_W,
  height: BOARD_H,
  pins: PINS,
  // Every GND pad is the same copper on the real board, AGND included — it is
  // joined to GND through a ferrite/0 Ω link, not isolated.
  buses: [['GND.1', 'GND.2', 'GND.3', 'GND.4', 'GND.5', 'GND.6', 'GND.7', 'AGND']],
  electrical: PICO_BOARD_ELECTRICAL,
  svg: `
    <rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" rx="8" fill="#0f5132" stroke="#0a3d26"/>
    <rect x="22" y="6" width="46" height="26" rx="2" fill="#1b1b1b"/>
    <text x="45" y="23" font-size="9" text-anchor="middle" fill="#d8d8d8" font-family="monospace">USB</text>
    <rect x="30" y="96" width="30" height="30" rx="3" fill="#1b1b1b" stroke="#000"/>
    <text x="45" y="108" font-size="7" text-anchor="middle" fill="#9ad" font-family="monospace">RP2</text>
    <text x="45" y="118" font-size="7" text-anchor="middle" fill="#9ad" font-family="monospace">040</text>
    <text x="45" y="200" font-size="7" text-anchor="middle" fill="#cfe8d8" font-family="monospace">Pico 3V3</text>
    ${pinHoles()}
  `,
}

/**
 * GPIO pins that are wired out to the header, in id order.
 *
 * The engine walks this rather than 0..29 so that a document naming, say, GP23
 * (which exists on the die but has no pad on a Pico) can never be stamped into
 * the solver as if a student could reach it.
 */
export const PICO_HEADER_GPIOS: readonly string[] = PINS.filter(
  (p) => p.type === 'digital' || p.type === 'analog',
).map((p) => p.id)

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

/**
 * GP25 drives the Pico's on-board LED. It has no header pad, so it is not a
 * PartDefinition pin — the engine reports its state in the snapshot instead, so
 * a "blink the built-in LED" script is still observable with nothing wired.
 */
export const PICO_ONBOARD_LED_GPIO = 25

/**
 * The one change model/compile.ts needs, recorded here because that file is
 * shared. compile()'s shorted-I/O-pin branch hardcodes `volts: 5`, which for a
 * Pico overstates the fault by 52%. It should read the rail from the board:
 *
 *   volts: def.electrical.board === 'raspberry_pi_pico' ? 3.3 : 5
 *
 * Nothing else in compile() is Uno-specific: the rail stamping already keys off
 * the pin ids '5V' and '3.3V', and mcuPorts/pinNets/analogNets are all keyed by
 * pin id, so a Pico compiles correctly today apart from that one number.
 */
export const PICO_COMPILE_TODO =
  "model/compile.ts hardcodes volts: 5 for a shorted I/O pin; a Pico's is 3.3 V."

let registered = false

/**
 * Make getPart('raspberry_pi_pico') work.
 *
 * Idempotent, and called on import below so that merely importing the Pico
 * engine or a Pico document is enough — there is no ordering trap where a
 * document loads before the part it names exists. Delete this once edit (2)
 * lands in parts.ts.
 */
export function registerPicoPart(): void {
  if (registered) return
  registered = true
  PART_LIBRARY[PICO_PART_TYPE] = PICO_PART
  if (!PALETTE.includes(PICO_PART_TYPE)) PALETTE.splice(1, 0, PICO_PART_TYPE)
}

registerPicoPart()
