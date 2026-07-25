/**
 * The student's SOURCE, as it is stored alongside the circuit.
 *
 * Migration 015 gave both `circuits` and `sim_attempts` a `code jsonb not null
 * default '{"files":[]}'`, and until now nothing wrote to it. This module is
 * that shape, given a name and a tolerant parser, so the editor and the two
 * persistence layers (IndexedDB and Supabase) all agree on one representation.
 *
 * WHY A LIST OF FILES AND NOT A STRING. The column's declared default already
 * says `files`, so the shape is not ours to invent; and a Pico project is one
 * `main.py` today only because the emulated MicroPython cannot write to flash
 * (rp2040js implements no SSI peripheral), not because a project is inherently
 * single-file. A list costs nothing now and does not need a migration later.
 *
 * EVERYTHING HERE IS DEFENSIVE. The value arrives as untyped `jsonb` from a row
 * that may have been written by an older build, by a seed, or by a future one.
 * `parseCodeBundle` returns null rather than throwing or half-trusting, and the
 * caller falls back to the authored starter — which is the same rule the
 * document restore already follows.
 */

/**
 * Two languages, because there are now two tracks a student can write for.
 *
 * This union was `'micropython'` alone, with a note saying that storing an
 * Arduino sketch would be "a lie told in a database column" while there was no
 * way to compile one — only three prebuilt .hex fixtures existed, so a saved
 * sketch could never have been run. `app/api/compile/route.ts` is the compile
 * path that note was waiting for: it drives the WebAssembly avr-gcc toolchain
 * SERVER-SIDE and hands back Intel HEX, so `arduino_c` now names something the
 * board can actually execute.
 *
 * The string matches `BoardProfile.language` in model/boards.ts and the
 * `language` field the published `code` sections already carry in the database,
 * so the same value flows from the lab sheet to the editor to the attempt row
 * without translation.
 */
export type CodeLanguage = 'micropython' | 'arduino_c'

const LANGUAGES: readonly CodeLanguage[] = ['micropython', 'arduino_c']

export interface CodeFile {
  /** Path as the board would see it. One file today; see the header. */
  name: string
  language: CodeLanguage
  source: string
}

export interface CodeBundle {
  files: CodeFile[]
}

/** The one file a Pico project has, named as MicroPython itself would. */
export const MAIN_PY = 'main.py'

/**
 * The one file an Arduino project has, named as the Arduino IDE would.
 *
 * `.ino` and not `.cpp` on purpose: it is what the student is writing, and the
 * distinction is real rather than cosmetic — a `.ino` is compiled only after
 * `#include <Arduino.h>` and hoisted prototypes are inserted for it, which is
 * what lib/simulator/avr/ino.ts does. Calling the stored file `.cpp` would
 * claim the student had written a C++ translation unit, and then the errors
 * they saw would be reported against a file that does not exist.
 *
 * It is also the name every diagnostic carries, so `sketch.ino:3:1: error: …`
 * names the tab the student is looking at.
 */
export const MAIN_INO = 'sketch.ino'

/** The file a given track's program is stored under. */
export function fileNameFor(language: CodeLanguage): string {
  return language === 'arduino_c' ? MAIN_INO : MAIN_PY
}

export const EMPTY_CODE: CodeBundle = { files: [] }

/** The source of `name`, or null when the bundle does not carry that file. */
export function readCodeFile(bundle: CodeBundle | null, name = MAIN_PY): string | null {
  if (!bundle) return null
  const hit = bundle.files.find((f) => f.name === name)
  return hit ? hit.source : null
}

/** `bundle` with `name` set to `source`, replacing it in place if present. */
export function writeCodeFile(
  bundle: CodeBundle | null,
  source: string,
  name = MAIN_PY,
  language: CodeLanguage = 'micropython',
): CodeBundle {
  const files = (bundle?.files ?? []).slice()
  const i = files.findIndex((f) => f.name === name)
  const next: CodeFile = { name, language, source }
  if (i < 0) files.push(next)
  else files[i] = next
  return { files }
}

/**
 * Read a `code` jsonb value into a bundle, or null if it is not one.
 *
 * A row written before this existed holds `{"files":[]}` — the column default —
 * which parses to an EMPTY bundle rather than to null. That distinction is
 * load-bearing: an empty bundle means "no code saved, use the starter", and so
 * does null, but only null means "this value was not something we recognise".
 */
export function parseCodeBundle(value: unknown): CodeBundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = (value as { files?: unknown }).files
  if (!Array.isArray(raw)) return null

  const files: CodeFile[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const f = entry as { name?: unknown; language?: unknown; source?: unknown }
    if (typeof f.name !== 'string' || typeof f.source !== 'string') continue
    /**
     * A known language is kept; an unknown one is INFERRED FROM THE FILE NAME
     * rather than dropped, because the source is the student's work and losing
     * it to a label mismatch would be indefensible.
     *
     * The inference matters for rows written before this union had two members:
     * every one of them stored `language: 'micropython'`, and every one of them
     * is a `main.py`, so the name and the label agree and nothing is
     * misfiled. A future row whose label is missing or misspelled falls back to
     * the extension, which is the more reliable of the two signals.
     */
    const declared = LANGUAGES.find((l) => l === f.language)
    const language: CodeLanguage =
      declared ?? (f.name.endsWith('.ino') || f.name.endsWith('.cpp') ? 'arduino_c' : 'micropython')
    files.push({ name: f.name, language, source: f.source })
  }
  return { files }
}
