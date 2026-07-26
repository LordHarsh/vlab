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
 * resting adult pulse sits in the seventies. Experiment 9's 2,450 rpm is the
 * figure our own DCMotor model gives for this motor on what an L298N passes
 * through from a 5 V rail — `rpmFor` works out to 1000 rpm per terminal volt
 * for HOBBY_MOTOR_6V, and the bridge leaves about 2.45 V of a 5 V supply.
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
 * Experiments 2, 6 and 11 restate the same reading in three places on every
 * step (the target's position, the module's report, the status strip), so each
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

/** Experiment 11: the lane scanner. */
function lane(distanceCm: number): Pick<ShowreelStep, 'props' | 'devices' | 'sensors'> {
  return {
    props: { hcsr04: { distance: distanceCm } },
    devices: { hcsr04: { distanceCm, inRange: true } },
    sensors: { distance: distanceCm },
  }
}

/* ── The twelve ───────────────────────────────────────────────────────────
 *
 * Keyed by the experiment ids in utils/experimentData.ts (1–12; ids 13 and 14
 * are blank sandboxes with no sketch to act out), which is the same key
 * ../circuits.ts uses for the drawing. An id with no timeline simply renders
 * the circuit inert, exactly as it did before this existed.
 */
export const SHOWREEL_TIMELINES: Readonly<Record<number, ShowreelTimeline>> = {
  /* 1 — LED & DHT11. The sketch samples every 2 s and blinks D13 at 500 ms
     for as long as the last reading was over 28 °C. So: seven readings, and
     the three that clear 28 are the three that blink. */
  1: {
    stillStep: 2,
    steps: [
      {
        ms: 2000,
        props: { dht: { temperature: 24, humidity: 45 } },
        sensors: { temperature: 24, humidity: 45 },
        serial: [
          'DHT11 Sensor & LED System Initialized',
          'Temperature: 24.00 *C  |  Humidity: 45.00 %',
        ],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 26, humidity: 47 } },
        sensors: { temperature: 26, humidity: 47 },
        serial: ['Temperature: 26.00 *C  |  Humidity: 47.00 %'],
      },

      // 29 °C — over the threshold, LED starts blinking.
      {
        ms: 500,
        leds: { led: LIT },
        props: { dht: { temperature: 29, humidity: 50 } },
        sensors: { temperature: 29, humidity: 50 },
        serial: ['Temperature: 29.00 *C  |  Humidity: 50.00 %'],
      },
      { ms: 500, props: { dht: { temperature: 29, humidity: 50 } }, sensors: { temperature: 29, humidity: 50 } },
      { ms: 500, leds: { led: LIT }, props: { dht: { temperature: 29, humidity: 50 } }, sensors: { temperature: 29, humidity: 50 } },
      { ms: 500, props: { dht: { temperature: 29, humidity: 50 } }, sensors: { temperature: 29, humidity: 50 } },

      // 31 °C.
      {
        ms: 500,
        leds: { led: LIT },
        props: { dht: { temperature: 31, humidity: 53 } },
        sensors: { temperature: 31, humidity: 53 },
        serial: ['Temperature: 31.00 *C  |  Humidity: 53.00 %'],
      },
      { ms: 500, props: { dht: { temperature: 31, humidity: 53 } }, sensors: { temperature: 31, humidity: 53 } },
      { ms: 500, leds: { led: LIT }, props: { dht: { temperature: 31, humidity: 53 } }, sensors: { temperature: 31, humidity: 53 } },
      { ms: 500, props: { dht: { temperature: 31, humidity: 53 } }, sensors: { temperature: 31, humidity: 53 } },

      // 30 °C — still over, still blinking.
      {
        ms: 500,
        leds: { led: LIT },
        props: { dht: { temperature: 30, humidity: 52 } },
        sensors: { temperature: 30, humidity: 52 },
        serial: ['Temperature: 30.00 *C  |  Humidity: 52.00 %'],
      },
      { ms: 500, props: { dht: { temperature: 30, humidity: 52 } }, sensors: { temperature: 30, humidity: 52 } },
      { ms: 500, leds: { led: LIT }, props: { dht: { temperature: 30, humidity: 52 } }, sensors: { temperature: 30, humidity: 52 } },
      { ms: 500, props: { dht: { temperature: 30, humidity: 52 } }, sensors: { temperature: 30, humidity: 52 } },

      // Back under the threshold: the sketch drives D13 LOW and leaves it there.
      {
        ms: 2000,
        props: { dht: { temperature: 27, humidity: 49 } },
        sensors: { temperature: 27, humidity: 49 },
        serial: ['Temperature: 27.00 *C  |  Humidity: 49.00 %'],
      },
      {
        ms: 2000,
        props: { dht: { temperature: 25, humidity: 46 } },
        sensors: { temperature: 25, humidity: 46 },
        serial: ['Temperature: 25.00 *C  |  Humidity: 46.00 %'],
      },
    ],
  },

  /* 2 — Ultrasonic & PIR. delay(1500) per reading, split into a 200 ms sample
     and the 1300 ms of waiting that follows. Somebody walks in from 2.4 m to
     40 cm and back out; BOTH sensors are watching the same person, so the
     ultrasonic's reticle and the PIR's cone move together. */
  2: {
    stillStep: 7,
    steps: [
      { ms: 200, ...scan(240, false), serial: ['Security Scanner Online...', 'Motion: 0 | Range: 240 cm'] },
      { ms: 1300, ...scan(240, false) },

      { ms: 200, ...scan(150, false), serial: ['Motion: 0 | Range: 150 cm'] },
      { ms: 1300, ...scan(150, false) },

      {
        ms: 200,
        ...scan(85, true),
        serial: ['Motion: 1 | Range: 85 cm', 'Notice: Motion detected at safe distance.'],
      },
      { ms: 1300, ...scan(85, true) },

      {
        ms: 200,
        ...scan(40, true),
        serial: ['Motion: 1 | Range: 40 cm', 'WARNING: Intruder Detected close by!'],
      },
      { ms: 1300, ...scan(40, true) },

      {
        ms: 200,
        ...scan(110, true),
        serial: ['Motion: 1 | Range: 110 cm', 'Notice: Motion detected at safe distance.'],
      },
      { ms: 1300, ...scan(110, true) },

      { ms: 200, ...scan(210, false), serial: ['Motion: 0 | Range: 210 cm'] },
      { ms: 1300, ...scan(210, false) },
    ],
  },

  /* 3 — Traffic light. The three `ms` below ARE the sketch's three delays;
     change one and the light dwells for longer. */
  3: {
    stillStep: 0,
    steps: [
      {
        ms: 3000,
        leds: { led_red: LIT },
        serial: ['Traffic Lights Starting...', 'State: RED - STOP!'],
      },
      { ms: 3000, leds: { led_green: LIT }, serial: ['State: GREEN - GO!'] },
      { ms: 1000, leds: { led_yellow: LIT }, serial: ['State: YELLOW - CAUTION!'] },
    ],
  },

  /* 4 — Water flow. A tap opened and closed again: still at 0 L/min, running,
     and the sketch's 8 L/min alarm trips once at the peak. A YF-S201 is rated
     1–30 L/min.
     NOTHING ON THE BOARD MOVES for this one, and that is honest rather than an
     omission: our YF-S201 has no live readout on its face, so the reading lives
     in the status strip and the serial log. */
  4: {
    stillStep: 3,
    steps: [
      { ms: 2000, props: { flow: { flow: 0 } }, sensors: { flowRate: 0 }, serial: ['Flow Meter Activated.', 'Current Flow Rate: 0.00 L/min'] },
      { ms: 2000, props: { flow: { flow: 3.4 } }, sensors: { flowRate: 3.4 }, serial: ['Current Flow Rate: 3.40 L/min'] },
      { ms: 2000, props: { flow: { flow: 6.2 } }, sensors: { flowRate: 6.2 }, serial: ['Current Flow Rate: 6.20 L/min'] },
      {
        ms: 2000,
        props: { flow: { flow: 9.1 } },
        sensors: { flowRate: 9.1 },
        serial: ['Current Flow Rate: 9.10 L/min', 'WARNING: High flow rate detected!'],
      },
      { ms: 2000, props: { flow: { flow: 7.5 } }, sensors: { flowRate: 7.5 }, serial: ['Current Flow Rate: 7.50 L/min'] },
      { ms: 2000, props: { flow: { flow: 4.8 } }, sensors: { flowRate: 4.8 }, serial: ['Current Flow Rate: 4.80 L/min'] },
      { ms: 2000, props: { flow: { flow: 0 } }, sensors: { flowRate: 0 }, serial: ['Current Flow Rate: 0.00 L/min'] },
    ],
  },

  /* 5 — LED & push button on the Pico. The cap goes down and the LED lights.
     The sketch polls every 100 ms and prints on every pass while the button is
     held, so a press is written as a few short steps and the log repeats the
     line — which is what the monitor really does. */
  5: {
    stillStep: 1,
    steps: [
      { ms: 1400, serial: ['Starting Raspberry Pi GPIO script...'] },

      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['Button pressed -> LED ON'] },
      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['Button pressed -> LED ON'] },
      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['Button pressed -> LED ON'] },

      { ms: 600 },

      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['Button pressed -> LED ON'] },
      { ms: 300, leds: { led: LIT }, props: { btn: { pressed: 1 } }, serial: ['Button pressed -> LED ON'] },

      { ms: 1600 },
    ],
  },

  /* 6 — PIR alarm. Quiet, then motion: the sketch chirps the buzzer 200 ms on,
     200 ms off for as long as the PIR output stays HIGH, and the cone keeps its
     alert amber through the whole burst.
     The chirp itself is in the serial log and not on the board: our buzzer has
     no drawn "sounding" state, so what the canvas shows is the detection that
     causes it. */
  6: {
    stillStep: 1,
    steps: [
      { ms: 2000, ...watch(300, false), serial: ['Alarm System Activated'] },

      { ms: 200, ...watch(180, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(170, true) },
      { ms: 200, ...watch(160, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(150, true) },
      { ms: 200, ...watch(140, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(130, true) },
      { ms: 200, ...watch(120, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(110, true) },

      { ms: 1000, ...watch(110, false) },

      { ms: 200, ...watch(140, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(170, true) },
      { ms: 200, ...watch(200, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(230, true) },
      { ms: 200, ...watch(260, true), serial: ['ALERT! Motion detected! Sounding Buzzer!'] },
      { ms: 200, ...watch(290, true) },

      { ms: 2000, ...watch(300, false) },
    ],
  },

  /* 7 — DHT11 on the Pico. time.sleep(2.0) between reads; the room warms past
     the sketch's 30 °C line and cools back down. */
  7: {
    stillStep: 3,
    steps: [
      {
        ms: 2000,
        props: { dht: { temperature: 22, humidity: 55 } },
        sensors: { temperature: 22, humidity: 55 },
        serial: ['Initializing DHT11 Sensor on GP4...', 'Temp: 22°C, Humidity: 55%'],
      },
      { ms: 2000, props: { dht: { temperature: 25, humidity: 52 } }, sensors: { temperature: 25, humidity: 52 }, serial: ['Temp: 25°C, Humidity: 52%'] },
      { ms: 2000, props: { dht: { temperature: 28, humidity: 49 } }, sensors: { temperature: 28, humidity: 49 }, serial: ['Temp: 28°C, Humidity: 49%'] },
      {
        ms: 2000,
        props: { dht: { temperature: 31, humidity: 45 } },
        sensors: { temperature: 31, humidity: 45 },
        serial: ['Temp: 31°C, Humidity: 45%', 'CRITICAL: Hot room! Turn on AC.'],
      },
      { ms: 2000, props: { dht: { temperature: 29, humidity: 47 } }, sensors: { temperature: 29, humidity: 47 }, serial: ['Temp: 29°C, Humidity: 47%'] },
      { ms: 2000, props: { dht: { temperature: 25, humidity: 52 } }, sensors: { temperature: 25, humidity: 52 }, serial: ['Temp: 25°C, Humidity: 52%'] },
    ],
  },

  /* 8 — DS18B20 on the Pico. 750 ms conversion plus a 1 s sleep is 1.75 s a
     reading. A probe in water brought up to hand-hot and left to cool; the
     sketch's 40 °C warning trips at the top. */
  8: {
    stillStep: 4,
    steps: [
      {
        ms: 1750,
        props: { ds: { temperature: 24.5 } },
        sensors: { tempProbe: 24.5 },
        serial: [
          '[Simulation Started on Raspberry Pi]',
          'Searching for 1-Wire devices...',
          "Found DS18B20 device with address: bytearray(b'(\\xaa\\x1b\\x1f\\x0e\\x00\\x00\\x00\\xbc')",
          'DS18B20 Temperature: 24.5 °C',
        ],
      },
      { ms: 1750, props: { ds: { temperature: 28 } }, sensors: { tempProbe: 28 }, serial: ['DS18B20 Temperature: 28.0 °C'] },
      { ms: 1750, props: { ds: { temperature: 33.5 } }, sensors: { tempProbe: 33.5 }, serial: ['DS18B20 Temperature: 33.5 °C'] },
      { ms: 1750, props: { ds: { temperature: 39 } }, sensors: { tempProbe: 39 }, serial: ['DS18B20 Temperature: 39.0 °C'] },
      {
        ms: 1750,
        props: { ds: { temperature: 42.5 } },
        sensors: { tempProbe: 42.5 },
        serial: ['DS18B20 Temperature: 42.5 °C', 'HIGH TEMP WARNING: Liquid boiling!'],
      },
      { ms: 1750, props: { ds: { temperature: 37 } }, sensors: { tempProbe: 37 }, serial: ['DS18B20 Temperature: 37.0 °C'] },
      { ms: 1750, props: { ds: { temperature: 30.5 } }, sensors: { tempProbe: 30.5 }, serial: ['DS18B20 Temperature: 30.5 °C'] },
      { ms: 1750, props: { ds: { temperature: 26 } }, sensors: { tempProbe: 26 }, serial: ['DS18B20 Temperature: 26.0 °C'] },
    ],
  },

  /* 9 — DC motor through the L298N. Clockwise, brake, counter-clockwise, at
     the sketch's own 2 s / 1 s / 2 s. The plate on the motor's case is what
     shows it: `rpm` and `direction` are exactly the two fields our engine's
     own motor readout reads. 2450 rpm is HOBBY_MOTOR_6V at the ~2.45 V an
     L298N passes through from a 5 V rail. */
  9: {
    stillStep: 0,
    steps: [
      {
        ms: 2000,
        devices: { motor: { rpm: 2450, direction: 'forward', amps: 0.0286, load: 0, stalled: false } },
        serial: [
          '[Simulation Started on Raspberry Pi]',
          'Initializing Motor Controller...',
          'Spinning DC Motor Clockwise...',
        ],
      },
      {
        ms: 1000,
        devices: { motor: { rpm: 0, direction: 'stopped', amps: 0, load: 0, stalled: false } },
        serial: ['Braking DC Motor...'],
      },
      {
        ms: 2000,
        devices: { motor: { rpm: 2450, direction: 'reverse', amps: -0.0286, load: 0, stalled: false } },
        serial: ['Spinning DC Motor Counter-Clockwise...'],
      },
    ],
  },

  /* 10 — Home automation. GP15 high pulls the armature in, channel 1's contacts
     close and the appliance on NO1 lights. 2 s each way, per the sketch's
     asyncio.sleep. The appliance is an LED — see ../circuits.ts on why. */
  10: {
    stillStep: 0,
    steps: [
      {
        ms: 2000,
        leds: { led: LIT },
        serial: [
          '[Simulation Started on Raspberry Pi]',
          'Initializing Relay on GP15...',
          'Initialization successful. Starting loop...',
          'Relay Triggered: [ON] -> Appliance Powered',
        ],
      },
      { ms: 2000, serial: ['Relay Triggered: [OFF] -> Appliance Off'] },
    ],
  },

  /* 11 — Smart traffic. Same 200 ms sample / rest-of-the-delay split as
     experiment 2. A car arrives, the lane scanner sees it inside the sketch's
     100 cm line and the light goes green until it has gone. */
  11: {
    stillStep: 5,
    steps: [
      {
        ms: 200,
        ...lane(260),
        leds: { led_red: LIT },
        serial: ['Smart Traffic Controller Active', 'Vehicle Distance: 260 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, ...lane(260), leds: { led_red: LIT } },

      {
        ms: 200,
        ...lane(180),
        leds: { led_red: LIT },
        serial: ['Vehicle Distance: 180 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, ...lane(180), leds: { led_red: LIT } },

      {
        ms: 200,
        ...lane(70),
        leds: { led_green: LIT },
        serial: ['Vehicle Distance: 70 cm', 'Vehicle Detected! GREEN Light ON'],
      },
      { ms: 1800, ...lane(70), leds: { led_green: LIT } },

      {
        ms: 200,
        ...lane(40),
        leds: { led_green: LIT },
        serial: ['Vehicle Distance: 40 cm', 'Vehicle Detected! GREEN Light ON'],
      },
      { ms: 1800, ...lane(40), leds: { led_green: LIT } },

      {
        ms: 200,
        ...lane(120),
        leds: { led_red: LIT },
        serial: ['Vehicle Distance: 120 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, ...lane(120), leds: { led_red: LIT } },

      {
        ms: 200,
        ...lane(220),
        leds: { led_red: LIT },
        serial: ['Vehicle Distance: 220 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, ...lane(220), leds: { led_red: LIT } },
    ],
  },

  /* 12 — Health monitoring. The sketch prints every 3 s; the sensors update
     faster than that, which is why each 3 s reading is three steps of wobbling
     BPM under one printed line.
     The printed numbers are `analogRead` counts, 0–1023, because that is what
     this sketch prints. The body-temperature count is the one an LM35 at the
     °C shown would give: 36.5 °C → 365 mV → 365/4.88 ≈ 75. The pulse counts are
     samples off a waveform that swings around mid-rail. */
  12: {
    stillStep: 0,
    steps: [
      {
        ms: 1000,
        props: { pulse: { bpm: 72 } },
        sensors: { bpm: 72, temperature: 36.5 },
        serial: [
          'ThingSpeak Patient Telemetry online...',
          'BPM: 512 | Body Temp: 75 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, props: { pulse: { bpm: 74 } }, sensors: { bpm: 74, temperature: 36.5 } },
      { ms: 1000, props: { pulse: { bpm: 73 } }, sensors: { bpm: 73, temperature: 36.5 } },

      {
        ms: 1000,
        props: { pulse: { bpm: 76 } },
        sensors: { bpm: 76, temperature: 36.7 },
        serial: [
          'BPM: 604 | Body Temp: 75 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, props: { pulse: { bpm: 78 } }, sensors: { bpm: 78, temperature: 36.7 } },
      { ms: 1000, props: { pulse: { bpm: 77 } }, sensors: { bpm: 77, temperature: 36.7 } },

      {
        ms: 1000,
        props: { pulse: { bpm: 82 } },
        sensors: { bpm: 82, temperature: 37 },
        serial: [
          'BPM: 671 | Body Temp: 76 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, props: { pulse: { bpm: 85 } }, sensors: { bpm: 85, temperature: 37 } },
      { ms: 1000, props: { pulse: { bpm: 83 } }, sensors: { bpm: 83, temperature: 37 } },

      {
        ms: 1000,
        props: { pulse: { bpm: 79 } },
        sensors: { bpm: 79, temperature: 36.9 },
        serial: [
          'BPM: 588 | Body Temp: 76 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, props: { pulse: { bpm: 77 } }, sensors: { bpm: 77, temperature: 36.9 } },
      { ms: 1000, props: { pulse: { bpm: 78 } }, sensors: { bpm: 78, temperature: 36.9 } },

      {
        ms: 1000,
        props: { pulse: { bpm: 74 } },
        sensors: { bpm: 74, temperature: 36.6 },
        serial: [
          'BPM: 497 | Body Temp: 75 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, props: { pulse: { bpm: 72 } }, sensors: { bpm: 72, temperature: 36.6 } },
      { ms: 1000, props: { pulse: { bpm: 73 } }, sensors: { bpm: 73, temperature: 36.6 } },
    ],
  },
}
