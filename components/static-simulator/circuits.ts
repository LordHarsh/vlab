/**
 * THE TWELVE REFERENCE CIRCUITS, IN OUR OWN DOCUMENT MODEL.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ These are `CircuitDoc`s — lib/simulator/model/document.ts — built from   │
 * │ PART_LIBRARY types and OUR pin ids, so the read-only workspace draws     │
 * │ them with components/simulator/CircuitCanvas and nothing else. The       │
 * │ ported artwork (ComponentSVGs.tsx, features/Wire.tsx) is gone.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * AUTHORED, NOT TRANSLATED, and the reason is in the source data. The ported
 * `EXPERIMENTS` in utils/experimentData.ts carry twelve circuits expressed in
 * their component types, their pin ids and their coordinate system, and three
 * separate things stop a mapping table being the right tool:
 *
 *   • THEY ARE NOT COMPLETE CIRCUITS. Experiment 1's DHT11 has no pull-up on
 *     an open-drain data line; experiment 5 wires both sides of a push button
 *     to pins that are bridged inside the switch body (`buses` in parts.ts),
 *     which is a dead short from GP14 to 3V3; experiment 9's circuit ships a
 *     stepper motor that their own loader deletes again before drawing it, and
 *     experiment 10's is missing the lamp their loader adds. A reference figure
 *     a student copies has to be right, so those had to be authored anyway.
 *
 *   • TWO PARTS DO NOT EXIST HERE, so a table would have had holes in it: their
 *     `lightbulb` (experiment 10) and their `lm35` (experiment 12). See the
 *     SUBSTITUTIONS note below.
 *
 *   • GEOMETRY DOES NOT PORT. Their parts, breadboard and pin layout are all
 *     different sizes from ours, so every coordinate and every breadboard hole
 *     would have had to be re-chosen by hand regardless of the topology. A
 *     translation table would have produced the same amount of hand work with
 *     an extra layer of indirection between the drawing and the reason for it.
 *
 * WHAT EACH CIRCUIT IS HELD TO. The panel shows the experiment's own
 * `defaultCode` beside the drawing and plays showreel/timelines.ts underneath
 * it, and all three have to describe ONE circuit — so the pin each sketch names
 * is the pin the wire lands on, every part in the drawing is one the sketch can
 * observe, and nothing is drawn that the sketch never touches. Where their
 * published circuit and their published sketch disagreed, the SKETCH wins,
 * because the sketch is the thing on screen next to the picture.
 *
 * The lab's OWN starters (lib/simulator/model/examples.ts) are the other
 * reading of "experiment 4", and they are deliberately different documents: a
 * starter is power-rails-only because completing the wiring is the exercise.
 * Their part choices, board choices and resistor values informed these; their
 * wiring could not, because a reference figure has to be finished.
 *
 * SUBSTITUTIONS — the two parts we do not have, and what stands in:
 *
 *   experiment 10  `lightbulb` → 220 Ω + LED. Our own bill of materials for
 *                  this experiment already says "LEDs to stand in for the
 *                  appliances", so the substitution is the lab's own, and the
 *                  relay still switches a real load through NO1/COM1.
 *   experiment 12  `lm35` → potentiometer. The sketch does `analogRead(A1)`
 *                  and nothing else, so what the pin needs is an analog source;
 *                  a pot across the rails with its wiper on A1 is the bench's
 *                  own stand-in for a missing analog sensor and is a circuit a
 *                  student can actually build. It is NOT a temperature sensor,
 *                  and this comment is the only place that says so — see the
 *                  note on experiment 12 below.
 *
 * WIRE COLOUR. Every colour below comes from `WIRE_PALETTE` — Tinkercad's own
 * `BreadboardWire.ColorMap`, transcribed in document.ts — and nothing here
 * invents a hex. Their circuits' colour names (red, black, green, blue, orange,
 * yellow) all exist in that palette, so the mapping is the identity for five of
 * the six. The exception is deliberate: this codebase reserves RED for supply
 * and BLACK for ground (`WIRE_COLOR_POWER` / `WIRE_COLOR_GND`), so experiment
 * 3's three LED signal wires — red, yellow, green in their data — become
 * orange, yellow and green here rather than putting a red wire on a digital
 * output. The lane is still colour-coded; the rail colours still mean what they
 * mean everywhere else in the app.
 *
 * ─── LAYOUT ───────────────────────────────────────────────────────────────
 *
 * THE COMPONENTS ARE IN THE BREADBOARD. Every discrete part in a figure that
 * has a breadboard is placed so its own leads land in tie points — see `plug()`
 * — and the wire that carries the connection is the zero-length one between the
 * lead and the hole it is standing in. That is what `leg()` is: not a jumper,
 * but the model's way of saying "this lead is in this hole", drawn as the round
 * cap of a wire whose two ends coincide, which is a couple of units across and
 * sits underneath the lead it belongs to. The visible wires are then only the
 * ones a real build has: jumpers from the board's headers to a column, short
 * stubs from a column down to a rail, and the supply pair.
 *
 * It matters because these figures exist to be copied. A student who plugs the
 * parts into the holes this drawing shows and runs the jumpers it draws gets
 * this exact netlist, because the strips in the drawing really are in the nets.
 *
 * THE ROW RULES, which is all the placement discipline there is:
 *
 *   • Components sit in row `e` — the row against the centre channel — so
 *     their bodies rise over the channel and the far bank, and rows a–d of
 *     their own columns stay open for the wiring.
 *   • Resistors lie flat across six columns in row `c` or `d`, under the
 *     bodies and above the jumpers.
 *   • Jumpers from a board land in row `a` or `b`; rail stubs leave from the
 *     same rows. Nothing crosses the board above row `b`, so nothing is ever
 *     drawn over a component body.
 *   • A wire leaves a header PERPENDICULAR to the edge it is on and turns once
 *     it is clear: up out of the digital header, down out of the power header.
 *     A jumper that leaves sideways runs along its own pin row for a hundred
 *     units first, and a reference figure cannot afford a wire that looks like
 *     it might be landing on the neighbouring pin.
 *   • Signal jumpers from one header are lanes: the leftmost pin takes the
 *     highest lane. That ordering is what stops the fan crossing itself.
 *
 * WHERE THE FURNITURE STANDS. Two benches, and every figure uses one of them
 * unchanged — `UNO_AT`/`BENCH_AT` and `PICO_AT`/`PICO_BENCH_AT`. Twelve figures
 * that put the board and the breadboard in the same place read as one set, and
 * the fit (CircuitCanvas `docBounds` → `fitView`) then frames all of them at
 * nearly the same scale, so a resistor is the same size in panel 1 as in panel
 * 11. The bench dimensions are chosen against the panel's own aspect ratio:
 * roughly 2:1, because the workspace canvas is, and a document of the same
 * shape as its canvas is a document with no wasted margin.
 *
 * SENSOR FIELDS. A PIR's cone and an HC-SR04's beam are drawn well past the
 * part's own box, and the fit measures boxes and bend points, not beams — so
 * those two are always placed with clear space above them.
 */

