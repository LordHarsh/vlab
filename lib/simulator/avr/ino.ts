/**
 * Turning what a student types into something cc1plus will accept, and turning
 * what cc1plus says back into something a student can act on.
 *
 * Everything here is PURE — no filesystem, no WASM, no Node. That is deliberate:
 * this is the half of the compile path that decides what a student sees when
 * their code is wrong, so it has to be testable without a 13 MB compiler. The
 * half that actually runs the toolchain lives in build.ts / build-worker.mjs.
 *
 * THE PROBLEM THIS SOLVES. Arduino sketches are not C++ files. The Arduino
 * build system silently rewrites a `.ino` before any compiler sees it:
 *
 *   1. it inserts `#include <Arduino.h>`, which is why `pinMode` resolves in a
 *      file that includes nothing;
 *   2. it HOISTS FUNCTION PROTOTYPES, which is why `loop()` may call a helper
 *      that is defined fifty lines further down.
 *
 * docs/AVR_COMPILE_FINDINGS.md records both as Blocker 4 — "nothing converts .ino to
 * .cpp" — and warns that getting the transformation wrong "produces confusing
 * errors on the student's own valid code". That warning shapes every rule
 * below: when this file is not sure a thing is a function definition, it emits
 * NOTHING. A missing prototype costs the student the same error the Arduino IDE
 * would have spared them; a wrong prototype costs them an error about code they
 * never wrote, pointing at a line they cannot see. Those are not symmetric, so
 * the tie is broken toward silence every time.
 *
 * WHY THE LINE NUMBERS SURVIVE. Injecting anything above a student's line 1
 * shifts every diagnostic below it, and a compiler error that names the wrong
 * line is worse than no error at all. So every injected region is closed with a
 * `#line` directive that puts the count back. Verified against the real
 * compiler: a missing semicolon on the student's line 2 is reported as
 * `sketch.ino:3:1: error: expected ';' before '}' token` — the same line and
 * column the Arduino IDE would name.
 */

/** What a student's file is called in every diagnostic they will read. */
export const SKETCH_NAME = 'sketch.ino'

/** One compiler message, split into the parts the UI shows separately. */
export interface Diagnostic {
  /** 1-based line in the STUDENT's source, or null for a whole-file message. */
  line: number | null
  column: number | null
  severity: 'error' | 'warning' | 'note'
  /** The message alone, e.g. `expected ';' before '}' token`. */
  message: string
  /** The whole line as the compiler emitted it, for the serial-style log. */
  raw: string
}

/* ── Masking, so braces inside text are not mistaken for code ───────────── */

/**
 * A copy of `src` with every comment, string and character literal replaced by
 * spaces, preserving length and newlines.
 *
 * Every scan below runs over this copy and indexes back into the original, so
 * `Serial.println("}{")` and `// void f() {` cannot move the brace depth. Doing
 * it any other way is the classic way to write a brace matcher that works on
 * every test and fails on the first sketch containing a smiley in a string.
 *
 * Raw strings (`R"(...)"`) are NOT handled — they are vanishingly rare in
 * Arduino code, and the failure mode is a skipped prototype, not a wrong one.
 */
export function maskLiterals(src: string): string {
  const out = src.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]

    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i)
      blank(i, end < 0 ? src.length : end)
      i = end < 0 ? src.length : end
      continue
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      let k = i + 1
      while (k < src.length) {
        if (src[k] === '\\') {
          k += 2
          continue
        }
        // An unterminated literal ends at the newline rather than eating the
        // rest of the file: the student is mid-typo and the compiler will say
        // so, but the scan must not lose its place.
        if (src[k] === c || src[k] === '\n') break
        k += 1
      }
      blank(i, Math.min(k + 1, src.length))
      i = Math.min(k + 1, src.length)
      continue
    }
    i += 1
  }
  return out.join('')
}

