/**
 * Starter circuits.
 *
 * These are what `circuits.role = 'starter'` holds in the schema (§7): the
 * document a student opens the experiment with. Authored here for development;
 * in production an admin draws them in the same editor (§7.1).
 */

import type { CircuitDoc } from './document'

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

export const EXAMPLES: Record<string, { label: string; doc: CircuitDoc }> = {
  exp01: { label: 'Experiment 01 — LED + 220 Ω', doc: EXPERIMENT_01 },
  dht: { label: 'Experiment 01 — DHT11 + LED', doc: EXPERIMENT_01_DHT },
  pot: { label: 'Potentiometer → analogRead', doc: POT_ADC },
  blank: { label: 'Blank board', doc: BLANK },
}
