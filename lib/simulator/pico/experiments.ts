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

// ─── Experiment 08 — ds18b20-rpi ──────────────────────────────────────────────

/**
 * DS18B20 on GP4 with the 4.7 kΩ pull-up, exactly as the published circuit
 * draws it: red → 3.3 V, black → GND, yellow → GPIO4 with the resistor up to
 * 3.3 V.
 *
 * 4.7 kΩ AND NOT 10 kΩ, which is the DHT11's value one experiment earlier. A
 * 1-Wire master samples a read slot about 15 µs after pulling the line down, so
 * the pull-up has to charge the bus capacitance back through a logic threshold
 * inside that window; Maxim specifies 4.7 kΩ for a short bus and MicroPython's
 * `onewire` timings are written against it.
 */
export const DS18B20_RPI: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'ds', type: 'ds18b20', x: 260, y: 60, rotation: 0, props: { temperature: 25, resolution: 12 } },
    { id: 'r4k7', type: 'resistor', x: 260, y: 180, rotation: 0, props: { ohms: 4700 } },
  ],
  wires: [
    w('dsb1', ['ds', 'VDD'], ['pico', '3.3V'], RED),
    w('dsb2', ['ds', 'GND'], ['pico', 'GND.4'], BLACK),
    w('dsb3', ['ds', 'DQ'], ['pico', 'GP4'], YELLOW),
    w('dsb4', ['r4k7', '1'], ['ds', 'DQ'], YELLOW),
    w('dsb5', ['r4k7', '2'], ['pico', '3.3V'], RED),
  ],
}

/**
 * The published sysfs program, transliterated.
 *
 *   os.system('modprobe w1-gpio' / 'w1-therm')  — DELETED. Those load LINUX
 *                                                 kernel modules, and so does
 *                                                 the `dtoverlay=w1-gpio` line
 *                                                 the Procedure adds to
 *                                                 /boot/config.txt. A
 *                                                 microcontroller has no kernel:
 *                                                 `onewire` and `ds18x20` are
 *                                                 frozen into the firmware and
 *                                                 the protocol is bit-banged on
 *                                                 GP4 by the interpreter itself.
 *   glob('/sys/bus/w1/devices/28*')[0]          → ds.scan(), which is a real
 *                                                 SEARCH ROM on the wire rather
 *                                                 than a directory listing
 *   open(device_file).readlines()               → ds.convert_temp() +
 *                                                 ds.read_temp(rom)
 *   while lines[0][-3:] != 'YES'                — the CRC retry. The driver
 *                                                 checks the scratchpad CRC
 *                                                 itself and raises, so the
 *                                                 retry becomes the try/except
 *                                                 the loop already needs.
 *
 * THE 750 ms IS NOT A GUESS AND NOT A COURTESY SLEEP. It is tCONV at 12-bit
 * resolution from the DS18B20 datasheet, and the device model enforces it: read
 * the scratchpad early and you get the PREVIOUS conversion, which is what the
 * silicon does. The published code never waits because the kernel driver was
 * doing it out of sight.
 *
 * THE DEGREE SIGN IS REAL, and it is here on purpose. The published listing
 * prints `°C` and `°F`; those are two bytes of UTF-8 each (`c2 b0`), and until
 * both directions of the emulated USB link were made UTF-8 the output arrived as
 * `Â°C`. It is printed here rather than flattened to "C" because a student
 * comparing the lab sheet against their own console should find the same
 * characters, and because it is the one line in this file that would break
 * again if the serial path ever went back to decoding bytes as characters.
 */
export const DS18B20_RPI_SCRIPT = [
  'from machine import Pin',
  'import onewire, ds18x20, time',
  '',
  '# The bus is GP4 with the published circuit\'s 4.7 kOhm pull-up to 3V3. There',
  '# is no modprobe and no dtoverlay: onewire/ds18x20 are frozen into this',
  '# firmware and the timing slots are bit-banged by the interpreter.',
  'ds = ds18x20.DS18X20(onewire.OneWire(Pin(4)))',
  '',
  'roms = ds.scan()',
  'print("Found %d DS18B20 device(s) on GP4." % len(roms))',
  'for rom in roms:',
  '    print("  ROM code: " + "".join("%02x" % b for b in rom))',
  'if not roms:',
  '    print("Nothing answered the 1-Wire reset.")',
  '    print("Check DQ on GP4 and the 4.7k pull-up from DQ to 3V3.")',
  '',
  'while roms:',
  '    try:',
  '        ds.convert_temp()',
  '        time.sleep_ms(750)      # tCONV at 12-bit resolution, per the datasheet',
  '        for rom in roms:',
  '            c = ds.read_temp(rom)',
  '            print("Temperature: %.3f °C  |  %.3f °F" % (c, c * 9 / 5 + 32))',
  '    except Exception as e:',
  '        # A failed CRC is what the published code\'s "YES" retry was waiting on.',
  '        print("Read failed (%s) - retrying" % e)',
  '    time.sleep(1)',
].join('\n')

