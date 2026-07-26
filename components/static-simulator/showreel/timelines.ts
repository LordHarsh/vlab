/**
 * SCRIPTED PLAYBACK FOR THE READ-ONLY CIRCUITS.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ THESE NUMBERS ARE CHOREOGRAPHY, NOT PHYSICS.                            │
 * │                                                                         │
 * │ Nothing in this file is computed, measured or solved. There is no       │
 * │ interpreter, no netlist, no current and no Ohm's law anywhere near it.  │
 * │ Each entry below is a hand-written stage direction: "hold this pin at   │
 * │ 5 V for 500 ms, show 29 on the DHT11, print this line". It exists so a  │
 * │ reference circuit LOOKS alive on a lesson page, and for no other        │
 * │ reason. Do not read a model into it and do not derive one from it.      │
 * │                                                                         │
 * │ The app's real simulator — emulated MCU, solved circuit, actual         │
 * │ voltages — is lib/simulator/. If you need a number to be true, it       │
 * │ comes from there, never from here.                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * WHAT IS STILL HELD TO A STANDARD
 *
 * Every value is one a real bench would produce, because a fake that teaches
 * something false is worse than no fake at all. A DHT11 reads whole degrees
 * over 0–50 °C, so it reads whole degrees here. An HC-SR04 spans 2–400 cm. A
 * resting adult pulse sits in the seventies. `analogRead` returns 0–1023, so
 * experiment 12's serial lines print counts — which is what its sketch
 * actually prints — and those counts are the ones an LM35 at the temperature
 * on the artwork would produce.
 *
 * Every serial line is lifted from the experiment's own `defaultCode` in
 * utils/experimentData.ts, with the placeholders filled in from the same step
 * that drives the artwork. If you change a reading, change its line too: the
 * whole point is that the LED, the sensor readout, the serial log and the
 * clock never contradict each other.
 *
 * HOW A TIMELINE PLAYS
 *
 * `steps` runs top to bottom and then repeats, forever, from one clock (see
 * useShowreel.ts). Each step is self-describing — nothing carries over from
 * the step before it, so what you read on a line is exactly what is on screen
 * while that line is current. To change the blink rate of experiment 3, edit
 * one `ms`.
 */

/** A pin key, `componentId/pinId`, matching utils/experimentData.ts. */
type PinKey = string

/**
 * Sensor readouts the ported artwork knows how to draw (ComponentSVGs.tsx).
 * Typed rather than a bag so a misspelt key is a build error and not a
 * silently blank display.
 */
