/**
 * The Raspberry Pi experiments, as circuits a Pico can actually run.
 *
 * These are the WORKED documents — fully wired, so they can be run end to end
 * and asserted against theory (see __tests__/pico.test.ts groups K and L). They
 * are not `role='starter'` documents: a starter hands over the bench and leaves
 * every signal path open. Those now exist, next to the Arduino ones, as
 * STARTER_LED_BUTTON_PICO and STARTER_DHT11_PICO in model/examples.ts, and it is
 * those that migration 022 loads into `circuits`. The two are deliberately not
 * derived from each other: this file is the answer, that one is the exercise.
 *
 * WHAT CHANGED IN THE PORT, AND WHY
 * ---------------------------------
 * The published content targets a Raspberry Pi SBC running `RPi.GPIO` under
 * Linux. A Pico is a microcontroller running MicroPython, so every `RPi.GPIO`
 * call becomes a `machine.*` one. Two things survive intact and are worth
 * saying out loud, because they are the reason the port is honest rather than a
 * substitution: BOTH boards are 3.3 V parts, so every resistor value in the
 * published content is already correct; and every BCM number the content uses
 * (4, 17, 27) exists as a GP number on a Pico, so the pin numbers are preserved
 * verbatim. Only the physical header positions differ.
 *
 * One thing does NOT survive: the emulated MicroPython cannot write files
 * (rp2040js does not implement the SSI peripheral, so its flash is read-only),
 * so `dht11-rpi`'s CSV logging is replaced by printing to the console. That is
 * a real capability we do not have, recorded here rather than faked.
 */

import type { CircuitDoc, DocWire } from '../model/document'

function w(id: string, from: [string, string], to: [string, string], color: string): DocWire {
  return {
    id,
    from: { partId: from[0], pinId: from[1] },
    to: { partId: to[0], pinId: to[1] },
    color,
  }
}

const RED = '#e04a4a'
const BLACK = '#111827'
const GREEN = '#2f7d32'
const YELLOW = '#eab308'
const BLUE = '#2563eb'

// ─── Experiment 05 — led-button-rpi ───────────────────────────────────────────

/**
 * GP17 → 220 Ω → LED → GND, and a push button from GP27 up to 3V3.
 *
 * A DISCREPANCY IN THE PUBLISHED CONTENT, resolved in favour of the code, and
 * since corrected at the source.
 *
 * The experiment's Python sets `pull_up_down=GPIO.PUD_DOWN` and then tests
 * `GPIO.input(BUTTON_PIN) == GPIO.HIGH`, so the switch has to SOURCE 3.3 V:
 * with an internal pull-DOWN and the far contact at GND the input reads LOW
 * whether or not the button is pressed, and the LED never toggles. The wiring
 * here follows the code, which is what the student actually runs and what the
 * Theory section teaches.
 *
 * WHERE THE TEXT STOOD WHEN THIS WAS WRITTEN, because the two versions did not
 * agree with each other. supabase/seeds/003_experiments.sql said "Button Pin 2
 * → GND (common)" — flatly incompatible with the code, and now fixed there. The
 * LIVE database's Circuit Diagram already read "3.3V (Pin 1) via 10kΩ", which is
 * correct; its Procedure step said "between GPIO27 and GND", which was not, and
 * supabase/migrations/022_native_experiments_5_7.sql corrects that step.
 */
export const LED_BUTTON_RPI: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'r220', type: 'resistor', x: 240, y: 60, rotation: 0, props: { ohms: 220 } },
    { id: 'led', type: 'led', x: 380, y: 50, rotation: 0, props: {} },
    { id: 'btn', type: 'push_button', x: 240, y: 220, rotation: 0, props: { pressed: 0 } },
  ],
  wires: [
    w('lb1', ['pico', 'GP17'], ['r220', '1'], BLUE),
    w('lb2', ['r220', '2'], ['led', 'A'], BLUE),
    w('lb3', ['led', 'C'], ['pico', 'GND.4'], BLACK),
    // The switch sources 3V3 into GP27; the Pico's internal PULL_DOWN returns
    // it to 0 V when the contacts are open. That is the pair the code assumes.
    w('lb4', ['pico', 'GP27'], ['btn', '1a'], GREEN),
    w('lb5', ['btn', '2a'], ['pico', '3.3V'], RED),
  ],
}

