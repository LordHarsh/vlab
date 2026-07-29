/**
 * PART 1 OF THE "REALISTIC FAKERY" ADD — SLIDERS FOR SENSOR INPUTS.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE STILL DRAWS NOTHING AND SOLVES NOTHING.                       │
 * │                                                                         │
 * │ It has exactly one job: given the frame the showreel would be showing  │
 * │ anyway, and a value a student just dragged a slider to, return the     │
 * │ SAME SHAPE OF FRAME with that one field changed and — for the one      │
 * │ experiment whose sketch lights an LED off it — the one derived visual  │
 * │ recomputed. No interpreter, no netlist, one threshold comparison per   │
 * │ adjustable field. See showreel/timelines.ts's own header for why that  │
 * │ restraint matters here more than most files.                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * WHERE EVERY RANGE COMES FROM. `rangeOf()` reads the declared `range`
 * PropSpec off PART_LIBRARY (lib/simulator/model/parts.ts) — the SAME
 * min/max/step/unit the real interactive editor's own inspector slider for
 * that part uses. Nothing here invents a span; a DHT11's temperature slider
 * runs 0–50 °C because that is what `dht11`'s own prop declares, not because
 * this file decided a reference circuit only ever gets warm.
 *
 * WHERE EVERY THRESHOLD COMES FROM. Each constant below is transcribed from
 * the sketch the code panel shows beside the slider it belongs to
 * (components/static-simulator/utils/experimentData.ts's `defaultCode`), with
 * the exact line quoted in the comment. A slider whose effect contradicted the
 * code sitting next to it would be worse than no slider — see the owner's
 * brief — so there is exactly one source for each number and this file is not
 * it.
 */

import { getPart } from '@/lib/simulator/model/parts'
import type { CircuitDoc } from '@/lib/simulator/model/document'
import type { ShowreelFrame } from './useShowreel'
import type { ShowreelSensors } from './timelines'

export type SensorField = keyof ShowreelSensors

interface RangeMeta {
  min: number
  max: number
  step: number
  unit: string
  label: string
}

/**
 * The declared `range` PropSpec for `type.key` — read off the part library
 * rather than typed in here twice. Throws loudly on a typo in `type`/`key`
 * rather than silently rendering a 0..100 slider for a field that does not
 * exist, the same discipline circuits.ts's own `plug()`/`off()` helpers use.
 */
function rangeOf(type: string, key: string): RangeMeta {
  const spec = getPart(type).props?.find((p) => p.key === key)
  if (!spec || spec.type !== 'range' || spec.min === undefined || spec.max === undefined) {
    throw new Error(`${type}.${key} is not a declared range prop`)
  }
  return { min: spec.min, max: spec.max, step: spec.step ?? 1, unit: spec.unit ?? '', label: spec.label }
}

export interface SliderControlSpec extends RangeMeta {
  kind: 'slider'
  field: SensorField
  /** Placed part id (circuits.ts) this field's document prop lives on. */
  partId: string
  /** Prop key inside that part's `props` bag. */
  propKey: string
  /**
   * Recomputes that part's `deviceStates` entry from the slider value.
   *
   * Only the ultrasonic module needs this: its reticle's printed cm/in label
   * and "no echo" text are read from `deviceStates`, not from the prop (see
   * `targetReadout` in CircuitCanvas.tsx) — so a distance slider that only
   * wrote the prop would move the reticle but leave its own label stuck on
   * the frame it was paused at. Every other slider here only ever moves a
   * prop and a status-strip number, so it has no need of this.
   */
  deviceFor?: (value: number) => Record<string, number | string | boolean>
  /** Lit exactly when the value crosses this, sourced from the sketch. */
  warnAbove?: number
  /** The LED part id `warnAbove` drives. Only experiment 1 has one. */
  ledId?: string
}

export interface ToggleControlSpec {
  kind: 'toggle'
  field: 'motion'
  partId: string
  label: string
}

export type SensorControlSpec = SliderControlSpec | ToggleControlSpec

// ── Thresholds, quoted from the sketch shown beside each circuit ───────────

/** Experiment 1 (`utils/experimentData.ts`): `if (currentTemp > 28) { ... }` */
const EXP1_LED_THRESHOLD = 28
/** Experiment 1's own LED part id, from circuits.ts's `CIRCUIT_LED_DHT11`. */
const EXP1_LED_ID = 'led'
/**
 * Experiment 2: `if (motion == 1 && dist < 50) { Serial.println("WARNING:
 * Intruder Detected close by!"); }`
 */
