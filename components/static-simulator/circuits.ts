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
 * LAYOUT. Landscape, because the workspace canvas is about twice as wide as it
 * is tall and `CircuitCanvas` fits the document's bounding box into it. Board
 * left, breadboard upper-right where the circuit needs a shared node, discrete
 * parts in a tray under it. Sensors with a drawn target — the HC-SR04's
 * reticle, the PIR's cone — are placed with clear space ABOVE them and always
 * with a taller part alongside, because `docBounds` measures PARTS and a beam
 * that reaches past every part's box is a beam that gets cropped by the fit.
 */

import {
  WIRE_COLOR_GND,
  WIRE_COLOR_POWER,
  WIRE_PALETTE,
  type CircuitDoc,
  type DocWire,
  type PinRef,
  type Point,
} from '@/lib/simulator/model/document'

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
 * them — so they are used here only where a straight lead would run across
 * something a reader needs to see, never to imply a connection.
 */
function w(id: string, from: string, to: string, color: string, waypoints?: Point[]): DocWire {
  return { id, from: pin(from), to: pin(to), color, ...(waypoints ? { waypoints } : {}) }
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
 */
export const CIRCUIT_LED_DHT11: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 220, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 400, y: 40, rotation: 0, props: {} },
    { id: 'led', type: 'led', x: 455, y: 300, rotation: 0, props: { color: 'red' } },
    { id: 'r220', type: 'resistor', x: 530, y: 320, rotation: 0, props: { ohms: 220 } },
    { id: 'r10k', type: 'resistor', x: 620, y: 320, rotation: 0, props: { ohms: 10000 } },
    { id: 'dht', type: 'dht11', x: 700, y: 270, rotation: 0, props: { temperature: 24, humidity: 45 } },
  ],
  wires: [
    // Supply out to the board's lower rails, along the bottom and up.
    w('pw_5v', 'uno:5V', 'bb:bp2', RED, [{ x: 206.7, y: 442 }, { x: 430, y: 442 }]),
    w('pw_gnd', 'uno:GND.2', 'bb:bn4', BLACK, [{ x: 216.6, y: 455 }, { x: 450, y: 455 }]),
    // DHT11: supply from the rails, DATA up into column 30.
    w('dht_v', 'dht:VCC', 'bb:bp28', RED),
    w('dht_g', 'dht:GND', 'bb:bn30', BLACK),
    w('dht_d', 'dht:DATA', 'bb:a30', GREEN),
    // The pull-up bridges that same column to the + rail.
    w('pu_d', 'r10k:2', 'bb:b30', YELLOW),
    w('pu_v', 'r10k:1', 'bb:bp21', RED),
    // …and the column carries on to D2.
    w('sig', 'bb:c30', 'uno:D2', GREEN),
    // D13 → column 19 → 220 Ω → LED → ground rail.
    w('drv', 'uno:D13', 'bb:b19', BLUE),
    w('r_in', 'r220:2', 'bb:a19', BLUE),
    w('r_out', 'r220:1', 'led:A', BLUE),
    w('ld_c', 'led:C', 'bb:bn6', BLACK),
  ],
}

/* ── 2 · Ultrasonic & PIR (Arduino Uno) ────────────────────────────────────
 *
 * Sketch: PIR OUT on D2, HC-SR04 TRIG on D3 and ECHO on D4.
 *
 * No breadboard: three wires per sensor straight to the header is what their
 * build steps describe and what a bench looks like for two modules. The Uno
 * sits high enough that both drawn fields — the PIR's 100° cone and the
 * ultrasonic's beam out to 240 cm — stay inside the fitted view.
 */
