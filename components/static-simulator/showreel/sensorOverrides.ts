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
 *
 * ALL OF THEM WERE RE-DERIVED when those sketches were replaced with the lab
 * sheet's own (reference/iot_virtual_lab.html), and the re-derivation is worth
 * recording because it did not merely move numbers:
 *
 *   experiment 1   28 °C → 30 °C. The sheet alerts at `if (t > 30)`; the
 *                  sketch this file used to read had been rewritten to 28.
 *   experiment 2   50 cm → 20 cm, and the comparison changed shape: the
 *                  sheet's condition is `pir || dist < 20`, an OR, where the
 *                  rewritten sketch had `motion == 1 && dist < 50`.
 *   experiments 4, 7, 8   THE CONSTANT IS GONE. Their published sketches draw
 *                  no line at all — 4 prints a flow rate and a running total,
 *                  7 prints a reading or a read failure, 8 prints °C and °F —
 *                  and every "WARNING: High flow rate detected!", "CRITICAL:
 *                  Hot room!" and "HIGH TEMP WARNING: Liquid boiling!" this
 *                  file used to quote came from the rewrites, not the lab.
 *                  A threshold with no line behind it is exactly the invention
 *                  the paragraph above forbids, so those three no longer warn.
 *   experiment 12  60–100 BPM, unchanged, and confirmed from both sides: the
 *                  published sketch's `if not (60 <= bpm <= 100)` and the
 *                  MicroPython port's `bpm_ok = 60 <= bpm <= 100` agree.
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
}

export interface ToggleControlSpec {
  kind: 'toggle'
  field: 'motion'
  partId: string
  label: string
}

export type SensorControlSpec = SliderControlSpec | ToggleControlSpec

// ── Thresholds, quoted from the sketch shown beside each circuit ───────────

/**
 * Experiment 1: `// LED ON if temperature exceeds threshold` / `if (t > 30) {`
 * — and the `else` below it drives D13 LOW again, so the lamp is steady while
 * the reading is over the line rather than blinking. The 28 this used to read
 * came from a rewritten sketch, not from the lab.
 */
const EXP1_LED_THRESHOLD = 30
/**
 * Experiment 2: `if (pir || dist < 20) { digitalWrite(LED_PIN, HIGH); }`
 *
 * AN OR, NOT AN AND, and 20 cm rather than 50. Either half lights D13 on its
 * own: someone standing still 15 cm from the module trips it on distance, and
 * someone crossing the PIR's cone at three metres trips it on motion.
 */
const EXP2_CLOSE_THRESHOLD_CM = 20
/**
 * Experiment 12: `bpm_ok = 60 <= bpm <= 100`, and the published sketch this
 * one is a port of agrees — `if not (60 <= bpm <= 100): status = "⚠ BPM
 * ALERT"`. Only the BPM half is wired to a slider here; see the brief on why
 * experiment 12 gets `bpm` and not a second `tempProbe` control.
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
 * to recolour a readout; it changes no prop and no device state.
 *
 * THREE ENTRIES WERE DELETED, not retuned: experiments 4, 7 and 8 drew their
 * lines from sketches that have been replaced by the lab sheet's own, and the
 * sheet's compare nothing. A readout that turns amber at a number no listing
 * on the page mentions is the same defect as a slider that contradicts the
 * code beside it, so those three now never warn.
 *
 * Experiment 2 is the one combined case, and it is an OR: the sketch's own
 * condition is `pir || dist < 20`, both halves of which are separately
 * controllable here (a toggle and a slider), so either alone is a warning.
 */
const SENSOR_WARN: Readonly<Record<number, (s: ShowreelSensors) => boolean>> = {
  1: (s) => typeof s.temperature === 'number' && s.temperature > EXP1_LED_THRESHOLD,
  2: (s) =>
    s.motion === true ||
    (typeof s.distance === 'number' && s.distance < EXP2_CLOSE_THRESHOLD_CM),
  6: (s) => s.motion === true,
  12: (s) => typeof s.bpm === 'number' && (s.bpm < EXP12_BPM_LOW || s.bpm > EXP12_BPM_HIGH),
}

