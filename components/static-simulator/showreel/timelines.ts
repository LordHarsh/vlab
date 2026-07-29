/**
 * SCRIPTED PLAYBACK FOR THE READ-ONLY CIRCUITS.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THESE NUMBERS ARE CHOREOGRAPHY, NOT PHYSICS.                            │
 * │                                                                         │
 * │ Nothing in this file is computed, measured or solved. There is no       │
 * │ interpreter, no netlist, no current and no Ohm's law anywhere near it.  │
 * │ Each entry below is a hand-written stage direction: "light this LED for │
 * │ 500 ms, put the target at 40 cm, print this line". It exists so a       │
 * │ reference circuit LOOKS alive on a lesson page, and for no other        │
 * │ reason. Do not read a model into it and do not derive one from it.      │
 * │                                                                         │
 * │ The app's real simulator — emulated MCU, solved circuit, actual         │
 * │ voltages — is lib/simulator/. If you need a number to be true, it       │
 * │ comes from there, never from here.                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * WHAT DRIVES THE ARTWORK, AND WHY IT CHANGED SHAPE
 *
 * The drawing is now components/simulator/CircuitCanvas — our own part library
 * and our own wire rendering — so a step no longer names PINS at logic levels.
 * That was the ported artwork's contract: it read a bag of `componentId/pinId`
 * keys and decided for itself which of its shapes to light. Ours has two real
 * seams instead, the same two the live editor feeds from a running simulation:
 *
 *   `leds`    partId → 0..1 brightness. The canvas draws the dome fill and the
 *             halo from it, exactly as it does for a solved LED current.
 *   `devices` partId → the state that part's behavioural model would be
 *             reporting. The PIR's cone colours from `motion`, the ultrasonic's
 *             readout from `distanceCm`, the DC motor's plate from `rpm`.
 *
 * plus `props`, which edits the DOCUMENT before it is drawn — a target's
 * distance, a button's pressed cap, a sensor's reading — because those are
 * properties of the circuit rather than of the simulation, and the canvas takes
 * them from the document for both.
 *
 * WHAT IS STILL HELD TO A STANDARD
 *
 * Every value is one a real bench would produce, because a fake that teaches
 * something false is worse than no fake at all. A DHT11 reads whole degrees
 * over 0–50 °C, so it reads whole degrees here. An HC-SR04 spans 2–400 cm. A
 * resting adult pulse sits in the seventies. Experiment 4's flow rates are all
 * a whole number of pulses over the sensor's own 7.5 pulses/L/min, because
 * `flowRate = pulseCount / 7.5` cannot produce anything else. Experiment 9's
 * 2,450 rpm is the figure our own DCMotor model gives for this motor on what
 * an L298N passes through from a 5 V rail — `rpmFor` works out to 1000 rpm per
 * terminal volt for HOBBY_MOTOR_6V, and the bridge leaves about 2.45 V of a
 * 5 V supply — and its 40 % and 70 % duty steps are that figure scaled, which
 * is what a PWM'd ENA does to the average terminal voltage.
 *
 * ONE STEP IS ONE TRUTH. A reading that appears in more than one place — the
 * status strip's `sensors`, a target's `props`, a module's `devices` — is the
 * same number in all of them, written out on the same line. That repetition is
 * the point: the panel's whole claim is that the artwork, the readouts, the
 * serial log and the clock cannot contradict each other, and the cheapest way
 * to keep that true is to make a contradiction visible in the diff.
 *
 * Every serial line is lifted from the experiment's own `defaultCode` in
 * utils/experimentData.ts, with the placeholders filled in from the same step
 * that drives the artwork. If you change a reading, change its line too.
 *
 * AND ONLY FROM THERE. Every timeline below was re-derived when those sketches
 * were replaced with the lab sheet's own (reference/iot_virtual_lab.html), and
 * what that removed is as important as what it changed: five of the twelve
 * were printing lines their sketch never had — a "Security Scanner Online..."
 * banner on an experiment whose `setup()` prints nothing, a "WARNING: High
 * flow rate detected!" at a threshold the program does not test, a "CRITICAL:
 * Hot room!", a "HIGH TEMP WARNING: Liquid boiling!", a "Traffic Lights
 * Starting...". A log line with no `print` behind it is the same defect as a
 * pin number the wire does not land on; there are none left.
 *
 * HOW A TIMELINE PLAYS
 *
 * `steps` runs top to bottom and then repeats, forever, from one clock (see
 * useShowreel.ts). Each step is self-describing — nothing carries over from
 * the step before it, so what you read on a line is exactly what is on screen
 * while that line is current. To change the blink rate of experiment 3, edit
 * one `ms`.
 */

