/**
 * The 16x2 character LCD, proved from the wire to the pixels.
 *
 * WHAT WOULD MAKE THIS FILE WORTHLESS. A display is a part whose whole output is
 * a data structure, so it is unusually easy to test in a way that proves
 * nothing: call the decoder directly, hand it the bytes you already know the
 * answer to, and watch it agree with you. That test passes whether or not a
 * single volt ever reaches the part, and this project has shipped exactly that
 * shape of green tick twice (see prop-reachability.ts for both).
 *
 * So nothing here calls the decoder. Every assertion below runs a REAL SKETCH:
 * C++ compiled by the WebAssembly toolchain, loaded into SimulationEngine,
 * executing on avr8js, toggling pins that become Norton stamps, solved by the
 * MCA solver, and read back off the solved node voltages by HD44780Display. The
 * chain has no shortcut in it and no interception of any library call — the
 * sketches bit-bang the HD44780 protocol with digitalWrite(), which is byte for
 * byte and edge for edge what Arduino's LiquidCrystal emits.
 *
 * FOUR THINGS MAKE THE NUMBERS REAL RATHER THAN CAPTURED:
 *
 *   1. THE TEXT IS THE SKETCH'S. `text0` is compared against the string literal
 *      in the C++ above it, padded to 16 the way the DDRAM pads it. Nothing in
 *      the simulator can produce that string except by decoding the writes.
 *
 *   2. THE PIXELS ARE CHECKED AS PIXELS. Group B renders the reported display
 *      memory through lcdGlyph() — the very function CircuitCanvas paints from —
 *      and compares it to dot art written out by hand here. A decoder that got
 *      the right characters into the wrong cells, or a renderer wired to the
 *      wrong half of the report, fails this and only this.
 *
 *   3. THE ANALOG SIDE IS DERIVED, NOT OBSERVED. The contrast trimmer's wiper
 *      voltage, the LCD driving voltage that follows from it, and the backlight
 *      current through the module's own ballast are each worked out in the
 *      comments from the divider and the diode equation, and then required.
 *
 *   4. EVERY BEHAVIOURAL CLAIM HAS A NEGATIVE HALF. Display-off must keep the
 *      text in memory while showing nothing. A read cycle must be counted AND
 *      change nothing. The contrast at one end must blank a screen whose DDRAM
 *      is unchanged, and at the other must fill every cell.
 *
 * Run: npx tsx lib/simulator/__tests__/lcd.test.ts
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CircuitCanvas } from '../../../components/simulator/CircuitCanvas'
import { compileSketch } from '../avr/build'
import { SimulationEngine, parseIntelHex } from '../engine'
import {
  LCD_GLYPH_COLS,
  LCD_GLYPH_ROWS,
  lcdGlyph,
  lcdRowText,
  unpackLcdRow,
} from '../lcd-font'
import { compile } from '../model/compile'
import type { CircuitDoc, DocWire } from '../model/document'
import { LCD1602_SCREEN, PALETTE, PART_LIBRARY, getPart } from '../model/parts'
import { propReachability } from '../model/prop-reachability'
import type { DeviceState } from '../behavioural'

// ─── Harness ──────────────────────────────────────────────────────────────────

interface Row {
  group: string
  name: string
  expected: string
  actual: string
  pass: boolean
}
const rows: Row[] = []
let currentGroup = ''
function group(g: string): void {
  currentGroup = g
}
function truth(name: string, pass: boolean, expected: string, actual: string): void {
  rows.push({ group: currentGroup, name, expected, actual, pass })
}
function eq(name: string, actual: unknown, expected: unknown): void {
  truth(name, String(actual) === String(expected), String(expected), String(actual))
}
function near(name: string, actual: number, expected: number, tol: number): void {
  truth(name, Math.abs(actual - expected) <= tol, `${expected} ±${tol}`, actual.toPrecision(5))
}

function wire(id: string, a: string, ap: string, b: string, bp: string): DocWire {
  return { id, from: { partId: a, pinId: ap }, to: { partId: b, pinId: bp }, color: '#2563eb' }
}

/** The reported state of the display, or an empty record if it never reported. */
function lcd(engine: SimulationEngine): DeviceState {
  return engine.snapshot().deviceStates['lcd'] ?? {}
}

const str = (s: DeviceState, k: string): string => String(s[k] ?? '')
const n = (s: DeviceState, k: string): number => (typeof s[k] === 'number' ? s[k] : NaN)

/**
 * Render one packed DDRAM row exactly as CircuitCanvas does.
 *
 * Same source data (the `row0`/`row1` the engine reported), same lookup
 * (lcdGlyph), same bit order. What differs is only the paint: `#` here, an SVG
 * path there. A change that broke the canvas's understanding of the report
 * breaks this too.
 */