export function isSensorWarn(experimentId: number | undefined, sensors: ShowreelSensors): boolean {
  const check = experimentId === undefined ? undefined : SENSOR_WARN[experimentId]
  return check ? check(sensors) : false
}

/**
 * WHAT THE SKETCH'S OUTPUT PINS ARE DOING for the reading now on the controls
 * — one function per experiment, straight off its own `digitalWrite` lines.
 *
 * WHY THIS IS A TABLE AND NOT A FIELD ON A SLIDER. It used to be
 * `warnAbove`/`ledId` on experiment 1's temperature spec, which can express
 * exactly one shape: one lamp, one slider, lit ABOVE a number. The corrected
 * circuits broke both halves of that. Experiment 2's lamp is `pir || dist <
 * 20` — a toggle OR a slider, and the slider from BELOW — and experiment 6
 * drives two lamps in opposition off one toggle. A function of the whole
 * sensor bag states any of the three plainly, and puts the output logic
 * beside the thresholds it reads.
 *
 * IT IS ALSO WHAT WIRES THE NEWLY DRAWN LAMPS UP. ../circuits.ts gained an
 * LED on experiment 2 and a red/green pair on experiment 6, because the
 * reference wires them and the reference's sketches drive them. Without an
 * entry here those parts would sit on the board doing nothing whenever a
 * student took the controls — present, drawn, and dead, which is the one
 * thing this panel is built not to be.
 *
 * A partId NOT named is left exactly as the timeline had it, so an entry can
 * say `{ led_red: 0 }` without knowing what else is on the board.
 */