import {
  WIRE_COLOR_GND,
  WIRE_COLOR_POWER,
  WIRE_PALETTE,
  pinPosition,
  type CircuitDoc,
  type DocWire,
  type PinRef,
  type PlacedPart,
  type Point,
} from '@/lib/simulator/model/document'
import { getPart } from '@/lib/simulator/model/parts'

/* ── Wire colours, by palette name ─────────────────────────────────────── */

const HUE: Record<string, string> = Object.fromEntries(
  WIRE_PALETTE.map((c) => [c.name, c.core]),
)

/** Ground and supply keep the app-wide reserved shades, which ARE palette entries. */
const BLACK = WIRE_COLOR_GND
const RED = WIRE_COLOR_POWER
const GREEN = HUE.green
const BLUE = HUE.blue
const ORANGE = HUE.orange
const YELLOW = HUE.yellow

/* ── Authoring helpers ─────────────────────────────────────────────────── */

/** `'uno:D13'` → `{ partId: 'uno', pinId: 'D13' }`. */
function pin(ref: string): PinRef {
  const at = ref.indexOf(':')
  return { partId: ref.slice(0, at), pinId: ref.slice(at + 1) }
}

/**
 * One wire, from pin spec to pin spec.
 *
 * `waypoints` are COSMETIC — document.ts says so and compile() never looks at
 * them — so they are used here only to take a wire out of a header at right
 * angles and around anything it would otherwise be drawn across, never to imply
 * a connection. They ARE fitted to, though: CircuitCanvas measures them, so a
 * turn placed below the board is a turn the frame makes room for.
 */
function w(id: string, from: string, to: string, color: string, waypoints?: Point[]): DocWire {
  return { id, from: pin(from), to: pin(to), color, ...(waypoints ? { waypoints } : {}) }
}

/**
 * A lead standing IN a tie point, rather than wired to one.
 *
 * The two ends are the same place, because `plug()` put the part there. The
 * model has no other way to say a leg is in a hole — a net is what the wires
 * union, and a part whose legs are merely drawn on top of a strip is a part
 * connected to nothing — so this is the connection, and it draws as the round
 * cap of a zero-length stroke: a couple of units of colour under the leg it
 * belongs to. See `filletPath`, which emits `M x y L x y` for exactly this and
 * documents why.
 */
const leg = w

/* ── The bench ─────────────────────────────────────────────────────────── */

const BREADBOARD = getPart('breadboard')

/** Where the Arduino Uno stands in every figure that has one. */
const UNO_AT: Point = { x: 0, y: 155 }
/**
 * Where the Uno stands in the two figures whose sensors have a DRAWN FIELD.
 *
 * A PIR's cone is a fixed 105 units tall and 161 wide about the module's face
 * (`HC_SR501_FIELD`: 700 cm of range at 0.15 units/cm, 100° wide) and an
 * HC-SR04's reticle stands `distance / 3` units off its face, which the
 * showreel drives out to 240 cm — 80 units, plus the marker's own radius. None
 * of that is inside any part's box, and `docBounds` measures boxes and bend
 * points, so a module placed at the top of a figure has its field cropped by
 * the frame no matter how the fit behaves.
 *
 * So in those two the board goes ABOVE the modules and they sit low, and the
 * clearance is stated in the comment on each: the Uno's own box is what holds
 * the top of the frame open. The signal wires arc over the board rather than
 * out of it, which is the other half of the same arrangement — the digital
 * header is on the Uno's upper edge and the modules' pin rows are on their
 * lower ones, so every wire leaves upward and comes down outside the board.
 */
const UNO_HIGH_AT: Point = { x: 0, y: 20 }
/** Where the breadboard stands in every Uno figure that has one. */
const BENCH_AT: Point = { x: 390, y: 20 }
/** Where the Pico stands in every figure that has one — right of the board. */
const PICO_AT: Point = { x: 505, y: 120 }
/** Where the breadboard stands in every Pico figure that has one. */
const PICO_BENCH_AT: Point = { x: 0, y: 20 }

function board(id: string, type: string, at: Point, props: PlacedPart['props'] = {}): PlacedPart {
  return { id, type, x: at.x, y: at.y, rotation: 0, props }
}

const uno = (): PlacedPart => board('uno', 'arduino_uno', UNO_AT)
const unoHigh = (): PlacedPart => board('uno', 'arduino_uno', UNO_HIGH_AT)
const pico = (): PlacedPart => board('pico', 'raspberry_pi_pico', PICO_AT)
const bench = (at: Point): PlacedPart => board('bb', 'breadboard', at)

/** World position of one of the breadboard's holes, for a board at `at`. */
function hole(at: Point, id: string): Point {
  const p = BREADBOARD.pins.find((q) => q.id === id)
  if (!p) throw new Error(`no such breadboard hole: ${id}`)
  return { x: at.x + p.x, y: at.y + p.y }
}

/**
 * A part placed so its lead `lead` stands in breadboard hole `at`.
 *
 * The arithmetic is the whole point: hand-typed coordinates are how a lamp ends
 * up floating a few units off the strip it is supposed to be in, and how an
 * edit to the bench turns into twelve silent misalignments. Give it the hole
 * and it computes the placement.
 *
 * Not every part's lead pitch is the board's 0.1 in. The wokwi-harvested
 * artwork measures 10.42 units between an LED's legs and the module bodies use
 * 12, against the board's 10 — so a three-pin module's outer legs land up to
 * two units off the hole centres. A hole is four units across, so the leg is
 * still in it; nothing here pretends otherwise, and the pitch mismatch is why
 * only the NAMED lead is exact.
 */
function plug(
  benchAt: Point,
  id: string,
  type: string,
  lead: string,
  at: string,
  props: PlacedPart['props'] = {},
): PlacedPart {
  const def = getPart(type)
  const p = def.pins.find((q) => q.id === lead)
  if (!p) throw new Error(`${type} has no pin ${lead}`)
  const h = hole(benchAt, at)
  return { id, type, x: h.x - p.x, y: h.y - p.y, rotation: 0, props }
}

