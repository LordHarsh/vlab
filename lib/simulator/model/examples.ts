/**
 * Starter circuits.
 *
 * These are what `circuits.role = 'starter'` holds in the schema (§7): the
 * document a student opens the experiment with. Authored here for development;
 * in production an admin draws them in the same editor (§7.1).
 */

import type { CircuitDoc, DocWire } from './document'

/**
 * VLab Experiment 01 output stage: D13 → 220 Ω → LED → GND, built on a
 * breadboard the way the lab sheet describes it.
 *
 * Column 5 carries the drive, column 10 joins resistor to LED anode, column 15
 * returns to ground. The breadboard's own strips do the connecting.
 */
export const EXPERIMENT_01: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 230, rotation: 0, props: {} },
    { id: 'r1', type: 'resistor', x: 90, y: 450, rotation: 0, props: { ohms: 220 } },
    { id: 'led1', type: 'led', x: 240, y: 440, rotation: 0, props: {} },
  ],
  wires: [
    // All on bank A (rows a-e). Wiring D13 to j5 and the resistor to a5 would
    // NOT connect them: the centre channel separates the two banks of a column.
    { id: 'w1', from: { partId: 'uno', pinId: 'D13' }, to: { partId: 'bb', pinId: 'a5' }, color: '#e04a4a' },
    { id: 'w2', from: { partId: 'r1', pinId: '1' }, to: { partId: 'bb', pinId: 'b5' }, color: '#eab308' },
    { id: 'w3', from: { partId: 'r1', pinId: '2' }, to: { partId: 'bb', pinId: 'b10' }, color: '#eab308' },
    { id: 'w4', from: { partId: 'led1', pinId: 'A' }, to: { partId: 'bb', pinId: 'c10' }, color: '#2f7d32' },
    { id: 'w5', from: { partId: 'led1', pinId: 'C' }, to: { partId: 'bb', pinId: 'c15' }, color: '#2f7d32' },
    { id: 'w6', from: { partId: 'bb', pinId: 'd15' }, to: { partId: 'uno', pinId: 'GND.1' }, color: '#111827' },
  ],
}

/** An empty board, for free-form building. */
export const BLANK: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 230, rotation: 0, props: {} },
  ],
  wires: [],
}

/** Potentiometer across the rails, wiper into A0 — the analogRead demo. */
export const POT_ADC: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'pot', type: 'potentiometer', x: 120, y: 260, rotation: 0, props: { position: 50 } },
    { id: 'r1', type: 'resistor', x: 300, y: 300, rotation: 0, props: { ohms: 220 } },
    { id: 'led1', type: 'led', x: 430, y: 280, rotation: 0, props: {} },
  ],
  wires: [
    { id: 'p1', from: { partId: 'pot', pinId: '1' }, to: { partId: 'uno', pinId: 'GND.1' }, color: '#111827' },
    { id: 'p2', from: { partId: 'pot', pinId: '3' }, to: { partId: 'uno', pinId: '5V' }, color: '#e04a4a' },
    { id: 'p3', from: { partId: 'pot', pinId: '2' }, to: { partId: 'uno', pinId: 'A0' }, color: '#eab308' },
    { id: 'p4', from: { partId: 'uno', pinId: 'D9' }, to: { partId: 'r1', pinId: '1' }, color: '#2563eb' },
    { id: 'p5', from: { partId: 'r1', pinId: '2' }, to: { partId: 'led1', pinId: 'A' }, color: '#2563eb' },
    { id: 'p6', from: { partId: 'led1', pinId: 'C' }, to: { partId: 'uno', pinId: 'GND.2' }, color: '#111827' },
  ],
}

/**
 * Experiment 01 as the lab sheet actually describes it: DHT11 on D2 with its
 * 10k pull-up, and the threshold LED on D13.
 */
