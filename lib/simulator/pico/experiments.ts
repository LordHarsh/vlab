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

// ─── Experiment 10 — home-automation-rpi ──────────────────────────────────────

/**
 * THE NETWORK IS PRINTED, NOT SIMULATED, AND THAT IS THE HONEST CHOICE.
 *
 * The published program for experiment 10 is a Flask web server and the one for
 * experiment 12 posts to ThingSpeak. Neither can run here: MicroPython on an
 * emulated RP2040 raises ImportError for `network`, `socket` and `urequests`
 * because the Pico's WiFi lives on a second chip (a CYW43439, on the Pico W)
 * that rp2040js does not emulate — and would not help much if it did, since
 * there is nothing on the other end of the wire.
 *
 * That is not a shortfall against the bar this lab actually sets. The owner's
 * canonical content (iot_virtual_lab.html) does not simulate networking either;
 * its experiment-10 widget prints
 *
 *     GPIO17 (Light): HIGH - ON  | HTTP GET /toggle/Light
 *
 * and its experiment-12 widget prints
 *
 *     Temp: 36.8C  BPM: 72  Status: NORMAL -> ThingSpeak updated
 *
 * Tinkercad likewise simulates no networking on any board. So the rule applied
 * to both ports is: MODEL THE HARDWARE PROPERLY AND LET THE NETWORK CALL BE A
 * PRINTED LINE. Every GPIO, every relay coil, every SPI clock edge and every
 * 1-Wire slot below is real and goes through the solver. What is not real is the
 * HTTP, and the code says so where it happens rather than pretending.
 *
 * ASCII ONLY, deliberately. The script reaches the interpreter through an
 * emulated USB CDC link that this engine reads a byte at a time, so a degree
 * sign or an arrow would arrive as mojibake in both directions. The published
 * text's "C" and "->" stand in for their typographic originals.
 */

/**
 * Four relay channels on GP17, GP27, GP22 and GP16, with a lamp on channel 1.
 *
 * The relay board's VCC comes from VBUS (the Pico's `5V` pad), NOT from the
 * 3.3 V logic rail. An SRD-05VDC coil is only guaranteed to pull in above
 * 3.75 V, so a board fed from 3V3 lights its opto-coupler and never moves its
 * armature — and the model reproduces that rather than closing the contact
 * anyway. GPIO23 in the published circuit does not exist on a Pico header, so
 * the fourth channel is on GP16.
 *
 * The lamp hangs off channel 1's NORMALLY OPEN contact, so it is dark until the
 * program energises the coil. Wiring it to NC instead gives a lamp that is on
 * until the program turns it off, which is a real and commonly surprising
 * property of an SPDT relay and is why the part exposes all three terminals.
 */
export const HOME_AUTOMATION_RPI: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'relay', type: 'relay_4ch', x: 220, y: 40, rotation: 0, props: { activeLow: 1 } },
    { id: 'r220', type: 'resistor', x: 260, y: 220, rotation: 0, props: { ohms: 220 } },
    { id: 'led', type: 'led', x: 400, y: 200, rotation: 0, props: {} },
  ],
  wires: [
    // Module supply: 5 V from VBUS, and a shared ground.
    w('ha1', ['relay', 'VCC'], ['pico', '5V'], RED),
    w('ha2', ['relay', 'GND'], ['pico', 'GND.4'], BLACK),
    // The four control lines.
    w('ha3', ['relay', 'IN1'], ['pico', 'GP17'], GREEN),
    w('ha4', ['relay', 'IN2'], ['pico', 'GP27'], GREEN),
    w('ha5', ['relay', 'IN3'], ['pico', 'GP22'], GREEN),
    w('ha6', ['relay', 'IN4'], ['pico', 'GP16'], GREEN),
    // Channel 1 switches the lamp: 5 V -> COM1, NO1 -> 220 Ohm -> LED -> GND.
    w('ha7', ['relay', 'COM1'], ['pico', '5V'], RED),
    w('ha8', ['relay', 'NO1'], ['r220', '1'], YELLOW),
    w('ha9', ['r220', '2'], ['led', 'A'], YELLOW),
    w('ha10', ['led', 'C'], ['pico', 'GND.5'], BLACK),
  ],
}