/** Indices of every line start, so an offset can be turned into a line number. */
function lineStarts(src: string): number[] {
  const starts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1)
  return starts
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/**
 * `masked` with every preprocessor line blanked as well.
 *
 * A `#define LED 13` carries no braces, but `#if 0 ... #endif` and multi-line
 * macros do, and a macro body's braces are not the program's. Blanking the
 * directive lines keeps the depth counter honest without having to expand
 * anything. Continuation lines (trailing `\`) are blanked too.
 */
function maskDirectives(masked: string): string {
  const out = masked.split('')
  const starts = lineStarts(masked)
  for (let li = 0; li < starts.length; li++) {
    const from = starts[li]
    const to = li + 1 < starts.length ? starts[li + 1] - 1 : masked.length
    let p = from
    while (p < to && (masked[p] === ' ' || masked[p] === '\t')) p++
    if (masked[p] !== '#') continue
    // Blank this line and every continuation of it.
    let end = to
    let cursor = li
    for (;;) {
      let q = end - 1
      while (q >= from && (masked[q] === ' ' || masked[q] === '\t' || masked[q] === '\r')) q--
      if (masked[q] !== '\\' || cursor + 1 >= starts.length) break
      cursor += 1
      end = cursor + 1 < starts.length ? starts[cursor + 1] - 1 : masked.length
    }
    for (let k = from; k < end; k++) if (out[k] !== '\n') out[k] = ' '
    li = cursor
  }
  return out.join('')
}

/* ── Prototype hoisting ─────────────────────────────────────────────────── */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Words that can begin a line ending in `{` without it being a function.
 *
 * `class`/`struct`/`union`/`enum`/`namespace` open a type, `extern "C"` opens a
 * linkage block, `template` opens something this file will not try to declare,
 * and the control keywords cannot legally appear at file scope but do appear in
 * half-written code, which is exactly when a bogus prototype would be most
 * confusing.
 */
const NOT_A_FUNCTION =
  /\b(?:class|struct|union|enum|namespace|template|typedef|using|if|else|for|while|do|switch|try|catch|return)\b/

/** `extern "C" {` and friends — the string is already masked, so match the word. */
const HAS_EXTERN_BLOCK = /\bextern\b/

export interface HoistedPrototype {
  /** The declaration to emit, e.g. `long dist()`. */
  decl: string
  /** 1-based line of the definition it was taken from. */
  line: number
  /** Byte offset in the source where the definition's declaration begins. */
  offset: number
}

/**
 * Every top-level function definition in `src`, as a prototype.
 *
 * The scan walks the masked text counting braces, and every time the depth goes
 * from 0 to 1 it looks BACKWARDS from that brace for `name ( … )` preceded by a
 * return type. Working backwards from the brace, rather than forwards from a
 * guessed start, is what makes multi-line signatures and awkward spacing fall
 * out for free — the brace is the one landmark whose position is unambiguous.
 *
 * A candidate is discarded unless every one of these holds:
 *   · the text between the previous top-level `;` `}` or start and the `{`
 *     contains no keyword from NOT_A_FUNCTION and no `=`;
 *   · there is a `)` immediately before the `{` (modulo whitespace and simple
 *     specifiers), and it matches a `(`;
 *   · the token before that `(` is a plain identifier;
 *   · a non-empty return type precedes the identifier.
 *
 * DEFAULT ARGUMENTS ARE HOISTED, defaults and all, which took a measurement to
 * settle. Repeating a default in a declaration and a definition is normally an
 * error — so the first draft refused to hoist such functions at all, and that
 * refusal broke real code: `void loop(){ beep(); }` above `void beep(int n=3)`
 * then failed with "'beep' was not declared in this scope", which is a hard
 * error on a sketch the Arduino IDE compiles happily. We build with
 * `-fpermissive`, under which the duplicate default is only a WARNING, so
 * hoisting it is both possible and the behaviour that keeps valid sketches
 * valid. The warning names a line the student did not write, so build.ts drops
 * it rather than showing it — see `INJECTED_ARTIFACT` there.
 */