/** Uno-bench shorthands. */
const uplug = (id: string, type: string, lead: string, at: string, props: PlacedPart['props'] = {}) =>
  plug(BENCH_AT, id, type, lead, at, props)
/** Pico-bench shorthands. */
const pplug = (id: string, type: string, lead: string, at: string, props: PlacedPart['props'] = {}) =>
  plug(PICO_BENCH_AT, id, type, lead, at, props)

/**
 * The turn a wire makes on its way out of a header: straight off the pin, to
 * `y`, and only then away.
 *
 * Reads the pin's real position rather than a transcribed number, so a bench
 * that moves takes its wiring with it.
 */
function off(part: PlacedPart, pinId: string, y: number): Point {
  const p = pinPosition(part, pinId)
  if (!p) throw new Error(`${part.type} has no pin ${pinId}`)
  return { x: p.x, y }
}

const UNO = uno()
const UNO_HIGH = unoHigh()
const PICO = pico()

/**
 * The supply pair, from an Uno's power header to the breadboard's lower rails.
 *
 * It is the one long run in a Uno figure and it has to be, because the 5 V and
 * GND pads are on the UNDERSIDE header while the board is above and to the
 * right. So the pair leaves downward — the only direction that clears the PCB
 * in ten units instead of a hundred and seventy — runs beneath the board, and
 * climbs to the rails in the gap past its right-hand edge. Two lanes rather
 * than one so the pair never lies on top of itself, and the turns are past
 * x=286 so neither diagonal is drawn across the Uno.
 */
function unoSupply(bp: string, bn: string): DocWire[] {
  return [
    w('pw_5v', 'uno:5V', `bb:${bp}`, RED, [off(UNO, '5V', 378), { x: 322, y: 378 }]),
    w('pw_gnd', 'uno:GND.2', `bb:${bn}`, BLACK, [off(UNO, 'GND.2', 390), { x: 338, y: 390 }]),
  ]
}

/**
 * The supply pair, from a Pico to the breadboard's rails.
 *
 * 3V3(OUT) is on the RIGHT-hand header, facing away from the board, so it goes
 * out, up over the top of the Pico and down into the upper + rail, with one
 * jumper at the far end of the board carrying it to the lower + rail the parts
 * are on — the same rail bridge lib/simulator/model/examples.ts draws, and for
 * the same reason: the four rails on a half-size board are four separate
 * strips. Ground comes off GND.4 on the LEFT header, which faces the board, and
 * needs nothing.
 *
 * `5V` is deliberately not used: on a Pico that pad is VBUS, USB power passed
 * straight through, and it is not the board's logic rail.
 */
function picoSupply(bn: string): DocWire[] {
  return [
    w('pw_3v3', 'pico:3.3V', 'bb:tp29', RED, [off(PICO, '3.3V', 175), { x: 620, y: 60 }]),
    w('pw_bridge', 'bb:tp2', 'bb:bp2', RED),
    w('pw_gnd', 'pico:GND.4', `bb:${bn}`, BLACK, [{ x: 485, y: 305 }]),
  ]
}

/* ── 1 · LED & DHT11 (Arduino Uno) ─────────────────────────────────────────
 *
 * Sketch: DHT11 DATA on D2, warning LED on D13, threshold 28 °C.
 *
 * The 10 kΩ pull-up is here and is not in their wire list. A DHT11's data line
 * is open drain — it can only ever pull DOWN — so without a resistor holding
 * the line up the `dht.readTemperature()` in the sketch beside this drawing
 * times out. It is the datasheet value and it is the value the lab's own BOM
 * lists, so a student copying this figure gets a circuit that works.
 *
 * THE 220 Ω IS IN THE CATHODE LEG, not between D13 and the anode. It is the
 * same series circuit — the current through a series pair does not care which
 * order they are in — and on a breadboard it is the order that fits: the LED's
 * legs go into columns 2 and 3, the resistor lies from column 2 out to column
 * 8, and the ground stub leaves from column 8, so nothing is drawn across
 * anything. Put the resistor on the anode side and its body has to run back
 * underneath the lamp.
 */
export const CIRCUIT_LED_DHT11: CircuitDoc = {
  parts: [
    uno(),
    bench(BENCH_AT),
    uplug('led', 'led', 'A', 'e3', { color: 'red' }),
    uplug('r220', 'resistor', '1', 'd2', { ohms: 220 }),
    uplug('dht', 'dht11', 'DATA', 'e18', { temperature: 24, humidity: 45 }),
    uplug('r10k', 'resistor', '1', 'c18', { ohms: 10000 }),
  ],
  wires: [
    ...unoSupply('bp2', 'bn5'),
    // D13 → column 3 → the lamp → 220 Ω → column 8 → the ground rail.
    w('drv', 'uno:D13', 'bb:a3', BLUE, [off(UNO, 'D13', 150)]),
    leg('led_a', 'led:A', 'bb:e3', BLUE),
    leg('led_c', 'led:C', 'bb:e2', BLUE),
    leg('r220_1', 'r220:1', 'bb:d2', BLUE),
    leg('r220_2', 'r220:2', 'bb:d8', BLUE),
    w('led_gnd', 'bb:a8', 'bb:bn8', BLACK),
    // The DHT11 stands in columns 17–19, its supply on the rails beneath it.
    leg('dht_v', 'dht:VCC', 'bb:e17', RED),
    leg('dht_d', 'dht:DATA', 'bb:e18', GREEN),
    leg('dht_g', 'dht:GND', 'bb:e19', BLACK),
    w('dht_pwr', 'bb:a17', 'bb:bp17', RED),
    w('dht_ret', 'bb:a19', 'bb:bn19', BLACK),
    // The pull-up bridges the data column to the + rail.
    leg('pu_d', 'r10k:1', 'bb:c18', YELLOW),
    leg('pu_r', 'r10k:2', 'bb:c24', YELLOW),
    w('pu_v', 'bb:a24', 'bb:bp24', RED),
    // …and the data column carries on to D2.
    w('sig', 'uno:D2', 'bb:b18', GREEN, [off(UNO, 'D2', 140)]),
  ],
}