export const EXPERIMENT_01_DHT: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'dht', type: 'dht11', x: 120, y: 280, rotation: 0, props: { temperature: 24, humidity: 45 } },
    { id: 'rpull', type: 'resistor', x: 260, y: 240, rotation: 0, props: { ohms: 10000 } },
    { id: 'r1', type: 'resistor', x: 420, y: 320, rotation: 0, props: { ohms: 220 } },
    { id: 'led1', type: 'led', x: 560, y: 300, rotation: 0, props: {} },
  ],
  wires: [
    { id: 'd1', from: { partId: 'dht', pinId: 'VCC' }, to: { partId: 'uno', pinId: '5V' }, color: '#e04a4a' },
    { id: 'd2', from: { partId: 'dht', pinId: 'GND' }, to: { partId: 'uno', pinId: 'GND.1' }, color: '#111827' },
    { id: 'd3', from: { partId: 'dht', pinId: 'DATA' }, to: { partId: 'uno', pinId: 'D2' }, color: '#2f7d32' },
    // The datasheet's 10k pull-up. Without it the open-drain line never rises.
    { id: 'd4', from: { partId: 'rpull', pinId: '1' }, to: { partId: 'dht', pinId: 'DATA' }, color: '#eab308' },
    { id: 'd5', from: { partId: 'rpull', pinId: '2' }, to: { partId: 'uno', pinId: '5V' }, color: '#e04a4a' },
    { id: 'd6', from: { partId: 'uno', pinId: 'D13' }, to: { partId: 'r1', pinId: '1' }, color: '#2563eb' },
    { id: 'd7', from: { partId: 'r1', pinId: '2' }, to: { partId: 'led1', pinId: 'A' }, color: '#2563eb' },
    { id: 'd8', from: { partId: 'led1', pinId: 'C' }, to: { partId: 'uno', pinId: 'GND.2' }, color: '#111827' },
  ],
}

/* ─── Authored lab starters ─────────────────────────────────────────────────
 *
 * These seven are the documents migrations 020, 021 and 022 load into
 * `circuits` as role='starter' for the real experiments. Everything above is a
 * development example; everything below is production content, so treat an edit
 * here as an edit to what a student opens with.
 *
 * PEDAGOGY — how much is pre-wired, and why.
 *
 * A starter hands over the bench, not the answer. The rule applied to all of
 * them is: the SUPPLY PLUMBING is done, every SIGNAL PATH is open. So the
 * board's supply and GND already reach the breadboard's rails (and the two rail
 * pairs are bridged, the way a demonstrator sets a board up before a class), and
 * every wire the lab sheet actually asks the student to reason about — which
 * digital pin, which side of the resistor, which leg of the LED, where the
 * pull-up goes — is missing. The parts themselves are laid out below the board
 * like a component tray: present, identified, and unwired.
 *
 * A consequence, and it is the intended one: compile() reports each unwired
 * part in the Checks panel from the moment the experiment opens. That is the
 * to-do list, not a defect. What must NOT appear is anything else — a crossed
 * centre channel, a dangling MCU pin, a fault, a solver error. The permanent
 * test in __tests__/starters.test.ts asserts exactly that split.
 */

/**
 * The Uno's supply brought out to the breadboard rails.
 *
 * Column 2 for the feed and column 29 for the bridge purely so the jumpers sit
 * clear of the middle of the board, where the student is about to work.
 *
 * A factory rather than a shared constant: these objects become editor state
 * (docReducer assigns the document straight through), and two documents must
 * never end up sharing wire objects.
 */
function powerRails(): DocWire[] {
  return [
    // Uno → top rails. GND.2 is on the power header, next to 5V, so the pair
    // leaves the board the way it does on a real bench.
    { id: 'pw_5v', from: { partId: 'uno', pinId: '5V' }, to: { partId: 'bb', pinId: 'tp2' }, color: '#e04a4a' },
    { id: 'pw_gnd', from: { partId: 'uno', pinId: 'GND.2' }, to: { partId: 'bb', pinId: 'tn2' }, color: '#111827' },
    // Top rails → bottom rails. The four rails on a half-size board are four
    // SEPARATE strips; without these two jumpers the lower half of the board
    // has no supply at all.
    { id: 'pw_bridge_p', from: { partId: 'bb', pinId: 'tp29' }, to: { partId: 'bb', pinId: 'bp29' }, color: '#e04a4a' },
    { id: 'pw_bridge_n', from: { partId: 'bb', pinId: 'tn29' }, to: { partId: 'bb', pinId: 'bn29' }, color: '#111827' },
  ]
}