export const CIRCUIT_ULTRASONIC_PIR: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 140, rotation: 0, props: {} },
    {
      id: 'pir',
      type: 'pir_motion',
      x: 400,
      y: 320,
      rotation: 0,
      props: { motion: 0, distance: 240, bearing: 0, hold: 5, warmup: 0 },
    },
    { id: 'hcsr04', type: 'hc_sr04', x: 600, y: 330, rotation: 0, props: { distance: 240 } },
  ],
  wires: [
    w('pir_v', 'uno:5V', 'pir:VCC', RED),
    w('pir_g', 'uno:GND.2', 'pir:GND', BLACK),
    w('pir_o', 'uno:D2', 'pir:OUT', GREEN),
    w('hc_v', 'uno:5V', 'hcsr04:VCC', RED),
    w('hc_g', 'uno:GND.3', 'hcsr04:GND', BLACK),
    w('hc_t', 'uno:D3', 'hcsr04:TRIG', ORANGE),
    w('hc_e', 'uno:D4', 'hcsr04:ECHO', YELLOW),
  ],
}

/* ── 3 · Traffic light (Arduino Uno) ───────────────────────────────────────
 *
 * Sketch: red D10, yellow D11, green D12, each through 220 Ω, cathodes to the
 * board's ground rail.
 *
 * The three LEDs really are red, yellow and green — our LED carries a `color`
 * prop and the artwork reads it — and the colour is not only cosmetic: green's
 * 3.2 V forward drop against red's ~2.0 is why the same 220 Ω gives a different
 * current per lamp.
 */
export const CIRCUIT_TRAFFIC_LIGHT: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 220, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 430, y: 40, rotation: 0, props: {} },
    // The lamps stand clear of the board's right edge on purpose: a lit LED's
    // halo has a 40-unit radius and any nearer it washes across the Uno.
    { id: 'led_red', type: 'led', x: 377, y: 300, rotation: 0, props: { color: 'red' } },
    { id: 'r_red', type: 'resistor', x: 434, y: 320, rotation: 0, props: { ohms: 220 } },
    { id: 'led_yellow', type: 'led', x: 497, y: 300, rotation: 0, props: { color: 'yellow' } },
    { id: 'r_yellow', type: 'resistor', x: 554, y: 320, rotation: 0, props: { ohms: 220 } },
    { id: 'led_green', type: 'led', x: 617, y: 300, rotation: 0, props: { color: 'green' } },
    { id: 'r_green', type: 'resistor', x: 674, y: 320, rotation: 0, props: { ohms: 220 } },
  ],
  wires: [
    // The ground rail leaves GND.1 on the DIGITAL header rather than the power
    // header underneath, so the run to the board passes over the tray instead
    // of down through it. Same net, same board, one fewer wire across a lamp.
    w('pw_gnd', 'uno:GND.1', 'bb:bn1', BLACK),
    // Red lane: D10 → column 6 → 220 Ω → anode; cathode to the ground rail.
    w('drv_r', 'uno:D10', 'bb:b6', ORANGE),
    w('rin_r', 'r_red:2', 'bb:a6', ORANGE),
    w('rout_r', 'r_red:1', 'led_red:A', ORANGE),
    w('gnd_r', 'led_red:C', 'bb:bn3', BLACK),
    // Yellow lane, on column 18.
    w('drv_y', 'uno:D11', 'bb:b18', YELLOW),
    w('rin_y', 'r_yellow:2', 'bb:a18', YELLOW),
    w('rout_y', 'r_yellow:1', 'led_yellow:A', YELLOW),
    w('gnd_y', 'led_yellow:C', 'bb:bn8', BLACK),
    // Green lane, on column 30.
    w('drv_g', 'uno:D12', 'bb:b30', GREEN),
    w('rin_g', 'r_green:2', 'bb:a30', GREEN),
    w('rout_g', 'r_green:1', 'led_green:A', GREEN),
    w('gnd_g', 'led_green:C', 'bb:bn20', BLACK),
  ],
}

/* ── 4 · Water flow (Arduino Uno) ──────────────────────────────────────────
 *
 * Sketch: YF-S201 signal on D2 — INT0, which is why that pin and no other.
 *
 * The 10 kΩ pull-up is here for the reason the DHT11's is: the sensor's output
 * is an open-collector Hall switch, so with nothing holding the line up there
 * is no edge for the interrupt to count. The breadboard exists to give the
 * pull-up and the signal a tie point they can share.
 */