// ─── Experiment 09 — motor-control-rpi ────────────────────────────────────────

/**
 * An L298N driving a DC motor, and a 28BYJ-48 stepped through a ULN2003.
 *
 * TWO DEPARTURES FROM THE PUBLISHED CIRCUIT, both forced by the board and both
 * recorded here and in model/examples.ts rather than quietly fudged.
 *
 *   GPIO23 AND GPIO24 ARE NOT ON A PICO'S HEADER. GP23/GP24/GP25 exist on the
 *   die but are wired to on-board functions and are not brought out (see
 *   makePico() in model/parts.ts — the header stops at GP22 and resumes at
 *   GP26). IN1 and IN2 therefore move to GP19 and GP20, the two pads
 *   immediately after GP18, so ENA/IN1/IN2 remain three consecutive header
 *   pins. ENA keeps the published GPIO18, and the stepper keeps GPIO 17, 27, 22
 *   and 5 verbatim — all four exist here.
 *
 *   THERE IS NO 12 V SUPPLY. The part library has no bench supply and the only
 *   rail on this board above 3.3 V is VBUS, the `5V` pad. That clears both of
 *   the L298N's requirements — VSS wants 4.5–7 V, VS wants at least VIH + 2.5 —
 *   and it makes the driver's real cost visible: two transistors in series drop
 *   about 2.55 V, so the motor sees roughly 2.44 V of the 5 V it is fed. A limp
 *   motor here is the L298N, not a defect.
 *
 * The stepper's common tap and the ULN2003's COM both go to the same 5 V pad:
 * COM is the flyback diodes' cathode rail and has to sit at the coil supply or
 * the diodes conduct in normal operation. Both grounds are wired to the Pico's
 * — an L298N or a ULN2003 that does not share a ground with the MCU has no
 * reference for what a logic high is, and both models say so by doing nothing.
 */
export const MOTOR_CONTROL_RPI: CircuitDoc = {
  parts: [
    { id: 'pico', type: 'raspberry_pi_pico', x: 60, y: 40, rotation: 0, props: {} },
    { id: 'l298n', type: 'l298n', x: 240, y: 40, rotation: 0, props: {} },
    { id: 'motor', type: 'dc_motor', x: 450, y: 40, rotation: 0, props: { load: 0 } },
    { id: 'uln', type: 'uln2003', x: 240, y: 220, rotation: 0, props: {} },
    { id: 'stepper', type: 'stepper_28byj48', x: 420, y: 220, rotation: 0, props: {} },
  ],
  wires: [
    // L298N supplies. Both screws come off VBUS: see the header above.
    w('mc1', ['l298n', 'VS'], ['pico', '5V'], RED),
    w('mc2', ['l298n', 'VSS'], ['pico', '5V'], RED),
    w('mc3', ['l298n', 'GND'], ['pico', 'GND.5'], BLACK),
    // Logic: ENA on the published GPIO18, IN1/IN2 moved to GP19/GP20.
    w('mc4', ['l298n', 'ENA'], ['pico', 'GP18'], BLUE),
    w('mc5', ['l298n', 'IN1'], ['pico', 'GP19'], GREEN),
    w('mc6', ['l298n', 'IN2'], ['pico', 'GP20'], GREEN),
    // Channel A's output pair to the motor.
    w('mc7', ['l298n', 'OUT1'], ['motor', '1'], YELLOW),
    w('mc8', ['l298n', 'OUT2'], ['motor', '2'], YELLOW),
    // ULN2003: the four published step pins, its own ground, and COM at the
    // coil supply so the flyback diodes are reverse-biased while the motor runs.
    w('mc9', ['uln', 'IN1'], ['pico', 'GP17'], GREEN),
    w('mc10', ['uln', 'IN2'], ['pico', 'GP27'], GREEN),
    w('mc11', ['uln', 'IN3'], ['pico', 'GP22'], GREEN),
    w('mc12', ['uln', 'IN4'], ['pico', 'GP5'], GREEN),
    w('mc13', ['uln', 'GND'], ['pico', 'GND.6'], BLACK),
    w('mc14', ['uln', 'COM'], ['pico', '5V'], RED),
    // The motor's five leads: common tap to 5 V, four phases to the sinks.
    w('mc15', ['stepper', 'COM'], ['pico', '5V'], RED),
    w('mc16', ['uln', 'OUT1'], ['stepper', 'A'], YELLOW),
    w('mc17', ['uln', 'OUT2'], ['stepper', 'B'], YELLOW),
    w('mc18', ['uln', 'OUT3'], ['stepper', 'C'], YELLOW),
    w('mc19', ['uln', 'OUT4'], ['stepper', 'D'], YELLOW),
  ],
}