/**
 * The PICO's supply brought out to the breadboard rails.
 *
 * Deliberately a second function rather than a parameter on powerRails(),
 * because almost nothing about it is shared. The feed is 3V3(OUT) — pin id
 * `3.3V`, which is what compile() keys its 3.3 V rail stamp off — not `5V`, and
 * the ground it leaves from is GND.7, two pads along the same right-hand header
 * so the pair leaves the board together exactly as it does on a real bench. A
 * Pico's `5V` pad is VBUS: USB power passed straight through, which is NOT the
 * board's logic rail and must never be what a starter plumbs.
 *
 * The rail voltage is the reason this matters beyond tidiness. Every part hung
 * on these rails sees 3.3 V, so an LED's series resistor, a sensor's minimum
 * supply and the level a switch can present to a GPIO all move. Copying the Uno
 * rails across would give a circuit that solves perfectly and teaches 5 V
 * arithmetic on a 3.3 V board.
 */
function picoPowerRails(): DocWire[] {
  return [
    { id: 'pw_3v3', from: { partId: 'pico', pinId: '3.3V' }, to: { partId: 'bb', pinId: 'tp2' }, color: '#e04a4a' },
    { id: 'pw_gnd', from: { partId: 'pico', pinId: 'GND.7' }, to: { partId: 'bb', pinId: 'tn2' }, color: '#111827' },
    // The four rails on a half-size board are four SEPARATE strips; without
    // these two jumpers the lower half of the board has no supply at all.
    { id: 'pw_bridge_p', from: { partId: 'bb', pinId: 'tp29' }, to: { partId: 'bb', pinId: 'bp29' }, color: '#e04a4a' },
    { id: 'pw_bridge_n', from: { partId: 'bb', pinId: 'tn29' }, to: { partId: 'bb', pinId: 'bn29' }, color: '#111827' },
  ]
}

/**
 * Experiment 01 — "LED & DHT11 Temperature/Humidity Sensor Interfacing"
 * (experiment slug `led-dht11-arduino`).
 *
 * Bill of materials from the experiment's own Components section: Uno, DHT11,
 * red LED, 220 Ω, 10 kΩ pull-up, breadboard. The student wires DHT11 VCC/GND to
 * the rails, DATA to D2 with the 10 kΩ up to +5 V, and D13 → 220 Ω → LED → GND.
 */
export const STARTER_LED_DHT11: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    // Component tray, below the board.
    { id: 'dht', type: 'dht11', x: 60, y: 470, rotation: 0, props: { temperature: 24, humidity: 45 } },
    { id: 'r10k', type: 'resistor', x: 150, y: 480, rotation: 0, props: { ohms: 10000 } },
    { id: 'r220', type: 'resistor', x: 250, y: 480, rotation: 0, props: { ohms: 220 } },
    { id: 'led', type: 'led', x: 350, y: 460, rotation: 0, props: {} },
  ],
  wires: powerRails(),
}

/**
 * Experiment 03 — "Traffic Light Simulator" (slug `traffic-light-arduino`).
 *
 * Bill of materials from the experiment's Components section: Uno, red/yellow/
 * green LEDs, 3 × 220 Ω, breadboard, and the optional push button the Theory
 * and Procedure sections both call for on D5 (pedestrian phase). The student
 * wires D2/D3/D4 → 220 Ω → anode and every cathode back to the ground rail.
 *
 * The three LEDs are electrically and visually identical — the part library has
 * one LED with a fixed red colour and no colour property — so the colour lives
 * in the part id, which is what the Measurements readout is keyed by.
 */