import type { DeviceState } from '@/lib/simulator/behavioural'

/**
 * Sensor readouts the status strip under the canvas prints
 * (features/WorkspaceChrome.tsx). Typed rather than a bag so a misspelt key is
 * a build error and not a silently blank display.
 */
export interface ShowreelSensors {
  /** DHT11, in °C. */
  temperature?: number
  /** DHT11, in %RH. */
  humidity?: number
  /** DS18B20 probe, in °C. */
  tempProbe?: number
  /** HC-SR04, in cm. */
  distance?: number
  /** YF-S201, in L/min. */
  flowRate?: number
  /** Pulse sensor, in beats per minute. */
  bpm?: number
  /** PIR sensor. */
  motion?: boolean
}

export interface ShowreelStep {
  /** How long this step is held on screen, in milliseconds. */
  ms: number
  /**
   * partId → 0..1 LED brightness, in the shape `CircuitCanvas`'s
   * `ledBrightness` prop wants. An LED not named here is dark, which is why a
   * cathode never needs listing and an "off" step can be empty.
   */
  leds?: Record<string, number>
  /**
   * partId → what that part's behavioural model would be reporting this
   * instant, in the shape `CircuitCanvas`'s `deviceStates` prop wants.
   *
   * Only the parts whose ARTWORK reads a report are worth naming — the PIR's
   * cone, the ultrasonic's readout, the DC motor's plate — because nothing
   * else on the canvas looks at this map.
   */
  devices?: Record<string, DeviceState>
  /**
   * partId → document property overrides applied before the circuit is drawn.
   *
   * For the things that belong to the CIRCUIT rather than to the run: where a
   * sensor's target is standing, whether a button's cap is down, what a sensor
   * is set to be reading.
   */
  props?: Record<string, Record<string, number | string>>
  /** What the status strip prints while this step is current. */
  sensors?: ShowreelSensors
  /**
   * Serial lines emitted at the MOMENT THIS STEP BEGINS, quoted from the
   * sketch. Step 0's array therefore prints once per loop of the timeline,
   * which is why the `setup()` lines live there: one pass of the timeline is
   * one run of the sketch, and the elapsed clock restarts with it.
   */
  serial?: string[]
}

export interface ShowreelTimeline {
  /**
   * The step to hold, motionless, for a viewer who has asked for reduced
   * motion. Pick the frame that says the most about the experiment — the
   * alert state, the lit lamp, the braked motor — never a blank one.
   */
  stillStep: number
  steps: ShowreelStep[]
}

/** An LED at full brightness. The canvas maps 1 to a lit dome and a full halo. */
const LIT = 1

/* ── Per-experiment stage helpers ─────────────────────────────────────────
 *
 * Experiments 2 and 6 restate the same reading in three places on every step
 * (the target's position, the module's report, the status strip), so each
 * gets one function that writes all three from one number. That is not
 * shorthand for its own sake: it makes it impossible for the cone, the reticle
 * readout and the strip to disagree, which is the one failure this panel is not
 * allowed to have.
 */

/** Experiment 2: one person, seen by both sensors at once. */
function scan(distanceCm: number, motion: boolean): Pick<ShowreelStep, 'props' | 'devices' | 'sensors'> {
  return {
    props: { hcsr04: { distance: distanceCm }, pir: { distance: distanceCm } },
    devices: {
      hcsr04: { distanceCm, inRange: true },
      pir: { powered: true, warming: false, motion },
    },
    sensors: { distance: distanceCm, motion },
  }
}

/** Experiment 6: the PIR alone. */
function watch(distanceCm: number, motion: boolean): Pick<ShowreelStep, 'props' | 'devices' | 'sensors'> {
  return {
    props: { pir: { distance: distanceCm } },
    devices: { pir: { powered: true, warming: false, motion } },
    sensors: { motion },
  }
}

/**
 * Experiment 11: the four-lane grid. `allRed()` in the sketch runs at the top
 * of every `setGreen()` call, so at every instant three lanes are showing red
 * and the fourth — `active` — is showing whichever of green or yellow its own
 * phase is in. One function for the same reason `scan()`/`watch()` are one:
 * it is not possible to light a lane's green and forget its neighbours' red.
 */
function grid11(active: number, phase: 'green' | 'yellow'): NonNullable<ShowreelStep['leds']> {
  const leds: Record<string, number> = {}
  for (let lane = 0; lane < 4; lane++) {
    leds[lane === active ? `led_l${lane + 1}_${phase}` : `led_l${lane + 1}_red`] = LIT
  }
  return leds
}

