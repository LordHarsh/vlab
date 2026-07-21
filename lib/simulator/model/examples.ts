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

export const EXAMPLES: Record<string, { label: string; doc: CircuitDoc }> = {
  exp01: { label: 'Experiment 01 — LED + 220 Ω', doc: EXPERIMENT_01 },
  blank: { label: 'Blank board', doc: BLANK },
}