/* ── 2 · Ultrasonic & PIR (Arduino Uno) ────────────────────────────────────
 *
 * Sketch: PIR OUT on D2, HC-SR04 TRIG on D3 and ECHO on D4.
 *
 * No breadboard: three wires per sensor straight to the header is what their
 * build steps describe and what a bench looks like for two modules. The supply
 * is daisy-chained from the near module to the far one the way a bench does it,
 * rather than run twice from the same pad.
 *
 * THE BOARD IS ABOVE THE MODULES because both of them draw a field. The PIR's
 * cone reaches 105 units past its face and the ultrasonic's reticle 87 at the
 * furthest the showreel drives it, and neither is inside any part's box — so
 * the Uno's own box has to be what holds the top of the frame open. It is: the
 * board's top edge is y=20, the PIR's cone tops out at y=50 and the scanner's
 * reticle at y=63.
 *
 * EVERY LEAD REACHES ITS PIN FROM BELOW, because that is the side the pins are
 * on: both modules carry their headers along their lower edge, so a wire that
 * comes down onto one is a wire drawn straight across the module's face. So the
 * signals leave the Uno's digital header upward, run out over the board, drop
 * down the gap past its right-hand edge and come back along lanes underneath —
 * which is also, exactly, how a bench with two modules and a board is cabled.
 *
 * The lanes are ordered rather than arbitrary. Above the board, a pin further
 * LEFT takes a higher lane and drops further RIGHT, so no wire is drawn over
 * its neighbour's riser. Below, a lane is deeper the further left it drops.
 * What is left after that ordering is the one crossing the sketch itself
 * forces — D3 is left of D4 on the header while TRIG is left of ECHO on the
 * module — plus the supply's, which has to reach across the signal lanes
 * because the 5 V pad is on the far side of the board from the modules.
 */
const PIR_2 = board('pir', 'pir_motion', { x: 500, y: 155 }, {
  motion: 0,
  distance: 240,
  bearing: 0,
  hold: 5,
  warmup: 0,
})
const HC_2 = board('hcsr04', 'hc_sr04', { x: 330, y: 150 }, { distance: 240 })

export const CIRCUIT_ULTRASONIC_PIR: CircuitDoc = {
  parts: [unoHigh(), HC_2, PIR_2],
  wires: [
    // The two modules share the supply, chained near-to-far along the shallowest
    // pair of lanes.
    w('link_v', 'hcsr04:VCC', 'pir:VCC', RED, [off(HC_2, 'VCC', 258), off(PIR_2, 'VCC', 258)]),
    w('link_g', 'hcsr04:GND', 'pir:GND', BLACK, [off(HC_2, 'GND', 270), off(PIR_2, 'GND', 270)]),
    // Signals: up out of the header, over the board, down the gap, back under.
    w('hc_e', 'uno:D4', 'hcsr04:ECHO', YELLOW, [
      off(UNO_HIGH, 'D4', 4),
      { x: 316, y: 4 },
      { x: 316, y: 284 },
      off(HC_2, 'ECHO', 284),
    ]),
    w('hc_t', 'uno:D3', 'hcsr04:TRIG', ORANGE, [
      off(UNO_HIGH, 'D3', 10),
      { x: 308, y: 10 },
      { x: 308, y: 296 },
      off(HC_2, 'TRIG', 296),
    ]),
    w('pir_o', 'uno:D2', 'pir:OUT', GREEN, [
      off(UNO_HIGH, 'D2', 16),
      { x: 300, y: 16 },
      { x: 300, y: 308 },
      off(PIR_2, 'OUT', 308),
    ]),
    // Supply, out of the underside header on the two deepest lanes. It feeds
    // the FAR module and the chain runs back, which is one riser's worth of
    // crossing cheaper than feeding the near one.
    w('pw_5v', 'uno:5V', 'pir:VCC', RED, [off(UNO_HIGH, '5V', 322), off(PIR_2, 'VCC', 322)]),
    w('pw_gnd', 'uno:GND.2', 'pir:GND', BLACK, [
      off(UNO_HIGH, 'GND.2', 334),
      off(PIR_2, 'GND', 334),
    ]),
  ],
}

/* ── 3 · Traffic light (Arduino Uno) ───────────────────────────────────────
 *
 * Sketch: red D10, yellow D11, green D12, each through 220 Ω, cathodes to the
 * board's ground rail.
 *
 * Three identical lanes, nine columns apart: drive jumper into the lamp's
 * column, lamp, 220 Ω out to six columns along, stub down to the ground rail.
 * The lanes are laid out so the leftmost pin on the header feeds the rightmost
 * lane — D12 at x=140 to column 21, D10 at x=160 to column 3 — which is the one
 * assignment where the three jumpers fan out without crossing each other.
 *
 * The three LEDs really are red, yellow and green — our LED carries a `color`
 * prop and the artwork reads it — and the colour is not only cosmetic: green's
 * 3.2 V forward drop against red's ~2.0 is why the same 220 Ω gives a different
 * current per lamp.
 */
export const CIRCUIT_TRAFFIC_LIGHT: CircuitDoc = {
  parts: [
    uno(),
    bench(BENCH_AT),
    uplug('led_red', 'led', 'A', 'e3', { color: 'red' }),
    uplug('r_red', 'resistor', '1', 'd2', { ohms: 220 }),
    uplug('led_yellow', 'led', 'A', 'e12', { color: 'yellow' }),
    uplug('r_yellow', 'resistor', '1', 'd11', { ohms: 220 }),
    uplug('led_green', 'led', 'A', 'e21', { color: 'green' }),
    uplug('r_green', 'resistor', '1', 'd20', { ohms: 220 }),
  ],
  wires: [
    // Only ground is needed from the board; the lamps are driven from the pins.
    w('pw_gnd', 'uno:GND.2', 'bb:bn1', BLACK, [off(UNO, 'GND.2', 384), { x: 330, y: 384 }]),
    // Red lane, column 3.
    w('drv_r', 'uno:D10', 'bb:a3', ORANGE, [off(UNO, 'D10', 142)]),
    leg('la_r', 'led_red:A', 'bb:e3', ORANGE),
    leg('lc_r', 'led_red:C', 'bb:e2', ORANGE),
    leg('r1_r', 'r_red:1', 'bb:d2', ORANGE),
    leg('r2_r', 'r_red:2', 'bb:d8', ORANGE),
    w('gnd_r', 'bb:a8', 'bb:bn8', BLACK),
    // Yellow lane, column 12.
    w('drv_y', 'uno:D11', 'bb:a12', YELLOW, [off(UNO, 'D11', 134)]),
    leg('la_y', 'led_yellow:A', 'bb:e12', YELLOW),
    leg('lc_y', 'led_yellow:C', 'bb:e11', YELLOW),
    leg('r1_y', 'r_yellow:1', 'bb:d11', YELLOW),
    leg('r2_y', 'r_yellow:2', 'bb:d17', YELLOW),
    w('gnd_y', 'bb:a17', 'bb:bn17', BLACK),
    // Green lane, column 21.
    w('drv_g', 'uno:D12', 'bb:a21', GREEN, [off(UNO, 'D12', 126)]),
    leg('la_g', 'led_green:A', 'bb:e21', GREEN),
    leg('lc_g', 'led_green:C', 'bb:e20', GREEN),
    leg('r1_g', 'r_green:1', 'bb:d20', GREEN),
    leg('r2_g', 'r_green:2', 'bb:d26', GREEN),
    w('gnd_g', 'bb:a26', 'bb:bn26', BLACK),
  ],
}