/**
 * The published Flask program, transliterated.
 *
 *   GPIO.setmode(GPIO.BCM)                  - gone; a Pico has only GP numbers
 *   GPIO.setup(pin, GPIO.OUT, initial=LOW)  -> Pin(pin, Pin.OUT, value=...)
 *   GPIO.output(pin, state)                 -> pin.value(...)
 *   @app.route('/toggle/<name>')            -> toggle(name), called on a timer
 *   app.run(host='0.0.0.0', port=5000)      - DELETED. See the section header.
 *
 * TWO SUBSTANTIVE CHANGES, both because the hardware is real here and was not
 * in the published listing:
 *
 *   THE INITIAL LEVEL IS HIGH, NOT LOW. The published code sets every pin low at
 *   start-up, which on an active-low relay board energises all four relays the
 *   moment the program launches. On a bench that is four simultaneous clicks and
 *   every appliance turning itself on. `value=1` idles them off.
 *
 *   THE SENSE IS INVERTED. `pin.value(0)` is ON. That is not a preference: the
 *   board's input opto-coupler LED sits between VCC and IN, so current only
 *   flows when the pin PULLS DOWN. ACTIVE_LOW is a named constant because
 *   high-trigger boards exist and the part has a prop for them.
 *
 * The printed line keeps the canonical widget's format exactly, including the
 * HTTP request the server would have been answering — but it prints the pin's
 * TRUE level, so an active-low board reads "LOW - ON". A line that claimed HIGH
 * meant ON would be teaching the bug this experiment is most likely to produce.
 */
export const HOME_AUTOMATION_RPI_SCRIPT = [
  'from machine import Pin',
  'import time',
  '',
  '# GPIO23 in the published circuit is not brought out on a Pico header, so the',
  '# fourth channel moves to GP16. The other three are the published numbers.',
  'DEVICES = (("Light", 17), ("Fan", 27), ("AC", 22), ("TV", 16))',
  '',
  '# The relay board is ACTIVE LOW: VCC -> opto LED -> 1k -> IN, so the coil is',
  '# energised by pulling IN down. Idle HIGH, or all four relays click on at boot.',
  'ACTIVE_LOW = True',
  '',
  'pins = {}',
  'state = {}',
  'gpio = {}',
  'for name, gp in DEVICES:',
  '    pins[name] = Pin(gp, Pin.OUT, value=1 if ACTIVE_LOW else 0)',
  '    state[name] = False',
  '    gpio[name] = gp',
  '',
  'def apply(name):',
  '    pins[name].value(0 if (state[name] == ACTIVE_LOW) else 1)',
  '',
  'def toggle(name):',
  '    """The body of Flask\'s @app.route("/toggle/<name>") handler."""',
  '    state[name] = not state[name]',
  '    apply(name)',
  '    # The level apply() just drove, derived the same way rather than read back:',
  '    # Pin.value() on an output is the pad, and what the log should report is',
  '    # what the program commanded.',
  '    level = "LOW" if (state[name] == ACTIVE_LOW) else "HIGH"',
  '    print("GPIO%d (%s): %s - %s  | HTTP GET /toggle/%s"',
  '          % (gpio[name], name, level, "ON" if state[name] else "OFF", name))',
  '',
  'print("Home Automation ready - 4 relay channels on GPIO 17, 27, 22, 16.")',
  '# There is no web server: a Flask route is a function that runs when a request',
  '# arrives, and with no network to receive one this calls it on a timer instead.',
  'while True:',
  '    for name, gp in DEVICES:',
  '        toggle(name)',
  '        time.sleep(2)',
].join('\n')

// ─── Experiment 12 — health-monitoring-rpi ────────────────────────────────────

/**
 * DS18B20 on GP4, and a pulse sensor read through an MCP3008 on GP8-GP11.
 *
 * EVERY PUBLISHED PIN NUMBER SURVIVES: 4, 8, 9, 10 and 11 all exist on a Pico
 * header, so unlike experiments 09 and 10 nothing has to move.
 *
 * The MCP3008 is electrically unnecessary on this board — a Pico has three
 * native ADCs and could read the sensor on GP26 — and it is here anyway because
 * the published circuit has it, and because a Raspberry Pi genuinely has no
 * analog input, which is the fact the part exists to teach.
 *
 * Both grounds of the converter are wired. AGND (pin 14) is the reference the
 * conversion is measured against and DGND (pin 9) is the logic return; a real
 * board ties them, and leaving that to the wiring is the same choice every other
 * part in this library makes about ground.
 */