/**
 * The published RPi.GPIO program, transliterated.
 *
 *   GPIO.setmode(GPIO.BCM)                  — gone; a Pico has only GP numbers
 *   GPIO.setup(p, GPIO.OUT)                 → Pin(p, Pin.OUT)
 *   GPIO.PWM(ENA, 1000); pwm.start(0)       → PWM(Pin(18)); freq(1000);
 *                                             duty_u16(0)
 *   pwm.ChangeDutyCycle(percent)            → duty_u16(percent * 65535 // 100).
 *                                             RPi.GPIO takes 0–100, the RP2040's
 *                                             PWM slice takes a 16-bit compare
 *                                             value; the arithmetic is the whole
 *                                             difference.
 *   GPIO.cleanup()                          — no equivalent, and release() below
 *                                             does the part that MATTERS on a
 *                                             bench: a stepper left energised
 *                                             holds its position by dissipating
 *                                             about 400 mW in one winding and
 *                                             gets hot doing nothing.
 *
 * THE HALF-STEP RING IS THE PUBLISHED ONE AND IT IS CORRECT. Written out as the
 * listing has it, the eight rows are A+D, A, A+B, B, B+C, C, C+D, D — the same
 * cycle as HALF_STEP_SEQUENCE in lib/simulator/devices.ts, entered one position
 * further round. Consecutive rows differ in exactly ONE bit, which is why the
 * four separate `Pin.value()` writes inside a step can never produce a pattern
 * that is off the ring: whichever order they land in, the intermediate states
 * are the row you left and the row you are entering. StepTracker REFUSES an
 * off-ring pattern (0b1010 energises two coils wound in opposition, so a real
 * rotor feels no net field), so this is not a detail the model would forgive.
 *
 * ONE CHANGE OF SUBSTANCE. The listing rebuilds the pattern from row zero on
 * every call, so a second `step()` jumps from wherever the first one stopped
 * back to row zero — up to four ring positions in one go, which a real motor
 * meets as a lurch or a lost step and which the model counts as a sequence
 * error. Walking a persistent `phase` index ±1 is what makes a run of steps
 * reversible, and it is what turns the published `step(512)` into a shaft angle
 * that can be checked: 4096 half-steps to one output revolution, so 1024 of
 * them is exactly 90°.
 */