export interface ShowreelSensors {
  /** DHT11 and LM35, in °C. */
  temperature?: number
  /** DHT11, in %RH. Not drawn on the artwork; kept to feed the serial log. */
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
   * The pins that sit at 5 V for the whole of this step. Every pin not named
   * here reads 0 V — which is why an LED cathode never needs listing.
   *
   * Only pins some part of the artwork actually looks at are worth naming;
   * adding the rest of the netlist would change nothing on screen.
   */
  high?: PinKey[]
  /** What the sensors on the board display while this step is current. */
  sensors?: ShowreelSensors
  /**
   * Component property overrides, by component id — for the parts whose
   * artwork reads `instance.properties` rather than a pin (the button cap,
   * the relay's own state flag).
   */
  props?: Record<string, Record<string, unknown>>
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

/* ── The twelve ───────────────────────────────────────────────────────────
 *
 * Keyed by the experiment ids in utils/experimentData.ts (1–12; ids 13 and 14
 * are blank sandboxes with no sketch to act out). An id with no timeline
 * simply renders the circuit inert, exactly as it did before this existed.
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
        sensors: { temperature: 24, humidity: 45 },
        serial: [
          'DHT11 Sensor & LED System Initialized',
          'Temperature: 24.00 *C  |  Humidity: 45.00 %',
        ],
      },
      {
        ms: 2000,
        sensors: { temperature: 26, humidity: 47 },
        serial: ['Temperature: 26.00 *C  |  Humidity: 47.00 %'],
      },

      // 29 °C — over the threshold, LED starts blinking.
      {
        ms: 500,
        high: ['led_1/anode', 'uno_1/arduino-D13'],
        sensors: { temperature: 29, humidity: 50 },
        serial: ['Temperature: 29.00 *C  |  Humidity: 50.00 %'],
      },
      { ms: 500, sensors: { temperature: 29, humidity: 50 } },
      { ms: 500, high: ['led_1/anode', 'uno_1/arduino-D13'], sensors: { temperature: 29, humidity: 50 } },
      { ms: 500, sensors: { temperature: 29, humidity: 50 } },

      // 31 °C.
      {
        ms: 500,
        high: ['led_1/anode', 'uno_1/arduino-D13'],
        sensors: { temperature: 31, humidity: 53 },
        serial: ['Temperature: 31.00 *C  |  Humidity: 53.00 %'],
      },
      { ms: 500, sensors: { temperature: 31, humidity: 53 } },
      { ms: 500, high: ['led_1/anode', 'uno_1/arduino-D13'], sensors: { temperature: 31, humidity: 53 } },
      { ms: 500, sensors: { temperature: 31, humidity: 53 } },

      // 30 °C — still over, still blinking.
      {
        ms: 500,
        high: ['led_1/anode', 'uno_1/arduino-D13'],
        sensors: { temperature: 30, humidity: 52 },
        serial: ['Temperature: 30.00 *C  |  Humidity: 52.00 %'],
      },
      { ms: 500, sensors: { temperature: 30, humidity: 52 } },
      { ms: 500, high: ['led_1/anode', 'uno_1/arduino-D13'], sensors: { temperature: 30, humidity: 52 } },
      { ms: 500, sensors: { temperature: 30, humidity: 52 } },

      // Back under the threshold: the sketch drives D13 LOW and leaves it there.
      {
        ms: 2000,
        sensors: { temperature: 27, humidity: 49 },
        serial: ['Temperature: 27.00 *C  |  Humidity: 49.00 %'],
      },
      {
        ms: 2000,
        sensors: { temperature: 25, humidity: 46 },
        serial: ['Temperature: 25.00 *C  |  Humidity: 46.00 %'],
      },
    ],
  },

  /* 2 — Ultrasonic & PIR. delay(1500) per reading, split into the 200 ms the
     TRIG line is being pulsed and the 1300 ms of waiting that follows, so the
     sensor visibly pings before each new range appears. Something walks in
     from 2.4 m to 40 cm and back out. */
  2: {
    stillStep: 7,
    steps: [
      {
        ms: 200,
        high: ['ultrasonic_1/trig'],
        sensors: { distance: 240, motion: false },
        serial: ['Security Scanner Online...', 'Motion: 0 | Range: 240 cm'],
      },
      { ms: 1300, sensors: { distance: 240, motion: false } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig'],
        sensors: { distance: 150, motion: false },
        serial: ['Motion: 0 | Range: 150 cm'],
      },
      { ms: 1300, sensors: { distance: 150, motion: false } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig'],
        sensors: { distance: 85, motion: true },
        serial: ['Motion: 1 | Range: 85 cm', 'Notice: Motion detected at safe distance.'],
      },
      { ms: 1300, sensors: { distance: 85, motion: true } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig'],
        sensors: { distance: 40, motion: true },
        serial: ['Motion: 1 | Range: 40 cm', 'WARNING: Intruder Detected close by!'],
      },
      { ms: 1300, sensors: { distance: 40, motion: true } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig'],
        sensors: { distance: 110, motion: true },
        serial: ['Motion: 1 | Range: 110 cm', 'Notice: Motion detected at safe distance.'],
      },
      { ms: 1300, sensors: { distance: 110, motion: true } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig'],
        sensors: { distance: 210, motion: false },
        serial: ['Motion: 0 | Range: 210 cm'],
      },
      { ms: 1300, sensors: { distance: 210, motion: false } },
    ],
  },

  /* 3 — Traffic light. The three `ms` below ARE the sketch's three delays;
     change one and the light dwells for longer. */
  3: {
    stillStep: 0,
    steps: [
      {
        ms: 3000,
        high: ['led_red/anode', 'uno_1/arduino-D10'],
        serial: ['Traffic Lights Starting...', 'State: RED - STOP!'],
      },
      {
        ms: 3000,
        high: ['led_green/anode', 'uno_1/arduino-D12'],
        serial: ['State: GREEN - GO!'],
      },
      {
        ms: 1000,
        high: ['led_yellow/anode', 'uno_1/arduino-D11'],
        serial: ['State: YELLOW - CAUTION!'],
      },
    ],
  },