/* ── 4 · Water flow (Arduino Uno) ──────────────────────────────────────────
 *
 * Sketch: YF-S201 signal on D2 — INT0, which is why that pin and no other.
 *
 * The 10 kΩ pull-up is here for the reason the DHT11's is: the sensor's output
 * is an open-collector Hall switch, so with nothing holding the line up there
 * is no edge for the interrupt to count. The breadboard is what gives the
 * pull-up and the signal a tie point they can share.
 */
export const CIRCUIT_WATER_FLOW: CircuitDoc = {
  parts: [
    uno(),
    bench(BENCH_AT),
    uplug('flow', 'flow_sensor', 'SIG', 'e10', { flow: 0 }),
    uplug('r10k', 'resistor', '1', 'c10', { ohms: 10000 }),
  ],
  wires: [
    ...unoSupply('bp2', 'bn5'),
    leg('fl_v', 'flow:VCC', 'bb:e9', RED),
    leg('fl_s', 'flow:SIG', 'bb:e10', YELLOW),
    leg('fl_g', 'flow:GND', 'bb:e11', BLACK),
    w('fl_pwr', 'bb:a9', 'bb:bp9', RED),
    w('fl_ret', 'bb:a11', 'bb:bn11', BLACK),
    leg('pu_d', 'r10k:1', 'bb:c10', YELLOW),
    leg('pu_r', 'r10k:2', 'bb:c16', YELLOW),
    w('pu_v', 'bb:a16', 'bb:bp16', RED),
    w('sig', 'uno:D2', 'bb:b10', YELLOW, [off(UNO, 'D2', 140)]),
  ],
}

/* ── 5 · LED & push button (Raspberry Pi Pico) ─────────────────────────────
 *
 * Sketch: LED on GP15, button on GP14 declared `Pin.IN, Pin.PULL_DOWN`.
 *
 * THE BUTTON IS WIRED ACROSS THE SWITCH, not along one side of it, and that is
 * the one place this drawing had to depart from their wire list. Their circuit
 * puts GP14 on `pin1a` and the + rail on `pin1b`; in our model those two are
 * `buses: [['1a','1b'], ...]` — permanently bridged inside the body — so that
 * pair is 3V3 tied straight to a GPIO with no switch in between.
 *
 * Here the body STRADDLES THE CENTRE CHANNEL, which is the whole reason a
 * tactile switch is shaped the way it is: the 1-side legs stand in row `f` of
 * the upper bank and the 2-side legs in row `e` of the lower bank, so the two
 * halves of the switch land on strips the board itself cannot join. GP14 comes
 * to the upper strip, the + rail to the lower one, and the only path between
 * them is through the contacts. The RP2040's internal pull-down holds the pin
 * low while they are open, exactly as the sketch asks for.
 */
export const CIRCUIT_LED_BUTTON_PICO: CircuitDoc = {
  parts: [
    pico(),
    bench(PICO_BENCH_AT),
    pplug('led', 'led', 'A', 'e20', { color: 'blue' }),
    pplug('r220', 'resistor', '1', 'd13', { ohms: 220 }),
    pplug('btn', 'push_button', '1a', 'f23', { pressed: 0 }),
  ],
  wires: [
    ...picoSupply('bn26'),
    // GP15 → column 20 → the lamp → 220 Ω → column 13 → the ground rail.
    w('drv', 'pico:GP15', 'bb:a20', BLUE, [{ x: 485, y: 325 }, { x: 360, y: 150 }]),
    leg('led_a', 'led:A', 'bb:e20', BLUE),
    leg('led_c', 'led:C', 'bb:e19', BLUE),
    leg('r220_1', 'r220:1', 'bb:d13', BLUE),
    leg('r220_2', 'r220:2', 'bb:d19', BLUE),
    w('led_gnd', 'bb:a13', 'bb:bn13', BLACK),
    // The switch, across the channel: 1a/1b above it, 2a/2b below.
    leg('btn_1a', 'btn:1a', 'bb:f23', GREEN),
    leg('btn_1b', 'btn:1b', 'bb:f30', GREEN),
    leg('btn_2a', 'btn:2a', 'bb:e23', RED),
    leg('btn_2b', 'btn:2b', 'bb:e30', RED),
    w('btn_sig', 'pico:GP14', 'bb:h30', GREEN, [{ x: 485, y: 315 }]),
    w('btn_pwr', 'bb:a30', 'bb:bp29', RED),
  ],
}

/* ── 6 · PIR alarm (Arduino Uno) ───────────────────────────────────────────
 *
 * Sketch: PIR OUT on D2, buzzer + on D3 and − to ground.
 *
 * `passive: 0` is load-bearing rather than decoration. The bill of materials
 * says ACTIVE buzzer, and the two are electrically different parts: an active
 * buzzer is a ~167 Ω resistive load that sounds on a bare `digitalWrite`, which
 * is exactly what this sketch does, while a passive one is a piezo — an open at
 * DC — that would draw nothing at all.
 *
 * The buzzer's return is chained to the PIR's ground pad rather than run back
 * to a second GND pad on the board. Same net, one fewer wire across the bench.
 *
 * Board above the modules, for experiment 2's reason: the PIR's cone reaches
 * 105 units past its face and 80 to either side of it, so the frame is held
 * open by the Uno's box at y=20 and the cone tops out at y=50.
 */
const PIR_6 = board('pir', 'pir_motion', { x: 500, y: 155 }, {
  motion: 0,
  distance: 300,
  bearing: 0,
  hold: 5,
  warmup: 0,
})
const BUZZER_6 = board('buzzer', 'buzzer', { x: 350, y: 208 }, { passive: 0 })