export const STARTER_TRAFFIC_LIGHT: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    { id: 'r_red', type: 'resistor', x: 60, y: 480, rotation: 0, props: { ohms: 220 } },
    { id: 'r_yellow', type: 'resistor', x: 160, y: 480, rotation: 0, props: { ohms: 220 } },
    { id: 'r_green', type: 'resistor', x: 260, y: 480, rotation: 0, props: { ohms: 220 } },
    { id: 'led_red', type: 'led', x: 370, y: 460, rotation: 0, props: {} },
    { id: 'led_yellow', type: 'led', x: 430, y: 460, rotation: 0, props: {} },
    { id: 'led_green', type: 'led', x: 490, y: 460, rotation: 0, props: {} },
    { id: 'btn', type: 'push_button', x: 560, y: 470, rotation: 0, props: { pressed: 0 } },
  ],
  wires: powerRails(),
}

/**
 * Experiment 02 — "Ultrasonic Sensor & PIR Sensor Interfacing"
 * (slug `ultrasonic-pir-arduino`).
 *
 * Bill of materials from the experiment's Components section: Uno, HC-SR04,
 * HC-SR501 PIR, LED, 220 Ω, breadboard. The Circuit section asks for
 * TRIG → D9, ECHO → D10, PIR OUT → D7, and the LED on D13 through the 220 Ω;
 * both sensors take their supply from the rails.
 *
 * Neither sensor is pre-wired, INCLUDING its supply. That is deliberate: the
 * behavioural models refuse to answer on an unpowered VCC pin (see the note on
 * GND_IS_A_REAL_WIRE in parts.ts — GND is typed `passive`, not `gnd`, precisely
 * so a forgotten ground wire stays forgotten), so "I wired the signal but not
 * the power" is a mistake the student can make, see, and fix here. Pre-wiring
 * the sensor supply would delete the lesson.
 *
 * The PIR ships with `warmup: 0`. A real HC-SR501 needs 30–60 s to settle and
 * the Procedure section says so, but a starter that does nothing at all for the
 * first minute reads as broken; the student can raise it in the inspector once
 * the circuit works.
 */
export const STARTER_ULTRASONIC_PIR: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    // Component tray, below the board. The HC-SR04 is wide (≈177 units) and the
    // PIR nearly square, so the tray runs the full width of the opening view.
    { id: 'hcsr04', type: 'hc_sr04', x: 60, y: 470, rotation: 0, props: { distance: 50 } },
    { id: 'pir', type: 'pir_motion', x: 270, y: 470, rotation: 0, props: { motion: 0, hold: 5, warmup: 0 } },
    { id: 'r220', type: 'resistor', x: 400, y: 490, rotation: 0, props: { ohms: 220 } },
    { id: 'led', type: 'led', x: 500, y: 470, rotation: 0, props: {} },
  ],
  wires: powerRails(),
}

/**
 * Experiment 04 — "Water Flow Detection using Arduino"
 * (slug `water-flow-arduino`).
 *
 * Bill of materials from the experiment's Components section: Uno, YF-S201 flow
 * sensor, 10 kΩ pull-up. The Circuit section asks for VCC → 5 V, GND → GND and
 * the signal line into D2 (INT0, which is why that pin and no other) with the
 * 10 kΩ up to +5 V.
 *
 * The BOM does not list a breadboard — the real bench wires this one sensor
 * straight to the header. A breadboard is shipped anyway, for two reasons: the
 * pull-up needs a tie point where the signal line and D2 already meet, and the
 * pre-wired supply rails are the convention every other starter opens with. It
 * costs the student nothing to ignore it.
 */
export const STARTER_WATER_FLOW: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    { id: 'flow', type: 'flow_sensor', x: 60, y: 470, rotation: 0, props: { flow: 10 } },
    { id: 'r10k', type: 'resistor', x: 170, y: 490, rotation: 0, props: { ohms: 10000 } },
  ],
  wires: powerRails(),
}