  /* 4 — Water flow. A tap opened and closed again: the impeller is still at
     0 L/min, turns while there is flow, and the sketch's 8 L/min alarm trips
     once at the peak. A YF-S201 is rated 1–30 L/min. */
  4: {
    stillStep: 2,
    steps: [
      { ms: 2000, sensors: { flowRate: 0 }, serial: ['Flow Meter Activated.', 'Current Flow Rate: 0.00 L/min'] },
      { ms: 2000, sensors: { flowRate: 3.4 }, serial: ['Current Flow Rate: 3.40 L/min'] },
      { ms: 2000, sensors: { flowRate: 6.2 }, serial: ['Current Flow Rate: 6.20 L/min'] },
      {
        ms: 2000,
        sensors: { flowRate: 9.1 },
        serial: ['Current Flow Rate: 9.10 L/min', 'WARNING: High flow rate detected!'],
      },
      { ms: 2000, sensors: { flowRate: 7.5 }, serial: ['Current Flow Rate: 7.50 L/min'] },
      { ms: 2000, sensors: { flowRate: 4.8 }, serial: ['Current Flow Rate: 4.80 L/min'] },
      { ms: 2000, sensors: { flowRate: 0 }, serial: ['Current Flow Rate: 0.00 L/min'] },
    ],
  },

  /* 5 — LED & push button on the Pico. The button cap goes down, GP15 follows
     it, the LED lights. The sketch polls every 100 ms and prints on every pass
     while the button is held, so a press is written as a few short steps and
     the log repeats the line — which is what the monitor really does. */
  5: {
    stillStep: 1,
    steps: [
      { ms: 1400, serial: ['Starting Raspberry Pi GPIO script...'] },

      {
        ms: 300,
        high: ['rpi_1/GP15', 'led_1/anode'],
        props: { button_1: { pressed: true } },
        serial: ['Button pressed -> LED ON'],
      },
      {
        ms: 300,
        high: ['rpi_1/GP15', 'led_1/anode'],
        props: { button_1: { pressed: true } },
        serial: ['Button pressed -> LED ON'],
      },
      {
        ms: 300,
        high: ['rpi_1/GP15', 'led_1/anode'],
        props: { button_1: { pressed: true } },
        serial: ['Button pressed -> LED ON'],
      },

      { ms: 600 },

      {
        ms: 300,
        high: ['rpi_1/GP15', 'led_1/anode'],
        props: { button_1: { pressed: true } },
        serial: ['Button pressed -> LED ON'],
      },
      {
        ms: 300,
        high: ['rpi_1/GP15', 'led_1/anode'],
        props: { button_1: { pressed: true } },
        serial: ['Button pressed -> LED ON'],
      },

      { ms: 1600 },
    ],
  },