const EXP2_CLOSE_THRESHOLD_CM = 50
/** Experiment 4: `if (flow > 8.0) { "WARNING: High flow rate detected!" }` */
const EXP4_FLOW_THRESHOLD = 8
/** Experiment 7: `if temp > 30: print("CRITICAL: Hot room! Turn on AC.")` */
const EXP7_TEMP_THRESHOLD = 30
/** Experiment 8: `if temp > 40: print("HIGH TEMP WARNING: Liquid boiling!")` */
const EXP8_TEMP_THRESHOLD = 40
/**
 * Experiment 12's own tip: "Watch the printed status flip to ALERT when
 * temperature drifts outside 36.1-37.2C or BPM outside 60-100." Only the BPM
 * half is wired to a slider here — see the brief on why experiment 12 gets
 * `bpm` and not a second `tempProbe` control.
 */
const EXP12_BPM_LOW = 60
const EXP12_BPM_HIGH = 100

/**
 * Which sensor fields are adjustable, per experiment id — the SHOWREEL_TIMELINES
 * key, so a control can never name an experiment that has no timeline to pause.
 *
 * Deliberately not all twelve: experiments 3, 5, 9, 10 and 11 are time-driven
 * playback with no live sensor reading to nudge (11's four density knobs set
 * a green-phase DURATION baked into the timeline's own `ms` fields, not a
 * `ShowreelSensors` value — turning one live would mean recomputing the whole
 * lane sequence, which is the "second physics engine" the brief rules out).
 */
export const SENSOR_CONTROLS: Readonly<Record<number, readonly SensorControlSpec[]>> = {
  1: [
    {
      kind: 'slider',
      field: 'temperature',
      partId: 'dht',
      propKey: 'temperature',
      ...rangeOf('dht11', 'temperature'),
      warnAbove: EXP1_LED_THRESHOLD,
      ledId: EXP1_LED_ID,
    },
    { kind: 'slider', field: 'humidity', partId: 'dht', propKey: 'humidity', ...rangeOf('dht11', 'humidity') },
  ],
  2: [
    {
      kind: 'slider',
      field: 'distance',
      partId: 'hcsr04',
      propKey: 'distance',
      ...rangeOf('hc_sr04', 'distance'),
      // The datasheet's own 2-400 cm window (HCSR04.MIN_CM/MAX_CM in
      // behavioural.ts) — outside it the module reports "no echo" rather than
      // a distance, exactly as the real behavioural model does.
      deviceFor: (v) => ({ distanceCm: v, inRange: v >= 2 && v <= 400 }),
    },
    { kind: 'toggle', field: 'motion', partId: 'pir', label: 'Motion' },
  ],
  4: [
    { kind: 'slider', field: 'flowRate', partId: 'flow', propKey: 'flow', ...rangeOf('flow_sensor', 'flow') },
  ],
  6: [{ kind: 'toggle', field: 'motion', partId: 'pir', label: 'Motion' }],
  7: [
    { kind: 'slider', field: 'temperature', partId: 'dht', propKey: 'temperature', ...rangeOf('dht11', 'temperature') },
    { kind: 'slider', field: 'humidity', partId: 'dht', propKey: 'humidity', ...rangeOf('dht11', 'humidity') },
  ],
  8: [
    { kind: 'slider', field: 'tempProbe', partId: 'ds', propKey: 'temperature', ...rangeOf('ds18b20', 'temperature') },
  ],
  12: [{ kind: 'slider', field: 'bpm', partId: 'pulse', propKey: 'bpm', ...rangeOf('pulse_sensor', 'bpm') }],
}

const NO_CONTROLS: readonly SensorControlSpec[] = []

/** The controls this experiment offers, or an empty (stable) array. */
export function controlsFor(experimentId: number | undefined): readonly SensorControlSpec[] {
  return (experimentId !== undefined && SENSOR_CONTROLS[experimentId]) || NO_CONTROLS
}

/**
 * Whether the CURRENT reading is past the line the sketch itself draws — one
 * boolean per experiment, straight off the thresholds cited above. Used only
 * to recolour a readout; it changes no prop, no device state and no LED.
 *
 * Experiment 2 is the one combined case: the sketch's own condition is
 * `motion == 1 && dist < 50`, both halves of which are separately
 * controllable here (a toggle and a slider), so the warning has to read both.
 */
const SENSOR_WARN: Readonly<Record<number, (s: ShowreelSensors) => boolean>> = {
  1: (s) => typeof s.temperature === 'number' && s.temperature > EXP1_LED_THRESHOLD,
  2: (s) => s.motion === true && typeof s.distance === 'number' && s.distance < EXP2_CLOSE_THRESHOLD_CM,
  4: (s) => typeof s.flowRate === 'number' && s.flowRate > EXP4_FLOW_THRESHOLD,
  7: (s) => typeof s.temperature === 'number' && s.temperature > EXP7_TEMP_THRESHOLD,
  8: (s) => typeof s.tempProbe === 'number' && s.tempProbe > EXP8_TEMP_THRESHOLD,
  12: (s) => typeof s.bpm === 'number' && (s.bpm < EXP12_BPM_LOW || s.bpm > EXP12_BPM_HIGH),
}