function renderCells(hex: string, count: number): string[] {
  const codes = unpackLcdRow(hex).slice(0, count)
  const lines: string[] = []
  for (let r = 0; r < LCD_GLYPH_ROWS; r++) {
    let line = ''
    for (let i = 0; i < codes.length; i++) {
      const cols = lcdGlyph(codes[i])
      if (i > 0) line += ' '
      for (let c = 0; c < LCD_GLYPH_COLS; c++) line += (cols[c] >> r) & 1 ? '#' : '.'
    }
    lines.push(line)
  }
  return lines
}

// ─── The circuit ──────────────────────────────────────────────────────────────

/**
 * THE WIRING FROM THE ARDUINO "HELLO WORLD" LCD TUTORIAL, unchanged.
 *
 * RS to 12, E to 11, D4-D7 to 5/4/3/2 is the pinout every 1602 tutorial on
 * earth uses and the one `LiquidCrystal lcd(12, 11, 5, 4, 3, 2)` names. R/W goes
 * to ground because the library never reads. The contrast trimmer is a real
 * 10 kΩ potentiometer across the rail with its wiper on V0, which is what makes
 * the analog assertions in group A and group D possible at all.
 *
 * `position: 84` is not arbitrary. compile() splits the track at the wiper, and
 * with pin 1 on 5 V and pin 3 on ground the wiper sits at 5 x (1 − 0.84) =
 * 0.80 V — the middle of the range a real trimmer is set to. The LCD driving
 * voltage is therefore VDD − V0 = 4.20 V, which is exactly the figure the
 * module's datasheet prints as typical.
 */
function circuit(potPosition = 84): CircuitDoc {
  return {
    parts: [
      { id: 'uno', type: 'arduino_uno', x: 0, y: 260, rotation: 0, props: {} },
      { id: 'lcd', type: 'lcd1602', x: 300, y: 0, rotation: 0, props: {} },
      {
        id: 'pot',
        type: 'potentiometer',
        x: 300, y: 160, rotation: 0,
        props: { position: potPosition },
      },
    ],
    wires: [
      wire('w1', 'lcd', 'VSS', 'uno', 'GND.1'),
      wire('w2', 'lcd', 'VDD', 'uno', '5V'),
      wire('w3', 'lcd', 'RW', 'uno', 'GND.2'),
      wire('w4', 'lcd', 'RS', 'uno', 'D12'),
      wire('w5', 'lcd', 'E', 'uno', 'D11'),
      wire('w6', 'lcd', 'D4', 'uno', 'D5'),
      wire('w7', 'lcd', 'D5', 'uno', 'D4'),
      wire('w8', 'lcd', 'D6', 'uno', 'D3'),
      wire('w9', 'lcd', 'D7', 'uno', 'D2'),
      wire('w10', 'lcd', 'A', 'uno', '5V'),
      wire('w11', 'lcd', 'K', 'uno', 'GND.3'),
      wire('w12', 'pot', '1', 'uno', '5V'),
      wire('w13', 'pot', '3', 'lcd', 'VSS'),
      wire('w14', 'pot', '2', 'lcd', 'V0'),
    ],
  }
}

/** The same circuit with R/W on a pin the sketch can drive, for group E. */
function circuitWithRW(): CircuitDoc {
  const doc = circuit()
  doc.wires = doc.wires.map((w) =>
    w.id === 'w3' ? wire('w3', 'lcd', 'RW', 'uno', 'D10') : w,
  )
  return doc
}

/** An 8-bit wiring: LCD D0-D7 on Uno D2-D9, RS on 12, E on 11, R/W grounded. */
function circuit8Bit(): CircuitDoc {
  const doc = circuit()
  doc.wires = doc.wires.filter((w) => !['w6', 'w7', 'w8', 'w9'].includes(w.id))
  for (let k = 0; k < 8; k++) {
    doc.wires.push(wire(`d${k}`, 'lcd', `D${k}`, 'uno', `D${k + 2}`))
  }
  return doc
}

// ─── The sketches ─────────────────────────────────────────────────────────────

/**
 * The 4-bit driver, hand-written so that NO library sits between the sketch and
 * the pins.
 *
 * Every line of it is what LiquidCrystal does, in the order LiquidCrystal does
 * it. `pulseEnable` reproduces its 1 µs setup / 1 µs pulse / 100 µs settle;
 * `write4` puts the nibble on D4-D7 low bit first; and the opening
 * 0x03/0x03/0x03/0x02 with its 4500/4500/150 µs waits is verbatim the reset
 * sequence out of the HD44780 datasheet's own 4-bit initialisation flowchart.
 *
 * Writing it by hand rather than calling the library is deliberate and is the
 * point: the toolchain here has no LiquidCrystal in it, and even if it did, a
 * test that leant on the library would be testing the library. What the decoder
 * has to cope with is a sequence of EDGES, and this produces exactly the
 * sequence real hardware sees.
 */
