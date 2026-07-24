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
 * These two are the documents migration 020 loads into `circuits` as
 * role='starter' for the real experiments. Everything above is a development
 * example; everything below is production content, so treat an edit here as an
 * edit to what a student opens with.
 *
 * PEDAGOGY — how much is pre-wired, and why.
 *
 * A starter hands over the bench, not the answer. The rule applied to both is:
 * the SUPPLY PLUMBING is done, every SIGNAL PATH is open. So the Uno's 5 V and
 * GND already reach the board's rails (and the two rail pairs are bridged, the
 * way a demonstrator sets a board up before a class), and every wire the lab
 * sheet actually asks the student to reason about — which digital pin, which
 * side of the resistor, which leg of the LED, where the pull-up goes — is
 * missing. The parts themselves are laid out below the board like a component
 * tray: present, identified, and unwired.
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
 * Every authored starter, keyed by EXPERIMENT SLUG.
 *
 * The slug is the key because that is what migration 020 looks the simulation
 * up by — never a hardcoded uuid — so this map and the migration can be
 * checked against each other. starters.test.ts does exactly that.
 */
export const EXPERIMENT_STARTERS: Record<string, CircuitDoc> = {
  'led-dht11-arduino': STARTER_LED_DHT11,
  'traffic-light-arduino': STARTER_TRAFFIC_LIGHT,
}

export const EXAMPLES: Record<string, { label: string; short: string; doc: CircuitDoc }> = {
  exp01: { label: 'Experiment 01 — LED + 220 Ω', short: 'LED', doc: EXPERIMENT_01 },
  dht: { label: 'Experiment 01 — DHT11 + LED', short: 'Exp 01', doc: EXPERIMENT_01_DHT },
  pot: { label: 'Potentiometer → analogRead', short: 'Pot', doc: POT_ADC },
  starterDht: { label: 'Lab starter — LED & DHT11', short: 'Starter 1', doc: STARTER_LED_DHT11 },
  starterTraffic: { label: 'Lab starter — Traffic light', short: 'Starter 3', doc: STARTER_TRAFFIC_LIGHT },
  blank: { label: 'Blank board', short: 'Blank', doc: BLANK },
}