export const CIRCUIT_WATER_FLOW: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 220, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 400, y: 40, rotation: 0, props: {} },
    { id: 'flow', type: 'flow_sensor', x: 450, y: 300, rotation: 0, props: { flow: 0 } },
    { id: 'r10k', type: 'resistor', x: 560, y: 320, rotation: 0, props: { ohms: 10000 } },
  ],
  wires: [
    w('pw_5v', 'uno:5V', 'bb:bp2', RED, [{ x: 206.7, y: 442 }, { x: 430, y: 442 }]),
    // Rising at column 3 and not column 4: the flow sensor's left edge is at
    // 450 and the rail hole for column 4 sits directly under it.
    w('pw_gnd', 'uno:GND.2', 'bb:bn3', BLACK, [{ x: 216.6, y: 455 }, { x: 440, y: 455 }]),
    w('fl_v', 'flow:VCC', 'bb:bp5', RED),
    w('fl_g', 'flow:GND', 'bb:bn9', BLACK),
    w('fl_s', 'flow:SIG', 'bb:a8', YELLOW),
    w('pu_d', 'r10k:1', 'bb:b8', YELLOW),
    w('pu_v', 'r10k:2', 'bb:bp21', RED),
    w('sig', 'bb:c8', 'uno:D2', YELLOW),
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
 * pair is 3V3 tied straight to a GPIO with no switch in between. Here GP14
 * lands on 1a and the rail on 2b, which is the diagonal a real tactile switch
 * is used across, and the RP2040's internal pull-down is what holds the pin low
 * while the contacts are open, exactly as the sketch asks for.
 */
export const CIRCUIT_LED_BUTTON_PICO: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 140, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 250, y: 40, rotation: 0, props: {} },
    { id: 'led', type: 'led', x: 245, y: 270, rotation: 0, props: { color: 'blue' } },
    { id: 'r220', type: 'resistor', x: 300, y: 290, rotation: 0, props: { ohms: 220 } },
    { id: 'btn', type: 'push_button', x: 430, y: 280, rotation: 0, props: { pressed: 0 } },
  ],
  wires: [
    w('pw_3v3', 'pico:3.3V', 'bb:bp2', RED),
    w('pw_gnd', 'pico:GND.7', 'bb:bn4', BLACK),
    // GP15 → column 11 → 220 Ω → LED → ground rail.
    w('drv', 'pico:GP15', 'bb:b11', BLUE),
    w('r_in', 'r220:2', 'bb:a11', BLUE),
    w('r_out', 'r220:1', 'led:A', BLUE),
    w('ld_c', 'led:C', 'bb:bn1', BLACK),
    // The switch: GP14 on one side of the contacts, 3V3 on the other.
    w('btn_sig', 'pico:GP14', 'bb:b20', GREEN),
    w('btn_in', 'btn:1a', 'bb:a20', GREEN),
    w('btn_pwr', 'btn:2b', 'bb:bp25', RED),
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
 */
export const CIRCUIT_PIR_ALARM: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 140, rotation: 0, props: {} },
    {
      id: 'pir',
      type: 'pir_motion',
      x: 430,
      y: 290,
      rotation: 0,
      props: { motion: 0, distance: 300, bearing: 0, hold: 5, warmup: 0 },
    },
    { id: 'buzzer', type: 'buzzer', x: 640, y: 340, rotation: 0, props: { passive: 0 } },
  ],
  wires: [
    w('pir_v', 'uno:5V', 'pir:VCC', RED),
    w('pir_g', 'uno:GND.2', 'pir:GND', BLACK),
    w('pir_o', 'uno:D2', 'pir:OUT', GREEN),
    w('bz_p', 'uno:D3', 'buzzer:P', ORANGE),
    w('bz_n', 'uno:GND.3', 'buzzer:N', BLACK),
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
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 140, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 250, y: 40, rotation: 0, props: {} },
    { id: 'dht', type: 'dht11', x: 300, y: 270, rotation: 0, props: { temperature: 22, humidity: 55 } },
    { id: 'r10k', type: 'resistor', x: 390, y: 290, rotation: 0, props: { ohms: 10000 } },
  ],
  wires: [
    w('pw_3v3', 'pico:3.3V', 'bb:bp2', RED),
    w('pw_gnd', 'pico:GND.7', 'bb:bn4', BLACK),
    w('dht_v', 'dht:VCC', 'bb:bp5', RED),
    w('dht_g', 'dht:GND', 'bb:bn7', BLACK),
    w('dht_d', 'dht:DATA', 'bb:a7', GREEN),
    w('pu_d', 'r10k:1', 'bb:b7', YELLOW),
    w('pu_v', 'r10k:2', 'bb:bp19', RED),
    w('sig', 'bb:c7', 'pico:GP4', GREEN),
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
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 140, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 250, y: 40, rotation: 0, props: {} },
    { id: 'ds', type: 'ds18b20', x: 300, y: 270, rotation: 0, props: { temperature: 24.5, resolution: 12 } },
    { id: 'r4k7', type: 'resistor', x: 390, y: 290, rotation: 0, props: { ohms: 4700 } },
  ],
  wires: [
    w('pw_3v3', 'pico:3.3V', 'bb:bp2', RED),
    w('pw_gnd', 'pico:GND.7', 'bb:bn4', BLACK),
    w('ds_v', 'ds:VDD', 'bb:bp7', RED),
    w('ds_g', 'ds:GND', 'bb:bn5', BLACK),
    w('ds_q', 'ds:DQ', 'bb:a6', GREEN),
    w('pu_d', 'r4k7:1', 'bb:b6', YELLOW),
    w('pu_v', 'r4k7:2', 'bb:bp19', RED),
    w('sig', 'bb:c6', 'pico:GP15', GREEN),
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
 * power passed straight through — which is what their build steps ask for. Five
 * volts is a limp motor after the bridge's ~2.5 V drop, and that is the L298N
 * rather than a defect in the drawing.
 */
export const CIRCUIT_MOTOR_CONTROL_PICO: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 150, rotation: 0, props: {} },
    { id: 'l298n', type: 'l298n', x: 330, y: 180, rotation: 0, props: {} },
    { id: 'motor', type: 'dc_motor', x: 560, y: 120, rotation: 0, props: { load: 0 } },
  ],
  wires: [
    w('vs', 'pico:5V', 'l298n:VS', RED),
    w('vss', 'pico:5V', 'l298n:VSS', RED),
    w('gnd', 'pico:GND.7', 'l298n:GND', BLACK),
    w('ena', 'pico:GP13', 'l298n:ENA', ORANGE),
    w('in1', 'pico:GP14', 'l298n:IN1', GREEN),
    w('in2', 'pico:GP15', 'l298n:IN2', YELLOW),
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
 */
export const CIRCUIT_HOME_AUTOMATION_PICO: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 150, rotation: 0, props: {} },
    { id: 'relay', type: 'relay_4ch', x: 300, y: 180, rotation: 0, props: { activeLow: 1 } },
    { id: 'r220', type: 'resistor', x: 560, y: 190, rotation: 0, props: { ohms: 220 } },
    { id: 'led', type: 'led', x: 650, y: 150, rotation: 0, props: { color: 'yellow' } },
  ],
  wires: [
    w('coil_v', 'pico:5V', 'relay:VCC', RED, [{ x: 250, y: 330 }]),
    w('coil_g', 'pico:GND.6', 'relay:GND', BLACK),
    w('coil_in', 'pico:GP15', 'relay:IN1', GREEN),
    // The switched side: 5 V into COM1, out of NO1 when the armature pulls in.
    w('load_com', 'pico:5V', 'relay:COM1', RED),
    w('load_no', 'relay:NO1', 'r220:1', ORANGE, [{ x: 400, y: 150 }]),
    w('load_r', 'r220:2', 'led:A', ORANGE),
    w('load_ret', 'led:C', 'pico:GND.4', BLACK, [{ x: 700, y: 330 }]),
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
 */
export const CIRCUIT_SMART_TRAFFIC: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 220, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 430, y: 40, rotation: 0, props: {} },
    // The two lamps sit ABOVE the lane the scanner's TRIG and ECHO leads take
    // across the bench, and clear of the Uno's right edge so a lit halo does
    // not wash over the board.
    { id: 'led_red', type: 'led', x: 377, y: 225, rotation: 0, props: { color: 'red' } },
    { id: 'r_red', type: 'resistor', x: 434, y: 245, rotation: 0, props: { ohms: 220 } },
    { id: 'led_green', type: 'led', x: 497, y: 225, rotation: 0, props: { color: 'green' } },
    { id: 'r_green', type: 'resistor', x: 554, y: 245, rotation: 0, props: { ohms: 220 } },
    { id: 'hcsr04', type: 'hc_sr04', x: 600, y: 340, rotation: 0, props: { distance: 260 } },
  ],
  wires: [
    w('pw_5v', 'uno:5V', 'hcsr04:VCC', RED),
    w('pw_gnd', 'uno:GND.3', 'hcsr04:GND', BLACK),
    w('hc_t', 'uno:D6', 'hcsr04:TRIG', ORANGE),
    w('hc_e', 'uno:D7', 'hcsr04:ECHO', YELLOW),
    // GND.1 on the digital header, so the rail feed runs over the lamps rather
    // than up through them.
    w('rail_gnd', 'uno:GND.1', 'bb:bn1', BLACK),
    // Red lamp: D4 → column 6 → 220 Ω → anode; cathode to the ground rail.
    w('drv_r', 'uno:D4', 'bb:b6', ORANGE),
    w('rin_r', 'r_red:2', 'bb:a6', ORANGE),
    w('rout_r', 'r_red:1', 'led_red:A', ORANGE),
    w('gnd_r', 'led_red:C', 'bb:bn3', BLACK),
    // Green lamp, on column 18.
    w('drv_g', 'uno:D3', 'bb:b18', GREEN),
    w('rin_g', 'r_green:2', 'bb:a18', GREEN),
    w('rout_g', 'r_green:1', 'led_green:A', GREEN),
    w('gnd_g', 'led_green:C', 'bb:bn9', BLACK),
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
 */
export const CIRCUIT_HEALTH_MONITOR: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 220, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 400, y: 40, rotation: 0, props: {} },
    { id: 'pulse', type: 'pulse_sensor', x: 450, y: 300, rotation: 0, props: { bpm: 72, amplitude: 8 } },
    { id: 'pot', type: 'potentiometer', x: 560, y: 290, rotation: 0, props: { position: 50, totalOhms: 10000 } },
  ],
  wires: [
    w('pw_5v', 'uno:5V', 'bb:bp2', RED, [{ x: 206.7, y: 442 }, { x: 430, y: 442 }]),
    // Column 3, not 4: the pulse sensor's left edge sits over column 4's hole.
    w('pw_gnd', 'uno:GND.2', 'bb:bn3', BLACK, [{ x: 216.6, y: 455 }, { x: 440, y: 455 }]),
    w('pl_v', 'pulse:VCC', 'bb:bp5', RED),
    w('pl_g', 'pulse:GND', 'bb:bn7', BLACK),
    w('pl_s', 'pulse:SIG', 'uno:A0', BLUE),
    w('pot_g', 'pot:1', 'bb:bn18', BLACK),
    w('pot_v', 'pot:3', 'bb:bp20', RED),
    w('pot_w', 'pot:2', 'uno:A1', ORANGE),
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