export const HEALTH_MONITORING_RPI: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'ds', type: 'ds18b20', x: 220, y: 40, rotation: 0, props: { temperature: 36.5, resolution: 12 } },
    { id: 'r4k7', type: 'resistor', x: 220, y: 130, rotation: 0, props: { ohms: 4700 } },
    { id: 'adc', type: 'mcp3008', x: 340, y: 40, rotation: 0, props: {} },
    { id: 'pulse', type: 'pulse_sensor', x: 500, y: 60, rotation: 0, props: { bpm: 72, amplitude: 8 } },
  ],
  wires: [
    // DS18B20, with the 4.7 kOhm the 1-Wire bus cannot work without.
    w('hm1', ['ds', 'VDD'], ['pico', '3.3V'], RED),
    w('hm2', ['ds', 'GND'], ['pico', 'GND.4'], BLACK),
    w('hm3', ['ds', 'DQ'], ['pico', 'GP4'], GREEN),
    w('hm4', ['r4k7', '1'], ['ds', 'DQ'], YELLOW),
    w('hm5', ['r4k7', '2'], ['pico', '3.3V'], RED),
    // MCP3008 supply and reference. VREF sets the full-scale reading, so tying
    // it to the same 3.3 V the sensor runs from is what makes the measurement
    // ratiometric — the reading stops depending on the rail.
    w('hm6', ['adc', 'VDD'], ['pico', '3.3V'], RED),
    w('hm7', ['adc', 'VREF'], ['pico', '3.3V'], RED),
    w('hm8', ['adc', 'AGND'], ['pico', 'GND.5'], BLACK),
    w('hm9', ['adc', 'DGND'], ['pico', 'GND.6'], BLACK),
    // SPI: the published circuit's GPIO11/10/9/8, verbatim.
    w('hm10', ['adc', 'CLK'], ['pico', 'GP11'], BLUE),
    w('hm11', ['adc', 'DIN'], ['pico', 'GP10'], BLUE),
    w('hm12', ['adc', 'DOUT'], ['pico', 'GP9'], BLUE),
    w('hm13', ['adc', 'CS'], ['pico', 'GP8'], BLUE),
    // The analog half: the pulse sensor's output into channel 0.
    w('hm14', ['pulse', 'SIG'], ['adc', 'CH0'], YELLOW),
    w('hm15', ['pulse', 'VCC'], ['pico', '3.3V'], RED),
    w('hm16', ['pulse', 'GND'], ['pico', 'GND.7'], BLACK),
  ],
}

/**
 * The published spidev/Adafruit/requests program, transliterated.
 *
 *   glob('/sys/bus/w1/devices/28*') + w1_slave  -> onewire + ds18x20, frozen
 *                                                  into the firmware, so there
 *                                                  is nothing to install and no
 *                                                  kernel module to enable
 *   spidev.SpiDev(); spi.open(0,0)              -> machine.SoftSPI on the same
 *                                                  four pins
 *   spi.xfer2([1, (8+ch)<<4, 0])                -> spi.write_readinto(...)
 *   requests.get(THINGSPEAK_URL, ...)           -  DELETED. See the section
 *                                                  header above HOME_AUTOMATION.
 *
 * A NOTE ON THE PUBLISHED LISTING. Its two SPI lines read `(8+ch)<4` and
 * `(r[1]&3)<8` — the shift operators lost a character somewhere in publishing,
 * which turns both into comparisons and makes the code return `1` or `0`. The
 * transliteration restores `<<`, which is what every spidev MCP3008 example
 * uses and what the converter's own frame requires.
 *
 * BPM IS MEASURED, NOT ASSUMED, and this is the one place the port is BETTER
 * than the listing rather than merely equivalent. The published code computes
 * `60 + ((max - min) // 10)`, which is not a heart rate at all — it is a
 * function of signal AMPLITUDE, so a stronger pulse reads as a faster one. The
 * experiment's own Theory section says the Pi "computes BPM using peak detection
 * on pulse sensor ADC data", and now that the sensor really does put a periodic
 * waveform on the wire, peak detection is what this does: threshold crossings
 * with a release level below them, timed with ticks_ms, and the rate taken from
 * the mean interval between beats.
 */