export const MOTOR_CONTROL_RPI_SCRIPT = [
  'from machine import Pin, PWM',
  'import time',
  '',
  '# -- DC motor, L298N channel A -------------------------------------------',
  '# GPIO23/24 in the published circuit are not brought out on a Pico header, so',
  '# IN1/IN2 move to GP19/GP20. ENA keeps the published GPIO18.',
  'ENA, IN1, IN2 = 18, 19, 20',
  '',
  'in1 = Pin(IN1, Pin.OUT, value=0)',
  'in2 = Pin(IN2, Pin.OUT, value=0)',
  'ena = PWM(Pin(ENA))',
  'ena.freq(1000)              # GPIO.PWM(ENA, 1000)',
  'ena.duty_u16(0)             # pwm.start(0)',
  '',
  'def speed(percent):',
  '    """RPi.GPIO takes 0-100; an RP2040 PWM slice takes a 16-bit compare."""',
  '    ena.duty_u16(percent * 65535 // 100)',
  '',
  'def motor_forward(percent):',
  '    in1.value(1)            # current leaves OUT1, returns through OUT2',
  '    in2.value(0)',
  '    speed(percent)',
  '',
  'def motor_reverse(percent):',
  '    in1.value(0)',
  '    in2.value(1)',
  '    speed(percent)',
  '',
  'def motor_stop():',
  '    speed(0)                # pwm.ChangeDutyCycle(0)',
  '    in1.value(0)',
  '    in2.value(0)',
  '',
  '# -- Stepper, 28BYJ-48 through a ULN2003 ---------------------------------',
  'STEP_PINS = (17, 27, 22, 5)   # the published GPIO numbers, all four on the header',
  'step = [Pin(p, Pin.OUT, value=0) for p in STEP_PINS]',
  '',
  '# The published half-step ring: A+D, A, A+B, B, B+C, C, C+D, D. Consecutive',
  '# rows differ in one bit, which is what makes it a half-step sequence and not',
  '# just eight patterns.',
  'SEQ = ((1, 0, 0, 1), (1, 0, 0, 0), (1, 1, 0, 0), (0, 1, 0, 0),',
  '       (0, 1, 1, 0), (0, 0, 1, 0), (0, 0, 1, 1), (0, 0, 0, 1))',
  '',
  '# 8 half-steps per electrical cycle x 8 cycles per motor revolution x the',
  "# 28BYJ-48's 64:1 gearbox = 4096 half-steps at the OUTPUT shaft.",
  'HALF_STEPS_PER_REV = 4096',
  '',
  '# Start on a SINGLE-coil row (rows 1, 3, 5, 7 energise one winding; the even',
  '# ones energise two). Four Pin.value() calls happen one after another, so',
  '# entering a two-coil row from rest means the shaft briefly sits on the',
  "# one-coil row in between - a real half-step, and the model counts it. From a",
  '# single-coil row, exactly one bit changes and the origin is clean.',
  'phase = 1',
  '',
  'def energise(idx):',
  '    row = SEQ[idx]',
  '    for i in range(4):',
  '        step[i].value(row[i])',
  '',
  'def rotate(half_steps, delay_ms=2):',
  '    """Walk the ring one position per step, so a run is reversible."""',
  '    global phase',
  '    d = 1 if half_steps > 0 else -1',
  '    for _ in range(abs(half_steps)):',
  '        phase = (phase + d) % 8',
  '        energise(phase)',
  '        time.sleep_ms(delay_ms)',
  '',
  'def release():',
  '    """A stepper left energised holds position by getting hot - about 400 mW',
  '    in one winding. GPIO.cleanup() did this by accident; here it is on',
  '    purpose."""',
  '    global phase',
  '    # Park on a single-coil row first. Dropping two coils means writing them',
  '    # one at a time, and the pattern in between is a legal half-step the rotor',
  '    # really does follow - so leaving from a two-coil row nudges the shaft one',
  '    # half-step on the way to nowhere.',
  '    if sum(SEQ[phase]) > 1:',
  '        phase = (phase + 1) % 8',
  '        energise(phase)',
  '        time.sleep_ms(2)',
  '    for p in step:',
  '        p.value(0)',
  '',
  'print("L298N: ENA=GP18 IN1=GP19 IN2=GP20   ULN2003: IN1-IN4 = GP17, GP27, GP22, GP5")',
  '',
  '# Energise the starting row and let the rotor settle on it. Position is',
  '# measured from the first pattern the coils are given, so without this the',
  '# first commanded half-step defines zero instead of counting as one.',
  'energise(phase)',
  'time.sleep_ms(20)',
  '',
  'while True:',
  '    for duty in (40, 70, 100):',
  '        motor_forward(duty)',
  '        print("DC motor: forward, ENA duty %d%% at 1 kHz" % duty)',
  '        time.sleep(1)',
  '    motor_stop()',
  '    print("DC motor: stopped")',
  '    time.sleep(1)',
  '',
  '    motor_reverse(70)',
  '    print("DC motor: reverse, ENA duty 70% at 1 kHz")',
  '    time.sleep(2)',
  '    motor_stop()',
  '    print("DC motor: stopped")',
  '',
  '    quarter = HALF_STEPS_PER_REV // 4',
  '    print("Stepper: %d half-steps forward = %.1f degrees"',
  '          % (quarter, 360.0 * quarter / HALF_STEPS_PER_REV))',
  '    rotate(quarter)',
  '    print("Stepper: %d half-steps back to zero" % quarter)',
  '    rotate(-quarter)',
  '    release()',
  '    print("Stepper: coils off, shaft free")',
  '    time.sleep(1)',
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
 * ASCII HERE, THOUGH NO LONGER BECAUSE IT HAS TO BE. This note used to read
 * "ASCII only, deliberately", because the CDC link decoded a byte as a
 * character in both directions and anything above 0x7F arrived as mojibake.
 * That defect is fixed — pico/engine.ts now encodes the script as UTF-8 on the
 * way in and decodes the console as UTF-8, streaming, on the way out, and
 * ds18b20-rpi prints a real degree sign to prove it. These two scripts keep
 * "C" and "->" because the canonical widget they mirror prints exactly that,
 * and matching the text a student is comparing against is worth more than the
 * typography.
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
  'ds18b20-rpi': {
    slug: 'ds18b20-rpi',
    title: 'DS18B20 Temperature Sensor with Raspberry Pi',
    doc: DS18B20_RPI,
    script: DS18B20_RPI_SCRIPT,
  },
  'motor-control-rpi': {
    slug: 'motor-control-rpi',
    title: 'DC Motor & Stepper Motor Control with Raspberry Pi',
    doc: MOTOR_CONTROL_RPI,
    script: MOTOR_CONTROL_RPI_SCRIPT,
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