/**
 * Experiment 06 — "Motion Sensor Alarm using PIR Sensor"
 * (slug `pir-alarm-arduino`).
 *
 * Bill of materials from the experiment's Components section: Uno, HC-SR501
 * PIR, ACTIVE buzzer, red LED, green LED, 2 × 220 Ω. The Circuit section asks
 * for PIR OUT → D7, buzzer + → D8 and − → GND, red LED on D12 and green LED on
 * D11, each through a 220 Ω.
 *
 * `passive: 0` is load-bearing, not decoration. The BOM says active buzzer, and
 * the two are electrically different parts: an active buzzer is a ~167 Ω
 * resistive load that sounds on a bare digitalWrite (which is exactly what the
 * sketch does), while a passive one is a piezo — a capacitor, an open at DC —
 * that would draw no current and make the compiler emit a limitation notice.
 *
 * The LEDs are electrically and visually identical (one red LED model, no
 * colour property), so the colour lives in the part id, which is what the
 * Measurements readout is keyed by. Same convention as experiment 03.
 */
export const STARTER_PIR_ALARM: CircuitDoc = {
  parts: [
    { id: 'uno', type: 'arduino_uno', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    { id: 'pir', type: 'pir_motion', x: 60, y: 470, rotation: 0, props: { motion: 0, hold: 5, warmup: 0 } },
    { id: 'buzzer', type: 'buzzer', x: 190, y: 470, rotation: 0, props: { passive: 0 } },
    { id: 'r_red', type: 'resistor', x: 270, y: 490, rotation: 0, props: { ohms: 220 } },
    { id: 'r_green', type: 'resistor', x: 370, y: 490, rotation: 0, props: { ohms: 220 } },
    { id: 'led_red', type: 'led', x: 470, y: 470, rotation: 0, props: {} },
    { id: 'led_green', type: 'led', x: 540, y: 470, rotation: 0, props: {} },
  ],
  wires: powerRails(),
}

/**
 * Experiment 05 — "LED & Push Button Interfacing with Raspberry Pi"
 * (slug `led-button-rpi`). A PICO circuit: see lib/simulator/model/boards.ts.
 *
 * Bill of materials from the experiment's own Components section: board, LED,
 * 220 Ω, push button, 10 kΩ, connecting wires, breadboard. The Circuit section
 * asks for LED anode → GPIO17 through the 220 Ω and its cathode to GND, button
 * pin 1 → GPIO27 and button pin 2 → 3.3 V through the 10 kΩ; the code sets
 * GP27 to `Pin.IN, Pin.PULL_DOWN` and tests for HIGH, so the switch has to
 * SOURCE the rail. All of that is the student's to wire.
 *
 * WHY 220 Ω IS STILL RIGHT ON 3.3 V, and why that is not an accident: the
 * published content targets a Raspberry Pi SBC, which is a 3.3 V part too, so
 * its resistor values port across unchanged. They would NOT have survived a port
 * from an Uno — the same 220 Ω that gives ~12.4 mA on 5 V gives ~4.9 mA here,
 * because the LED's ~2 V forward drop eats a far larger share of the budget.
 * That figure is pinned by hand-solved theory in __tests__/pico.test.ts group C.
 *
 * The 10 kΩ sits in SERIES between the switch and 3V3 rather than as the usual
 * external pull-down to ground, because that is what the lab sheet's Circuit
 * section draws. It still works: against the Pico's ~55 kΩ internal pull-down it
 * divides 3.3 V down to about 2.8 V, comfortably over the RP2040's 2.0 V VIH.
 */
export const STARTER_LED_BUTTON_PICO: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    // Component tray, below the board.
    { id: 'r220', type: 'resistor', x: 60, y: 490, rotation: 0, props: { ohms: 220 } },
    { id: 'r10k', type: 'resistor', x: 170, y: 490, rotation: 0, props: { ohms: 10000 } },
    { id: 'led', type: 'led', x: 280, y: 470, rotation: 0, props: {} },
    { id: 'btn', type: 'push_button', x: 370, y: 470, rotation: 0, props: { pressed: 0 } },
  ],
  wires: picoPowerRails(),
}