export function findPrototypes(src: string): HoistedPrototype[] {
  const masked = maskDirectives(maskLiterals(src))
  const starts = lineStarts(src)
  const found: HoistedPrototype[] = []

  let depth = 0
  /** Where the current top-level declaration began — after the last `;`/`}`. */
  let declStart = 0

  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]

    if (c === '}') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) declStart = i + 1
      continue
    }
    if (c === ';' && depth === 0) {
      declStart = i + 1
      continue
    }
    if (c !== '{') continue

    depth += 1
    if (depth !== 1) continue

    // ── depth went 0 → 1: is the text behind this brace a function header? ──
    const from = declStart
    const head = masked.slice(from, i)
    const raw = src.slice(from, i)

    declStart = i + 1 // whatever this turns out to be, the next decl starts after it

    if (head.trim() === '') continue
    if (NOT_A_FUNCTION.test(head)) continue
    if (HAS_EXTERN_BLOCK.test(head)) continue
    if (head.includes(':')) continue // initialiser lists, labels, bitfields

    // Trailing specifiers between `)` and `{` — const, noexcept, override…
    let p = head.length - 1
    while (p >= 0 && /[\sA-Za-z0-9_()]/.test(head[p]) && head[p] !== ')') p--
    if (head[p] !== ')') continue

    // Match the parameter list back to its `(`.
    let parens = 0
    let open = -1
    for (let k = p; k >= 0; k--) {
      if (head[k] === ')') parens += 1
      else if (head[k] === '(') {
        parens -= 1
        if (parens === 0) {
          open = k
          break
        }
      }
    }
    if (open < 0) continue

    /**
     * An `=` BEFORE the parameter list means this is an initialiser, not a
     * function — `int pins[] = {2,3,4};` reaches here because its `{` is also a
     * 0 → 1 brace transition. An `=` INSIDE the parameter list is a default
     * argument and is fine (see the header). Checking the whole head, as the
     * first draft did, conflated the two and refused to declare any function
     * with a default argument.
     */
    if (head.slice(0, open).includes('=')) continue

    // The identifier immediately before the `(`.
    let e = open - 1
    while (e >= 0 && /\s/.test(head[e])) e--
    let s = e
    while (s >= 0 && /[A-Za-z0-9_]/.test(head[s])) s--
    const name = head.slice(s + 1, e + 1)
    if (!IDENT.test(name)) continue

    // …and a non-empty return type before THAT.
    const returnType = head.slice(0, s + 1).trim()
    if (returnType === '') continue

    // Emit the original text (not the masked copy) so `unsigned long` and
    // pointer/reference punctuation survive verbatim. Collapse whitespace so a
    // signature split over three lines becomes one legal declaration.
    /**
     * The declaration starts at the first non-space character of the MASKED
     * head, not the raw one — and the difference is a bug that shipped in the
     * first draft of this file. `maskLiterals` and `maskDirectives` blank
     * comments and preprocessor lines to spaces of the same length, so the two
     * strings are index-for-index aligned; taking `lead` from the masked copy
     * skips a `#define LED 13` or a `// helper` sitting above the function,
     * while slicing `raw` keeps the real characters. Reading `lead` off `raw`
     * instead produced the prototype `#define LED 13 void setup();`, which is
     * both wrong and, being invalid, would have failed the compile it was
     * meant to enable.
     */
    const lead = head.length - head.trimStart().length
    const decl = raw.slice(lead, p + 1).replace(/\s+/g, ' ').trim()
    if (decl === '') continue

    const offset = from + lead
    found.push({ decl, line: lineOf(starts, offset), offset })
  }

  return found
}

/* ── The whole transform ────────────────────────────────────────────────── */

export interface PreparedSketch {
  /** What cc1plus is actually given. */
  cpp: string
  /** The prototypes that were injected, in source order. */
  prototypes: string[]
}