/* ── The twelve ───────────────────────────────────────────────────────────
 *
 * Keyed by the experiment ids in utils/experimentData.ts (1–12; ids 13 and 14
 * are blank sandboxes with no sketch to act out), which is the same key
 * ../circuits.ts uses for the drawing. An id with no timeline simply renders
 * the circuit inert, exactly as it did before this existed.
 */
export const SHOWREEL_TIMELINES: Readonly<Record<number, ShowreelTimeline>> = {
  /* 1 — LED & DHT11. `delay(2000)` at the top of `loop()`, so one reading
     every two seconds, and `if (t > 30)` drives D13 HIGH with an `else` that
     drives it LOW — STEADY while the reading is over the line, not blinking.
     The blink this used to play came from a rewritten sketch; the lab sheet's
     own has no `millis()` in it.

     Eight readings, warming and cooling again, and the sweep is chosen to
     land ON the line as well as over it: 31 and 33 alert, 30 does NOT — the
     comparison is `>`, not `>=`, and a reading exactly at the threshold
     leaving the lamp dark is the most useful thing this sequence can show. */
  1: {
    stillStep: 3,
    steps: [
      {
        ms: 2000,
        props: { dht: { temperature: 24, humidity: 45 } },
        sensors: { temperature: 24, humidity: 45 },
        serial: ['DHT11 Test Starting...', 'Humidity: 45.00 %', 'Temperature: 24.00 °C'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 26, humidity: 47 } },
        sensors: { temperature: 26, humidity: 47 },
        serial: ['Humidity: 47.00 %', 'Temperature: 26.00 °C'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 29, humidity: 50 } },
        sensors: { temperature: 29, humidity: 50 },
        serial: ['Humidity: 50.00 %', 'Temperature: 29.00 °C'],
      },

      // Over the line: D13 HIGH and stays there while the readings do.
      {
        ms: 2000,
        leds: { led: LIT },
        props: { dht: { temperature: 31, humidity: 53 } },
        sensors: { temperature: 31, humidity: 53 },
        serial: [
          'Humidity: 53.00 %',
          'Temperature: 31.00 °C',
          'ALERT: High Temperature! LED ON',
        ],
      },
      {
        ms: 2000,
        leds: { led: LIT },
        props: { dht: { temperature: 33, humidity: 55 } },
        sensors: { temperature: 33, humidity: 55 },
        serial: [
          'Humidity: 55.00 %',
          'Temperature: 33.00 °C',
          'ALERT: High Temperature! LED ON',
        ],
      },

      // Exactly 30.00 °C. `30 > 30` is false, so the `else` runs and the lamp
      // goes out one degree earlier than a student expects it to.
      {
        ms: 2000,
        props: { dht: { temperature: 30, humidity: 52 } },
        sensors: { temperature: 30, humidity: 52 },
        serial: ['Humidity: 52.00 %', 'Temperature: 30.00 °C'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 27, humidity: 49 } },
        sensors: { temperature: 27, humidity: 49 },
        serial: ['Humidity: 49.00 %', 'Temperature: 27.00 °C'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 25, humidity: 46 } },
        sensors: { temperature: 25, humidity: 46 },
        serial: ['Humidity: 46.00 %', 'Temperature: 25.00 °C'],
      },
    ],
  },

  /* 2 — Ultrasonic & PIR. `delay(500)` per reading, and the sketch's `setup()`
     prints nothing at all, so the log opens straight on a distance.

     The lamp is `if (pir || dist < 20)`, an OR, and the walk exercises both
     halves separately. Someone comes in from 2.4 m: the PIR trips first and
     lights D13 from three-quarters of a metre out, well before anything is
     near the 20 cm line. Then they stop, 18 cm from the module — the PIR
     reports NO motion, because a PIR detects movement and not presence, and
     the lamp stays lit on the distance half alone. That pair of steps is the
     whole reason this sequence is worth watching. */
  2: {
    stillStep: 4,
    steps: [
      { ms: 500, ...scan(240, false), serial: ['Distance: 240 cm', 'Motion: None'] },
      { ms: 500, ...scan(150, false), serial: ['Distance: 150 cm', 'Motion: None'] },

      // Motion alone, at a distance nothing would call close.
      {
        ms: 500,
        leds: { led: LIT },
        ...scan(85, true),
        serial: ['Distance: 85 cm', 'Motion: DETECTED'],
      },
      {
        ms: 500,
        leds: { led: LIT },
        ...scan(40, true),
        serial: ['Distance: 40 cm', 'Motion: DETECTED'],
      },
      {
        ms: 500,
        leds: { led: LIT },
        ...scan(15, true),
        serial: ['Distance: 15 cm', 'Motion: DETECTED'],
      },

      // Standing still, close: the distance half holds the lamp on by itself.
      {
        ms: 500,
        leds: { led: LIT },
        ...scan(18, false),
        serial: ['Distance: 18 cm', 'Motion: None'],
      },

      { ms: 500, ...scan(210, false), serial: ['Distance: 210 cm', 'Motion: None'] },
    ],
  },

  /* 3 — Traffic light. The three `ms` below ARE the sketch's three delays, in
     the sketch's own order: `loop()` opens on GREEN, not on red, and its
     `setup()` prints nothing. Change one `ms` and the light dwells for
     longer. */
  3: {
    stillStep: 0,
    steps: [
      { ms: 5000, leds: { led_green: LIT }, serial: ['GREEN — Go!'] },
      { ms: 2000, leds: { led_yellow: LIT }, serial: ['YELLOW — Slow down'] },
      { ms: 5000, leds: { led_red: LIT }, serial: ['RED — Stop!'] },
    ],
  },

  /* 4 — Water flow. One reading a second, which is the `millis() - lastTime >=
     1000` gate, and TWO lines each — a rate and a running total, because
     `totalLitres += flowRate / 60` accumulates across the whole run.

     EVERY RATE IS A WHOLE NUMBER OF PULSES. `flowRate = pulseCount / 7.5`, and
     `pulseCount` is an interrupt count, so a YF-S201 cannot report 9.1 L/min:
     the reachable values around it are 68/7.5 = 9.07 and 69/7.5 = 9.20. The
     seven below are 0, 24, 48, 69, 54, 36 and 0 pulses in the second.

     There is no alarm in this sketch and so there is none here. The 8 L/min
     "WARNING: High flow rate detected!" this used to print came from a
     rewrite; the lab sheet's own program only ever reports.
     NOTHING ON THE BOARD MOVES for this one, and that is honest rather than an
     omission: our YF-S201 has no live readout on its face, so the reading lives
     in the status strip and the serial log. */
  4: {
    stillStep: 3,
    steps: [
      {
        ms: 1000,
        props: { flow: { flow: 0 } },
        sensors: { flowRate: 0 },
        serial: ['Flow Rate: 0.00 L/min', 'Total Volume: 0.00 L'],
      },
      {
        ms: 1000,
        props: { flow: { flow: 3.2 } },
        sensors: { flowRate: 3.2 },
        serial: ['Flow Rate: 3.20 L/min', 'Total Volume: 0.05 L'],
      },
      {
        ms: 1000,
        props: { flow: { flow: 6.4 } },
        sensors: { flowRate: 6.4 },
        serial: ['Flow Rate: 6.40 L/min', 'Total Volume: 0.16 L'],
      },
      {
        ms: 1000,
        props: { flow: { flow: 9.2 } },
        sensors: { flowRate: 9.2 },
        serial: ['Flow Rate: 9.20 L/min', 'Total Volume: 0.31 L'],
      },
      {
        ms: 1000,
        props: { flow: { flow: 7.2 } },
        sensors: { flowRate: 7.2 },
        serial: ['Flow Rate: 7.20 L/min', 'Total Volume: 0.43 L'],
      },
      {
        ms: 1000,
        props: { flow: { flow: 4.8 } },
        sensors: { flowRate: 4.8 },
        serial: ['Flow Rate: 4.80 L/min', 'Total Volume: 0.51 L'],
      },
      {
        ms: 1000,
        props: { flow: { flow: 0 } },
        sensors: { flowRate: 0 },
        // The tap is shut, so the rate falls to zero and the total stops
        // climbing — it does not reset, which is the point of a volume.
        serial: ['Flow Rate: 0.00 L/min', 'Total Volume: 0.51 L'],
      },
    ],
  },

  /* 5 — LED & push button on the Pico. THE SKETCH TOGGLES; IT DOES NOT FOLLOW.
     `led_state = not led_state` on every sample that reads HIGH, then a 0.3 s
     debounce sleep — so the lamp latches, and stays lit after the cap comes
     back up. This used to play as a lamp that tracked the button, which is a
     different program.

     Four presses, so the loop ends where it began with the lamp dark and
     `led_state` back to False, and the log alternates ON / OFF the way the
     f-string does. */
  5: {
    stillStep: 1,
    steps: [
      { ms: 1400, serial: ['Press button to toggle LED. Ctrl+C to exit.'] },

      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['LED ON'] },
      // Cap up, lamp still on — the state is held in a variable, not in the
      // switch.
      { ms: 1200, leds: { led: LIT } },

      { ms: 300, props: { btn: { pressed: 1 } }, serial: ['LED OFF'] },
      { ms: 1200 },

      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['LED ON'] },
      { ms: 1200, leds: { led: LIT } },

      { ms: 300, props: { btn: { pressed: 1 } }, serial: ['LED OFF'] },
      { ms: 1200 },
    ],
  },

  /* 6 — PIR alarm, and it has its lamps now. `setup()` drives GREEN_LED HIGH
     and prints "PIR Alarm Ready", so idle is a lit green lamp; motion drives
     GREEN low and RED high, chirps the buzzer ten times at 200 ms on / 200 ms
     off — four seconds, blocking — and then restores green.

     THE FOUR-SECOND BURST IS FOUR STEPS, not one, because the person is still
     walking through the cone while the sketch is stuck in its `for` loop. The
     cone's own report is what the module is seeing; the program's belief is
     frozen for the duration, which is exactly what a blocking alarm does and
     is worth being able to watch.
     The chirp itself is in the serial log and not on the board: our buzzer has
     no drawn "sounding" state, so what the canvas shows is the detection that
     causes it. */
  6: {
    stillStep: 3,
    steps: [
      {
        ms: 500,
        leds: { led_green: LIT },
        ...watch(300, false),
        serial: ['PIR Alarm Ready — Waiting...', 'No motion — System Idle'],
      },
      { ms: 500, leds: { led_green: LIT }, ...watch(300, false), serial: ['No motion — System Idle'] },

      // Someone comes in. Red on, green off, buzzer for four seconds.
      {
        ms: 1000,
        leds: { led_red: LIT },
        ...watch(180, true),
        serial: ['⚠ MOTION DETECTED — ALARM!'],
      },
      { ms: 1000, leds: { led_red: LIT }, ...watch(150, true) },
      { ms: 1000, leds: { led_red: LIT }, ...watch(125, true) },
      { ms: 1000, leds: { led_red: LIT }, ...watch(110, true) },

      // The burst ends, green comes back, and the next pass finds them still.
      { ms: 500, leds: { led_green: LIT }, ...watch(110, false), serial: ['No motion — System Idle'] },

      // And again on the way out.
      {
        ms: 1000,
        leds: { led_red: LIT },
        ...watch(160, true),
        serial: ['⚠ MOTION DETECTED — ALARM!'],
      },
      { ms: 1000, leds: { led_red: LIT }, ...watch(200, true) },
      { ms: 1000, leds: { led_red: LIT }, ...watch(250, true) },
      { ms: 1000, leds: { led_red: LIT }, ...watch(290, true) },

      { ms: 500, leds: { led_green: LIT }, ...watch(300, false), serial: ['No motion — System Idle'] },
      { ms: 500, leds: { led_green: LIT }, ...watch(300, false), serial: ['No motion — System Idle'] },
    ],
  },

  /* 7 — DHT11 on the Raspberry Pi. `time.sleep(2)` between reads, and one
     f-string per reading: `Temp={t:.1f}°C  Humidity={h:.1f}%`, one decimal
     each and two spaces between the fields.

     No threshold. The "CRITICAL: Hot room! Turn on AC." this used to print at
     30 °C was never in the lab sheet's program — that one reads the sensor,
     prints it, appends a CSV row and sleeps. The room still warms and cools,
     because that is what makes the reading worth watching; nothing calls it
     an alarm. */
  7: {
    stillStep: 3,
    steps: [
      {
        ms: 2000,
        props: { dht: { temperature: 22, humidity: 55 } },
        sensors: { temperature: 22, humidity: 55 },
        serial: ['DHT11 on Raspberry Pi — Reading sensor...', 'Temp=22.0°C  Humidity=55.0%'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 25, humidity: 52 } },
        sensors: { temperature: 25, humidity: 52 },
        serial: ['Temp=25.0°C  Humidity=52.0%'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 28, humidity: 49 } },
        sensors: { temperature: 28, humidity: 49 },
        serial: ['Temp=28.0°C  Humidity=49.0%'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 31, humidity: 45 } },
        sensors: { temperature: 31, humidity: 45 },
        serial: ['Temp=31.0°C  Humidity=45.0%'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 29, humidity: 47 } },
        sensors: { temperature: 29, humidity: 47 },
        serial: ['Temp=29.0°C  Humidity=47.0%'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 25, humidity: 52 } },
        sensors: { temperature: 25, humidity: 52 },
        serial: ['Temp=25.0°C  Humidity=52.0%'],
      },
    ],
  },

  /* 8 — DS18B20 on the Raspberry Pi. `time.sleep(1)` a reading, and the line
     is `Temperature: {t:.3f}°C  |  {t*9/5+32:.3f}°F` — THREE decimals and a
     Fahrenheit column, both of which this log was missing.

     Three decimals is not decoration: the sysfs `t=` value is millidegrees, so
     `float(...) / 1000` really does carry them, and a 12-bit DS18B20 steps in
     1/16 °C. A probe in water brought up to hand-hot and left to cool. The
     40 °C "HIGH TEMP WARNING: Liquid boiling!" is gone with the sketch that
     invented it — nothing in the lab sheet's program compares the reading to
     anything. */
  8: {
    stillStep: 4,
    steps: [
      {
        ms: 1000,
        props: { ds: { temperature: 24.5 } },
        sensors: { tempProbe: 24.5 },
        serial: ['Temperature: 24.500°C  |  76.100°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 28 } },
        sensors: { tempProbe: 28 },
        serial: ['Temperature: 28.000°C  |  82.400°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 33.5 } },
        sensors: { tempProbe: 33.5 },
        serial: ['Temperature: 33.500°C  |  92.300°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 39 } },
        sensors: { tempProbe: 39 },
        serial: ['Temperature: 39.000°C  |  102.200°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 42.5 } },
        sensors: { tempProbe: 42.5 },
        serial: ['Temperature: 42.500°C  |  108.500°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 37 } },
        sensors: { tempProbe: 37 },
        serial: ['Temperature: 37.000°C  |  98.600°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 30.5 } },
        sensors: { tempProbe: 30.5 },
        serial: ['Temperature: 30.500°C  |  86.900°F'],
      },
      {
        ms: 1000,
        props: { ds: { temperature: 26 } },
        sensors: { tempProbe: 26 },
        serial: ['Temperature: 26.000°C  |  78.800°F'],
      },
    ],
  },

  /* 9 — DC motor AND stepper, through the L298N and the ULN2003. The listing
     beside this is `MOTOR_CONTROL_RPI_SCRIPT` (lib/simulator/pico/
     experiments.ts) and every line below is one of its `print`s, in its own
     order and at its own `time.sleep`s.

     THE DUTY CYCLE IS THE POINT of the first half, so the plate has to show
     it: `rpmFor` gives HOBBY_MOTOR_6V 1000 rpm per terminal volt, an L298N
     passes about 2.45 V of a 5 V rail, and PWM scales that — so 40 % is
     980 rpm, 70 % is 1715 and 100 % is 2450, with the current scaling with
     them. Reverse is the same magnitudes with the sign flipped, which is what
     `direction` and a negative `amps` say.

     THE STEPPER TURNS AND NOTHING DRAWS IT. `rotate(1024)` is 2048 ms of real
     motion at the script's 2 ms per half-step, and it is in the log because
     the script prints it — but a `stepper` has no canvas readout the way a
     `motor` does (CircuitCanvas draws a plate for `kind === 'motor'` only), so
     those two steps show a still shaft. Better a silent truth than a spinning
     picture of a measurement nothing took. */
  9: {
    stillStep: 2,
    steps: [
      {
        ms: 1000,
        devices: { motor: { rpm: 980, direction: 'forward', amps: 0.0114, load: 0, stalled: false } },
        serial: [
          'L298N: ENA=GP18 IN1=GP19 IN2=GP20   ULN2003: IN1-IN4 = GP17, GP27, GP22, GP5',
          'DC motor: forward, ENA duty 40% at 1 kHz',
        ],
      },
      {
        ms: 1000,
        devices: { motor: { rpm: 1715, direction: 'forward', amps: 0.02, load: 0, stalled: false } },
        serial: ['DC motor: forward, ENA duty 70% at 1 kHz'],
      },
      {
        ms: 1000,
        devices: { motor: { rpm: 2450, direction: 'forward', amps: 0.0286, load: 0, stalled: false } },
        serial: ['DC motor: forward, ENA duty 100% at 1 kHz'],
      },
      {
        ms: 1000,
        devices: { motor: { rpm: 0, direction: 'stopped', amps: 0, load: 0, stalled: false } },
        serial: ['DC motor: stopped'],
      },
      {
        ms: 2000,
        devices: { motor: { rpm: 1715, direction: 'reverse', amps: -0.02, load: 0, stalled: false } },
        serial: ['DC motor: reverse, ENA duty 70% at 1 kHz'],
      },

      // The motor stops and the stepper takes over, a quarter turn each way.
      // 1024 half-steps at 2 ms is 2048 ms, which is what these two hold for.
      {
        ms: 2048,
        devices: { motor: { rpm: 0, direction: 'stopped', amps: 0, load: 0, stalled: false } },
        serial: ['DC motor: stopped', 'Stepper: 1024 half-steps forward = 90.0 degrees'],
      },
      {
        ms: 2048,
        devices: { motor: { rpm: 0, direction: 'stopped', amps: 0, load: 0, stalled: false } },
        serial: ['Stepper: 1024 half-steps back to zero'],
      },
      {
        ms: 1000,
        devices: { motor: { rpm: 0, direction: 'stopped', amps: 0, load: 0, stalled: false } },
        serial: ['Stepper: coils off, shaft free'],
      },
    ],
  },

  /* 10 — Home automation, four relay channels. The listing beside this is
     `HOME_AUTOMATION_RPI_SCRIPT`, whose loop calls the Flask route's own
     `toggle()` body on each of Light, Fan, AC and TV in turn with two seconds
     between — so a full ON pass and a full OFF pass is eight steps.

     THE BOARD IS ACTIVE LOW, which is why "LOW" reads as ON: the module's opto
     LED sits between VCC and IN, so the coil is energised by pulling the pin
     DOWN. A log claiming HIGH meant ON would teach the bug this experiment is
     most likely to produce.

     Only channel 1 has a load drawn on it — see ../circuits.ts on why one lamp
     rather than four — so the LED lights when Light goes on and stays lit
     through the other three channels' turns, until Light's next toggle. */
  10: {
    stillStep: 0,
    steps: [
      {
        ms: 2000,
        leds: { led: LIT },
        serial: [
          'Home Automation ready - 4 relay channels on GPIO 17, 27, 22, 16.',
          'GPIO17 (Light): LOW - ON  | HTTP GET /toggle/Light',
        ],
      },
      { ms: 2000, leds: { led: LIT }, serial: ['GPIO27 (Fan): LOW - ON  | HTTP GET /toggle/Fan'] },
      { ms: 2000, leds: { led: LIT }, serial: ['GPIO22 (AC): LOW - ON  | HTTP GET /toggle/AC'] },
      { ms: 2000, leds: { led: LIT }, serial: ['GPIO16 (TV): LOW - ON  | HTTP GET /toggle/TV'] },

      { ms: 2000, serial: ['GPIO17 (Light): HIGH - OFF  | HTTP GET /toggle/Light'] },
      { ms: 2000, serial: ['GPIO27 (Fan): HIGH - OFF  | HTTP GET /toggle/Fan'] },
      { ms: 2000, serial: ['GPIO22 (AC): HIGH - OFF  | HTTP GET /toggle/AC'] },
      { ms: 2000, serial: ['GPIO16 (TV): HIGH - OFF  | HTTP GET /toggle/TV'] },
    ],
  },

  /* 11 — Smart traffic, four lanes. One pass of the timeline is one call to
     `loop()`: the sketch's own `for(int i=0;i<4;i++)` visits every lane once,
     each for `3000 + density*7` ms of green and a fixed 2 s of yellow, before
     `loop()` returns and the runtime calls it again.

     NO SETUP LINE. `setup()` here ends `allRed(); Serial.begin(9600);` and
     prints nothing — the "Smart Traffic Controller Active" this used to open
     with was added by the rewrite, not by the lab sheet.

     The four densities — 100, 300, 500, 200 — are the raw `analogRead()`
     counts the pots in circuits.ts are posed to give: `POT_POSITIONS_11`
     there (10/29/49/20 %) is chosen so a real `position/100 * 1023` lands on
     these same four numbers, so the knob a viewer sees and the count the
     serial log prints agree. */
  11: {
    stillStep: 1,
    steps: [
      // Lane 1 — density 100 -> green for 3000 + 100*7 = 3700 ms.
      { ms: 200, leds: grid11(0, 'green'), serial: ['Lane 1 Green: 3700ms'] },
      { ms: 3500, leds: grid11(0, 'green') },
      { ms: 2000, leds: grid11(0, 'yellow') },

      // Lane 2 — density 300 -> green for 3000 + 300*7 = 5100 ms.
      { ms: 200, leds: grid11(1, 'green'), serial: ['Lane 2 Green: 5100ms'] },
      { ms: 4900, leds: grid11(1, 'green') },
      { ms: 2000, leds: grid11(1, 'yellow') },

      // Lane 3 — density 500 -> green for 3000 + 500*7 = 6500 ms, the busiest
      // lane and the longest phase, matching the highest knob setting.
      { ms: 200, leds: grid11(2, 'green'), serial: ['Lane 3 Green: 6500ms'] },
      { ms: 6300, leds: grid11(2, 'green') },
      { ms: 2000, leds: grid11(2, 'yellow') },

      // Lane 4 — density 200 -> green for 3000 + 200*7 = 4400 ms.
      { ms: 200, leds: grid11(3, 'green'), serial: ['Lane 4 Green: 4400ms'] },
      { ms: 4200, leds: grid11(3, 'green') },
      { ms: 2000, leds: grid11(3, 'yellow') },
    ],
  },

  /* 12 — Health monitoring, on the Pico. `HEALTH_MONITORING_RPI_SCRIPT`
     (lib/simulator/pico/experiments.ts) is what runs now, and its loop is a
     real measurement rather than an instant analogRead: `measure_bpm(4000)`
     polls the MCP3008 for a full 4 s window, then `read_temp()` spends the
     DS18B20's own 750 ms conversion time — 4750 ms of work before the one
     line it prints. One step per reading, held for that long, is what makes
     the serial log's pace match a sketch a student could actually be running
     rather than a print happening every tick.

     Five readings, normal → alert → normal, exactly the shape experiment 1's
     temperature excursion takes: the middle one clears BOTH the 36.1–37.2 °C
     and the 60–100 BPM bands the sketch checks, at once, so the ALERT line
     shows what a compound fault looks like rather than only ever one flag at
     a time. */
  12: {
    stillStep: 0,
    steps: [
      {
        ms: 200,
        props: { ds: { temperature: 36.5 }, pulse: { bpm: 72 } },
        sensors: { tempProbe: 36.5, bpm: 72 },
        serial: [
          'Smart Health Monitor - DS18B20 on GP4, pulse sensor on MCP3008 CH0.',
          'Found 1 1-Wire device(s).',
          'Temp: 36.5C  BPM: 72  Status: NORMAL -> ThingSpeak updated',
        ],
      },
      { ms: 4550, props: { ds: { temperature: 36.5 }, pulse: { bpm: 72 } }, sensors: { tempProbe: 36.5, bpm: 72 } },

      {
        ms: 200,
        props: { ds: { temperature: 36.8 }, pulse: { bpm: 78 } },
        sensors: { tempProbe: 36.8, bpm: 78 },
        serial: ['Temp: 36.8C  BPM: 78  Status: NORMAL -> ThingSpeak updated'],
      },
      { ms: 4550, props: { ds: { temperature: 36.8 }, pulse: { bpm: 78 } }, sensors: { tempProbe: 36.8, bpm: 78 } },

      // Both bands cleared at once: temperature over 37.2 °C and BPM over
      // 100 — a fever with a racing pulse, the compound ALERT case.
      {
        ms: 200,
        props: { ds: { temperature: 37.6 }, pulse: { bpm: 112 } },
        sensors: { tempProbe: 37.6, bpm: 112 },
        serial: ['Temp: 37.6C  BPM: 112  Status: ALERT Temp HIGH BPM HIGH (Tachycardia) -> ThingSpeak updated'],
      },
      { ms: 4550, props: { ds: { temperature: 37.6 }, pulse: { bpm: 112 } }, sensors: { tempProbe: 37.6, bpm: 112 } },

      {
        ms: 200,
        props: { ds: { temperature: 37.0 }, pulse: { bpm: 95 } },
        sensors: { tempProbe: 37.0, bpm: 95 },
        serial: ['Temp: 37.0C  BPM: 95  Status: NORMAL -> ThingSpeak updated'],
      },
      { ms: 4550, props: { ds: { temperature: 37.0 }, pulse: { bpm: 95 } }, sensors: { tempProbe: 37.0, bpm: 95 } },

      {
        ms: 200,
        props: { ds: { temperature: 36.4 }, pulse: { bpm: 70 } },
        sensors: { tempProbe: 36.4, bpm: 70 },
        serial: ['Temp: 36.4C  BPM: 70  Status: NORMAL -> ThingSpeak updated'],
      },
      { ms: 4550, props: { ds: { temperature: 36.4 }, pulse: { bpm: 70 } }, sensors: { tempProbe: 36.4, bpm: 70 } },
    ],
  },
}