/**
 * Experiment 07 — "DHT11 Temperature & Humidity with Raspberry Pi"
 * (slug `dht11-rpi`). A PICO circuit.
 *
 * Bill of materials from the experiment's Components section: board, DHT11,
 * 10 kΩ, connecting wires. The Circuit section asks for VCC → 3.3 V, GND → GND
 * and DATA → GPIO4 with the 10 kΩ pulled up to 3.3 V.
 *
 * The pull-up is not decoration and not optional. A DHT11 is open-drain — it can
 * only ever pull the line DOWN — and MicroPython's `dht` driver puts GP4 in
 * open-drain mode as well, so with nothing pulling the line up the read simply
 * times out. 10 kΩ is the datasheet value and is the same on either rail.
 *
 * As with experiment 04, the bill of materials does not list a breadboard and
 * one ships anyway: the pull-up needs a tie point where DATA and GP4 already
 * meet, and pre-wired rails are the convention every other starter opens with.
 */
export const STARTER_DHT11_PICO: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 40, y: 20, rotation: 0, props: {} },
    { id: 'bb', type: 'breadboard', x: 40, y: 260, rotation: 0, props: {} },
    { id: 'dht', type: 'dht11', x: 60, y: 470, rotation: 0, props: { temperature: 24, humidity: 45 } },
    { id: 'r10k', type: 'resistor', x: 150, y: 490, rotation: 0, props: { ohms: 10000 } },
  ],
  wires: picoPowerRails(),
}

/**
 * Every authored starter, keyed by EXPERIMENT SLUG.
 *
 * The slug is the key because that is what migrations 020, 021 and 022 look the
 * simulation up by — never a hardcoded uuid — so this map and the migrations can
 * be checked against each other. starters.test.ts does exactly that.
 *
 * The last two run on a Raspberry Pi Pico rather than an Uno. Nothing in this
 * map records that, and nothing needs to: detectBoard() reads the board out of
 * the document itself (model/boards.ts), which is the only place that can never
 * disagree with what the student is actually looking at.
 */
export const EXPERIMENT_STARTERS: Record<string, CircuitDoc> = {
  'led-dht11-arduino': STARTER_LED_DHT11,
  'ultrasonic-pir-arduino': STARTER_ULTRASONIC_PIR,
  'traffic-light-arduino': STARTER_TRAFFIC_LIGHT,
  'water-flow-arduino': STARTER_WATER_FLOW,
  'pir-alarm-arduino': STARTER_PIR_ALARM,
  'led-button-rpi': STARTER_LED_BUTTON_PICO,
  'dht11-rpi': STARTER_DHT11_PICO,
}

export const EXAMPLES: Record<string, { label: string; short: string; doc: CircuitDoc }> = {
  exp01: { label: 'Experiment 01 — LED + 220 Ω', short: 'LED', doc: EXPERIMENT_01 },
  dht: { label: 'Experiment 01 — DHT11 + LED', short: 'Exp 01', doc: EXPERIMENT_01_DHT },
  pot: { label: 'Potentiometer → analogRead', short: 'Pot', doc: POT_ADC },
  starterDht: { label: 'Lab starter — LED & DHT11', short: 'Starter 1', doc: STARTER_LED_DHT11 },
  starterUltrasonic: { label: 'Lab starter — Ultrasonic + PIR', short: 'Starter 2', doc: STARTER_ULTRASONIC_PIR },
  starterTraffic: { label: 'Lab starter — Traffic light', short: 'Starter 3', doc: STARTER_TRAFFIC_LIGHT },
  starterFlow: { label: 'Lab starter — Water flow', short: 'Starter 4', doc: STARTER_WATER_FLOW },
  starterPirAlarm: { label: 'Lab starter — PIR alarm', short: 'Starter 6', doc: STARTER_PIR_ALARM },
  starterPicoButton: { label: 'Lab starter — Pico LED & button', short: 'Starter 5', doc: STARTER_LED_BUTTON_PICO },
  starterPicoDht: { label: 'Lab starter — Pico DHT11', short: 'Starter 7', doc: STARTER_DHT11_PICO },
  blank: { label: 'Blank board', short: 'Blank', doc: BLANK },
}