export const CIRCUIT_PIR_ALARM: CircuitDoc = {
  parts: [unoHigh(), BUZZER_6, PIR_6],
  wires: [
    // Both parts carry their pins on the underside, so — as in experiment 2 —
    // every lead comes at them from below.
    w('bz_n', 'buzzer:N', 'pir:GND', BLACK, [off(BUZZER_6, 'N', 262), off(PIR_6, 'GND', 262)]),
    w('bz_p', 'uno:D3', 'buzzer:P', ORANGE, [
      off(UNO_HIGH, 'D3', 6),
      { x: 308, y: 6 },
      { x: 308, y: 276 },
      off(BUZZER_6, 'P', 276),
    ]),
    w('pir_o', 'uno:D2', 'pir:OUT', GREEN, [
      off(UNO_HIGH, 'D2', 12),
      { x: 300, y: 12 },
      { x: 300, y: 290 },
      off(PIR_6, 'OUT', 290),
    ]),
    // The 5 V lead's lane runs on past the module rather than stopping short of
    // it, so the frame reaches the right-hand edge of the cone as well as its
    // top.
    w('pw_5v', 'uno:5V', 'pir:VCC', RED, [off(UNO_HIGH, '5V', 304), { x: 650, y: 304 }]),
    w('pw_gnd', 'uno:GND.2', 'buzzer:N', BLACK, [
      off(UNO_HIGH, 'GND.2', 316),
      off(BUZZER_6, 'N', 316),
    ]),
  ],
}

/* ── 7 · DHT11 (Raspberry Pi Pico) ─────────────────────────────────────────
 *
 * Sketch: DHT11 on GP4, read every two seconds.
 *
 * 10 kΩ up to 3V3, the datasheet value, and the same value on either rail — the
 * pull-up sets the line's rise time, not a bias point.
 */
export const CIRCUIT_DHT11_PICO: CircuitDoc = {
  parts: [
    pico(),
    bench(PICO_BENCH_AT),
    pplug('dht', 'dht11', 'DATA', 'e20', { temperature: 22, humidity: 55 }),
    pplug('r10k', 'resistor', '1', 'c20', { ohms: 10000 }),
  ],
  wires: [
    ...picoSupply('bn28'),
    leg('dht_v', 'dht:VCC', 'bb:e19', RED),
    leg('dht_d', 'dht:DATA', 'bb:e20', GREEN),
    leg('dht_g', 'dht:GND', 'bb:e21', BLACK),
    w('dht_pwr', 'bb:a19', 'bb:bp19', RED),
    w('dht_ret', 'bb:a21', 'bb:bn21', BLACK),
    leg('pu_d', 'r10k:1', 'bb:c20', YELLOW),
    leg('pu_r', 'r10k:2', 'bb:c26', YELLOW),
    w('pu_v', 'bb:a26', 'bb:bp26', RED),
    w('sig', 'pico:GP4', 'bb:b20', GREEN, [{ x: 485, y: 185 }, { x: 360, y: 140 }]),
  ],
}

/* ── 8 · DS18B20 (Raspberry Pi Pico) ───────────────────────────────────────
 *
 * Sketch: 1-Wire bus on GP15.
 *
 * 4.7 kΩ, and it is NOT interchangeable with the DHT11's 10 kΩ next door. A
 * 1-Wire master samples a bit about 15 µs after the falling edge, so the
 * pull-up has to charge the line's capacitance back up inside a slot; Maxim's
 * own notes specify 4.7 kΩ for a short bus and MicroPython's `onewire` timings
 * are written against it.
 */
export const CIRCUIT_DS18B20_PICO: CircuitDoc = {
  parts: [
    pico(),
    bench(PICO_BENCH_AT),
    pplug('ds', 'ds18b20', 'DQ', 'e20', { temperature: 24.5, resolution: 12 }),
    pplug('r4k7', 'resistor', '1', 'c20', { ohms: 4700 }),
  ],
  wires: [
    ...picoSupply('bn28'),
    leg('ds_g', 'ds:GND', 'bb:e19', BLACK),
    leg('ds_q', 'ds:DQ', 'bb:e20', GREEN),
    leg('ds_v', 'ds:VDD', 'bb:e21', RED),
    w('ds_ret', 'bb:a19', 'bb:bn19', BLACK),
    w('ds_pwr', 'bb:a21', 'bb:bp21', RED),
    leg('pu_d', 'r4k7:1', 'bb:c20', YELLOW),
    leg('pu_r', 'r4k7:2', 'bb:c26', YELLOW),
    w('pu_v', 'bb:a26', 'bb:bp26', RED),
    w('sig', 'pico:GP15', 'bb:b20', GREEN, [{ x: 485, y: 325 }, { x: 360, y: 140 }]),
  ],
}

/* ── 9 · DC motor through an L298N (Raspberry Pi Pico) ─────────────────────
 *
 * Sketch: IN1 on GP14, IN2 on GP15, ENA on GP13 held high.
 *
 * NO STEPPER. The experiment's title names one and their circuit ships one, but
 * their own loader deletes it again before the drawing is made and their sketch
 * never steps it — so it is absent here rather than drawn unconnected.
 *
 * VS AND VSS ARE BOTH FED, and the L298N is the part where that distinction is
 * worth drawing. VS (the "+12V" screw) is the MOTOR supply; VSS (the "+5V"
 * screw) is the LOGIC supply, rated 4.5–7 V, and putting the motor rail on it
 * is how the chip is destroyed. Both come from the Pico's `5V` pad — VBUS, USB
 * power passed straight through — which is what their build steps ask for, VSS
 * by a short link between the two screws the way a bench does it. Five volts is
 * a limp motor after the bridge's ~2.5 V drop, and that is the L298N rather
 * than a defect in the drawing.
 *
 * The board is on the LEFT here, which is the only side that works: a Pico's
 * GPIO are all on its left-hand header and the L298N's logic inputs are along
 * its underside, so the three control wires leave the Pico sideways, drop below
 * both boards and come up into IN1/IN2/ENA without either board being drawn
 * across. The supply pads on the Pico's right-hand header face the driver
 * directly.
 */
const PICO_9 = board('pico', 'raspberry_pi_pico', { x: 0, y: 140 })
const L298N_9 = board('l298n', 'l298n', { x: 470, y: 175 })