const DRIVER_4BIT = `
const int RS = 12, EN = 11, DB4 = 5, DB5 = 4, DB6 = 3, DB7 = 2;

void pulseEnable() {
  digitalWrite(EN, LOW);  delayMicroseconds(1);
  digitalWrite(EN, HIGH); delayMicroseconds(1);
  digitalWrite(EN, LOW);  delayMicroseconds(100);
}

void write4(uint8_t v) {
  digitalWrite(DB4, (v >> 0) & 1);
  digitalWrite(DB5, (v >> 1) & 1);
  digitalWrite(DB6, (v >> 2) & 1);
  digitalWrite(DB7, (v >> 3) & 1);
  pulseEnable();
}

void send(uint8_t value, uint8_t mode) {
  digitalWrite(RS, mode);
  write4(value >> 4);
  write4(value);
}

void cmd(uint8_t v) { send(v, LOW); }
void put(uint8_t v) { send(v, HIGH); }
void say(const char *s) { while (*s) put(*s++); }

void begin4bit() {
  pinMode(RS, OUTPUT); pinMode(EN, OUTPUT);
  pinMode(DB4, OUTPUT); pinMode(DB5, OUTPUT);
  pinMode(DB6, OUTPUT); pinMode(DB7, OUTPUT);
  delay(50);
  digitalWrite(RS, LOW); digitalWrite(EN, LOW);
  write4(0x03); delayMicroseconds(4500);
  write4(0x03); delayMicroseconds(4500);
  write4(0x03); delayMicroseconds(150);
  write4(0x02);
  cmd(0x28);
  cmd(0x08);
  cmd(0x01); delay(2);
  cmd(0x06);
  cmd(0x0C);
}
`

/** Experiment 4's readout, on the glass instead of the serial monitor. */
const SKETCH_FLOW = `${DRIVER_4BIT}
void setup() {
  begin4bit();
  say("Flow: 12.00 L/m");
  cmd(0xC0);
  say("Total: 3.5 L");
}
void loop() {}
`

/**
 * The same driver, stepping through one instruction per 200 ms so the test can
 * watch each one land. Stage numbers are asserted against in group E.
 */
const SKETCH_STAGES = `${DRIVER_4BIT}
const int RW = 10;

void readProbe() {
  digitalWrite(RW, HIGH);
  digitalWrite(RS, LOW);
  pulseEnable();
  pulseEnable();
  digitalWrite(RW, LOW);
}

void setup() {
  pinMode(RW, OUTPUT); digitalWrite(RW, LOW);
  begin4bit();
  say("Flow: 12.00 L/m");
  cmd(0xC0);
  say("Total: 3.5 L");
}

int stage = 0;

void loop() {
  delay(200);
  switch (stage) {
    case 0: cmd(0x18); break;
    case 1: cmd(0x08); break;
    case 2: cmd(0x0C); break;
    case 3: readProbe(); break;
    case 4: cmd(0x01); delay(2); break;
    case 5: cmd(0x80 | 0x27); say("AB"); break;
    case 6: cmd(0x0F); break;
  }
  stage++;
}
`

/** Eight data lines, one E pulse per byte. */
const SKETCH_8BIT = `
const int RS = 12, EN = 11;
const int DB[8] = {2, 3, 4, 5, 6, 7, 8, 9};

void pulseEnable() {
  digitalWrite(EN, LOW);  delayMicroseconds(1);
  digitalWrite(EN, HIGH); delayMicroseconds(1);
  digitalWrite(EN, LOW);  delayMicroseconds(100);
}

void send(uint8_t v, uint8_t mode) {
  digitalWrite(RS, mode);
  for (int i = 0; i < 8; i++) digitalWrite(DB[i], (v >> i) & 1);
  pulseEnable();
}

void cmd(uint8_t v) { send(v, LOW); }
void put(uint8_t v) { send(v, HIGH); }
void say(const char *s) { while (*s) put(*s++); }

void setup() {
  pinMode(RS, OUTPUT); pinMode(EN, OUTPUT);
  for (int i = 0; i < 8; i++) pinMode(DB[i], OUTPUT);
  delay(50);
  cmd(0x38); delayMicroseconds(4500);
  cmd(0x38); delayMicroseconds(150);
  cmd(0x38);
  cmd(0x08);
  cmd(0x01); delay(2);
  cmd(0x06);
  cmd(0x0C);
  say("8-BIT OK");
}
void loop() {}
`

