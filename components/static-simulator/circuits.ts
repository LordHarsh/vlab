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

/**
 * The turn a wire makes leaving a SIDE-mounted header: straight off the pin
 * HORIZONTALLY, to `x`, keeping the pin's own y.
 *
 * `off()` above assumes a header on the board's top or bottom edge — true for
 * the Uno and the Pico, both of which this file wired first. The Mega's
 * D22-D53 header runs down its RIGHT edge instead (see makeMega()), so a wire
 * leaving THAT header clears the board moving sideways, not vertically; this
 * is the same idea as `off()`, rotated a quarter turn for the edge it is on.
 */
function offX(part: PlacedPart, pinId: string, x: number): Point {
  const p = pinPosition(part, pinId)
  if (!p) throw new Error(`${part.type} has no pin ${pinId}`)
  return { x, y: p.y }
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
 * Reference `connections`, verbatim: `['HC-SR04 TRIG','Arduino D9']`,
 * `['HC-SR04 ECHO','Arduino D10']`, `['PIR OUT','Arduino D7']`, `['LED
 * Anode','Arduino D13 (via 220Ω)']`, `['LED Cathode','GND']`, plus 5 V and
 * ground to both modules. The published sketch agrees: `TRIG_PIN 9`,
 * `ECHO_PIN 10`, `PIR_PIN 7`, `LED_PIN 13`. This figure used to draw D3/D4/D2
 * and NO LAMP AT ALL — which left the last four lines of `loop()`, the whole
 * point of the experiment, driving a pin with nothing on it.
 *
 * THE LAMP IS FREE-STANDING, BELOW THE BOARD. The bill of materials does list
 * `Breadboard`, and every other Uno figure in this file plugs its discretes
 * into one — but a half-size board is 325 x 170 and the only place one fits
 * here is under the Uno, which pushes the modules' supply lanes below y=440
 * and takes the figure from 330 units tall to nearly 470. That is most of the
 * panel-height budget experiment 11's note describes, spent on somewhere for
 * two parts to stand. The reference's own `connections` never route anything
 * through a board either: all nine entries are a part pin against an Arduino
 * pin. So the lamp is wired the way the wire list actually describes it.
 *
 * THE 220 Ω IS BETWEEN D13 AND THE ANODE, which is where the reference puts it
 * and — unlike experiment 1, where the part is in a breadboard column and the
 * order is free — is also the order that draws here. The resistor lies in the
 * drive lane below the board, the anode rises out of its far end, and the
 * cathode leaves on its own shallower lane, so the two leads never share a
 * line. The lamp's return crosses the anode's riser once; a cathode is the
 * LEFT leg of our LED artwork and the only ground pad is to the right, so that
 * crossing is the geometry, not a choice.
 *
 * THE PIR MOVED RIGHT BY TWENTY UNITS. It used to stand at x=500 with the
 * HC-SR04's body reaching x=507, so seven units of one module were drawn
 * inside the other.
 *
 * The supply is daisy-chained from the near module to the far one the way a
 * bench does it, rather than run twice from the same pad.
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
const PIR_2 = board('pir', 'pir_motion', { x: 520, y: 155 }, {
  motion: 0,
  distance: 240,
  bearing: 0,
  hold: 5,
  warmup: 0,
})
const HC_2 = board('hcsr04', 'hc_sr04', { x: 330, y: 150 }, { distance: 240 })

export const CIRCUIT_ULTRASONIC_PIR: CircuitDoc = {
  parts: [
    unoHigh(),
    HC_2,
    PIR_2,
    board('led', 'led', { x: 60, y: 250 }, { color: 'red' }),
    board('r220', 'resistor', { x: -14, y: 316 }, { ohms: 220 }),
  ],
  wires: [
    // The two modules share the supply, chained near-to-far along the shallowest
    // pair of lanes.
    w('link_v', 'hcsr04:VCC', 'pir:VCC', RED, [off(HC_2, 'VCC', 258), off(PIR_2, 'VCC', 258)]),
    w('link_g', 'hcsr04:GND', 'pir:GND', BLACK, [off(HC_2, 'GND', 270), off(PIR_2, 'GND', 270)]),
    // Signals: up out of the header, over the board, down the gap, back under.
    // The lane order is the same rule as before, re-derived for the published
    // pins: above the board a pin further LEFT takes a higher lane and drops
    // further right; below, a lane is deeper the further left it drops. What
    // survives that ordering is one crossing, and the sketch forces it — D10
    // is LEFT of D9 on the Uno's header while TRIG is left of ECHO on the
    // module, so the two must swap somewhere.
    w('hc_e', 'uno:D10', 'hcsr04:ECHO', YELLOW, [
      off(UNO_HIGH, 'D10', 7),
      { x: 314, y: 7 },
      { x: 314, y: 296 },
      off(HC_2, 'ECHO', 296),
    ]),
    w('hc_t', 'uno:D9', 'hcsr04:TRIG', ORANGE, [
      off(UNO_HIGH, 'D9', 12),
      { x: 322, y: 12 },
      { x: 322, y: 284 },
      off(HC_2, 'TRIG', 284),
    ]),
    w('pir_o', 'uno:D7', 'pir:OUT', GREEN, [
      off(UNO_HIGH, 'D7', 17),
      { x: 306, y: 17 },
      { x: 306, y: 308 },
      off(PIR_2, 'OUT', 308),
    ]),
    // D13 → the lamp. It is the only signal on this board that goes LEFT, and
    // it goes left because D13 is the leftmost of the four pins in use: a wire
    // leaving the left end of the header outward crosses none of the three
    // that leave the right end inward. Round the board's left edge, along the
    // resistor, up into the anode from below.
    w('drv', 'uno:D13', 'r220:1', BLUE, [
      off(UNO_HIGH, 'D13', 2),
      { x: -28, y: 2 },
      { x: -28, y: 321.9 },
    ]),
    w('led_a', 'r220:2', 'led:A', BLUE, [{ x: 86, y: 321.9 }]),
    w('led_gnd', 'led:C', 'uno:GND.3', BLACK, [{ x: 75.6, y: 308 }, { x: 186.5, y: 308 }]),
    // Supply, out of the underside header on the two deepest lanes. It feeds
    // the FAR module and the chain runs back, which is one riser's worth of
    // crossing cheaper than feeding the near one.
    w('pw_5v', 'uno:5V', 'pir:VCC', RED, [off(UNO_HIGH, '5V', 334), off(PIR_2, 'VCC', 334)]),
    w('pw_gnd', 'uno:GND.2', 'pir:GND', BLACK, [
      off(UNO_HIGH, 'GND.2', 346),
      off(PIR_2, 'GND', 346),
    ]),
  ],
}

/* ── 3 · Traffic light (Arduino Uno) ───────────────────────────────────────
 *
 * Reference `connections`, verbatim: `['Red LED Anode','Arduino D2 (via
 * 220Ω)']`, `['Yellow LED Anode','Arduino D3 (via 220Ω)']`, `['Green LED
 * Anode','Arduino D4 (via 220Ω)']`, `['All LED Cathodes','GND']` — and the
 * published sketch agrees pin for pin (`#define RED_PIN 2 / YELLOW_PIN 3 /
 * GREEN_PIN 4`). This figure used to draw D10/D11/D12, which was neither.
 *
 * Three identical lanes, nine columns apart: drive jumper into the lamp's
 * column, lamp, 220 Ω out to six columns along, stub down to the ground rail.
 * The lanes are laid out so the leftmost pin on the header feeds the rightmost
 * lane — D4 at x=227 to column 21, D2 at x=246 to column 3 — which is the one
 * assignment where the three jumpers fan out without crossing each other. The
 * published pin order helps here: D2/D3/D4 sit at the RIGHT end of the Uno's
 * digital header, so all three jumpers are shorter than the D10-D12 ones were
 * and every diagonal is shallower.
 *
 * `Push Button (optional)` is on the reference's bill of materials and is
 * omitted, the same call this file makes for experiment 11's optional IR
 * sensors: the sketch never reads it, and a part the program cannot observe
 * would be furniture.
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
    w('drv_r', 'uno:D2', 'bb:a3', ORANGE, [off(UNO, 'D2', 142)]),
    leg('la_r', 'led_red:A', 'bb:e3', ORANGE),
    leg('lc_r', 'led_red:C', 'bb:e2', ORANGE),
    leg('r1_r', 'r_red:1', 'bb:d2', ORANGE),
    leg('r2_r', 'r_red:2', 'bb:d8', ORANGE),
    w('gnd_r', 'bb:a8', 'bb:bn8', BLACK),
    // Yellow lane, column 12.
    w('drv_y', 'uno:D3', 'bb:a12', YELLOW, [off(UNO, 'D3', 134)]),
    leg('la_y', 'led_yellow:A', 'bb:e12', YELLOW),
    leg('lc_y', 'led_yellow:C', 'bb:e11', YELLOW),
    leg('r1_y', 'r_yellow:1', 'bb:d11', YELLOW),
    leg('r2_y', 'r_yellow:2', 'bb:d17', YELLOW),
    w('gnd_y', 'bb:a17', 'bb:bn17', BLACK),
    // Green lane, column 21.
    w('drv_g', 'uno:D4', 'bb:a21', GREEN, [off(UNO, 'D4', 126)]),
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
 * Reference `connections`, verbatim: `['LED Anode','GPIO17 (Pin 11) via
 * 220Ω']`, `['LED Cathode','GND (Pin 6)']`, `['Button Pin 1','GPIO27 (Pin
 * 13)']`, `['Button Pin 2','3.3V (Pin 1) via 10kΩ']`, with a `10kΩ Pull-down
 * Resistor` on the bill of materials. The published Python agrees: `LED_PIN =
 * 17`, `BUTTON_PIN = 27`, `pull_up_down=GPIO.PUD_DOWN`. This figure used to
 * draw GP15 and GP14 and no pull-down at all.
 *
 * THE BOARD IS ON THE LEFT AND THE BENCH ON THE RIGHT — the one figure of the
 * five Pico ones that does not use `PICO_AT`/`PICO_BENCH_AT`, and the
 * reference's own pin numbers are what force it. GP17 and GP27 are both on the
 * Pico's RIGHT-hand header (see `PICO_RIGHT_HEADER` in parts.ts: physical pins
 * 22 and 32), which in the standard arrangement faces AWAY from the
 * breadboard. Every route that keeps the standard furniture has both signals
 * leaving the far edge and coming back across the supply pair; turning the
 * bench round instead puts the header that does the work facing the work.
 * Experiments 9 and 10 already make the same call for the mirror-image reason
 * — their control pins are on the LEFT header, so their boards stand left of
 * the peripheral.
 *
 * THE THREE SHORT RUNS ARE A LANE CHANNEL, and their order is chosen, not
 * arbitrary. Between the Pico's right edge and the board's left there are
 * 165 units for three wires that all climb: 3V3 (y=175 → the top + rail),
 * GP27 (215 → row h) and ground (305 → the bottom − rail). Handing out the
 * lanes 3V3-innermost, then GP27, then ground is the one order in which no
 * wire's horizontal run passes through another's climb. GP17 is not in the
 * channel at all: it leaves at y=315, which is already BELOW the board, so it
 * runs straight out under it, up the clear column past its right-hand edge and
 * back along row `a`. That is one long lead and no crossings, against a fourth
 * lane that would have had to cross both of the others.
 *
 * 3V3 LANDS ON THE TOP + RAIL, not the bottom one, for the same reason: a
 * bottom-rail landing puts its run at y≈170, straight through GP27's climb.
 * The rail bridge then carries it down, which is the jumper
 * lib/simulator/model/examples.ts draws too — the four rails on a half-size
 * board are four separate strips.
 *
 * AND THE − RAILS NEED THE SAME BRIDGE, which is new here. The pull-down hangs
 * off the button's UPPER-bank strip and the lamp returns through the LOWER
 * one, so both − rails have to be live. The two bridges stand at columns 10
 * and 12 — far enough apart not to read as one line, and in the only stretch
 * of board no part or lead occupies.
 *
 * THE BUTTON IS WIRED ACROSS THE SWITCH, not along one side of it, and that is
 * the one place this drawing departs from their wire list. Their circuit
 * puts GP27 on `pin1a` and 3V3 on `pin1b`; in our model those two are
 * `buses: [['1a','1b'], ...]` — permanently bridged inside the body — so that
 * pair is 3V3 tied straight to a GPIO with no switch in between.
 *
 * Here the body STRADDLES THE CENTRE CHANNEL, which is the whole reason a
 * tactile switch is shaped the way it is: the 1-side legs stand in row `f` of
 * the upper bank and the 2-side legs in row `e` of the lower bank, so the two
 * halves of the switch land on strips the board itself cannot join. GP27 comes
 * to the upper strip, the + rail to the lower one, and the only path between
 * them is through the contacts.
 *
 * THE 10 kΩ IS A PULL-DOWN, from GP27's strip to ground — which is what the
 * bill of materials calls it (`10kΩ Pull-down Resistor`) and what the sketch's
 * `PUD_DOWN` is asking for. It is NOT what the `connections` line reads
 * literally: `['Button Pin 2','3.3V (Pin 1) via 10kΩ']` puts the resistor in
 * SERIES with the supply side, which makes the closed switch a divider against
 * the RP2040's own ~60 kΩ internal pull-down and lands the pin at roughly
 * 2.8 V — near enough to pass, but for the wrong reason and with the resistor
 * doing the opposite job to the one its own name states. Wired as a pull-down
 * it holds the pin at a hard 0 V while the contacts are open and hands it the
 * full 3V3 when they close, which is the circuit the sketch reads.
 */
const PICO_5 = board('pico', 'raspberry_pi_pico', { x: 0, y: 120 })
/** The bench, right of the board, and far enough over to frame like the rest. */
const BENCH_5_AT: Point = { x: 240, y: 20 }

export const CIRCUIT_LED_BUTTON_PICO: CircuitDoc = {
  parts: [
    PICO_5,
    bench(BENCH_5_AT),
    plug(BENCH_5_AT, 'led', 'led', 'A', 'e21', { color: 'blue' }),
    plug(BENCH_5_AT, 'r220', 'resistor', '1', 'd14', { ohms: 220 }),
    plug(BENCH_5_AT, 'btn', 'push_button', '1a', 'f1', { pressed: 0 }),
    plug(BENCH_5_AT, 'r10k', 'resistor', '1', 'j1', { ohms: 10000 }),
  ],
  wires: [
    // Supply: 3V3 to the TOP + rail on the innermost lane, then bridged down to
    // the bottom one the parts sit on; ground straight to the bottom − rail on
    // the outermost, and bridged UP to feed the pull-down.
    w('pw_3v3', 'pico:3.3V', 'bb:tp1', RED, [{ x: 140, y: 175 }, { x: 140, y: 25 }]),
    w('pw_bridge', 'bb:tp10', 'bb:bp10', RED),
    w('pw_gnd', 'pico:GND.5', 'bb:bn1', BLACK, [{ x: 200, y: 305 }, { x: 200, y: 180 }]),
    w('gnd_bridge', 'bb:tn12', 'bb:bn12', BLACK),
    // GP17 → out under the board → up its far edge → back along row a into
    // column 21 → the lamp → 220 Ω → column 14 → the ground rail.
    w('drv', 'pico:GP17', 'bb:a21', BLUE, [{ x: 585, y: 315 }, { x: 585, y: 150 }]),
    leg('led_a', 'led:A', 'bb:e21', BLUE),
    leg('led_c', 'led:C', 'bb:e20', BLUE),
    leg('r220_2', 'r220:2', 'bb:d20', BLUE),
    leg('r220_1', 'r220:1', 'bb:d14', BLUE),
    w('led_gnd', 'bb:a14', 'bb:bn14', BLACK),
    // The switch, across the channel: 1a/1b above it, 2a/2b below.
    leg('btn_1a', 'btn:1a', 'bb:f1', GREEN),
    leg('btn_1b', 'btn:1b', 'bb:f8', GREEN),
    leg('btn_2a', 'btn:2a', 'bb:e1', RED),
    leg('btn_2b', 'btn:2b', 'bb:e8', RED),
    w('btn_sig', 'pico:GP27', 'bb:h1', GREEN, [{ x: 170, y: 215 }, { x: 170, y: 70 }]),
    w('btn_pwr', 'bb:a8', 'bb:bp8', RED),
    // The pull-down: GP27's own strip, along row j clear of the switch body,
    // out to column 7 and down onto the upper − rail.
    leg('pd_1', 'r10k:1', 'bb:j1', YELLOW),
    leg('pd_2', 'r10k:2', 'bb:j7', YELLOW),
    w('pd_gnd', 'bb:j7', 'bb:tn7', BLACK),
  ],
}

/* ── 6 · PIR alarm (Arduino Uno) ───────────────────────────────────────────
 *
 * Reference `connections`, verbatim: `['PIR OUT','Arduino D7']`, `['Buzzer
 * +','Arduino D8']`, `['Buzzer −','GND']`, `['Red LED','Arduino D12 (via
 * 220Ω)']`, `['Green LED','Arduino D11 (via 220Ω)']`, plus PIR 5 V and ground.
 * The published sketch agrees: `PIR_PIN 7`, `BUZZER 8`, `RED_LED 12`,
 * `GREEN_LED 11`. This figure used to draw the PIR on D2 and the buzzer on D3
 * and had NEITHER LAMP — so `digitalWrite(GREEN_LED, HIGH)` in `setup()`, the
 * line that tells a student the alarm is armed, lit nothing.
 *
 * THE TWO LAMPS STAND BELOW THE BOARD, free of a breadboard, because the bill
 * of materials does not list one — `Arduino Uno, PIR Sensor HC-SR501, Active
 * Buzzer, Red LED, Green LED, 220Ω Resistors, Connecting Wires` and nothing
 * else. Each is the reference's series pair drawn as one: the drive rounds the
 * board's LEFT edge (D12 and D11 are near the left end of the header, and
 * leaving that way crosses neither of the two signals bound for the modules on
 * the right), runs along its own resistor, and comes up into the anode from
 * underneath. Coming up from underneath is what keeps the two leads apart: our
 * LED artwork puts the cathode 10 units LEFT of the anode, so a drive arriving
 * from either SIDE is drawn over one leg to reach the other.
 *
 * The green lamp's resistor sits one lane deeper than the red one's for the
 * same reason the drives do — two wires bound for the same strip of empty
 * board need two lanes or they are one line.
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
  parts: [
    unoHigh(),
    BUZZER_6,
    PIR_6,
    board('led_red', 'led', { x: 60, y: 250 }, { color: 'red' }),
    board('led_green', 'led', { x: 120, y: 250 }, { color: 'green' }),
    board('r_red', 'resistor', { x: -10, y: 316 }, { ohms: 220 }),
    board('r_green', 'resistor', { x: -28, y: 344 }, { ohms: 220 }),
  ],
  wires: [
    // Both parts carry their pins on the underside, so — as in experiment 2 —
    // every lead comes at them from below.
    w('bz_n', 'buzzer:N', 'pir:GND', BLACK, [off(BUZZER_6, 'N', 262), off(PIR_6, 'GND', 262)]),
    w('bz_p', 'uno:D8', 'buzzer:P', ORANGE, [
      off(UNO_HIGH, 'D8', 6),
      { x: 308, y: 6 },
      { x: 308, y: 276 },
      off(BUZZER_6, 'P', 276),
    ]),
    w('pir_o', 'uno:D7', 'pir:OUT', GREEN, [
      off(UNO_HIGH, 'D7', 12),
      { x: 300, y: 12 },
      { x: 300, y: 290 },
      off(PIR_6, 'OUT', 290),
    ]),
    // The two lamps, out of the LEFT end of the header and round the board.
    // D12 is left of D11, so it takes the inner drop and the shallower lane.
    w('drv_red', 'uno:D12', 'r_red:1', ORANGE, [
      off(UNO_HIGH, 'D12', 6),
      { x: -10, y: 6 },
    ]),
    w('br_red', 'r_red:2', 'led_red:A', ORANGE, [{ x: 86, y: 321.9 }]),
    w('drv_green', 'uno:D11', 'r_green:1', GREEN, [
      off(UNO_HIGH, 'D11', 2),
      { x: -28, y: 2 },
    ]),
    w('br_green', 'r_green:2', 'led_green:A', GREEN, [{ x: 146, y: 349.9 }]),
    // Both cathodes on one return, chained below the lamps and back up into
    // the board's third ground pad — the two the supply pair uses are taken.
    w('led_link', 'led_red:C', 'led_green:C', BLACK, [
      { x: 75.6, y: 336 },
      { x: 135.6, y: 336 },
    ]),
    w('led_gnd', 'led_green:C', 'uno:GND.3', BLACK, [
      { x: 135.6, y: 308 },
      { x: 186.5, y: 308 },
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
 * Reference `connections`, verbatim: `['DS18B20 Red (VDD)','3.3V']`,
 * `['DS18B20 Black (GND)','GND']`, `['DS18B20 Yellow (Data)','GPIO4 + 4.7kΩ
 * pull-up to 3.3V']`. The bus is on GP4, not the GP15 this figure used to
 * draw — the published Python reads `/sys/bus/w1/devices/`, which on a Pi is
 * the `dtoverlay=w1-gpio` default of GPIO4 and nothing else, so the reference's
 * own pin number is the only one its listing could have worked on.
 *
 * That makes this figure and experiment 7 the same three wires on the same
 * pin, which is the point: a 1-Wire probe and a DHT11 are both single-wire
 * parts on GP4 and the ONLY thing that differs is the pull-up value below.
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
    // Same reach as experiment 7's, because it is the same pin: out of the
    // left header, clear of the board, then across to the data column.
    w('sig', 'pico:GP4', 'bb:b20', GREEN, [{ x: 485, y: 185 }, { x: 360, y: 140 }]),
  ],
}

/* ── 9 · DC motor AND stepper (Raspberry Pi Pico) ──────────────────────────
 *
 * Reference `connections`, verbatim: `['L298N ENA','GPIO18 (PWM)']`, `['L298N
 * IN1','GPIO23']`, `['L298N IN2','GPIO24']`, `['L298N 12V','External 12V']`,
 * `['L298N GND','Common GND']`, `['ULN2003 IN1-IN4','GPIO17,27,22,5']`. Its
 * bill of materials adds `28BYJ-48 Stepper Motor` and `ULN2003 Driver Board`,
 * and its published Python steps them: `step_pins = [17, 27, 22, 5]` driven
 * through an eight-phase `seq`.
 *
 * THE STEPPER IS HERE NOW. This figure used to omit it, on the grounds that the
 * colleague's ported circuit shipped one and then deleted it again — but the
 * reference is the source of truth and both its wire list and its sketch drive
 * it. Half of the experiment was missing from its own reference figure.
 *
 * TWO DEPARTURES FROM THE PUBLISHED PIN LIST, and both are already decided
 * elsewhere in this codebase rather than invented here. lib/simulator/pico/
 * experiments.ts's `MOTOR_CONTROL_RPI` sets them out in full; this drawing
 * follows it rather than re-deriving:
 *
 *   GPIO23 AND GPIO24 ARE NOT ON A PICO'S HEADER. They exist on the die but
 *   are wired to on-board functions and never brought out — see `makePico()`
 *   in lib/simulator/model/parts.ts, where the header stops at GP22 and
 *   resumes at GP26. So IN1 and IN2 move to GP19 and GP20, the two pads
 *   immediately after GP18, which keeps ENA/IN1/IN2 three consecutive header
 *   pins. ENA keeps the published GPIO18, and the stepper keeps GPIO 17, 27,
 *   22 and 5 verbatim — all four of those exist.
 *
 *   THERE IS NO 12 V SUPPLY. `['L298N 12V','External 12V']` has nothing to
 *   point at: this part library has no bench supply and the only rail on a Pico
 *   above 3.3 V is VBUS, the `5V` pad. See the note below on what that costs.
 *
 * THE THREE CONTROL WIRES CHANGED SIDES, which is the whole reason this figure
 * reads better than it did. GP13/14/15 are on the Pico's LEFT header, facing
 * away from the driver, so the old drawing took them out past the board's left
 * edge and back underneath both boards. GP18/19/20 are on the RIGHT header,
 * facing the driver directly, so they now leave, drop one lane and run straight
 * across.
 *
 * THE FOUR STEP WIRES CROSS EACH OTHER, and that is the reference's own doing:
 * 17, 27, 22, 5 is not the order those pads appear in on the header, so leads
 * bound for IN1…IN4 in that sequence have to swap on the way. Following the
 * published sequence matters more than a tidy fan — the winding order IS the
 * experiment, and `HALF_STEP_SEQUENCE` in parts.ts is written against it.
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
 * The board is on the LEFT here, which is the only side that works: the
 * L298N's logic inputs are along its underside and the ULN2003's along its
 * left edge, so everything the Pico drives faces back toward it. The supply
 * pads on the Pico's right-hand header face the driver directly.
 *
 * THE STEPPER PAIR SITS BELOW, clear of the three control lanes: the ULN2003's
 * body starts at y=360 and the stepper's at 355, and the deepest lane is 345.
 * The four phase leads are short diagonals between two adjacent parts rather
 * than orthogonal runs — the same call lib/simulator/model/examples.ts and
 * this file's own `m1`/`m2` make for a motor hanging off its driver. A lead
 * between two touching parts is a lead, not a schematic line.
 */
const PICO_9 = board('pico', 'raspberry_pi_pico', { x: 0, y: 140 })
const L298N_9 = board('l298n', 'l298n', { x: 470, y: 175 })
const ULN_9 = board('uln', 'uln2003', { x: 170, y: 360 })
const STEPPER_9 = board('stepper', 'stepper_28byj48', { x: 320, y: 355 })

export const CIRCUIT_MOTOR_CONTROL_PICO: CircuitDoc = {
  parts: [
    PICO_9,
    L298N_9,
    board('motor', 'dc_motor', { x: 460, y: 65 }, { load: 0 }),
    ULN_9,
    STEPPER_9,
  ],
  wires: [
    // The two supply runs go across, then down, then in — not corner to corner.
    // They used to carry a single waypoint each, which left a 370x60 diagonal
    // sloping across the open middle of the figure: the one thing a bench
    // build never looks like, and the first thing the eye reads as "drawing"
    // rather than "wiring". Separate drop columns (430 for VS, 405 for GND) so
    // the two verticals do not sit on top of each other.
    w('vs', 'pico:5V', 'l298n:VS', RED, [{ x: 430, y: 155 }, { x: 430, y: 215 }]),
    // VSS is jumped off the VS screw rather than run a second time from the
    // Pico's pad — one lead between two terminals, the way the bench does it.
    // The bulge clears the screw block by 12 px rather than the 28 px it used
    // to, which read as a loop of slack hanging off the board's edge. It meets
    // the VS feed at the terminal, which is correct: same net, same colour.
    w('vss', 'l298n:VS', 'l298n:VSS', RED, [{ x: 458, y: 215 }, { x: 458, y: 255 }]),
    w('gnd', 'pico:GND.7', 'l298n:GND', BLACK, [{ x: 405, y: 175 }, { x: 405, y: 235 }]),
    // The three control lines: off the RIGHT header, one step down into their
    // own lane, straight across, and up into the driver's underside. The pin
    // furthest DOWN the header (GP18) takes the shallowest lane and the
    // OUTERMOST turn, which is what keeps each wire's long run clear of the
    // other two's descents.
    w('ena', 'pico:GP18', 'l298n:ENA', ORANGE, [
      { x: 125, y: 315 },
      { x: 125, y: 325 },
      { x: 510, y: 325 },
    ]),
    w('in1', 'pico:GP19', 'l298n:IN1', GREEN, [
      { x: 115, y: 305 },
      { x: 115, y: 335 },
      { x: 520, y: 335 },
    ]),
    w('in2', 'pico:GP20', 'l298n:IN2', YELLOW, [
      { x: 105, y: 295 },
      { x: 105, y: 345 },
      { x: 530, y: 345 },
    ]),
    w('m1', 'l298n:OUT1', 'motor:1', BLUE),
    w('m2', 'l298n:OUT2', 'motor:2', BLUE),

    // ── The stepper half ──────────────────────────────────────────────────
    // IN1-IN4 on GPIO 17, 27, 22 and 5, the published sequence verbatim. The
    // first three are on the right header and drop in a column band inside
    // x=105, so none of them crosses a control lane; GP5 is the one step pin
    // on the LEFT header and goes round the board's edge to reach the same
    // row of inputs.
    w('st_in1', 'pico:GP17', 'uln:IN1', GREEN, [{ x: 92, y: 335 }, { x: 92, y: 375 }]),
    w('st_in2', 'pico:GP27', 'uln:IN2', GREEN, [{ x: 100, y: 235 }, { x: 100, y: 385 }]),
    w('st_in3', 'pico:GP22', 'uln:IN3', GREEN, [{ x: 96, y: 265 }, { x: 96, y: 395 }]),
    w('st_in4', 'pico:GP5', 'uln:IN4', GREEN, [{ x: -20, y: 215 }, { x: -20, y: 405 }]),
    // The array's own ground, round the outside so it meets none of the four
    // step leads, and COM at the coil supply — COM is the flyback diodes'
    // cathode rail and has to sit AT the winding supply or they conduct while
    // the motor is running normally.
    w('st_gnd', 'uln:GND', 'pico:GND.4', BLACK, [
      { x: 180, y: 470 },
      { x: -32, y: 470 },
      { x: -32, y: 325 },
    ]),
    // COM leaves DOWNWARD and climbs past the far side of the motor, rather
    // than stepping right off the terminal: the 60-unit gap between the array
    // and the motor is where the five-lead cable runs, and a supply wire
    // crossing it there would be drawn over all four phases.
    w('st_com', 'uln:COM', 'pico:5V', RED, [
      { x: 260, y: 512 },
      { x: 430, y: 512 },
      { x: 430, y: 130 },
      { x: 80, y: 130 },
    ]),
    // The motor's five leads, as a cable rather than five diagonals: each one
    // steps into its own column in the 60-unit gap between the two parts,
    // drops to its own lane below both, and comes up into its lead. Phases in
    // HALF_STEP_SEQUENCE order — IN1→A, IN2→B, IN3→C, IN4→D.
    //
    // The ordering is the same three-part rule as experiment 11's lamp fan:
    // the array's TOP output takes the outermost column and the shallowest
    // lane, so no phase lead crosses another. The common tap is the exception
    // and cannot be otherwise — the red lead sits between the array's columns
    // and the four phase leads' risers, so it has to pass through the bundle
    // whichever lane it takes. It takes the deepest, which is where a fifth
    // wire joining a four-wire cable belongs.
    w('st_a', 'uln:OUT1', 'stepper:A', YELLOW, [
      { x: 292, y: 375 },
      { x: 292, y: 470 },
      { x: 355, y: 470 },
    ]),
    w('st_b', 'uln:OUT2', 'stepper:B', YELLOW, [
      { x: 284, y: 385 },
      { x: 284, y: 478 },
      { x: 365, y: 478 },
    ]),
    w('st_c', 'uln:OUT3', 'stepper:C', YELLOW, [
      { x: 276, y: 395 },
      { x: 276, y: 486 },
      { x: 375, y: 486 },
    ]),
    w('st_d', 'uln:OUT4', 'stepper:D', YELLOW, [
      { x: 268, y: 405 },
      { x: 268, y: 494 },
      { x: 385, y: 494 },
    ]),
    w('st_common', 'stepper:COM', 'uln:COM', RED, [
      { x: 345, y: 502 },
      { x: 264, y: 502 },
      { x: 264, y: 445 },
    ]),
  ],
}

/* ── 10 · Home automation (Raspberry Pi Pico) ──────────────────────────────
 *
 * Reference `connections`, verbatim: `['Relay IN1–IN4','GPIO17, 27, 22, 23']`,
 * `['Relay VCC','5V']`, `['Relay GND','GND']` — and its published Flask app
 * names the same four: `devices = {'Light': 17, 'Fan': 27, 'AC': 22, 'TV': 23}`.
 * This figure used to drive ONE channel, on GP15, which is a four-channel
 * module with three dead inputs and a web page listing four appliances.
 *
 * GPIO23 IS NOT ON A PICO'S HEADER, the same wall experiment 9 hits, and the
 * same answer: lib/simulator/pico/experiments.ts's `HOME_AUTOMATION_RPI` puts
 * the fourth channel on GP16 and says so in the script's own comment. This
 * follows it. The other three are the published numbers untouched.
 *
 * ONE LAMP, NOT FOUR, and the reference is why: its `connections` wire no load
 * at all — VCC, GND and the four inputs, and then a `['Note','Use opto-isolated
 * relay for 230V AC loads']`. The `LEDs (simulate loads)` on the bill of
 * materials are exactly that, a stand-in, so this draws ONE of them, on channel
 * 1, to show what a switched contact does. Four would be four copies of the
 * same three wires and would say nothing the first says.
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
    // The four control lines. GP17, GP22 and GP16 are on the RIGHT header,
    // which faces the module, so those three drop straight into their own
    // lanes and run across. GP27 is on the right header too but far up it, so
    // it takes the shallowest lane of the four. Deeper lane = further right
    // landing, which is what keeps the fan from crossing itself: IN1 is the
    // module's leftmost input and IN4 its rightmost.
    w('coil_in1', 'pico:GP17', 'relay:IN1', GREEN, [
      { x: 108, y: 335 },
      { x: 108, y: 380 },
      { x: 320, y: 380 },
    ]),
    w('coil_in2', 'pico:GP27', 'relay:IN2', GREEN, [
      { x: 120, y: 235 },
      { x: 120, y: 356 },
      { x: 330, y: 356 },
    ]),
    w('coil_in3', 'pico:GP22', 'relay:IN3', GREEN, [
      { x: 114, y: 265 },
      { x: 114, y: 368 },
      { x: 340, y: 368 },
    ]),
    w('coil_in4', 'pico:GP16', 'relay:IN4', GREEN, [
      { x: 102, y: 345 },
      { x: 102, y: 392 },
      { x: 350, y: 392 },
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

/* ── 11 · Smart traffic controller (Arduino Mega) ──────────────────────────
 *
 * THE LAB SHEET GOVERNS, NOT THE PORTED SKETCH — an explicit reversal of the
 * choice this file used to make. `iot_virtual_lab.html`'s own bill of
 * materials is unambiguous: Arduino Mega, 12 LEDs (three sets of red/yellow/
 * green — the sheet writes "RGYG"), four potentiometers, four OPTIONAL IR
 * sensors, a 16×2 LCD. Its Circuit section wires lane 1's R/Y/G to pins
 * 22/23/24, lane 2 to 25/26/27, lane 3 to 28/29/30, lane 4 to 31/32/33, and
 * the four density pots to A0-A3 — and its own published sketch (reproduced
 * verbatim in utils/experimentData.ts now) drives exactly that: a
 * `redPins[]`/`yelPins[]`/`grnPins[]` array of four, `analogRead` on four
 * density pins, no ultrasonic sensor anywhere in it. The single-lane,
 * one-scanner Uno circuit this file drew before came from the colleague's
 * ported SKETCH data, which told a smaller story than the lab sheet did; the
 * owner has ruled that where the two disagree, the lab sheet wins. See
 * lib/simulator/model/examples.ts's `STARTER_SMART_TRAFFIC` for the fuller
 * accounting of the same bill of materials against this part library — this
 * drawing matches its board and its five part types (Mega, breadboard, LED,
 * resistor, potentiometer), plus the LCD that starter could not ship because
 * this library had no display part yet.
 *
 * THE PARTS ARE FREE-STANDING, NOT PLUGGED INTO BREADBOARD COLUMNS, and that
 * departs from every other figure's discipline in this file on purpose. A
 * single R/Y/G trio already spans a whole bank's 26 usable columns (see
 * experiment 3), and four trios do not fit sixteen columns wide on any
 * breadboard this library has. The starter reaches the same conclusion for
 * the same reason: its own twelve LEDs and twelve resistors sit in a
 * component tray below the bench, wired straight to the Mega, with the
 * breadboard present only for the rails. This drawing does the same, and then
 * finishes the wiring the starter leaves to the student.
 *
 * ONE BREADBOARD, matching the starter's own bill of materials, carries the
 * shared ground return for all twelve lamps and the LCD's supply pins. The
 * four pots and the twelve lane drives tap the Mega directly — its GND and
 * 5 V pads sit right beside where each of those lands, and running every one
 * of sixteen signals via the rail would be four extra jumpers for no wire
 * saved.
 *
 * THE MEGA'S DIGITAL HEADER IS SIDE-MOUNTED, unlike the Uno's or the Pico's.
 * D22-D53 run down the board's RIGHT edge (see makeMega()), so the twelve
 * lane wires leave the board moving sideways — `offX()`, not `off()` — clear
 * the edge, then drop below the header before turning toward whichever lamp
 * they drive, which is what keeps a dozen wires bound for a 2×6 grid from
 * being drawn across the board or across each other's lamps. D0-D21 are the
 * Uno-style top-edge header the Mega ALSO carries, and the six LCD control
 * lines use six of those pins — free ones, because the published circuit
 * never assigns the LCD a pin at all (see below).
 *
 * TWELVE LAMPS IN A 2×6 GRID, two lanes to a row, each lane's red/yellow/
 * green kept as three consecutive cells so the trio still reads as one unit.
 * A 4-column × 3-row layout would say "lane" more plainly but costs 70-odd
 * units of PANEL HEIGHT this figure cannot spend: the read-only canvas floors
 * its zoom-out at 0.45× (CircuitCanvas's `FIT_MIN_Z`), so a figure any taller
 * than roughly 450 units starts giving up real margin on the narrowest phones
 * this page supports. Two rows of six is the shape that keeps a 30-part Mega
 * board inside the same panel the other eleven three-to-eight-part circuits
 * already fit — see the fit measurements taken in the commit that added this.
 *
 * THE LCD IS WIRED, NOT DECORATIVE, even though the published sketch never
 * touches it — every status line it prints goes to `Serial.print`, which the
 * code panel already shows, exactly as the starter's own comment on the same
 * point observes. It is on the bill of materials without the "(optional)" the
 * IR sensors carry, so it is built as real, working hardware: VSS/GND, VDD/
 * 5 V, R/W tied low (the library never reads), V0 tied straight to ground for
 * maximum contrast (no fifth potentiometer is in the bill of materials to
 * spare for a trimmer), RS/E/D4-D7 on a 4-bit interface to six free Mega
 * pins, and the backlight straight across the rail — the exact "Hello World"
 * LCD wiring lib/simulator/__tests__/lcd.test.ts exercises, just on a Mega
 * instead of an Uno. D0-D3 and R/W stay off the Checks panel by the same
 * `character_lcd` exemption that test file documents: a 4-bit interface
 * leaves them unconnected by design, not by mistake.
 *
 * THE IR SENSORS ARE OMITTED. The bill of materials marks all four
 * "(optional)", and the published sketch never reads them — density comes
 * from `analogRead(densityPin[i])` on the four pots, exactly as the starter's
 * own comment on this experiment argues: "a part that the program cannot
 * observe would be furniture." Four more modules would also be four more
 * shapes fighting the panel-height budget above for room a working part
 * already has a claim on.
 */

/**
 * Where the Mega, the LCD, the breadboard and the pots stand.
 *
 * THE LCD SITS BESIDE THE MEGA, ON ITS TOP EDGE'S OWN LEVEL, not below the
 * breadboard the way an earlier draft of this file placed it. Every one of
 * the LCD's sixteen pins is a single row along ITS top edge (see
 * `makeLCD1602()`), and the six free Mega pins driving it — D6-D11 — are on
 * the Mega's TOP edge too (the Uno-style header the Mega also carries,
 * unlike D22-D53's side-mounted one the lane wires use). Put the two boards
 * side by side at the same height and those six control wires are nearly
 * horizontal instead of the long trip around the panel an earlier layout
 * needed; it is also what keeps this figure's overall width inside the
 * panel-height budget's OWN twin, the panel-WIDTH one — this document's own
 * fit measurement is the one this shape was chosen to pass.
 *
 * THE BREADBOARD AND THE POTS SIT BELOW THE MEGA, side by side, so neither
 * adds its own row: the pot tray shares the Mega's own footprint width, and
 * the breadboard — used here only for the twelve lamps' shared ground
 * return — costs only the fifty extra units of width its own body needs
 * beside the pots, not a whole board's width stacked on top of everything
 * else.
 */
const MEGA_AT: Point = { x: 0, y: 20 }
const MEGA_11 = board('mega', 'arduino_mega', MEGA_AT)
/**
 * The LCD, sixty units further right than it used to stand.
 *
 * THE TWELVE LANE WIRES WERE BEING DRAWN THROUGH IT. The Mega's D22-D53
 * header runs down its right edge at y=38..88 (world), the display's body
 * covers y=20..112, and every lamp drive used to leave its pin and run
 * straight right at its own pin row — which is to say, straight across the
 * screen. It was already true of the six pins this figure reached before and
 * the correct twelve make it plainer, so the fix is here rather than deferred:
 * the drives now DROP first, into the corridor between the two boards, and
 * cross underneath the display. That corridor was 20 units wide with the LCD
 * at x=424 and twelve wires do not fit in 20 units; at 484 it is 80, and the
 * display still clears the lane channel at 692 by 28.
 */
const LCD_11_AT: Point = { x: 484, y: 20 }
const LCD_11 = board('lcd', 'lcd1602', LCD_11_AT)
const BB_11_AT: Point = { x: 0, y: 240 }

/** Where potentiometer `i` (0-3) stands, beside the breadboard. */
function potAt(i: number): Point {
  return { x: 335 + i * 88.74, y: 240 }
}

/**
 * Each knob's resting position, chosen to MATCH the density showreel/
 * timelines.ts plays back — `analogRead()` returns roughly `position/100 *
 * 1023`, so lane 1's 10% knob is the ~100-count reading the timeline's first
 * "Lane 1 Green" line is computed from, and so on for the other three. The
 * knobs do not turn during playback; only the lamps and the serial log do.
 */
const POT_POSITIONS_11 = [10, 29, 49, 20]
const POTS_11 = [0, 1, 2, 3].map((i) =>
  board(`pot${i + 1}`, 'potentiometer', potAt(i), { position: POT_POSITIONS_11[i] }),
)

/**
 * The twelve lamps, laid out two lanes per row so the grid stays inside the
 * panel-height budget explained above.
 *
 * `pin` is the published assignment, verbatim: redPins/yelPins/grnPins in
 * `iot_virtual_lab.html`'s own sketch, `{22,25,28,31}`/`{23,26,29,32}`/
 * `{24,27,30,33}`, which is also its `connections` list read straight down —
 * `['Lane 1 R/Y/G LEDs','Pins 22,23,24']` … `['Lane 4 R/Y/G LEDs','Pins
 * 31,32,33']`. A lane takes THREE consecutive pins and the next lane starts
 * where the previous one stopped, so lane `i` is `22+3i`/`23+3i`/`24+3i` and
 * the twelve lamps use twelve distinct pins.
 *
 * The stride used to be `+i` rather than `+3i`, which collapsed the twelve on
 * to seven pins (D22-D28) and gave four of them two lamps apiece — lane 2's
 * red was lane 1's yellow. Nothing downstream could notice: `digitalWrite` to
 * a pin two lamps share is legal, the drawing rendered, and the showreel
 * lights lamps by part id rather than by pin. The reference's own arithmetic
 * is what catches it.
 */
const LANE_PINS = [0, 1, 2, 3].map((lane) => ({
  red: `D${22 + lane * 3}`,
  yellow: `D${23 + lane * 3}`,
  green: `D${24 + lane * 3}`,
}))

const GRID_11_AT: Point = { x: 0, y: 422 }
const CELL_PITCH_X = 106
/** Row pitch is barely more than an LED's own 52-unit height — this panel's
 * height budget is as tight as its width one, see the doc comment above. */
const ROW_PITCH_Y = 55
/** How far the LED sits from its cell's own left edge — right against the
 * resistor's far lead, which is what keeps a cell only as wide as the two
 * parts actually need. */
const LED_OFFSET_X = 62

interface Lamp11 {
  id: string
  color: 'red' | 'yellow' | 'green'
  pin: string
  cellX: number
  cellY: number
}

const LAMPS_11: Lamp11[] = LANE_PINS.flatMap((pins, lane) =>
  (['red', 'yellow', 'green'] as const).map((color, colorIdx) => {
    const cellIndex = lane * 3 + colorIdx
    const row = Math.floor(cellIndex / 6)
    const col = cellIndex % 6
    return {
      id: `l${lane + 1}_${color}`,
      color,
      pin: pins[color],
      cellX: GRID_11_AT.x + col * CELL_PITCH_X,
      cellY: GRID_11_AT.y + row * ROW_PITCH_Y,
    }
  }),
)

/** The 220 Ω series resistor and the lamp it feeds, for one lamp cell. */
function lampParts(lamp: Lamp11): PlacedPart[] {
  return [
    board(`r_${lamp.id}`, 'resistor', { x: lamp.cellX, y: lamp.cellY + 20 }, { ohms: 220 }),
    board(`led_${lamp.id}`, 'led', { x: lamp.cellX + LED_OFFSET_X, y: lamp.cellY }, { color: lamp.color }),
  ]
}

const LAMP_HUE: Record<Lamp11['color'], string> = { red: ORANGE, yellow: YELLOW, green: GREEN }

/**
 * The LEFT edge of a vertical channel clear of every part above the grid — the
 * Mega, the LCD, the breadboard and the pot tray all end at or before this x —
 * so the twelve lane-drive wires can drop from the Mega's side header straight
 * down to the grid without crossing any of their bodies.
 */
const LANE_CHANNEL_X = 692

/**
 * How far apart the twelve drive wires' descents stand in that channel.
 *
 * ONE SHARED COLUMN IS NOT ENOUGH ANY MORE, and the reason is the reference's
 * own pin list. D22-D53 is a DOUBLE row (see the geometry in makeMega():
 * D22 and D23 are both at y=18.2, one at x=376 and one at x=386.5, and so on
 * down the header), so twelve consecutive pins are twelve wires on only SIX
 * y levels. Sent to a single channel column they would leave in six pairs,
 * each pair drawn along the same line. Twelve descents four units apart is
 * forty-four units of extra width and is the whole fix.
 */
const LANE_CHANNEL_PITCH = 4

/**
 * The CORRIDOR between the Mega's right edge (x=404.2) and the LCD's left one
 * (484): where the twelve drives drop out of the pin rows so they can cross
 * the panel BELOW the display rather than through it. Twelve columns six
 * apart is 412…478, which leaves six units of daylight at the display.
 */
const LANE_CORRIDOR_X = 412
const LANE_CORRIDOR_PITCH = 6

/**
 * The BAND they cross in, under the LCD (its body ends at y=112) and well
 * above the Mega's own ground jumper (y=198) and the pot tray (y=240).
 * Twelve lanes four apart is 118…162.
 */
const LANE_BAND_Y = 118
const LANE_BAND_PITCH = 4

/**
 * How far the INNER column's wires step off their own row before crossing the
 * outer one.
 *
 * D22, D24, D26… sit at x=376 with D23, D25, D27… directly beside them at
 * x=386.5 on the SAME y. A wire from an inner pad that leaves straight right
 * is drawn through its neighbour's pad, which is exactly the thing this file's
 * header rule forbids: "a reference figure cannot afford a wire that looks
 * like it might be landing on the neighbouring pin." So an inner wire steps
 * DOWN into the gap between two rows first — the rows are ten units apart, so
 * 4.5 puts it between pads and not over one. Down rather than up because the
 * six LCD control lanes occupy y=12…18, immediately above the top row.
 */
const MEGA_INNER_JOG = 4.5
/** The x an inner-column wire makes that step at: between the two pad columns. */
const MEGA_JOG_X = 381

/**
 * The drive wire for one lamp: off the Mega's SIDE header, down its own
 * corridor column, across its own band lane under the display, down its own
 * channel column past the pot tray, then left into the lamp's own cell.
 *
 * THE THREE FANS ARE ORDERED, AND THE ORDER IS THE WHOLE REASON THERE ARE NO
 * CROSSINGS. Rank the twelve by the height they leave the header at — which
 * after the jog is twelve distinct values, D23 highest and D32 lowest — and
 * then:
 *
 *   • the HIGHEST wire takes the OUTERMOST corridor column, so every wire's
 *     run off the header stops short of the columns belonging to wires above
 *     it, and never has to cross one;
 *   • the highest wire takes the SHALLOWEST band lane, so a wire crossing the
 *     panel is always above the corridor drops it passes;
 *   • and the shallowest band lane takes the OUTERMOST channel column, so a
 *     band lane is always above the channel drops it passes as well.
 *
 * Reverse any one of the three and twelve wires cross each other. All twelve
 * then share the same landing `y` (412, ten units clear of the grid's own top
 * edge at 422), so the fan makes its last bend in the open gap below the pots
 * rather than over any part's body.
 */
function lampDrive(lamp: Lamp11): DocWire {
  const index = Number(lamp.pin.slice(1)) - 22
  // Even pins are the inner column; odd ones already face open space.
  const inner = index % 2 === 0
  const pinY = offX(MEGA_11, lamp.pin, 0).y
  const runY = inner ? pinY + MEGA_INNER_JOG : pinY
  // Height rank, 0 = highest. The jog puts each inner pin just below its own
  // outer twin, so swapping the pair's indices is exactly that ordering.
  const rank = inner ? index + 1 : index - 1
  const corridorX = LANE_CORRIDOR_X + (11 - rank) * LANE_CORRIDOR_PITCH
  const bandY = LANE_BAND_Y + rank * LANE_BAND_PITCH
  const channelX = LANE_CHANNEL_X + (11 - rank) * LANE_CHANNEL_PITCH
  return w(`drv_${lamp.id}`, `mega:${lamp.pin}`, `r_${lamp.id}:1`, LAMP_HUE[lamp.color], [
    ...(inner
      ? [
          { x: MEGA_JOG_X, y: pinY },
          { x: MEGA_JOG_X, y: runY },
        ]
      : []),
    { x: corridorX, y: runY },
    { x: corridorX, y: bandY },
    { x: channelX, y: bandY },
    { x: channelX, y: 412 },
    { x: lamp.cellX, y: 412 },
  ])
}

const GRID_ROWS_11: Lamp11[][] = [LAMPS_11.slice(0, 6), LAMPS_11.slice(6, 12)]

/**
 * One row's ground return: the six cathodes chained lamp-to-lamp, then ONE
 * wire from the FIRST of them back to the shared rail — the same
 * daisy-chain-then-one-return shape experiment 2 uses for two sensors, scaled
 * to six, tapped at whichever end is closer.
 *
 * That end is column 0's, not column 5's, because the breadboard sits
 * directly above the grid's LEFT edge (`BB_11_AT`): a return from the first
 * lamp is a short near-vertical hop into the rail, where a return from the
 * last would cross the other five lamps' bodies to get there.
 *
 * THE SECOND ROW CANNOT GO STRAIGHT UP, and this is why the two rows are not
 * wired identically. Row 2's lamps sit directly BELOW row 1's — same six cell
 * columns, 55 units lower — so a return climbing out of row 2's first cathode
 * is drawn through row 1's first lamp on its way to the rail. There is no way
 * between the cells either: a cell is 106 wide and its resistor plus lamp fill
 * 103.7 of it. So row 2 leaves the grid SIDEWAYS instead, and the only side it
 * can leave by is the left — the right is where all twelve drive wires make
 * their last turn at y=412, and a riser out there would cross every one of
 * them. It comes back in along y=404, short of row 1's own return, and lands
 * two columns further along the same rail.
 */
function rowGround(row: Lamp11[], railCol: number, aroundLeft = false): DocWire[] {
  const links: DocWire[] = []
  for (let i = 0; i < row.length - 1; i++) {
    links.push(w(`gndlink_${row[i].id}`, `led_${row[i].id}:C`, `led_${row[i + 1].id}:C`, BLACK))
  }
  const first = row[0]
  const cathodeX = first.cellX + LED_OFFSET_X + 15.63
  const railX = 20 + (railCol - 1) * 10
  const path = aroundLeft
    ? [
        { x: GRID_BYPASS_X, y: first.cellY + 43.8 },
        { x: GRID_BYPASS_X, y: 404 },
        { x: railX, y: 404 },
      ]
    : [{ x: cathodeX, y: 415 }]
  links.push(w(`gndret_${first.id}`, `led_${first.id}:C`, `bb:bn${railCol}`, BLACK, path))
  return links
}

/** The clear column to the left of the grid that row 2's return climbs. */
const GRID_BYPASS_X = -26

export const CIRCUIT_SMART_TRAFFIC: CircuitDoc = {
  parts: [
    MEGA_11,
    bench(BB_11_AT),
    LCD_11,
    ...POTS_11,
    ...LAMPS_11.flatMap(lampParts),
  ],
  wires: [
    // Mega -> breadboard: the ONE thing the board carries now that the LCD
    // and the pots tap the Mega directly (see the doc comment above) is the
    // twelve lamps' shared ground, so this is the only wire it needs. GND.4
    // exits the Mega's side header, drops below it and the pot tray — clear
    // of both — before landing on the near rail.
    // The turn is at x=490, past the lane corridor's outermost column (478)
    // rather than inside it: GND.4 leaves the side header BELOW every drive
    // (y=198 against their deepest band lane at 162), so running on to clear
    // the corridor entirely costs nothing and keeps the two fans apart.
    w('bb_gnd', 'mega:GND.4', 'bb:bn1', BLACK, [
      offX(MEGA_11, 'GND.4', 490),
      { x: 490, y: 230 },
      { x: 300, y: 230 },
    ]),

    // The LCD's supply and control. VSS/RW/V0/K are jumpered together right
    // on the module and grounded once, the same for VDD/A on the 5 V side —
    // the same "Hello World" LCD wiring lib/simulator/__tests__/lcd.test.ts
    // exercises (R/W tied low, V0 tied straight to ground for maximum
    // contrast, backlight straight across the rail), just gathered at the
    // module instead of run to a rail twice each.
    w('lcd_vss', 'mega:GND.1', 'lcd:VSS', BLACK, [off(MEGA_11, 'GND.1', 12), { x: 499, y: 12 }]),
    w('lcd_rw', 'lcd:RW', 'lcd:VSS', BLACK),
    w('lcd_v0', 'lcd:V0', 'lcd:VSS', BLACK),
    w('lcd_k', 'lcd:K', 'lcd:VSS', BLACK),
    // 5V.1 is at the top of the Mega's SIDE header, so this one reaches across
    // sideways. The turn is at x=480 — past the lane corridor, short of the
    // display — so it never runs down a drive wire's column.
    w('lcd_vdd', 'mega:5V.1', 'lcd:VDD', RED, [offX(MEGA_11, '5V.1', 480)]),
    w('lcd_a', 'lcd:A', 'lcd:VDD', RED),
    // RS/E/D4-D7 on six free top-header pins — free because the published
    // circuit never assigns the LCD one. Six parallel lanes at y=13..18,
    // clearing the Mega's top edge before crossing to the display, which
    // sits at the SAME height beside it (see the doc comment above). Kept as
    // close to the edge as the lanes can be packed — this panel's HEIGHT
    // budget is exactly as tight as its width one.
    w('lcd_rs', 'mega:D6', 'lcd:RS', BLUE, [off(MEGA_11, 'D6', 13), { x: 529, y: 13 }]),
    w('lcd_e', 'mega:D7', 'lcd:E', BLUE, [off(MEGA_11, 'D7', 14), { x: 549, y: 14 }]),
    w('lcd_d4', 'mega:D8', 'lcd:D4', BLUE, [off(MEGA_11, 'D8', 15), { x: 599, y: 15 }]),
    w('lcd_d5', 'mega:D9', 'lcd:D5', BLUE, [off(MEGA_11, 'D9', 16), { x: 609, y: 16 }]),
    w('lcd_d6', 'mega:D10', 'lcd:D6', BLUE, [off(MEGA_11, 'D10', 17), { x: 619, y: 17 }]),
    w('lcd_d7', 'mega:D11', 'lcd:D7', BLUE, [off(MEGA_11, 'D11', 18), { x: 629, y: 18 }]),

    // The four density pots: wiper to its own analog pin, ground and 5 V
    // chained pot-to-pot and tapped once each off the Mega's bottom header —
    // A0-A3 and GND/5V share that header, so every one of these is a short
    // reach straight down.
    // A0's pot is the first in the tray, so its wiper lead reaches it without
    // passing another pot. A1-A3's do NOT: run straight and they are drawn
    // through one, two and three knobs respectively on the way. So those three
    // drop into the 10-unit GAP immediately left of the pot they are going to
    // — the tray's pitch is 88.74 against a body 78.74 wide, which is what
    // leaves the gap — and come at the wiper from just above the pin row.
    //
    // The three lanes above the tray are ordered furthest-target-shallowest,
    // for the reason the lamp fan's are, and all three sit BELOW the Mega's
    // own ground jumper at y=230 so none of them crosses it.
    ...[0, 1, 2, 3].flatMap((i) => {
      const gapX = potAt(i).x - 5
      const wires: DocWire[] = [
        w(
          `pot${i}_sig`,
          `mega:A${i}`,
          `pot${i + 1}:2`,
          ORANGE,
          i === 0
            ? [off(MEGA_11, 'A0', 228)]
            : [off(MEGA_11, `A${i}`, 240 - i * 3), { x: gapX, y: 240 - i * 3 }, { x: gapX, y: 302 }],
        ),
      ]
      if (i > 0) {
        wires.push(
          w(`pot${i}_gchain`, `pot${i}:1`, `pot${i + 1}:1`, BLACK),
          w(`pot${i}_vchain`, `pot${i}:3`, `pot${i + 1}:3`, RED),
        )
      }
      return wires
    }),
    w('pot_gnd', 'mega:GND.2', 'pot1:1', BLACK, [off(MEGA_11, 'GND.2', 228)]),
    w('pot_v', 'mega:5V', 'pot1:3', RED, [off(MEGA_11, '5V', 228)]),

    // The twelve lamps: drive from the Mega, resistor into the anode, cathode
    // onto its row's ground chain.
    ...LAMPS_11.map(lampDrive),
    ...LAMPS_11.map((lamp) => w(`br_${lamp.id}`, `r_${lamp.id}:2`, `led_${lamp.id}:A`, LAMP_HUE[lamp.color])),
    ...rowGround(GRID_ROWS_11[0], 5),
    ...rowGround(GRID_ROWS_11[1], 2, true),
  ],
}

/* ── 12 · Health monitoring (Raspberry Pi Pico) ────────────────────────────
 *
 * THE LAB SHEET GOVERNS, NOT THE PORTED SKETCH — the same reversal as
 * experiment 11's, for the same reason. `iot_virtual_lab.html`'s bill of
 * materials names a Raspberry Pi 3/4, a DS18B20, a pulse sensor (SEN-11574),
 * an MCP3008 ADC, a 4.7 kΩ resistor and an optional OLED — no LM35, no analog
 * pins read directly, and its own Theory section says outright why the ADC is
 * there: "since Pi lacks analog pins". A potentiometer standing in for an
 * analog temperature reading was never this circuit; it was a stand-in for a
 * part this library used to be missing, recorded as exactly that in this
 * comment's previous revision. The library now has `ds18b20`, so the
 * substitution is retired rather than carried forward.
 *
 * A PICO, not the Uno the ported sketch ran on — a Raspberry Pi board is what
 * the bill of materials names, and `raspberry_pi_pico` is the only Raspberry
 * Pi this library emulates (see lib/simulator/model/parts.ts). This is also
 * now the fifth Pico circuit in this file to reuse `pico()`/`bench()`, so it
 * follows the same furniture every other one does.
 *
 * THE WIRING IS lib/simulator/pico/experiments.ts's `HEALTH_MONITORING_RPI`,
 * redrawn in this file's own document model rather than re-derived: DS18B20
 * DATA on GP4 with its 4.7 kΩ pull-up (the same value experiment 8 uses, for
 * the same 1-Wire-timing reason), MCP3008 CLK/MOSI/MISO/CS on GP11/10/9/8 —
 * the published SPI0 pins, unmoved — and the pulse sensor's analog output into
 * the converter's CH0. Every published pin number survives the port, same as
 * that file's own comment observes.
 *
 * WHY THE MCP3008 IS STILL HERE on a board with three native ADCs
 * (GP26/27/28): the printed circuit puts an external SPI converter in front
 * of the sensor because a real Raspberry Pi has no analog input pins at all,
 * and that fact — not a Pico-specific limitation — is what the experiment is
 * teaching. Building the SPI transaction the published Python performs
 * (`spidev.xfer2([1, (8+ch)<<4, 0])`, ported to a bit-banged `SoftSPI` in
 * pico/experiments.ts) is worth meeting even though GP26 would read the same
 * sensor directly.
 *
 * DS18B20 AND RESISTOR ARE ON THE BREADBOARD, in the same columns and the
 * same discipline experiment 8 already established (a datasheet 4.7 kΩ
 * pull-up sharing the data column). THE MCP3008 AND THE PULSE SENSOR ARE
 * FREE-STANDING, wired straight to the Pico's left header and to each other,
 * the same choice experiment 9 makes for the L298N: a 16-pin ADC does not
 * gain anything from tie-point columns it would only occupy two of (its own
 * pins are on a 10-unit pitch already, but along the chip's own edges, not
 * the breadboard's row grid), and a reference figure gets a shorter, plainer
 * set of wires by placing it where it is going to sit.
 *
 * THE OLED IS OMITTED. The bill of materials marks it optional, there is no
 * display part in this library, and — as with experiment 11's LCD note, the
 * mirror image of this one — the published Python never writes to one either;
 * every reading it produces goes to `print()`, which the code panel already
 * shows.
 */
const MCP3008_AT: Point = { x: 100, y: 220 }
const MCP3008_12 = board('adc', 'mcp3008', MCP3008_AT)
const PULSE_12 = board('pulse', 'pulse_sensor', { x: 30, y: 260 }, { bpm: 72, amplitude: 8 })

export const CIRCUIT_HEALTH_MONITOR: CircuitDoc = {
  parts: [
    pico(),
    bench(PICO_BENCH_AT),
    pplug('ds', 'ds18b20', 'DQ', 'e20', { temperature: 36.5, resolution: 12 }),
    pplug('r4k7', 'resistor', '1', 'c20', { ohms: 4700 }),
    MCP3008_12,
    PULSE_12,
  ],
  wires: [
    ...picoSupply('bn28'),
    // DS18B20, exactly as experiment 8 wires one.
    leg('ds_g', 'ds:GND', 'bb:e19', BLACK),
    leg('ds_q', 'ds:DQ', 'bb:e20', GREEN),
    leg('ds_v', 'ds:VDD', 'bb:e21', RED),
    w('ds_ret', 'bb:a19', 'bb:bn19', BLACK),
    w('ds_pwr', 'bb:a21', 'bb:bp21', RED),
    leg('pu_d', 'r4k7:1', 'bb:c20', YELLOW),
    leg('pu_r', 'r4k7:2', 'bb:c26', YELLOW),
    w('pu_v', 'bb:a26', 'bb:bp26', RED),
    w('sig', 'pico:GP4', 'bb:b20', GREEN, [{ x: 485, y: 185 }, { x: 360, y: 140 }]),

    // The MCP3008's supply and reference, off the same rail. VREF tied to the
    // 3.3 V rail the sensor runs from is what makes the conversion
    // ratiometric — see the doc comment on the equivalent wire in
    // pico/experiments.ts.
    w('adc_vdd', 'bb:bp5', 'adc:VDD', RED),
    w('adc_vref', 'bb:bp6', 'adc:VREF', RED),
    w('adc_agnd', 'bb:bn24', 'adc:AGND', BLACK),
    w('adc_dgnd', 'bb:bn25', 'adc:DGND', BLACK),
    // SPI: the Pico's left header exits leftward, clears the board, then
    // crosses to the converter's right-hand pins — CLK/DIN/DOUT/CS is
    // GP11/10/9/8, the published SPI0 pins, unmoved.
    w('adc_clk', 'pico:GP11', 'adc:CLK', BLUE, [{ x: 480, y: 275 }]),
    w('adc_din', 'pico:GP10', 'adc:DIN', BLUE, [{ x: 483, y: 265 }]),
    w('adc_dout', 'pico:GP9', 'adc:DOUT', BLUE, [{ x: 486, y: 245 }]),
    w('adc_cs', 'pico:GP8', 'adc:CS', BLUE, [{ x: 489, y: 235 }]),

    // The pulse sensor: supply off the rail, signal into the converter's
    // channel 0 — the one analog half of an otherwise-digital bus.
    w('pulse_vcc', 'bb:bp7', 'pulse:VCC', RED),
    // The return leaves the rail at the far end of the board, so a straight run
    // to the sensor is drawn corner-to-corner THROUGH the converter. It goes
    // under both instead: down clear of the board, along beneath the ADC (its
    // body ends at y=320) and the sensor, and up into the pad from below —
    // which is the side a pulse sensor's three leads come out of anyway.
    w('pulse_gnd', 'bb:bn26', 'pulse:GND', BLACK, [{ x: 270, y: 336 }, { x: 60, y: 336 }]),
    w('pulse_sig', 'pulse:SIG', 'adc:CH0', YELLOW),
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