/**
 * The published `RPi.GPIO` program, transliterated.
 *
 * Line for line, with three substitutions and one deletion:
 *   GPIO.setmode(GPIO.BCM)                  — gone; a Pico has only GP numbers
 *   GPIO.setup(p, GPIO.OUT)                 → Pin(p, Pin.OUT)
 *   GPIO.setup(p, GPIO.IN, PUD_DOWN)        → Pin(p, Pin.IN, Pin.PULL_DOWN)
 *   GPIO.input(p) == GPIO.HIGH              → button.value() == 1
 *   GPIO.cleanup()                          — no equivalent; a microcontroller
 *                                             has no OS to hand the pins back to
 *
 * The 0.3 s sleep after a toggle is the original's software debounce and is
 * kept, because it is the point of that part of the lesson.
 */
export const LED_BUTTON_RPI_SCRIPT = [
  'from machine import Pin',
  'import time',
  '',
  'LED_PIN    = 17',
  'BUTTON_PIN = 27',
  '',
  'led    = Pin(LED_PIN, Pin.OUT)',
  'button = Pin(BUTTON_PIN, Pin.IN, Pin.PULL_DOWN)',
  '',
  'led_state = False',
  'print("Press button to toggle LED.")',
  '',
  'while True:',
  '    if button.value() == 1:',
  '        led_state = not led_state',
  '        led.value(led_state)',
  '        print("LED", "ON" if led_state else "OFF")',
  '        time.sleep(0.3)',
  '    time.sleep(0.05)',
].join('\n')

// ─── Experiment 07 — dht11-rpi ────────────────────────────────────────────────

/**
 * DHT11 on GP4 with the datasheet's 10 kΩ pull-up to 3V3.
 *
 * The pull-up is not optional and not decorative: the DHT11 is open-drain — it
 * can only ever pull the line DOWN — and MicroPython's driver puts GP4 in
 * open-drain mode too, so with no pull-up nothing on the wire can raise it and
 * the read times out. The published circuit calls for exactly this resistor.
 */
export const DHT11_RPI: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'dht', type: 'dht11', x: 260, y: 120, rotation: 0, props: { temperature: 24, humidity: 45 } },
    { id: 'rpull', type: 'resistor', x: 260, y: 40, rotation: 0, props: { ohms: 10000 } },
  ],
  wires: [
    w('dh1', ['dht', 'VCC'], ['pico', '3.3V'], RED),
    w('dh2', ['dht', 'GND'], ['pico', 'GND.4'], BLACK),
    w('dh3', ['dht', 'DATA'], ['pico', 'GP4'], GREEN),
    w('dh4', ['rpull', '1'], ['dht', 'DATA'], YELLOW),
    w('dh5', ['rpull', '2'], ['pico', '3.3V'], RED),
  ],
}

/**
 * The published Adafruit_DHT program, transliterated.
 *
 *   Adafruit_DHT.read_retry(SENSOR, 4)      → dht.DHT11(Pin(4)).measure()
 *   humidity, temperature = ...             → .humidity() / .temperature()
 *   open("dht_log.csv","a").write(...)      — DELETED. See the file header: the
 *                                             emulated flash is not writeable.
 *
 * `dht` is frozen into the MicroPython image, so there is nothing to install —
 * which also removes the published Procedure's `pip3 install Adafruit_DHT`
 * step.
 *
 * The bare `except` is what read_retry() was doing implicitly: a DHT11 read is
 * a bit-banged, interrupt-sensitive transaction and a failed one raises
 * OSError. Swallowing it and trying again is the real behaviour of the library
 * the content used, not a workaround for the simulator.
 */
export const DHT11_RPI_SCRIPT = [
  'from machine import Pin',
  'import dht',
  'import time',
  '',
  'sensor = dht.DHT11(Pin(4))',
  '',
  'while True:',
  '    try:',
  '        sensor.measure()',
  '        print("Temp=%.1fC  Humidity=%.1f%%" % (sensor.temperature(), sensor.humidity()))',
  '    except OSError:',
  '        print("Sensor read failed")',
  '    time.sleep(2)',
].join('\n')

// ─── Registry ─────────────────────────────────────────────────────────────────

export interface PicoExperiment {
  /** The experiment slug, as `experiments.slug` in the database. */
  slug: string
  title: string
  doc: CircuitDoc
  /** The student's MicroPython source, typed into the emulated REPL. */
  script: string
}

/** Keyed by EXPERIMENT SLUG, the same key model/examples.ts uses. */
export const PICO_EXPERIMENTS: Record<string, PicoExperiment> = {
  'led-button-rpi': {
    slug: 'led-button-rpi',
    title: 'LED & Push Button Interfacing with Raspberry Pi',
    doc: LED_BUTTON_RPI,
    script: LED_BUTTON_RPI_SCRIPT,
  },
  'dht11-rpi': {
    slug: 'dht11-rpi',
    title: 'DHT11 Temperature & Humidity with Raspberry Pi',
    doc: DHT11_RPI,
    script: DHT11_RPI_SCRIPT,
  },
}