const SENSOR_LEDS: Readonly<Record<number, (s: ShowreelSensors) => Record<string, number>>> = {
  /** `if (t > 30) digitalWrite(LED_PIN, HIGH); else digitalWrite(LED_PIN, LOW);` */
  1: (s) => ({
    led: typeof s.temperature === 'number' && s.temperature > EXP1_LED_THRESHOLD ? 1 : 0,
  }),
  /** `if (pir || dist < 20) digitalWrite(LED_PIN, HIGH); else ... LOW;` */
  2: (s) => ({
    led:
      s.motion === true ||
      (typeof s.distance === 'number' && s.distance < EXP2_CLOSE_THRESHOLD_CM)
        ? 1
        : 0,
  }),
  /**
   * Motion: `digitalWrite(GREEN_LED, LOW); digitalWrite(RED_LED, HIGH);` and
   * the buzzer chirps ten times, which this board has no drawn state for.
   * Idle: `setup()`'s own `digitalWrite(GREEN_LED, HIGH)` still standing.
   */
  6: (s) => (s.motion === true ? { led_green: 0, led_red: 1 } : { led_green: 1, led_red: 0 }),
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
 * ORDER, same wording. If these drifted from the listing on screen the feature
 * would be worse than not having it, and a live line sits directly under the
 * scripted ones where any difference shows.
 *
 * WHAT THE LAB SHEET'S OWN SKETCHES CHANGED HERE, all of it visible on screen:
 *
 *   1  TWO LINES, HUMIDITY FIRST. `Serial.print("Humidity: ") … println(" %")`
 *      then `Serial.print("Temperature: ") … println(" °C")` — two separate
 *      `println`s in that order, where this used to emit one combined
 *      `Temperature: … *C  |  Humidity: … %`. Note `°C`, not `*C`.
 *   2  `Distance: 240 cm` then `Motion: DETECTED` / `Motion: None` — and no
 *      warning line at all. `dist` is a `long`, so no decimals.
 *   4  `Flow Rate: 3.20 L/min`. Its second line, `Total Volume: … L`, is an
 *      ACCUMULATOR — `totalLitres += flowRate / 60` over the whole run — so it
 *      has no value derivable from one slider position and is deliberately not
 *      offered live. The scripted log carries it.
 *   6  NEW. Its control is a toggle and its sketch prints on both branches, so
 *      flipping Motion now says what the sketch would say.
 *   7  `Temp=22.0°C  Humidity=55.0%` — one decimal each, an `=` rather than a
 *      `:`, two spaces between the fields, no comma, and no threshold line.
 *   8  `Temperature: 24.500°C  |  76.100°F` — THREE decimals, and a Fahrenheit
 *      column this never had.
 *  12  Unchanged: its listing is the MicroPython port, and this already
 *      quoted it.
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
    const out = [
      `Humidity: ${s.humidity.toFixed(2)} %`,
      `Temperature: ${s.temperature.toFixed(2)} °C`,
    ]
    if (s.temperature > EXP1_LED_THRESHOLD) out.push('ALERT: High Temperature! LED ON')
    return out
  },
  2: (s) => {
    if (typeof s.distance !== 'number') return []
    // `long dist` and `int pir`, so: no decimals, and the words the ternary
    // in `Serial.println(pir ? "DETECTED" : "None")` picks between.
    return [
      `Distance: ${Math.round(s.distance)} cm`,
      `Motion: ${s.motion === true ? 'DETECTED' : 'None'}`,
    ]
  },
  4: (s) => {
    if (typeof s.flowRate !== 'number') return []
    return [`Flow Rate: ${s.flowRate.toFixed(2)} L/min`]
  },
  6: (s) => {
    if (typeof s.motion !== 'boolean') return []
    return [s.motion ? '⚠ MOTION DETECTED — ALARM!' : 'No motion — System Idle']
  },
  7: (s) => {
    if (typeof s.temperature !== 'number' || typeof s.humidity !== 'number') return []
    return [`Temp=${s.temperature.toFixed(1)}°C  Humidity=${s.humidity.toFixed(1)}%`]
  },
  8: (s) => {
    if (typeof s.tempProbe !== 'number') return []
    const f = (s.tempProbe * 9) / 5 + 32
    return [`Temperature: ${s.tempProbe.toFixed(3)}°C  |  ${f.toFixed(3)}°F`]
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
 * A SLIDER FIELD FOLLOWS THE TIMELINE UNTIL IT IS TOUCHED, THEN PINS.
 * `overrides[field] ?? live ?? resting[field]`.
 *
 * This is the second correction to the same question, and the reasoning for
 * the first was incomplete. Pinning an UNTOUCHED slider to its authored value
 * did stop the thumb drifting on its own, but it left the panel showing two
 * different numbers for one sensor: the slider read 24 °C while the serial
 * log, which replays pre-baked strings, narrated the timeline's own sweep
 * through 30, 27, 25. A control that disagrees with the log beside it is a
 * worse bug than a thumb that moves, because it makes the reading itself
 * untrustworthy.
 *
 * So before first touch the slider tracks the sweep and the two agree by
 * construction. After first touch the student owns the value and the sweep
 * stops being shown at all — see `frozenAt` in useSensorOverride.ts for the
 * other half, which stops the log narrating readings the student has
 * overridden.
 *
 * A TOGGLE field (motion) has always worked this way — pass through the live
 * scripted boolean until the student flips it — and is unchanged.
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
      const live = frame.sensors[spec.field]
      const value =
        typeof override === 'number'
          ? override
          : typeof live === 'number'
            ? live
            : resting[spec.field]
      if (value === undefined) continue

      sensors[spec.field] = value
      props = { ...props, [spec.partId]: { ...props[spec.partId], [spec.propKey]: value } }
      if (spec.deviceFor) {
        devices = { ...devices, [spec.partId]: spec.deviceFor(value) }
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

  /**
   * The output pins, LAST — after every control has been resolved, because the
   * sketches that drive more than one lamp read more than one field to decide
   * (`pir || dist < 20`) and cannot be answered a control at a time.
   *
   * `sensors` here is already the resolved bag, so before first touch this is
   * computing from the timeline's own live readings and agrees with whatever
   * the step's `leds` said; after it, from the student's.
   */
  const lamps = experimentId === undefined ? undefined : SENSOR_LEDS[experimentId]
  if (lamps) {
    const next = lamps(sensors as ShowreelSensors)
    leds = new Map(leds)
    for (const id of Object.keys(next)) leds.set(id, next[id])
  }

  return { ...frame, sensors: sensors as ShowreelSensors, props, devices, leds }
}