export function isSensorWarn(experimentId: number | undefined, sensors: ShowreelSensors): boolean {
  const check = experimentId === undefined ? undefined : SENSOR_WARN[experimentId]
  return check ? check(sensors) : false
}

/**
 * WHAT THE SKETCH WOULD PRINT FOR THE READING A STUDENT HAS DIALLED IN.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THE GAP THIS CLOSES.                                                    │
 * │                                                                         │
 * │ In four of the six experiments with a slider (4, 7, 8 and 12) the       │
 * │ sketch's ONLY output is a `Serial.print`/`print`. The serial monitor    │
 * │ beside the circuit replays pre-baked lines from timelines.ts, so        │
 * │ dragging the temperature to 45 °C in experiment 7 changed a number and  │
 * │ its colour and nothing else — the sketch's own `CRITICAL: Hot room!`    │
 * │ never appeared. The slider looked connected to nothing, because for     │
 * │ those four it WAS connected to nothing.                                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Every format string below is transcribed from the same `defaultCode` the
 * thresholds above were, so a live line is byte-identical in shape to the
 * scripted ones it appears beneath — same decimals, same separators, same
 * wording. Experiment 1 prints `24.00 *C` with two spaces around the pipe
 * because its sketch does; experiment 7 prints `Temp: 31°C, Humidity: 45%`
 * because its sketch does. If these drifted from the listing on screen the
 * feature would be worse than not having it.
 *
 * These are NOT written into the showreel's own log buffer. They are derived
 * from the current reading and rendered as a distinct trailing line — see
 * StaticSimulator.tsx — because the scripted log is a record of what the
 * PLAYBACK showed, and appending to it would make a student's slider look
 * like part of a run that never happened.
 */
const LIVE_SERIAL: Readonly<Record<number, (s: ShowreelSensors) => string[]>> = {
  1: (s) => {
    if (typeof s.temperature !== 'number' || typeof s.humidity !== 'number') return []
    const line = `Temperature: ${s.temperature.toFixed(2)} *C  |  Humidity: ${s.humidity.toFixed(2)} %`
    return s.temperature > EXP1_LED_THRESHOLD ? [line, 'ALERT: High Temperature! LED ON'] : [line]
  },
  2: (s) => {
    if (typeof s.distance !== 'number') return []
    const motion = s.motion === true
    const out = [`Motion: ${motion ? 1 : 0} | Range: ${Math.round(s.distance)} cm`]
    if (motion && s.distance < EXP2_CLOSE_THRESHOLD_CM) out.push('WARNING: Intruder Detected close by!')
    else if (motion) out.push('Notice: Motion detected at safe distance.')
    return out
  },
  4: (s) => {
    if (typeof s.flowRate !== 'number') return []
    const out = [`Current Flow Rate: ${s.flowRate.toFixed(2)} L/min`]
    if (s.flowRate > EXP4_FLOW_THRESHOLD) out.push('WARNING: High flow rate detected!')
    return out
  },
  7: (s) => {
    if (typeof s.temperature !== 'number' || typeof s.humidity !== 'number') return []
    const out = [`Temp: ${Math.round(s.temperature)}°C, Humidity: ${Math.round(s.humidity)}%`]
    if (s.temperature > EXP7_TEMP_THRESHOLD) out.push('CRITICAL: Hot room! Turn on AC.')
    return out
  },
  8: (s) => {
    if (typeof s.tempProbe !== 'number') return []
    const out = [`DS18B20 Temperature: ${s.tempProbe.toFixed(1)} °C`]
    if (s.tempProbe > EXP8_TEMP_THRESHOLD) out.push('HIGH TEMP WARNING: Liquid boiling!')
    return out
  },
  12: (s) => {
    if (typeof s.bpm !== 'number') return []
    const temp = typeof s.tempProbe === 'number' ? s.tempProbe : 36.5
    const bpmLow = s.bpm < EXP12_BPM_LOW
    const bpmHigh = s.bpm > EXP12_BPM_HIGH
    // The sketch's own wording: NORMAL, or ALERT with the offending half named.
    const status = bpmHigh
      ? 'ALERT BPM HIGH (Tachycardia)'
      : bpmLow
        ? 'ALERT BPM LOW (Bradycardia)'
        : 'NORMAL'
    return [`Temp: ${temp.toFixed(1)}C  BPM: ${Math.round(s.bpm)}  Status: ${status} -> ThingSpeak updated`]
  },
}