export const CIRCUIT_MOTOR_CONTROL_PICO: CircuitDoc = {
  parts: [PICO_9, L298N_9, board('motor', 'dc_motor', { x: 460, y: 65 }, { load: 0 })],
  wires: [
    w('vs', 'pico:5V', 'l298n:VS', RED, [{ x: 110, y: 155 }]),
    // VSS is jumped off the VS screw rather than run a second time from the
    // Pico's pad — one lead between two terminals, the way the bench does it.
    w('vss', 'l298n:VS', 'l298n:VSS', RED, [{ x: 452, y: 215 }, { x: 452, y: 255 }]),
    w('gnd', 'pico:GND.7', 'l298n:GND', BLACK, [{ x: 110, y: 175 }]),
    // The three control lines: out of the left header, under both boards, up
    // into the driver's underside.
    w('ena', 'pico:GP13', 'l298n:ENA', ORANGE, [
      { x: -15, y: 315 },
      { x: -15, y: 386 },
      { x: 510, y: 386 },
    ]),
    w('in1', 'pico:GP14', 'l298n:IN1', GREEN, [
      { x: -28, y: 335 },
      { x: -28, y: 398 },
      { x: 520, y: 398 },
    ]),
    w('in2', 'pico:GP15', 'l298n:IN2', YELLOW, [
      { x: -41, y: 345 },
      { x: -41, y: 410 },
      { x: 530, y: 410 },
    ]),
    w('m1', 'l298n:OUT1', 'motor:1', BLUE),
    w('m2', 'l298n:OUT2', 'motor:2', BLUE),
  ],
}

/* ── 10 · Home automation (Raspberry Pi Pico) ──────────────────────────────
 *
 * Sketch: relay channel 1 on GP15, toggled every two seconds.
 *
 * THE APPLIANCE IS AN LED AND A 220 Ω, standing in for their `lightbulb`, which
 * this library does not have. The lab's own bill of materials for this
 * experiment already says "LEDs to stand in for the appliances", so the
 * substitution is the lab's; the relay is still switching a real load through
 * its own contacts rather than a picture of one.
 *
 * NO1 AND NOT NC1. A load on the normally-CLOSED terminal is powered while the
 * relay is idle, so a student who copies the wrong terminal gets an appliance
 * that is on until the program turns it off. The board's own silkscreen order
 * is NO / COM / NC and this figure uses the first of the three.
 *
 * VCC IS ON THE 5 V PAD, not the 3.3 V rail: an SRD-05VDC coil is only
 * guaranteed to pull in above 3.75 V, so a module fed from 3V3 switches its
 * opto-coupler and never its contact.
 *
 * The load returns to the module's own GND screw, which is the same node as the
 * Pico's ground and is where the return lands on a real bench.
 */
const PICO_10 = board('pico', 'raspberry_pi_pico', { x: 0, y: 150 })

export const CIRCUIT_HOME_AUTOMATION_PICO: CircuitDoc = {
  parts: [
    PICO_10,
    board('relay', 'relay_4ch', { x: 250, y: 120 }, { activeLow: 1 }),
    board('r220', 'resistor', { x: 520, y: 133 }, { ohms: 220 }),
    // Low enough that the lit lamp's halo — which is a blur filter, and so is
    // outside the part's box and outside what the fit measures — still lands
    // inside the frame the COM1 lead's turn at y=80 holds open.
    board('led', 'led', { x: 574, y: 95 }, { color: 'yellow' }),
  ],
  wires: [
    // The module's logic pins are along its underside and its switched screws
    // along its top, so the coil side comes at it from below and the load side
    // from above. Nothing is drawn across the body either way.
    w('coil_v', 'pico:5V', 'relay:VCC', RED, [
      { x: 125, y: 165 },
      { x: 125, y: 296 },
      { x: 310, y: 296 },
    ]),
    w('coil_g', 'pico:GND.6', 'relay:GND', BLACK, [
      { x: 95, y: 285 },
      { x: 95, y: 308 },
      { x: 330, y: 308 },
    ]),
    w('coil_in', 'pico:GP15', 'relay:IN1', GREEN, [
      { x: -15, y: 355 },
      { x: -15, y: 392 },
      { x: 320, y: 392 },
    ]),
    // Switched side: 5 V into COM1 over the top, out of NO1 when the armature
    // pulls in, through the lamp and back to the module's ground screw.
    w('load_com', 'pico:5V', 'relay:COM1', RED, [
      { x: 110, y: 165 },
      { x: 110, y: 74 },
      { x: 285, y: 74 },
    ]),
    w('load_no', 'relay:NO1', 'r220:1', ORANGE, [{ x: 270, y: 92 }, { x: 500, y: 92 }]),
    w('load_r', 'r220:2', 'led:A', ORANGE),
    w('load_ret', 'led:C', 'relay:GND', BLACK, [{ x: 590, y: 272 }, { x: 380, y: 272 }]),
  ],
}

/* ── 11 · Smart traffic controller (Arduino Uno) ───────────────────────────
 *
 * Sketch: HC-SR04 TRIG on D6 and ECHO on D7, red lamp on D4, green on D3, and a
 * 100 cm line that decides between them.
 *
 * AN UNO, NOT A MEGA, and that is a deliberate split from the lab's own starter
 * for this slug. The starter builds the printed four-lane controller — twelve
 * LEDs and four density pots, sixteen signals, which is why it needs a Mega.
 * The sketch shown beside THIS drawing is the ported one: one lane, one
 * scanner, two lamps, six pins. The drawing has to be the circuit the listing
 * next to it runs on.
 *
 * The scanner stands BELOW the breadboard rather than on it, for two reasons
 * that point the same way. Its beam is drawn out to 260 cm — 94 units — above
 * the module, so it has to sit low enough that the board's own top edge holds
 * the frame open above it; and its pins are along its underside, so every lead
 * has to arrive from below or be drawn across its face. So the two signals go
 * up out of the digital header, over the board, down its right-hand side and
 * back along lanes underneath, and the return comes off the near end of the
 * ground rail the same way round.
 */
const HC_11 = board('hcsr04', 'hc_sr04', { x: 520, y: 210 }, { distance: 260 })