async function build(source: string): Promise<string | null> {
  const r = await compileSketch(source, 'arduino_uno')
  if (r.ok) return r.hex
  console.error(r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n'))
  return null
}

async function main() {
  // ════════════════════════════════════════════════════════════════════════════
  group('A. A compiled sketch writes to the glass, through the solver')
  // ════════════════════════════════════════════════════════════════════════════
  const flowHex = await build(SKETCH_FLOW)
  truth('the 4-bit driver sketch compiles', flowHex !== null, 'ok', flowHex ? 'ok' : 'FAILED')
  if (!flowHex) {
    report()
    return
  }

  const doc = circuit()
  const compiled = compile(doc)

  eq('the circuit has no wiring problems', compiled.problems.join(' | '), '')
  eq('...and one behavioural part, the display', compiled.behavioural.map((b) => b.protocol).join(','), 'hd44780')
  eq('...which drives nothing: it is a monitor, not a sensor',
    Object.keys(compiled.behavioural[0].ports).length, 0)
  eq('...and all sixteen pins reached a net', Object.keys(compiled.behavioural[0].nets).length, 16)

  const engine = new SimulationEngine(parseIntelHex(flowHex), doc)
  engine.run(300_000)
  const a = lcd(engine)

  /**
   * THE ASSERTION THIS WHOLE FILE EXISTS FOR.
   *
   * "Flow: 12.00 L/m" is fifteen characters, and the sixteenth cell still holds
   * the space a clear-display instruction put there — so the padding is the
   * DDRAM's, not this test's.
   */
  eq('row 0 reads what the sketch printed', str(a, 'text0'), 'Flow: 12.00 L/m ')
  eq('row 1 too, after a set-DDRAM-address to 0x40', str(a, 'text1'), 'Total: 3.5 L    ')

  /**
   * WRITES, COUNTED BY HAND: four bytes of reset sequence (0x30 0x30 0x30 0x20,
   * latched in 8-bit mode because that is the mode a reset leaves the part in),
   * five configuration commands (0x28 0x08 0x01 0x06 0x0C), fifteen characters,
   * one set-address to 0xC0, twelve more characters. 4 + 5 + 15 + 1 + 12 = 37.
   */
  eq('37 byte transfers, every one of them a write', n(a, 'writes'), 37)
  eq('...and no reads at all — R/W is grounded', n(a, 'reads'), 0)

  eq('the function set put it in 4-bit mode', n(a, 'busWidth'), 4)
  eq('...2-line mode', n(a, 'lines'), 2)
  eq('the display-on instruction was seen', a.on, true)
  eq('...and the cursor was left off', a.cursor, false)
  eq('the address counter is where the 12th character left it', `${n(a, 'cursorRow')},${n(a, 'cursorCol')}`, '1,12')

  /**
   * THE ANALOG HALF, derived rather than observed.
   *
   * The trimmer is a 10 kΩ track split at 84 %: 8.4 kΩ from 5 V to the wiper and
   * 1.6 kΩ from the wiper to ground, so V0 = 5 x 1.6/10 = 0.800 V and the LCD
   * driving voltage VDD − V0 is 4.200 V. (The display's own V0 input is 5 MΩ, so
   * it moves the divider by 0.3 mV — below the tolerance below, which is why it
   * can be a high impedance rather than an ideal open.)
   */
  near('VDD − V0 is the datasheet-typical 4.20 V', n(a, 'bias'), 4.2, 0.01)
  eq('...which is full contrast', n(a, 'contrast'), 1)
  eq('...and not enough bias to show the un-driven segments', n(a, 'blocks'), 0)
  near('the supply is the Uno 5 V rail', n(a, 'supplyVolts'), 5, 0.001)

  /**
   * THE BACKLIGHT, also derived. A is on 5 V and K on ground, so the whole rail
   * is across the array and its 104 Ω of ballast. Solving
   * 5 = 3.6·Vt·ln(I/3.9e-20) + 104·I gives I = 12.0 mA, and the same current
   * through a module with the ballast jumpered out would be about 240 mA — which
   * is the difference the constant in devices.ts is there to keep honest.
   */
  const snapA = engine.snapshot()
  near('the backlight draws 12 mA through the module’s own 100 Ω ballast',
    (snapA.currents['lcd.backlight'] ?? 0) * 1000, 12.0, 0.5)
  truth('...and reaches the canvas as a brightness, like any other LED',
    (snapA.ledBrightness['lcd.backlight'] ?? 0) > 0.5,
    '> 0.5', String((snapA.ledBrightness['lcd.backlight'] ?? 0).toFixed(3)))

  eq('nothing in the circuit is faulted', snapA.faults.map((f) => f.deviceId).join(','), '')

  // ════════════════════════════════════════════════════════════════════════════
  group('B. The pixels — the same lookup the canvas paints from')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * Dot art for the first four cells of row 0, written out by hand from the
   * letterforms F, l, o and w. It is compared against a render of the DISPLAY
   * MEMORY THE SKETCH WROTE, through lcdGlyph() — so a pass means the character
   * codes travelled the whole way from a digitalWrite to a lit dot in the right
   * cell.
   *
   * Row 8 is the cursor line and is blank in every glyph, which is exactly why
   * an underline cursor can be drawn on top of any character without touching
   * it.
   */
  const expectedFlow = [
    '##### .##.. ..... .....',
    '#.... ..#.. ..... .....',
    '#.... ..#.. .###. #...#',
    '###.. ..#.. #...# #...#',
    '#.... ..#.. #...# #.#.#',
    '#.... ..#.. #...# #.#.#',
    '#.... .###. .###. .#.#.',
    '..... ..... ..... .....',
  ]
  const painted = renderCells(str(a, 'row0'), 4)
  for (let r = 0; r < expectedFlow.length; r++) {
    eq(`"Flow" dot row ${r}`, painted[r], expectedFlow[r])
  }

  /**
   * A DIFFERENTIAL CHECK on top of the equality. If the renderer were fed a
   * constant — a default, a placeholder, the last thing anybody hard-coded — the
   * art above would still match by luck only if that constant happened to be
   * "Flow". Requiring the SECOND row to differ, from the same render path,
   * removes even that.
   */
  truth('row 1 paints differently from row 0 — the render follows the data',
    renderCells(str(a, 'row1'), 4).join('|') !== painted.join('|'),
    'different', renderCells(str(a, 'row1'), 4)[3])

  eq('the packed row round-trips back to the same text',
    lcdRowText(str(a, 'row0')), str(a, 'text0'))

  /**
   * The glass has to be big enough for the text. Sixteen cells at the declared
   * pitch, starting at the declared origin, must finish inside the declared
   * bezel — otherwise the last characters are painted on the module's plastic.
   */
  const g = LCD1602_SCREEN
  truth('16 columns fit inside the bezel',
    g.x + g.cols * g.cellW <= g.bezel.x + g.bezel.w,
    `≤ ${g.bezel.x + g.bezel.w}`, String(g.x + g.cols * g.cellW))
  truth('2 rows fit too',
    g.y + (g.rows - 1) * g.cellH + LCD_GLYPH_ROWS * g.dotPitchY <= g.bezel.y + g.bezel.h,
    `≤ ${g.bezel.y + g.bezel.h}`,
    (g.y + (g.rows - 1) * g.cellH + LCD_GLYPH_ROWS * g.dotPitchY).toFixed(1))

  // ════════════════════════════════════════════════════════════════════════════
  group('C. Eight-bit mode, from a sketch that never sends a nibble')
  // ════════════════════════════════════════════════════════════════════════════
  {
    const hex = await build(SKETCH_8BIT)
    truth('the 8-bit sketch compiles', hex !== null, 'ok', hex ? 'ok' : 'FAILED')
    if (hex) {
      const e8 = new SimulationEngine(parseIntelHex(hex), circuit8Bit())
      e8.run(300_000)
      const s = lcd(e8)
      eq('the function set left it in 8-bit mode', n(s, 'busWidth'), 8)
      eq('...and the text arrived one byte per E pulse', str(s, 'text0'), '8-BIT OK        ')
      /**
       * BYTES, COUNTED BY HAND: three 0x38 resets, 0x08, 0x01, 0x06, 0x0C, then
       * eight characters. 3 + 4 + 8 = 15 — and note it is fifteen where the
       * 4-bit sketch printing a longer string took 37, because a byte here is
       * one transfer rather than two.
       */
      eq('15 transfers, one per byte', n(s, 'writes'), 15)
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('D. The contrast trimmer, and what a blank screen really means')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * The trimmer is turned by editing the DOCUMENT, exactly as a student turning
   * the knob on the canvas does — and the display must SURVIVE that edit with
   * its memory intact, because the part is still the same part on the same nets.
   * (A model that was rebuilt on every prop change would blank the screen every
   * time the contrast moved. The PIR sensor shipped with precisely that defect.)
   */
  {
    // Wiper at the top of the track: V0 = 5 V, so VDD − V0 = 0 and there is no
    // bias driving the glass at all.
    engine.setDocument(circuit(0))
    engine.run(20_000)
    const dark = lcd(engine)
    eq('trimmer at VDD: nothing is driven onto the glass', n(dark, 'contrast'), 0)
    eq('...but the text is still in display memory', str(dark, 'text0'), 'Flow: 12.00 L/m ')
    eq('...and the controller still says the display is on', dark.on, true)

    // Wiper at the bottom: V0 = 0 V, the full 5 V across the panel, which shows
    // the un-driven segments as well as the driven ones.
    engine.setDocument(circuit(100))
    engine.run(20_000)
    const blocks = lcd(engine)
    /**
     * 4.9998 V rather than 5.0000, and the two-tenths of a millivolt is real:
     * potentiometerLegs() floors each leg at POT_MIN_LEG_OHMS, because a track
     * with a genuinely zero-ohm half is a short and not a trimmer. So the wiper
     * never quite reaches the rail, on the bench or here.
     */
    near('trimmer at ground: the full rail across the panel', n(blocks, 'bias'), 5, 0.01)
    near('...every cell fills in', n(blocks, 'blocks'), 1, 0.002)
    eq('...and the text is still there underneath', str(blocks, 'text0'), 'Flow: 12.00 L/m ')

    engine.setDocument(circuit(84))
    engine.run(20_000)
    eq('turning it back restores the reading', n(lcd(engine), 'contrast'), 1)

    /**
     * THE GROUND LEAD. Everything on this module returns to VSS, so pulling that
     * one wire leaves the whole part on a floating island — the supply device
     * drags its own negative terminal up to meet its positive one and there is
     * no supply across the controller at all.
     */
    const ungrounded = circuit()
    ungrounded.wires = ungrounded.wires.filter((w) => w.id !== 'w1')
    engine.setDocument(ungrounded)
    engine.run(20_000)
    const floating = lcd(engine)
    truth('with VSS unwired the controller has no supply',
      n(floating, 'supplyVolts') < 0.1, '< 0.1 V', n(floating, 'supplyVolts').toFixed(4))
    eq('...so it is not running', floating.powered, false)
    eq('...and reports nothing on the glass', str(floating, 'text0'), '                ')
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('E. The rest of the instruction set, one stage at a time')
  // ════════════════════════════════════════════════════════════════════════════
  {
    const hex = await build(SKETCH_STAGES)
    truth('the staged sketch compiles', hex !== null, 'ok', hex ? 'ok' : 'FAILED')
    if (hex) {
      const e = new SimulationEngine(parseIntelHex(hex), circuitWithRW())
      // setup() finishes well inside 200 ms; loop() then acts once per 200 ms.
      e.run(150_000)
      eq('before any shift, the text is where it was written', str(lcd(e), 'text0'), 'Flow: 12.00 L/m ')

      /**
       * SCROLL LEFT (0x18). "Shift the display left" moves the TEXT left across
       * the glass, so the window advances one character up the DDRAM: the F
       * walks off the left edge and a space arrives on the right.
       */
      e.run(200_000)
      const shifted = lcd(e)
      eq('0x18 scrolls the display left', str(shifted, 'text0'), 'low: 12.00 L/m  ')
      eq('...both lines together, because one shift register drives both', str(shifted, 'text1'), 'otal: 3.5 L     ')

      // Display off (0x08): shown or not shown is not the same question as
      // written or not written, and the model keeps them apart.
      e.run(200_000)
      const off = lcd(e)
      eq('0x08 turns the display off', off.on, false)
      eq('...without touching display memory', str(off, 'text0'), 'low: 12.00 L/m  ')

      e.run(200_000)
      eq('0x0C turns it back on with everything still there', str(lcd(e), 'text0'), 'low: 12.00 L/m  ')

      /**
       * A READ CYCLE. Two E pulses with R/W held high is how a sketch polls the
       * busy flag. The model cannot answer — it drives nothing — so the only
       * honest behaviour is to count them and change nothing, which is what is
       * required here in both halves.
       */
      const before = n(lcd(e), 'writes')
      e.run(200_000)
      const read = lcd(e)
      eq('two transfers with R/W high are counted as reads', n(read, 'reads'), 2)
      eq('...and are not decoded as writes', n(read, 'writes'), before)
      eq('...and left the glass alone', str(read, 'text0'), 'low: 12.00 L/m  ')

      // Clear display: DDRAM to spaces, counter home, and the shift undone.
      e.run(200_000)
      const cleared = lcd(e)
      eq('0x01 clears display memory', str(cleared, 'text0'), '                ')
      eq('...and line 2 with it', str(cleared, 'text1'), '                ')

      /**
       * THE ADDRESS COUNTER'S WRAP. Writing at DDRAM 0x27 — the fortieth cell of
       * line 1, forty characters off the right-hand edge of a 16-column module —
       * leaves the counter at 0x40, which is the first cell of line 2. So "AB"
       * puts the A somewhere invisible and the B at the start of the second row.
       * A model that folded the address space naively would show both, or
       * neither.
       */
      e.run(200_000)
      const wrapped = lcd(e)
      eq('a character written at 0x27 is off the visible window', str(wrapped, 'text0'), '                ')
      eq('...and the next one lands at the start of line 2', str(wrapped, 'text1'), 'B               ')

      /**
       * 0x0F is display-on with BOTH cursor bits set. They are separate control
       * bits and the canvas draws them differently — an underline for C, a
       * blinking whole cell for B — so a decoder that collapsed them into one
       * flag would pass everything above and fail here.
       */
      e.run(200_000)
      const both = lcd(e)
      eq('0x0F turns the underline cursor on', both.cursor, true)
      eq('...and the blinking block with it', both.blink, true)
      eq('...at the cell after the B', `${n(both, 'cursorRow')},${n(both, 'cursorCol')}`, '1,1')
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('F. The part is declared honestly')
  // ════════════════════════════════════════════════════════════════════════════
  {
    const def = getPart('lcd1602')
    truth('lcd1602 is in the palette', PALETTE.includes('lcd1602'), 'present', String(PALETTE.includes('lcd1602')))
    eq('...and in the library', PART_LIBRARY['lcd1602'] === def, true)
    eq('sixteen pins, in silkscreen order',
      def.pins.map((p) => p.id).join(' '),
      'VSS VDD V0 RS RW E D0 D1 D2 D3 D4 D5 D6 D7 A K')
    eq('VSS is passive, not gnd — an unwired ground has to mean something',
      def.pins.find((p) => p.id === 'VSS')?.type, 'passive')
    eq('the header is on the 0.1 inch grid',
      new Set(def.pins.map((p, i) => p.x - (def.pins[0].x + i * 10))).size, 1)

    /**
     * The part declares no props, so there is nothing for a student to turn that
     * the physics could fail to hear about — the contrast and the backlight are
     * both SOLVED. This asserts the absence rather than assuming it, because a
     * prop added later without a reader is exactly the defect
     * prop-reachability.ts exists to catch.
     */
    eq('it declares no props at all', (def.props ?? []).length, 0)
    eq('...so the reachability guard has nothing to report about it',
      propReachability().filter((r) => r.type === 'lcd1602').length, 0)

    /**
     * The three limitations, present and specific. Each names a behaviour that
     * is genuinely absent; none of them claims the engine could not do it.
     */
    const limits = compiled.limitations.filter((l) => /LCD|HD44780|R\/W|custom characters/.test(l))
    eq('three limitations are declared for the display', limits.length, 3)
    truth('...one about reads', limits.some((l) => /R\/W high is a READ/.test(l)), 'present', 'ok')
    truth('...one about CGRAM and the character ROM',
      limits.some((l) => /custom characters/.test(l)), 'present', 'ok')
    truth('...one about instruction timing',
      limits.some((l) => /37 µs/.test(l)), 'present', 'ok')
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('G. …and the canvas actually paints it')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * THE HALF THIS PROJECT HAS TWICE FAILED TO SHIP.
   *
   * Everything above proves the decoder is right. None of it would have caught
   * an LED-colour-shaped defect — a display whose state is perfect and whose
   * pixels never reach the screen, because the canvas was never handed the
   * snapshot or never read the field. So this group takes the state the ENGINE
   * REPORTED, feeds it to the real CircuitCanvas, renders it, and counts dots in
   * the resulting SVG.
   *
   * The counts are hand-derived from the CGROM table: the number of set bits in
   * the five column bytes of each glyph is the number of lit dots that must
   * appear in that cell, and no other number can be right.
   */
  {
    // A fresh engine on the flow sketch, because `engine` has been rewired
    // several times by group D and its display has been legitimately reset.
    const eG = new SimulationEngine(parseIntelHex(flowHex), doc)
    eG.run(300_000)
    const state = lcd(eG)
    const backlight = eG.snapshot().ledBrightness['lcd.backlight'] ?? 0

    const paint = (s: DeviceState): string =>
      renderToStaticMarkup(
        createElement(CircuitCanvas, {
          doc,
          dispatch: () => {},
          deviceStates: { lcd: s },
          ledBrightness: new Map([['lcd.backlight', backlight]]),
          selected: null,
          onSelect: () => {},
        }),
      )

    /** Lit dots painted in one character cell, read back out of the markup. */
    const cellDots = (html: string, row: number, col: number): number => {
      const x = LCD1602_SCREEN.x + col * LCD1602_SCREEN.cellW
      const y = LCD1602_SCREEN.y + row * LCD1602_SCREEN.cellH
      const re = new RegExp(`translate\\(${x} ${y}\\) scale\\([^)]*\\)"><path d="([^"]*)"`)
      const m = re.exec(html)
      return m ? (m[1].match(/M/g) ?? []).length : -1
    }

    /**
     * Lit dots are painted in the display's own ink colour, which nothing else
     * on the canvas uses — so counting that fill counts LCD glyph paths and not
     * the Uno's and the trimmer's own artwork, which is full of paths too.
     */
    const glyphPaths = (html: string): number => (html.match(/fill="#0b2b0b"/g) ?? []).length

    const html = paint(state)
    truth('the display group reaches the SVG', html.includes('data-testid="lcd-screen"'), 'present',
      String(html.includes('data-testid="lcd-screen"')))
    eq('one glyph path per character cell, 16 x 2 of them', glyphPaths(html), 32)

    /**
     * F is 0x7F 0x09 0x09 0x01 0x01 — 7 + 2 + 2 + 1 + 1 = 13 dots.
     * l is 0x00 0x41 0x7F 0x40 0x00 — 0 + 2 + 7 + 1 + 0 = 10.
     * A space is five zero bytes, so its cell is painted with nothing in it.
     */
    eq('cell (0,0) paints the 13 dots of an F', cellDots(html, 0, 0), 13)
    eq('cell (0,1) paints the 10 dots of an l', cellDots(html, 0, 1), 10)
    eq('cell (0,15) is a space and paints nothing', cellDots(html, 0, 15), 0)
    eq('the backlight tints the glass', /fill="rgb\(\d+ \d+ \d+\)"/.test(html), true)

    /**
     * THE DIFFERENTIAL. Identical display memory, contrast wound to zero: the
     * canvas must paint no dots at all. A renderer that ignored the solved
     * contrast — or that drew from a constant instead of from the report — is
     * the only way to pass the assertions above and fail this one.
     */
    /**
     * The two cursor bits, drawn. Group E proved they come from the sketch's own
     * 0x0F; this proves the canvas does something with each. The underline is
     * one dot row (5 dots) and the blinking cursor is the whole cell (40), so
     * their cell carries 13 + 5 + 40 = 58 dots across its three paths.
     */
    const withCursor = paint({ ...state, cursor: true, blink: true })
    eq('an underline cursor and a blinking block add two more paths',
      glyphPaths(withCursor) - glyphPaths(html), 2)
    truth('...and the blink is animated rather than stuck on',
      withCursor.includes('vlab-lcd-blink'), 'keyframes present',
      String(withCursor.includes('vlab-lcd-blink')))

    const blank = paint({ ...state, contrast: 0 })
    eq('with the trimmer at VDD the same memory paints no dots', glyphPaths(blank), 0)
    truth('...while the state it was given still holds the text',
      String(state.text0) === 'Flow: 12.00 L/m ', 'Flow: 12.00 L/m ', String(state.text0))
  }

  report()
}

function report(): void {
  const nameW = Math.min(72, Math.max(30, ...rows.map((r) => r.name.length)))
  const expW = Math.min(26, Math.max(10, ...rows.map((r) => r.expected.length)))
  const actW = Math.min(30, Math.max(10, ...rows.map((r) => r.actual.length)))

  let lastGroup = ''
  for (const r of rows) {
    if (r.group !== lastGroup) {
      lastGroup = r.group
      console.log('\n' + r.group)
      console.log('-'.repeat(Math.min(200, nameW + expW + actW + 14)))
    }
    console.log(
      `${r.name.slice(0, nameW).padEnd(nameW)}  ${r.expected.slice(0, expW).padEnd(expW)}  ` +
        `${r.actual.slice(0, actW).padEnd(actW)}  ` +
        (r.pass ? 'PASS' : '*** FAIL ***'),
    )
  }

  const failures = rows.filter((r) => !r.pass)
  console.log('\n' + '='.repeat(Math.min(200, nameW + expW + actW + 14)))
  console.log(`${rows.length - failures.length}/${rows.length} passed`)
  if (failures.length) {
    console.log('\nFAILURES')
    for (const f of failures) {
      console.log(`  [${f.group}] ${f.name}`)
      console.log(`      expected: ${f.expected}`)
      console.log(`      actual  : ${f.actual}`)
    }
  }
  process.exit(failures.length > 0 ? 1 : 0)
}

void main()
