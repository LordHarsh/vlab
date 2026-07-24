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
 * Only one language today, and deliberately not widened to 'cpp'.
 *
 * There is no avr-gcc in the browser and only three prebuilt .hex fixtures, so
 * an Arduino sketch stored here could never be run — and a stored program that
 * cannot run is a lie told in a database column. When a compile path exists,
 * widening this union is the change that admits it.
 */
export type CodeLanguage = 'micropython'

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
    // An unknown language is coerced rather than dropped: the source is the
    // student's work and losing it to a label mismatch would be indefensible.
    files.push({ name: f.name, language: 'micropython', source: f.source })
  }
  return { files }
}