export function liveSerialFor(
  experimentId: number | undefined,
  sensors: ShowreelSensors,
): string[] {
  const build = experimentId === undefined ? undefined : LIVE_SERIAL[experimentId]
  return build ? build(sensors) : []
}

/**
 * The AUTHORED value a slider's own part/prop was placed with, in
 * `circuits.ts` — the number a real bench would read before anyone touched
 * anything, e.g. the 24 °C `dht.props.temperature` experiment 1's circuit was
 * built with, not whatever the timeline currently happens to be sweeping it
 * through.
 *
 * WHY THIS EXISTS: a slider is a MANUAL control, and a manual control that
 * silently drifts on its own — because the field it shows also happens to be
 * something showreel/timelines.ts animates as stage direction — reads as
 * broken, not as realistic. So once a field has a slider, that slider's
 * resting position (before a student ever drags it) is this authored number,
 * fixed, not the live scripted value. See `restingSensors` below for how this
 * is threaded through every controllable field at once.
 */
function restingValue(doc: CircuitDoc | undefined, spec: SliderControlSpec): number {
  const raw = doc?.parts.find((p) => p.id === spec.partId)?.props[spec.propKey]
  return typeof raw === 'number' ? raw : spec.min
}

/**
 * Every SLIDER field's resting value, keyed the same way `overrides` is —
 * computed once per `doc` (it is a document-authored constant, not a live
 * reading) rather than on every frame.
 */
export function restingSensors(
  doc: CircuitDoc | undefined,
  experimentId: number | undefined,
): Partial<Record<SensorField, number>> {
  const out: Partial<Record<SensorField, number>> = {}
  for (const spec of controlsFor(experimentId)) {
    if (spec.kind === 'slider') out[spec.field] = restingValue(doc, spec)
  }
  return out
}

/**
 * The base frame, with sliders resolved to override-or-resting and any active
 * toggle override layered on top.
 *
 * A SLIDER FIELD IS ALWAYS RESOLVED, even with no active drag — to
 * `overrides[field] ?? resting[field]`, never to the live scripted value.
 * That is what stops the "why is the slider moving by itself" symptom: the
 * timeline still varies that field internally (the serial log still narrates
 * its own sweep — a known, disclosed gap, not silently patched over), but
 * nothing this panel actually SHOWS for a slider's own field is allowed to
 * come from that sweep any more. A TOGGLE field (motion) keeps the old
 * behaviour — pass through the live scripted boolean until the student flips
 * it — because a binary alarm-style reading flipping on the timeline's own
 * schedule is the demo, not a bug report waiting to happen the way a
 * continuously drifting slider thumb is.
 *
 * Same discipline as StaticCircuit's `withOverrides` otherwise: a fresh object
 * only when there is something to resolve, everything the timeline did not
 * mention passes through by reference, and a field is touched only because a
 * control named it — nothing here infers a second field from the first.
 */
export function applySensorOverrides(
  frame: ShowreelFrame,
  experimentId: number | undefined,
  overrides: Readonly<Partial<Record<SensorField, number | boolean>>>,
  resting: Readonly<Partial<Record<SensorField, number>>>,
): ShowreelFrame {
  const specs = controlsFor(experimentId)
  const hasSliders = specs.some((s) => s.kind === 'slider')
  if (!hasSliders && Object.keys(overrides).length === 0) return frame

  const sensors = { ...frame.sensors } as Record<string, number | boolean>
  let props = frame.props
  let devices = frame.devices
  let leds = frame.leds

  for (const spec of specs) {
    if (spec.kind === 'slider') {
      const override = overrides[spec.field]
      const value = typeof override === 'number' ? override : resting[spec.field]
      if (value === undefined) continue

      sensors[spec.field] = value
      props = { ...props, [spec.partId]: { ...props[spec.partId], [spec.propKey]: value } }
      if (spec.deviceFor) {
        devices = { ...devices, [spec.partId]: spec.deviceFor(value) }
      }
      if (spec.ledId && spec.warnAbove !== undefined) {
        leds = new Map(leds)
        leds.set(spec.ledId, value > spec.warnAbove ? 1 : 0)
      }
    } else {
      const value = overrides[spec.field]
      if (typeof value !== 'boolean') continue
      sensors[spec.field] = value
      devices = {
        ...devices,
        [spec.partId]: { ...devices[spec.partId], powered: true, warming: false, motion: value },
      }
    }
  }

  return { ...frame, sensors: sensors as ShowreelSensors, props, devices, leds }
}
