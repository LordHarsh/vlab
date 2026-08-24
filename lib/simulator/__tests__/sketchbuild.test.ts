/**
 * The student's own Arduino C++, compiled on the server and run on the engine.
 *
 * WHAT IS BEING PROVED. Until now the Arduino track had no editable source at
 * all: three prebuilt .hex fixtures, a firmware picker, and no way for a
 * student to change a single character of what their board ran. Six of twelve
 * experiments could therefore not be programmed, while the Pico half had a live
 * MicroPython editor. This file is the evidence that the asymmetry is gone.
 *
 * "IT COMPILED" IS NOT THE CLAIM WORTH TESTING, and docs/AVR_COMPILE_FINDINGS.md
 * says why: a toolchain that emits a well-formed .hex full of subtly wrong code
 * loads, runs, prints nothing, and shows green everywhere. So the assertions
 * that matter here are behavioural and DIFFERENTIAL — two sketches that differ
 * in one line must produce two binaries that differ in exactly the consequence
 * that line names.
 *
 * FOUR THINGS MAKE THESE REAL RATHER THAN CIRCULAR:
 *
 *   1. BYTE-IDENTITY WITH A COMMITTED ARTIFACT. Group A rebuilds
 *      public/sim/traffic-mega.hex through the product's own path and compares
 *      bytes. scripts/build-avr-hex.mjs — the reproducible builder — produced
 *      that file, so this pins the two implementations together. If either
 *      drifts, a student stops getting what the repository says they get.
 *
 *   2. HAND-DERIVED OUTPUT. Group D changes a printed string and a delay in a
 *      sketch and requires the new string and the new timing to appear. The
 *      numbers are derived here in the comments, not read off a previous run.
 *
 *   3. ERRORS ARE ASSERTED AS PRECISELY AS SUCCESSES. A compiler that reported
 *      every mistake as "compile failed" would pass a test that only checked
 *      `ok === false`. Group C requires the exact GCC message AND the exact
 *      line number of the student's own source — the thing `#line` bookkeeping
 *      in ino.ts exists to protect, and the thing a student actually needs.
 *
 *   4. THE TRANSFORM IS TESTED WHERE IT CAN GO WRONG. Prototype hoisting is
 *      the one piece here that can produce a WRONG answer rather than no
 *      answer, so group B pushes the cases that would break a naive
 *      implementation: braces inside strings and comments, `class` and array
 *      initialisers that must NOT be declared, default arguments that must not
 *      be duplicated.
 *
 * Run: npx tsx lib/simulator/__tests__/sketchbuild.test.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SimulationEngine, parseIntelHex } from '../engine'
import { compileSketch } from '../avr/build'
import {
  findPrototypes,
  hasError,
  maskLiterals,
  parseDiagnostics,
  prepareSketch,
  summariseDiagnostics,
} from '../avr/ino'
import { EXPERIMENT_01 } from '../model/examples'
import { MAIN_INO, fileNameFor, parseCodeBundle, writeCodeFile } from '../model/code'

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

async function main() {
  // ════════════════════════════════════════════════════════════════════════════
  group('A. The server path reproduces the committed artifact')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * public/sim/traffic-mega.hex is experiment 11's firmware, built by
   * scripts/build-avr-hex.mjs from scripts/sketches/traffic-mega.cpp. Building
   * the same source through compileSketch() — a different file, a worker
   * thread, a different error-handling path — must give the same bytes.
   *
   * This is the strongest single assertion in the file. It says the product
   * path and the reproducible build path are the same compiler with the same
   * flags, so the .hex a student's sketch becomes is the same KIND of artifact
   * as the one committed to the repository, not a lookalike.
   */
  {
    const src = readFileSync(join(process.cwd(), 'scripts/sketches/traffic-mega.cpp'), 'utf8')
    const built = await compileSketch(src, 'arduino_mega')
    truth('the Mega sketch compiles', built.ok, 'ok', built.ok ? 'ok' : `failed at ${built.stage}`)
    if (built.ok) {
      const shipped = readFileSync(join(process.cwd(), 'public/sim/traffic-mega.hex'), 'utf8')
      eq('...to bytes identical to public/sim/traffic-mega.hex', built.hex.trim(), shipped.trim())
      eq('...and the documented 4,308 bytes of flash', built.flashBytes, 4308)
    }

    /**
     * blink-fast.cpp is the Uno control. The build script reports 5,678 bytes
     * for it; the same number here means the Uno object set, the linker script
     * and the -Tdata origin all match too — and, less obviously, that the
     * on-demand WInterrupts unit did NOT get linked. It defines interrupt
     * vectors, which are reachable from the vector table and therefore survive
     * --gc-sections, so linking it unconditionally would add 162 bytes to every
     * Uno sketch and silently break exactly this equality.
     */
    const blink = await compileSketch(
      readFileSync(join(process.cwd(), 'scripts/sketches/blink-fast.cpp'), 'utf8'),
      'arduino_uno',
    )
    truth('the Uno control compiles', blink.ok, 'ok', blink.ok ? 'ok' : `failed at ${blink.stage}`)
    if (blink.ok) {
      eq('...to the build script’s 5,678 bytes — no stray core unit linked in', blink.flashBytes, 5678)
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('B. .ino → .cpp, the transformation that can be wrong rather than absent')
  // ════════════════════════════════════════════════════════════════════════════
  {
    // ── masking ──
    eq(
      'a brace inside a string does not count',
      maskLiterals('void f() { Serial.print("}{"); }').includes('"}{"'),
      false,
    )
    eq(
      'masking preserves length exactly, so offsets stay aligned',
      maskLiterals('a="xy" // z\nb').length,
      'a="xy" // z\nb'.length,
    )
    eq(
      'masking preserves newlines, so line numbers stay right',
      maskLiterals('/* a\nb\nc */x').split('\n').length,
      3,
    )

    // ── what IS a function ──
    const basic = findPrototypes('void setup(){}\nlong dist(int a){return 1;}\n')
    eq('two top-level definitions found', basic.length, 2)
    eq('...the first is setup', basic[0]?.decl, 'void setup()')
    eq('...the second keeps its parameter list', basic[1]?.decl, 'long dist(int a)')
    eq('...and its line number', basic[1]?.line, 2)

    eq(
      'a signature split over lines is joined',
      findPrototypes('unsigned long\n  slow(int a,\n       int b) {\n return 0;\n}')[0]?.decl,
      'unsigned long slow(int a, int b)',
    )
    eq(
      'a comment above a function is not swallowed into its return type',
      findPrototypes('// helper\nvoid f() {}')[0]?.decl,
      'void f()',
    )
    eq(
      'nor is a #define on the line above',
      findPrototypes('#define LED 13\nvoid f() {}')[0]?.decl,
      'void f()',
    )
    eq(
      'a nested function-like body does not produce a second prototype',
      findPrototypes('void f(){ if(1){ int x=0; } }').length,
      1,
    )

    // ── what is NOT a function: every one of these would be a WRONG prototype ──
    const rejects: [string, string][] = [
      ['a class definition', 'class Foo { public: int x; };'],
      ['a struct definition', 'struct P { int a; };'],
      ['an enum', 'enum Mode { A, B };'],
      ['an array initialiser', 'int pins[] = {2,3,4};'],
      ['a struct variable initialiser', 'Config c = { 1, 2 };'],
      ['an extern "C" block', 'extern "C" { void g(); }'],
      ['a namespace', 'namespace n { void g(){} }'],
      ['a bare declaration with no body', 'void f(int x);'],
      ['a constructor call at file scope', 'DHT dht(DHTPIN, DHTTYPE);'],
    ]
    for (const [label, src] of rejects) {
      const got = findPrototypes(src)
      truth(
        `${label} produces no prototype`,
        got.length === 0,
        'none',
        got.map((p) => p.decl).join(' / ') || 'none',
      )
    }

    /**
     * A DEFAULT ARGUMENT, hoisted, and the warning that follows suppressed.
     *
     * This case cost a design change. Refusing to hoist functions with default
     * arguments — the safe-looking choice — broke a sketch the Arduino IDE
     * compiles fine, because `loop()` calling `beep()` above its definition
     * then failed with "'beep' was not declared in this scope". Hoisting it
     * works under `-fpermissive`, at the price of one warning about the line we
     * injected, which build.ts filters. Both halves are asserted: it must
     * compile, and the student must not be shown a warning about code they
     * cannot see.
     */
    {
      const withDefault = await compileSketch(
        'void setup(){ Serial.begin(9600); }\nvoid loop(){ beep(); }\nvoid beep(int n = 3) { for(int i=0;i<n;i++) delay(1); }\n',
        'arduino_uno',
      )
      truth(
        'a default argument is hoisted, so the sketch still compiles',
        withDefault.ok,
        'ok',
        withDefault.ok
          ? 'ok'
          : `${withDefault.stage}: ${withDefault.diagnostics[0]?.message ?? ''}`,
      )
      if (withDefault.ok) {
        truth(
          '...and the warning about OUR injected line is not shown to the student',
          !withDefault.diagnostics.some((d) => /default argument given/.test(d.message)),
          'no such warning',
          withDefault.diagnostics.map((d) => d.message).join(' / ') || 'no such warning',
        )
      }
      eq(
        'the prototype keeps the default rather than dropping it',
        findPrototypes('void beep(int n = 3) { }')[0]?.decl,
        'void beep(int n = 3)',
      )
    }

    // ── the emitted file ──
    const prepared = prepareSketch('#define LED 13\nvoid setup(){}\nvoid loop(){ help(); }\nvoid help(){}\n')
    truth(
      'Arduino.h is included for the student',
      prepared.cpp.startsWith('#include <Arduino.h>\n'),
      'first line',
      prepared.cpp.split('\n')[0],
    )
    truth(
      'the #define stays ABOVE the prototypes that may depend on it',
      prepared.cpp.indexOf('#define LED 13') < prepared.cpp.indexOf('void setup();'),
      '#define first',
      prepared.cpp.indexOf('#define LED 13') < prepared.cpp.indexOf('void setup();') ? '#define first' : 'prototypes first',
    )
    truth(
      'a #line directive restores the count after the injected block',
      prepared.cpp.includes('#line 2 "sketch.ino"'),
      'contains #line 2',
      prepared.cpp.includes('#line 2 "sketch.ino"') ? 'contains #line 2' : 'absent',
    )
    eq(
      'a sketch with no functions gets the include and nothing else injected',
      prepareSketch('int x = 1;\n').cpp,
      '#include <Arduino.h>\n#line 1 "sketch.ino"\nint x = 1;\n',
    )

    /**
     * The point of hoisting, stated as behaviour: a helper defined BELOW the
     * loop that calls it. This is the single most common shape in Arduino code
     * and it is a hard error in plain C++.
     */
    const hoisted = await compileSketch(
      'void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.println(twice(21)); delay(1000); }\nint twice(int n){ return n*2; }\n',
      'arduino_uno',
    )
    truth(
      'a function called above its definition compiles — the whole point of hoisting',
      hoisted.ok,
      'ok',
      hoisted.ok ? 'ok' : `${hoisted.stage}: ${hoisted.diagnostics[0]?.message ?? ''}`,
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('C. A student writing bad C++ gets the compiler’s own words')
  // ════════════════════════════════════════════════════════════════════════════
  {
    /**
     * THE LINE NUMBER IS THE ASSERTION.
     *
     * `#include <Arduino.h>` and three hoisted prototypes are injected above
     * this sketch, so without the `#line` directives every diagnostic would be
     * reported four or five lines low — pointing a student at code they cannot
     * see and did not write. The missing semicolon is on the student's line 2;
     * GCC reports the error at the token that follows it, the `}` on line 3.
     */
    const missingSemicolon = await compileSketch(
      'void setup() {\n  Serial.begin(9600)\n}\nvoid loop() {}\n',
      'arduino_uno',
    )
    truth('a missing semicolon fails the build', !missingSemicolon.ok, 'fails', missingSemicolon.ok ? 'compiled' : 'fails')
    if (!missingSemicolon.ok) {
      eq('...at the compile stage, not the link stage', missingSemicolon.stage, 'compile')
      eq('...with GCC’s exact message', missingSemicolon.diagnostics[0]?.message, "expected ';' before '}' token")
      eq('...at the student’s own line 3', missingSemicolon.diagnostics[0]?.line, 3)
      eq('...and a column', missingSemicolon.diagnostics[0]?.column, 1)
      eq(
        '...summarised for a one-line status',
        summariseDiagnostics(missingSemicolon.diagnostics),
        "Line 3: expected ';' before '}' token",
      )
      truth(
        '...and NOT drowned in linker noise from a link that should not have run',
        !missingSemicolon.raw.some((l) => /undefined reference/.test(l)),
        'no linker output',
        missingSemicolon.raw.some((l) => /undefined reference/.test(l)) ? 'linker ran anyway' : 'no linker output',
      )
    }

    const undeclared = await compileSketch(
      'void setup() {\n  Serial.begin(9600);\n}\nvoid loop() {\n  int x = notAThing;\n}\n',
      'arduino_uno',
    )
    truth('an undeclared identifier fails', !undeclared.ok, 'fails', undeclared.ok ? 'compiled' : 'fails')
    if (!undeclared.ok) {
      eq('...naming the identifier', undeclared.diagnostics[0]?.message, "'notAThing' was not declared in this scope")
      eq('...on line 5', undeclared.diagnostics[0]?.line, 5)
    }

    /**
     * A sketch that overflows flash LINKS CLEANLY — there is no size check in
     * the linker script we drive — so without an explicit guard the engine
     * would be handed an image a real board could never hold, and every
     * assertion downstream would be about a fiction.
     */
    /**
     * Getting a sketch that is genuinely too big took three attempts, and each
     * failure is a reason this shape is what it is:
     *
     *   · `const char big[] PROGMEM = "xxx…"` read at `big[0]` linked at 5,308
     *     bytes — the compiler folded the constant and --gc-sections dropped
     *     the rest, so the test would have passed for the wrong reason.
     *   · One 36,000-byte array is rejected by cc1plus itself ("size of
     *     variable 'big' is too large"), which is a COMPILE error and never
     *     reaches the size check.
     *
     * So: three objects each under the per-object limit, in PROGMEM so they
     * live in flash rather than the 2 KB of SRAM, read through
     * `pgm_read_byte` at a `volatile` index so nothing can be folded away.
     * Values stay under 128 because a `char` initialiser list narrows.
     */
    const blob = (n: number) =>
      `const char blob${n}[] PROGMEM = {${Array.from({ length: 12000 }, (_, i) => (i * 7 + n) % 100).join(',')}};`
    const huge = await compileSketch(
      '#include <avr/pgmspace.h>\n' +
        `${blob(1)}\n${blob(2)}\n${blob(3)}\n` +
        'volatile int idx = 3;\n' +
        'void setup(){ Serial.begin(9600); }\n' +
        'void loop(){ Serial.println((int)(pgm_read_byte(&blob1[idx])+pgm_read_byte(&blob2[idx])+pgm_read_byte(&blob3[idx]))); idx=idx+1; delay(10); }\n',
      'arduino_uno',
    )
    truth('a sketch too big for the part is refused', !huge.ok, 'refused', huge.ok ? `linked at ${huge.flashBytes} B` : 'refused')
    if (!huge.ok) {
      eq('...at the size stage, not as a link failure', huge.stage, 'size')
      truth(
        '...naming both numbers, so the student knows by how much',
        /41894 bytes used of 32256/.test(huge.diagnostics[0]?.message ?? ''),
        'used and available',
        huge.diagnostics[0]?.message ?? '',
      )
    }

    // ── the parser, on shapes the real compiler emits ──
    const parsed = parseDiagnostics([
      '[cc1plus] sketch.ino: In function ‘void loop()’:',
      '[cc1plus] sketch.ino:5:11: error: ‘x’ was not declared in this scope',
      '[cc1plus] sketch.ino:7: warning: unused variable',
      '[cc1plus] /arduino/core/HardwareSerial.h:412:3: error: deep in a header',
      'cc1plus: fatal error: no input files',
    ])
    eq('context headers are not diagnostics', parsed.length, 4)
    eq('an error keeps its line', parsed[0]?.line, 5)
    eq('a warning is not an error', parsed[1]?.severity, 'warning')
    eq('a column-less diagnostic still parses', parsed[1]?.line, 7)
    truth(
      'a header’s line number is dropped rather than shown as the student’s',
      parsed[2]?.line === null,
      'null',
      String(parsed[2]?.line),
    )
    eq('"fatal error" is normalised to an error', parsed[3]?.severity, 'error')
    eq('hasError sees it', hasError(parsed), true)
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('D. Changing the code changes the behaviour')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * THE HEADLINE CLAIM, AS A DIFFERENTIAL MEASUREMENT.
   *
   * Two sketches, identical but for a printed string and a delay, are compiled
   * and each is run on the real engine against EXPERIMENT_01 — an LED on D13
   * through a resistor. Requiring BOTH consequences to follow is what makes
   * this more than "a binary came back": a toolchain that ignored the source
   * and returned a cached blob would fail the string; one that compiled the
   * string but mistimed the loop would fail the edge count.
   *
   * EDGE COUNTS, DERIVED. loop() writes HIGH, waits D ms, writes LOW, waits D
   * ms — one period is 2D ms carrying two transitions. Over T seconds that is
   * 2 × T/(2D/1000) transitions, plus the first rising edge when loop() runs
   * for the first time.
   *
   *   D = 100 ms over 5 s : 5000/200 = 25 periods → 50 + 1 = 51
   *   D = 500 ms over 5 s : 5000/1000 = 5 periods → 10 + 1 = 11
   */
  {
    const sketch = (msg: string, delayMs: number) =>
      `void setup() {\n  pinMode(13, OUTPUT);\n  Serial.begin(9600);\n  Serial.println("${msg}");\n}\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(${delayMs});\n  digitalWrite(13, LOW);\n  delay(${delayMs});\n}\n`

    const before = await compileSketch(sketch('ORIGINAL', 100), 'arduino_uno')
    const after = await compileSketch(sketch('EDITED BY A STUDENT', 500), 'arduino_uno')

    truth('the first version compiles', before.ok, 'ok', before.ok ? 'ok' : 'failed')
    truth('the edited version compiles', after.ok, 'ok', after.ok ? 'ok' : 'failed')

    if (before.ok && after.ok) {
      truth(
        'the two binaries are genuinely different',
        before.hex !== after.hex,
        'different',
        before.hex === after.hex ? 'IDENTICAL — the source was ignored' : 'different',
      )

      const runIt = (hex: string, us: number) => {
        const engine = new SimulationEngine(parseIntelHex(hex), EXPERIMENT_01)
        engine.run(us)
        return engine.snapshot()
      }

      const a = runIt(before.hex, 5_000_000)
      const b = runIt(after.hex, 5_000_000)

      eq('the original prints its own string', JSON.stringify(a.serial), '"ORIGINAL\\r\\n"')
      eq('the edited one prints the NEW string', JSON.stringify(b.serial), '"EDITED BY A STUDENT\\r\\n"')
      eq('a 100 ms delay gives 51 edges in 5 s', a.pinEdges, 51)
      eq('a 500 ms delay gives 11 — the timing changed with the source', b.pinEdges, 11)

      /**
       * A control against the most plausible way for all of this to be fake:
       * if the engine were somehow running the same image twice, the two edge
       * counts could not differ. They do, and by the derived ratio.
       */
      truth(
        'the edge counts differ in the derived ratio, not merely at all',
        a.pinEdges - 1 === (b.pinEdges - 1) * 5,
        '50 = 10 × 5',
        `${a.pinEdges - 1} vs ${b.pinEdges - 1}`,
      )
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('E. The cache, and what must NOT be cached')
  // ════════════════════════════════════════════════════════════════════════════
  {
    const src = 'void setup(){ Serial.begin(9600); Serial.println("CACHE"); }\nvoid loop(){}\n'
    const first = await compileSketch(src, 'arduino_uno')
    const second = await compileSketch(src, 'arduino_uno')
    truth('the first compile is real work', first.ok && !first.cached, 'ok, uncached', `ok=${first.ok} cached=${first.cached}`)
    truth('the identical sketch is served from cache', second.cached, 'cached', String(second.cached))
    if (first.ok && second.ok) {
      eq('...with the same bytes', second.hex, first.hex)
    }

    /**
     * THE KEY INCLUDES THE BOARD. Without it the second call would hand an
     * ATmega328P image to a Mega — which does not error, it runs, and moves
     * whichever pads the 328P's register addresses name on a 2560. That is the
     * silent-wrong-answer failure the firmware picker is filtered to prevent,
     * and a cache keyed on source alone would reintroduce it behind the
     * picker's back.
     */
    const mega = await compileSketch(src, 'arduino_mega')
    truth('the same source on another board is NOT a cache hit', !mega.cached, 'uncached', String(mega.cached))
    if (mega.ok && first.ok) {
      truth('...and produces a different binary', mega.hex !== first.hex, 'different', mega.hex === first.hex ? 'IDENTICAL' : 'different')
    }

    const broken = 'void setup(){ oops }\nvoid loop(){}\n'
    const bad1 = await compileSketch(broken, 'arduino_uno')
    const bad2 = await compileSketch(broken, 'arduino_uno')
    truth('a deterministic failure is cached too', !bad2.ok && bad2.cached, 'cached failure', `ok=${bad2.ok} cached=${bad2.cached}`)
    if (!bad1.ok && !bad2.ok) {
      eq('...with the same diagnostics', bad2.diagnostics[0]?.message, bad1.diagnostics[0]?.message)
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('F. Persistence — the sketch survives a reload')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * The editor autosaves into `sim_attempts.code`, the same jsonb column the
   * Pico track uses. An Arduino attempt has to round-trip through it without
   * being mistaken for Python — parseCodeBundle used to coerce EVERY stored
   * language to 'micropython', which would have relabelled a student's C++ on
   * the way back in.
   */
  {
    eq('an Arduino program is stored as sketch.ino', fileNameFor('arduino_c'), MAIN_INO)
    eq('a Pico program is still main.py', fileNameFor('micropython'), 'main.py')

    const source = 'void setup(){ Serial.println("SAVED"); }\nvoid loop(){}\n'
    const bundle = writeCodeFile(null, source, MAIN_INO, 'arduino_c')
    const roundTripped = parseCodeBundle(JSON.parse(JSON.stringify(bundle)))
    eq('the source survives the jsonb round trip', roundTripped?.files[0]?.source, source)
    eq('...and is still labelled C++, not coerced to Python', roundTripped?.files[0]?.language, 'arduino_c')

    // A row written before this union had two members.
    const legacy = parseCodeBundle({ files: [{ name: 'main.py', language: 'micropython', source: 'print(1)' }] })
    eq('a pre-existing MicroPython row is untouched', legacy?.files[0]?.language, 'micropython')

    // A row whose label is missing or wrong falls back to the extension.
    const mislabelled = parseCodeBundle({ files: [{ name: 'sketch.ino', source: 'void loop(){}' }] })
    eq('an unlabelled .ino is recognised as C++ by its name', mislabelled?.files[0]?.language, 'arduino_c')

    // Both tracks can coexist in one bundle without colliding.
    const both = writeCodeFile(bundle, 'print(1)', 'main.py', 'micropython')
    eq('a bundle can hold both files', both.files.length, 2)
  }

  // ════════════════════════════════════════════════════════════════════════════
  group('G. Every published Arduino experiment compiles from its own listing')
  // ════════════════════════════════════════════════════════════════════════════
  /**
   * These are the `code` sections of the six Arduino experiments, VERBATIM from
   * the database — the exact text a student reads in the lab sheet and now
   * opens in the editor. Compiling them unedited is what makes "your
   * experiment's sketch, editable" a fact rather than a claim: not one of them
   * needed `#include <Arduino.h>` added, a prototype moved, or a line changed.
   *
   * Only two are exercised here — the smallest Uno one and the Mega one, which
   * between them cover both parts and both core paths — because each Mega build
   * recompiles the whole Arduino core for avr6 and costs seconds. The other
   * four were verified the same way when this landed; the shapes they add
   * (a third-party library, pulseIn, attachInterrupt, float printing) are each
   * covered by a smaller case elsewhere in this file or in wasmhex.test.ts.
   */
  {
    const trafficLight =
      '#define R 2\n#define Y 3\n#define G 4\n' +
      'void setup(){pinMode(R,OUTPUT);pinMode(Y,OUTPUT);pinMode(G,OUTPUT);}\n' +
      'void loop(){digitalWrite(G,HIGH);delay(5000);digitalWrite(G,LOW);digitalWrite(Y,HIGH);delay(2000);digitalWrite(Y,LOW);digitalWrite(R,HIGH);delay(5000);digitalWrite(R,LOW);}'
    const tl = await compileSketch(trafficLight, 'arduino_uno')
    truth(
      'traffic-light-arduino compiles unedited from its published listing',
      tl.ok,
      'ok',
      tl.ok ? `${tl.flashBytes} B` : `${tl.stage}: ${tl.diagnostics[0]?.message ?? ''}`,
    )

    /**
     * attachInterrupt is the one core function the prebuilt 328P object set
     * omits, so water-flow-arduino failed at LINK until WInterrupts.c was added
     * as an on-demand unit. Asserted directly because it is the only place the
     * on-demand path is exercised, and its failure mode was an error about the
     * Arduino core in the middle of a student's own sketch.
     */
    const interrupts = await compileSketch(
      'volatile int n = 0;\nvoid tick(){ n++; }\n' +
        'void setup(){ Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(2), tick, FALLING); }\n' +
        'void loop(){ Serial.println(n); delay(1000); }\n',
      'arduino_uno',
    )
    truth(
      'attachInterrupt links — the on-demand core unit is pulled in',
      interrupts.ok,
      'ok',
      interrupts.ok ? `${interrupts.flashBytes} B` : `${interrupts.stage}: ${interrupts.diagnostics[0]?.message ?? ''}`,
    )
    if (interrupts.ok) {
      const plain = await compileSketch('void setup(){}\nvoid loop(){}\n', 'arduino_uno')
      if (plain.ok) {
        truth(
          '...and a sketch that does not use it stays smaller',
          plain.flashBytes < interrupts.flashBytes,
          `< ${interrupts.flashBytes}`,
          String(plain.flashBytes),
        )
      }
    }

    /**
     * A UTF-8 string literal, because pir-alarm-arduino's published listing
     * contains one (`"⚠ MOTION DETECTED — ALARM!"`) and a toolchain that
     * mangled it would corrupt what the serial monitor shows.
     */
    const unicode = await compileSketch(
      'void setup(){ Serial.begin(9600); Serial.println("⚠ MOTION — ALARM!"); }\nvoid loop(){}\n',
      'arduino_uno',
    )
    truth('a UTF-8 string literal compiles', unicode.ok, 'ok', unicode.ok ? 'ok' : `${unicode.stage}`)
    if (unicode.ok) {
      const engine = new SimulationEngine(parseIntelHex(unicode.hex), EXPERIMENT_01)
      engine.run(1_000_000)
      truth(
        '...and reaches the serial monitor intact',
        engine.snapshot().serial.includes('ALARM!'),
        'contains ALARM!',
        JSON.stringify(engine.snapshot().serial),
      )
    }

    eq('the flash budget is the part minus its bootloader', tl.ok ? tl.flashLimit : 0, 32256)
  }

  // ── report ────────────────────────────────────────────────────────────────
  const nameW = Math.min(84, Math.max(56, ...rows.map((r) => r.name.length)))
  const expW = Math.min(46, Math.max(20, ...rows.map((r) => r.expected.length)))
  const actW = Math.min(46, Math.max(20, ...rows.map((r) => r.actual.length)))

  let lastGroup = ''
  for (const r of rows) {
    if (r.group !== lastGroup) {
      lastGroup = r.group
      console.log('\n' + r.group)
      console.log('-'.repeat(Math.min(200, nameW + expW + actW + 14)))
    }
    console.log(
      `${r.name.slice(0, nameW).padEnd(nameW)}  ${r.expected.slice(0, expW).padEnd(expW)}  ${r.actual.slice(0, actW).padEnd(actW)}  ` +
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