export const CIRCUIT_SMART_TRAFFIC: CircuitDoc = {
  parts: [
    uno(),
    bench(BENCH_AT),
    uplug('led_red', 'led', 'A', 'e3', { color: 'red' }),
    uplug('r_red', 'resistor', '1', 'd2', { ohms: 220 }),
    uplug('led_green', 'led', 'A', 'e12', { color: 'green' }),
    uplug('r_green', 'resistor', '1', 'd11', { ohms: 220 }),
    HC_11,
  ],
  wires: [
    ...unoSupply('bp2', 'bn5'),
    // Red lamp, column 3; green, column 12.
    w('drv_r', 'uno:D4', 'bb:b3', ORANGE, [off(UNO, 'D4', 140)]),
    leg('la_r', 'led_red:A', 'bb:e3', ORANGE),
    leg('lc_r', 'led_red:C', 'bb:e2', ORANGE),
    leg('r1_r', 'r_red:1', 'bb:d2', ORANGE),
    leg('r2_r', 'r_red:2', 'bb:d8', ORANGE),
    w('gnd_r', 'bb:a8', 'bb:bn8', BLACK),
    w('drv_g', 'uno:D3', 'bb:a12', GREEN, [off(UNO, 'D3', 150)]),
    leg('la_g', 'led_green:A', 'bb:e12', GREEN),
    leg('lc_g', 'led_green:C', 'bb:e11', GREEN),
    leg('r1_g', 'r_green:1', 'bb:d11', GREEN),
    leg('r2_g', 'r_green:2', 'bb:d17', GREEN),
    w('gnd_g', 'bb:a17', 'bb:bn17', BLACK),
    // The scanner, every lead arriving from underneath. Its return comes off
    // the far end of the ground rail and round the outside; its supply shares
    // the 5 V pad with the rail feed, which is what a second lead off one pad
    // looks like.
    w('hc_g', 'bb:bn30', 'hcsr04:GND', BLACK, [
      { x: 732, y: 180 },
      { x: 732, y: 342 },
      off(HC_11, 'GND', 342),
    ]),
    w('hc_e', 'uno:D7', 'hcsr04:ECHO', YELLOW, [
      off(UNO, 'D7', 4),
      { x: 740, y: 4 },
      { x: 740, y: 354 },
      off(HC_11, 'ECHO', 354),
    ]),
    w('hc_t', 'uno:D6', 'hcsr04:TRIG', ORANGE, [
      off(UNO, 'D6', 12),
      { x: 748, y: 12 },
      { x: 748, y: 366 },
      off(HC_11, 'TRIG', 366),
    ]),
    w('hc_v', 'uno:5V', 'hcsr04:VCC', RED, [off(UNO, '5V', 402), off(HC_11, 'VCC', 402)]),
  ],
}

/* ── 12 · Health monitoring (Arduino Uno) ──────────────────────────────────
 *
 * Sketch: `analogRead(A0)` for the pulse sensor and `analogRead(A1)` for body
 * temperature, printed as raw 0–1023 counts every three seconds.
 *
 * THE POTENTIOMETER IS STANDING IN FOR AN LM35 AND IT IS NOT A THERMOMETER.
 * There is no LM35 in this part library. What A1 needs is an analog source
 * across the rails, which is what a pot wired 1→GND, 3→5 V, wiper→A1 is; it is
 * a circuit a student can build, and the sketch cannot tell the difference
 * because all it does is read a count. It is recorded here rather than dressed
 * up, because a drawing that quietly labelled a pot as a temperature sensor
 * would be the kind of near-miss that stops a student trusting the rest.
 *
 * An Uno rather than the Pico + MCP3008 the lab's own starter for this slug
 * builds, for the reason experiment 11 is an Uno: the listing beside this
 * drawing is the ported Arduino sketch, and it reads analog pins directly.
 *
 * A0 and A1 are on the UNDERSIDE header beside the supply pads, so the two
 * analog leads take the same route the supply does — down, along beneath the
 * board, and up in the gap — on their own pair of lanes below it.
 */
export const CIRCUIT_HEALTH_MONITOR: CircuitDoc = {
  parts: [
    uno(),
    bench(BENCH_AT),
    uplug('pulse', 'pulse_sensor', 'SIG', 'e5', { bpm: 72, amplitude: 8 }),
    uplug('pot', 'potentiometer', '2', 'e16', { position: 50, totalOhms: 10000 }),
  ],
  wires: [
    ...unoSupply('bp2', 'bn3'),
    leg('pl_v', 'pulse:VCC', 'bb:e4', RED),
    leg('pl_s', 'pulse:SIG', 'bb:e5', BLUE),
    leg('pl_g', 'pulse:GND', 'bb:e6', BLACK),
    w('pl_pwr', 'bb:b4', 'bb:bp4', RED),
    w('pl_ret', 'bb:b6', 'bb:bn6', BLACK),
    w('sig_a0', 'uno:A0', 'bb:a5', BLUE, [
      off(UNO, 'A0', 402),
      { x: 354, y: 402 },
      { x: 354, y: 150 },
    ]),
    leg('pot_g', 'pot:1', 'bb:e15', BLACK),
    leg('pot_w', 'pot:2', 'bb:e16', ORANGE),
    leg('pot_v', 'pot:3', 'bb:e17', RED),
    w('pot_ret', 'bb:b15', 'bb:bn15', BLACK),
    w('pot_pwr', 'bb:b17', 'bb:bp17', RED),
    w('sig_a1', 'uno:A1', 'bb:a16', ORANGE, [
      off(UNO, 'A1', 414),
      { x: 370, y: 414 },
      { x: 370, y: 162 },
    ]),
  ],
}

/**
 * Every reference circuit, keyed by the SAME numeric experiment id the ported
 * `EXPERIMENTS` array and `SHOWREEL_TIMELINES` use — so the drawing, the code
 * listing and the playback are looked up by one key and cannot drift apart.
 * Ids 13 and 14 are their blank sandboxes and have no reference build.
 */
export const REFERENCE_CIRCUITS: Readonly<Record<number, CircuitDoc>> = {
  1: CIRCUIT_LED_DHT11,
  2: CIRCUIT_ULTRASONIC_PIR,
  3: CIRCUIT_TRAFFIC_LIGHT,
  4: CIRCUIT_WATER_FLOW,
  5: CIRCUIT_LED_BUTTON_PICO,
  6: CIRCUIT_PIR_ALARM,
  7: CIRCUIT_DHT11_PICO,
  8: CIRCUIT_DS18B20_PICO,
  9: CIRCUIT_MOTOR_CONTROL_PICO,
  10: CIRCUIT_HOME_AUTOMATION_PICO,
  11: CIRCUIT_SMART_TRAFFIC,
  12: CIRCUIT_HEALTH_MONITOR,
}