export const HEALTH_MONITORING_RPI_SCRIPT = [
  'from machine import Pin, SoftSPI',
  'import onewire, ds18x20, time',
  '',
  '# -- DS18B20 on GP4 -------------------------------------------------------',
  'ds = ds18x20.DS18X20(onewire.OneWire(Pin(4)))',
  'roms = ds.scan()',
  '',
  'def read_temp():',
  '    if not roms:',
  '        return None',
  '    ds.convert_temp()',
  '    time.sleep_ms(750)          # tCONV at 12-bit resolution',
  '    return ds.read_temp(roms[0])',
  '',
  '# -- MCP3008 on GP11/GP10/GP9/GP8, the published SPI0 pins ----------------',
  'cs = Pin(8, Pin.OUT, value=1)',
  'spi = SoftSPI(baudrate=100000, polarity=0, phase=0,',
  '              sck=Pin(11), mosi=Pin(10), miso=Pin(9))',
  'rx = bytearray(3)',
  '',
  'def read_adc(ch):',
  '    """One 3-byte MCP3008 transaction: start bit, config word, 10 data bits."""',
  '    cs.value(0)',
  '    spi.write_readinto(bytes([1, (8 + ch) << 4, 0]), rx)',
  '    cs.value(1)',
  '    return ((rx[1] & 3) << 8) | rx[2]',
  '',
  '# -- Peak detection -------------------------------------------------------',
  '# The sensor rests at half its supply, which is 512 counts of 1024, and a beat',
  '# swings it up by about 8% of the rail - roughly 80 counts. 550 is comfortably',
  '# above the baseline; releasing at 530 stops one noisy beat counting twice.',
  'THRESHOLD = 550',
  'RELEASE = 530',
  '',
  'def measure_bpm(window_ms):',
  '    beats = 0',
  '    first = None',
  '    last = None',
  '    above = False',
  '    end = time.ticks_add(time.ticks_ms(), window_ms)',
  '    while time.ticks_diff(end, time.ticks_ms()) > 0:',
  '        v = read_adc(0)',
  '        if not above and v >= THRESHOLD:',
  '            above = True',
  '            t = time.ticks_ms()',
  '            if first is None:',
  '                first = t',
  '            else:',
  '                last = t',
  '                beats += 1',
  '        elif above and v <= RELEASE:',
  '            above = False',
  '        time.sleep_ms(8)',
  '    if beats > 0 and last is not None:',
  '        return int((60000 * beats) / time.ticks_diff(last, first))',
  '    return 0',
  '',
  'def upload(temp, bpm):',
  '    """requests.get(THINGSPEAK_URL, ...) would go here. There is no network."""',
  '    pass',
  '',
  'print("Smart Health Monitor - DS18B20 on GP4, pulse sensor on MCP3008 CH0.")',
  'print("Found %d 1-Wire device(s)." % len(roms))',
  '',
  'while True:',
  '    bpm = measure_bpm(4000)',
  '    temp = read_temp()',
  '    if temp is None:',
  '        print("DS18B20 not found - check the 4.7k pull-up on GP4")',
  '        time.sleep(2)',
  '        continue',
  '    temp_ok = 36.1 <= temp <= 37.2',
  '    bpm_ok = 60 <= bpm <= 100',
  '    status = "NORMAL" if (temp_ok and bpm_ok) else "ALERT"',
  '    detail = ""',
  '    if not temp_ok:',
  '        detail += " Temp LOW" if temp < 36.1 else " Temp HIGH"',
  '    if not bpm_ok:',
  '        detail += " BPM LOW (Bradycardia)" if bpm < 60 else " BPM HIGH (Tachycardia)"',
  '    upload(temp, bpm)',
  '    print("Temp: %.1fC  BPM: %d  Status: %s%s -> ThingSpeak updated"',
  '          % (temp, bpm, status, detail))',
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
  'home-automation-rpi': {
    slug: 'home-automation-rpi',
    title: 'Home Automation with Raspberry Pi',
    doc: HOME_AUTOMATION_RPI,
    script: HOME_AUTOMATION_RPI_SCRIPT,
  },
  'health-monitoring-rpi': {
    slug: 'health-monitoring-rpi',
    title: 'Smart Health Monitoring System',
    doc: HEALTH_MONITORING_RPI,
    script: HEALTH_MONITORING_RPI_SCRIPT,
  },
}