/**
 * A student's sketch, as a translation unit.
 *
 * Layout, and why each `#line` is where it is:
 *
 *     #include <Arduino.h>          ← what the IDE adds and the student omits
 *     #line 1 "sketch.ino"          ← student line 1 is next
 *     …everything above the first function definition…
 *     <prototypes>                  ← injected; costs N physical lines
 *     #line K "sketch.ino"          ← puts the count back to student line K
 *     …the rest of the sketch…
 *
 * `#line N` sets the line number of the FOLLOWING line to N, so the second
 * directive names the line the first function definition actually starts on and
 * everything below it counts on from there.
 *
 * When the sketch defines no functions at all — a student who has typed three
 * lines and pressed Run — the second region is omitted and the file is just the
 * include, one directive and the source.
 *
 * `#include <Arduino.h>` is added UNCONDITIONALLY, including when the student
 * has written it themselves. The header is `#pragma once`-guarded, so a second
 * include is a no-op; refusing to add it because the source contains the string
 * "Arduino.h" would break the moment someone mentions it in a comment.
 */
export function prepareSketch(source: string): PreparedSketch {
  const protos = findPrototypes(source)

  // Everything is declared before the FIRST definition, which is the only
  // position that helps: a helper defined after loop() must be visible inside
  // loop(), and loop() is itself a definition.
  const insertAt = protos.length > 0 ? protos[0].offset : -1

  const header = `#include <Arduino.h>\n#line 1 "${SKETCH_NAME}"\n`

  if (insertAt < 0) {
    return { cpp: header + source, prototypes: [] }
  }

  const decls = protos.map((p) => `${p.decl};`)
  const before = source.slice(0, insertAt)
  const after = source.slice(insertAt)

  return {
    cpp:
      header +
      before +
      decls.join('\n') +
      `\n#line ${protos[0].line} "${SKETCH_NAME}"\n` +
      after,
    prototypes: decls,
  }
}

/* ── Reading the compiler's mind ────────────────────────────────────────── */

/**
 * `sketch.ino:3:1: error: expected ';' before '}' token` and its relatives.
 *
 * GCC's diagnostic grammar is `file:line[:col]: severity: message`, with the
 * column omitted for some messages and the whole location omitted for others
 * (`cc1plus: error: …`). All three shapes appear in practice, so all three are
 * matched rather than assuming the common one.
 */
const GCC_DIAG = /^(?:\[[^\]]+\]\s*)?(.*?):(?:(\d+):)?(?:(\d+):)?\s*(error|warning|note|fatal error):\s*(.*)$/

/**
 * Parse raw compiler stderr into diagnostics a panel can render.
 *
 * Lines that are not diagnostics — GCC's `In function 'void loop()':` context
 * headers, source echoes, carets — are dropped from the structured list but the
 * caller keeps the raw text, because those context lines are often the thing
 * that makes an error make sense.
 *
 * A diagnostic naming a file OTHER than the student's sketch (a header, a core
 * object) keeps its message but loses its line number: pointing a student at
 * line 412 of `HardwareSerial.h` would be worse than pointing them nowhere.
 */
export function parseDiagnostics(stderr: string[]): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const raw of stderr) {
    const line = raw.trimEnd()
    if (!line) continue
    const m = GCC_DIAG.exec(line)
    if (!m) continue
    const [, file, lineNo, colNo, severityRaw, message] = m
    const mine = file.trim().endsWith(SKETCH_NAME)
    out.push({
      line: mine && lineNo ? Number(lineNo) : null,
      column: mine && colNo ? Number(colNo) : null,
      severity: severityRaw === 'fatal error' ? 'error' : (severityRaw as Diagnostic['severity']),
      message: message.trim(),
      raw: line.replace(/^\[[^\]]+\]\s*/, ''),
    })
  }
  return out
}

/** True when anything in the list stops a binary from being produced. */
export function hasError(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error')
}

/**
 * The one-line summary shown where there is no room for the list.
 *
 * Deliberately quotes the compiler rather than paraphrasing it. "Line 3:
 * expected ';' before '}' token" is a string a student can paste into a search
 * engine; "Your code has a syntax error" is not.
 */
export function summariseDiagnostics(diags: Diagnostic[]): string {
  const first = diags.find((d) => d.severity === 'error')
  if (!first) return 'Compile failed'
  const where = first.line !== null ? `Line ${first.line}: ` : ''
  const more = diags.filter((d) => d.severity === 'error').length - 1
  return `${where}${first.message}${more > 0 ? ` (+${more} more)` : ''}`
}