  /* 6 — PIR alarm. Quiet, then motion: the sketch chirps the buzzer 200 ms on,
     200 ms off for as long as the PIR output stays HIGH, and the lens keeps
     its alert glow through the whole burst. */
  6: {
    stillStep: 1,
    steps: [
      { ms: 2000, sensors: { motion: false }, serial: ['Alarm System Activated'] },

      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },
      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },
      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },
      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },

      { ms: 1000, sensors: { motion: false } },

      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },
      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },
      {
        ms: 200,
        high: ['buzzer_1/positive', 'uno_1/arduino-D3'],
        sensors: { motion: true },
        serial: ['ALERT! Motion detected! Sounding Buzzer!'],
      },
      { ms: 200, sensors: { motion: true } },

      { ms: 2000, sensors: { motion: false } },
    ],
  },

  /* 7 — DHT11 on the Pico. time.sleep(2.0) between reads; the room warms past
     the sketch's 30 °C line and cools back down. */
  7: {
    stillStep: 3,
    steps: [
      {
        ms: 2000,
        sensors: { temperature: 22, humidity: 55 },
        serial: ['Initializing DHT11 Sensor on GP4...', 'Temp: 22°C, Humidity: 55%'],
      },
      { ms: 2000, sensors: { temperature: 25, humidity: 52 }, serial: ['Temp: 25°C, Humidity: 52%'] },
      { ms: 2000, sensors: { temperature: 28, humidity: 49 }, serial: ['Temp: 28°C, Humidity: 49%'] },
      {
        ms: 2000,
        sensors: { temperature: 31, humidity: 45 },
        serial: ['Temp: 31°C, Humidity: 45%', 'CRITICAL: Hot room! Turn on AC.'],
      },
      { ms: 2000, sensors: { temperature: 29, humidity: 47 }, serial: ['Temp: 29°C, Humidity: 47%'] },
      { ms: 2000, sensors: { temperature: 25, humidity: 52 }, serial: ['Temp: 25°C, Humidity: 52%'] },
    ],
  },

  /* 8 — DS18B20 on the Pico. 750 ms conversion plus a 1 s sleep is 1.75 s a
     reading. A probe in water being brought up to hand-hot and left to cool;
     the sketch's 40 °C warning trips at the top. */
  8: {
    stillStep: 4,
    steps: [
      {
        ms: 1750,
        sensors: { tempProbe: 24.5 },
        serial: [
          '[Simulation Started on Raspberry Pi]',
          'Searching for 1-Wire devices...',
          "Found DS18B20 device with address: bytearray(b'(\\xaa\\x1b\\x1f\\x0e\\x00\\x00\\x00\\xbc')",
          'DS18B20 Temperature: 24.5 °C',
        ],
      },
      { ms: 1750, sensors: { tempProbe: 28 }, serial: ['DS18B20 Temperature: 28.0 °C'] },
      { ms: 1750, sensors: { tempProbe: 33.5 }, serial: ['DS18B20 Temperature: 33.5 °C'] },
      { ms: 1750, sensors: { tempProbe: 39 }, serial: ['DS18B20 Temperature: 39.0 °C'] },
      {
        ms: 1750,
        sensors: { tempProbe: 42.5 },
        serial: ['DS18B20 Temperature: 42.5 °C', 'HIGH TEMP WARNING: Liquid boiling!'],
      },
      { ms: 1750, sensors: { tempProbe: 37 }, serial: ['DS18B20 Temperature: 37.0 °C'] },
      { ms: 1750, sensors: { tempProbe: 30.5 }, serial: ['DS18B20 Temperature: 30.5 °C'] },
      { ms: 1750, sensors: { tempProbe: 26 }, serial: ['DS18B20 Temperature: 26.0 °C'] },
    ],
  },

  /* 9 — DC motor through the L298N. Clockwise, brake, counter-clockwise, at
     the sketch's own 2 s / 1 s / 2 s. Which OUT terminal is high is what makes
     the rotor turn one way or the other, and the driver's channel LEDs go out
     while it coasts.
     (The stepper motor named in the experiment title is removed from this
     circuit before it is drawn — see normaliseCircuit in StaticCircuit.tsx —
     so there is nothing here to step.) */
  9: {
    stillStep: 1,
    steps: [
      {
        ms: 2000,
        high: ['rpi_1/GP14', 'l298n_1/out1', 'dc_1/t1'],
        serial: [
          '[Simulation Started on Raspberry Pi]',
          'Initializing Motor Controller...',
          'Spinning DC Motor Clockwise...',
        ],
      },
      { ms: 1000, serial: ['Braking DC Motor...'] },
      {
        ms: 2000,
        high: ['rpi_1/GP15', 'l298n_1/out2', 'dc_1/t2'],
        serial: ['Spinning DC Motor Counter-Clockwise...'],
      },
    ],
  },

  /* 10 — Home automation. GP15 high closes the relay, which is what the relay
     module and the lamp downstream of it both watch. 2 s each way, per the
     sketch's asyncio.sleep. */
  10: {
    stillStep: 0,
    steps: [
      {
        ms: 2000,
        high: ['rpi_1/GP15'],
        props: { relay_1: { state: true }, lightbulb_1: { lit: true } },
        serial: [
          '[Simulation Started on Raspberry Pi]',
          'Initializing Relay on GP15...',
          'Initialization successful. Starting loop...',
          'Relay Triggered: [ON] -> Appliance Powered',
        ],
      },
      {
        ms: 2000,
        props: { relay_1: { state: false }, lightbulb_1: { lit: false } },
        serial: ['Relay Triggered: [OFF] -> Appliance Off'],
      },
    ],
  },

  /* 11 — Smart traffic. Same 200 ms ping / rest-of-the-delay split as
     experiment 2. A car arrives, the lane scanner sees it inside the sketch's
     100 cm line and the light goes green until it has gone. */
  11: {
    stillStep: 5,
    steps: [
      {
        ms: 200,
        high: ['ultrasonic_1/trig', 'led_red/anode', 'uno_1/arduino-D4'],
        sensors: { distance: 260 },
        serial: ['Smart Traffic Controller Active', 'Vehicle Distance: 260 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, high: ['led_red/anode', 'uno_1/arduino-D4'], sensors: { distance: 260 } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig', 'led_red/anode', 'uno_1/arduino-D4'],
        sensors: { distance: 180 },
        serial: ['Vehicle Distance: 180 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, high: ['led_red/anode', 'uno_1/arduino-D4'], sensors: { distance: 180 } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig', 'led_green/anode', 'uno_1/arduino-D3'],
        sensors: { distance: 70 },
        serial: ['Vehicle Distance: 70 cm', 'Vehicle Detected! GREEN Light ON'],
      },
      { ms: 1800, high: ['led_green/anode', 'uno_1/arduino-D3'], sensors: { distance: 70 } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig', 'led_green/anode', 'uno_1/arduino-D3'],
        sensors: { distance: 40 },
        serial: ['Vehicle Distance: 40 cm', 'Vehicle Detected! GREEN Light ON'],
      },
      { ms: 1800, high: ['led_green/anode', 'uno_1/arduino-D3'], sensors: { distance: 40 } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig', 'led_red/anode', 'uno_1/arduino-D4'],
        sensors: { distance: 120 },
        serial: ['Vehicle Distance: 120 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, high: ['led_red/anode', 'uno_1/arduino-D4'], sensors: { distance: 120 } },

      {
        ms: 200,
        high: ['ultrasonic_1/trig', 'led_red/anode', 'uno_1/arduino-D4'],
        sensors: { distance: 220 },
        serial: ['Vehicle Distance: 220 cm', 'No Vehicle: RED Light ON'],
      },
      { ms: 1800, high: ['led_red/anode', 'uno_1/arduino-D4'], sensors: { distance: 220 } },
    ],
  },

  /* 12 — Health monitoring. The sketch prints every 3 s; the sensors on the
     board update faster than that, which is why each 3 s reading is three
     steps of wobbling BPM under one printed line.
     The printed numbers are `analogRead` counts, 0–1023, because that is what
     this sketch prints. The body-temperature count is the one an LM35 at the
     °C shown on its face would give: 36.5 °C → 365 mV → 365/4.88 ≈ 75. The
     pulse counts are samples off a waveform that swings around mid-rail. */
  12: {
    stillStep: 0,
    steps: [
      {
        ms: 1000,
        sensors: { bpm: 72, temperature: 36.5 },
        serial: [
          'ThingSpeak Patient Telemetry online...',
          'BPM: 512 | Body Temp: 75 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, sensors: { bpm: 74, temperature: 36.5 } },
      { ms: 1000, sensors: { bpm: 73, temperature: 36.5 } },

      {
        ms: 1000,
        sensors: { bpm: 76, temperature: 36.7 },
        serial: [
          'BPM: 604 | Body Temp: 75 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, sensors: { bpm: 78, temperature: 36.7 } },
      { ms: 1000, sensors: { bpm: 77, temperature: 36.7 } },

      {
        ms: 1000,
        sensors: { bpm: 82, temperature: 37 },
        serial: [
          'BPM: 671 | Body Temp: 76 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, sensors: { bpm: 85, temperature: 37 } },
      { ms: 1000, sensors: { bpm: 83, temperature: 37 } },

      {
        ms: 1000,
        sensors: { bpm: 79, temperature: 36.9 },
        serial: [
          'BPM: 588 | Body Temp: 76 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, sensors: { bpm: 77, temperature: 36.9 } },
      { ms: 1000, sensors: { bpm: 78, temperature: 36.9 } },

      {
        ms: 1000,
        sensors: { bpm: 74, temperature: 36.6 },
        serial: [
          'BPM: 497 | Body Temp: 75 C',
          'ThingSpeak API: Pushing Field1=BPM, Field2=Temp... Success!',
        ],
      },
      { ms: 1000, sensors: { bpm: 72, temperature: 36.6 } },
      { ms: 1000, sensors: { bpm: 73, temperature: 36.6 } },
    ],
  },
}
