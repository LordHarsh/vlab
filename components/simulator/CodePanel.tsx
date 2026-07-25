'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { ChevronDown, ChevronRight, Loader2, Play, RotateCcw, Square, X } from 'lucide-react'
import type { CodeLanguage } from '@/lib/simulator/model/code'

/**
 * The student's MicroPython, docked beside the circuit.
 *
 * WHY A PANEL AND NOT A MODAL. Tinkercad's `Code` button splits the window and
 * leaves the canvas live beside the editor, and that is not a stylistic choice:
 * the whole point of the exercise is that `Pin(17, Pin.OUT)` refers to a wire
 * the student can see. A modal that covers the circuit breaks the one link the
 * lesson is teaching.
 *
 * WHY A TEXTAREA AND NOT CODEMIRROR. Tinkercad runs CodeMirror. We run a
 * <textarea> with a synced line-number gutter, and it is a deliberate trade
 * rather than a shortcut: this repo has no editor dependency, the dev server is
 * live in front of the owner, and 400 KB of editor for syntax colouring is not
 * worth the risk today. What a student actually needs — type, indent, run, see
 * the error — a textarea does natively, with real accessibility, real mobile
 * keyboards and real find-in-page for free. Tab and Shift-Tab are handled here
 * because a code box that tabs to the next control is unusable; everything else
 * is the platform's.
 *
 * THE RUN MODEL, stated once and shown in the UI:
 *
 *   Typing changes a DRAFT. It does not touch the running board.
 *
 * There is no way to hot-patch a running MicroPython — once a `while True:`
 * owns the REPL, only a reset gets it back (pico/engine.ts says so, and
 * pico.worker.ts's `setScript` case does exactly that reboot). So loading new
 * code is unavoidably a reboot, and the honest thing is to make the student ask
 * for it rather than have their board silently restart under them on a
 * keystroke. `Run` is that ask. Until it is pressed the panel says, in words,
 * that the board is running something older than what is on screen.
 */

/**
 * TWO LANGUAGES, ONE PANEL.
 *
 * Arduino C++ was added here rather than in a second component, and the reason
 * is not tidiness. Everything a student does in this panel — type, indent, run,
 * read the error, reset to the starter, watch the serial monitor, resize the
 * split — is identical on both tracks, and every one of those behaviours took a
 * decision that is written down above. A parallel `SketchPanel` would have had
 * to re-make all of them, and would have started drifting on the first one.
 *
 * What genuinely differs is narrow, and is exactly what `language` selects:
 *
 *   · MicroPython is INTERPRETED. "Run" reboots the interpreter and pastes the
 *     script; failure arrives later, as a traceback in the serial stream, and
 *     is dug out of it by lastTraceback().
 *   · Arduino C++ is COMPILED, on the server. "Run" is a network round trip
 *     that either produces firmware or produces a list of errors with line
 *     numbers, and it takes seconds — so there is a third status, `compiling`,
 *     which the Python track has no equivalent of.
 *
 * The failure display is shared: a Python traceback and a GCC diagnostic list
 * are both "here is what went wrong, in the tool's own words", and a student
 * who has learnt to look in one place on one track should look in the same
 * place on the other.
 */

/** Python wants 4 spaces; C++ conventionally uses 2, and Arduino's own IDE does. */
const INDENT_FOR: Record<CodeLanguage, string> = {
  micropython: '    ',
  arduino_c: '  ',
}

export type CodePanelStatus = 'loading' | 'stopped' | 'running'

/**
 * What the compiler is doing, for the tracks that have one.
 *
 * `idle` on the MicroPython track always — there is nothing to compile — which
 * is why this is a separate axis from CodePanelStatus rather than two more
 * members of it. The board can be running the previous binary WHILE a new one
 * compiles, and one enum could not say both.
 */
export type CompilePhase = 'idle' | 'compiling' | 'ready' | 'error'

/** One compiler message, as lib/simulator/avr/ino.ts parses it. */
export interface CodeDiagnostic {
  line: number | null
  column: number | null
  severity: 'error' | 'warning' | 'note'
  message: string
  raw: string
}

export interface CodePanelProps {
  /** Board this code is bound to, e.g. "Raspberry Pi Pico". */
  boardLabel: string
  /** The placed part's id — Tinkercad's selector keys on the board's name. */
  boardId: string
  /** Which language the student is writing, and therefore how Run behaves. */
  language: CodeLanguage
  /** The draft: what is in the editor, which is NOT necessarily what is running. */
  source: string
  onSourceChange: (next: string) => void
  /** True when the draft differs from the source the board was given. */
  dirty: boolean
  status: CodePanelStatus
  /** How far the REPL hand-off has got, in the editor's own words. MicroPython only. */
  replLabel: string
  /** Everything the emulated USB serial link has produced. */
  serial: string
  /** False when this experiment ships no authored program to go back to. */
  canReset: boolean
  onReset: () => void
  /** Load the draft onto the board and run it. Reboots the MCU. */
  onRun: () => void
  onStop: () => void
  onClose: () => void

  /* ── compiled tracks only ─────────────────────────────────────────────── */
  compile?: {
    phase: CompilePhase
    /** Errors when the compile failed; warnings when it succeeded. */
    diagnostics: CodeDiagnostic[]
    /** A transport/authorisation failure, which is NOT about the student's code. */
    error: string | null
    flashBytes: number
    flashLimit: number
    ms: number
    cached: boolean
    /** True once any firmware built from this editor is on the board. */
    hasFirmware: boolean
  }
}

/**
 * The last Python traceback in the stream, or null.
 *
 * Pulled out and shown separately because it is the single thing a student most
 * needs and is most likely to miss: the REPL echoes the whole script back
 * during the paste, so a three-line SyntaxError arrives at the bottom of a
 * screenful of the student's own source and scrolls past in a console that is
 * already showing a MicroPython banner.
 *
 * Cut at the next prompt so a traceback from an earlier run cannot be shown as
 * if it were the current one.
 */
export function lastTraceback(serial: string): string | null {
  const at = serial.lastIndexOf('Traceback (most recent call last):')
  if (at < 0) return null
  const rest = serial.slice(at)
  const end = rest.indexOf('\n>>>')
  const block = (end < 0 ? rest : rest.slice(0, end)).trim()
  return block.length > 0 ? block : null
}

export function CodePanel({
  boardLabel,
  boardId,
  language,
  source,
  onSourceChange,
  dirty,
  status,
  replLabel,
  serial,
  canReset,
  onReset,
  onRun,
  onStop,
  onClose,
  compile,
}: CodePanelProps) {
  const isCpp = language === 'arduino_c'
  const INDENT = INDENT_FOR[language]
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const serialRef = useRef<HTMLPreElement>(null)
  const [serialOpen, setSerialOpen] = useState(true)
  /**
   * Reset is two presses, not a window.confirm().
   *
   * One press would let a mis-click throw away everything the student has
   * written — there is no undo stack for the code, unlike the circuit — and a
   * native confirm() is both untestable and, inside the Fullscreen API, drawn
   * somewhere the student is not looking.
   */
  const [confirmingReset, setConfirmingReset] = useState(false)

  const lineCount = source.split('\n').length
  /**
   * A Python traceback is a RUNTIME failure found by reading the serial stream;
   * a GCC diagnostic is a BUILD failure the server hands back as data. Neither
   * exists on the other track, so each is looked for only where it can occur.
   */
  const traceback = isCpp ? null : lastTraceback(serial)
  const errors = compile?.diagnostics.filter((d) => d.severity === 'error') ?? []
  const warnings = compile?.diagnostics.filter((d) => d.severity === 'warning') ?? []
  const compiling = compile?.phase === 'compiling'
  /** Anything red, whichever track produced it. */
  const failed = traceback !== null || errors.length > 0 || Boolean(compile?.error)

  // Gutter follows the textarea exactly. useLayoutEffect so a programmatic
  // source change (reset to starter) cannot paint one frame misaligned.
  const syncGutter = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])
  useLayoutEffect(syncGutter, [source, syncGutter])

  // The interesting end of a console is the bottom, always.
  useEffect(() => {
    const el = serialRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [serial, serialOpen])

  /**
   * Tab indents, Shift-Tab outdents, Ctrl/Cmd-Enter runs.
   *
   * Selection-aware because Python is whitespace-significant: indenting a
   * three-line block one line at a time is how a student ends up with the
   * IndentationError they did not write.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      onRun()
      return
    }
    if (e.key !== 'Tab') return
    e.preventDefault()

    const el = e.currentTarget
    const { selectionStart: start, selectionEnd: end, value } = el

    // A caret with no selection just inserts, which is what Tab means there.
    if (start === end && !e.shiftKey) {
      const next = value.slice(0, start) + INDENT + value.slice(end)
      onSourceChange(next)
      queueMicrotask(() => el.setSelectionRange(start + INDENT.length, start + INDENT.length))
      return
    }

    // Otherwise shift every line the selection touches, whole lines at a time.
    const from = value.lastIndexOf('\n', start - 1) + 1
    const toRaw = value.indexOf('\n', end)
    const to = toRaw < 0 ? value.length : toRaw
    const block = value.slice(from, to)
    const lines = block.split('\n')

    let firstDelta = 0
    let total = 0
    const shifted = lines.map((line, i) => {
      if (e.shiftKey) {
        const strip = line.startsWith(INDENT) ? INDENT.length : line.startsWith(' ') ? 1 : 0
        if (i === 0) firstDelta = -strip
        total -= strip
        return line.slice(strip)
      }
      if (i === 0) firstDelta = INDENT.length
      total += INDENT.length
      return INDENT + line
    })

    const next = value.slice(0, from) + shifted.join('\n') + value.slice(to)
    if (next === value) return
    onSourceChange(next)
    queueMicrotask(() =>
      el.setSelectionRange(Math.max(from, start + firstDelta), Math.max(from, end + total)),
    )
  }

  /**
   * "Running" is the REPL's word, not the program's, and after a traceback the
   * two disagree.
   *
   * pico/engine.ts moves its `replPhase` to `running` the moment the paste is
   * handed over and never moves it back — it has no way to know whether the
   * block that was pasted survived. So a script that died on its first line
   * still reads "script running", which is precisely the wrong thing to tell a
   * student staring at a board doing nothing. MicroPython only prints a
   * traceback to the REPL when the pasted block ends, so a traceback in the tail
   * of the stream is the honest signal that it did.
   */
  /**
   * ORDER MATTERS HERE, and the rule is: say the most recent true thing.
   *
   * `compiling` comes first because it is happening NOW and takes seconds — the
   * one state the Python track never had, and the one a student will otherwise
   * read as the button having done nothing.
   *
   * A compile ERROR outranks `dirty`. Both are true after a failed build — the
   * draft does differ from what is on the board — but "press Run to load this"
   * is a lie when pressing Run has just been tried and refused. Naming the
   * error, and leaving the board's true state to the line below it, is the
   * honest pair.
   *
   * On the MicroPython side this is unchanged, including the part that matters
   * most: pico/engine.ts moves its replPhase to `running` when the paste is
   * handed over and never moves it back, so a script that died on its first
   * line still reads "script running". A traceback in the tail of the stream is
   * the signal that it did not, and it wins over the REPL's own word.
   */
  const statusText =
    /**
     * COMPILING IS CHECKED FIRST, ahead of `status === 'loading'`, and it has to
     * be: the editor deliberately reports `loading` while a compile is in
     * flight, because `ready` still describes the PREVIOUS binary. With the
     * loading branch first, the one operation that takes visible seconds
     * announced itself as "Loading the board…" — measured in the browser, not
     * theorised — which tells the student nothing about what is actually
     * happening or why it is slow.
     */
    compiling
      ? 'Compiling your sketch…'
      : status === 'loading'
        ? isCpp
          ? 'Loading the board…'
          : 'Loading MicroPython…'
        : compile?.error
          ? 'Could not reach the compiler'
          : errors.length > 0
            ? `${errors.length} compile error${errors.length > 1 ? 's' : ''} — nothing new was loaded`
            : dirty
              ? isCpp
                ? 'Edited — press Run to compile and load it'
                : 'Edited — press Run to load this onto the board'
              : traceback
                ? 'Python error — see the serial monitor'
                : status === 'running'
                  ? isCpp
                    ? 'On the board · running'
                    : `On the board · ${replLabel}`
                  : 'On the board · stopped'

  return (
    <section
      data-testid="code-panel"
      aria-label="Code editor"
      className="flex min-h-0 w-full flex-col border-t border-[#dfe3e8] bg-white md:h-auto md:border-t-0 md:border-l"
    >
      {/* Header — what this code is bound to, and the way out. */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#dfe3e8] px-3">
        <span className="text-[10px] uppercase tracking-wider text-[#566573]">Code</span>

        {/* Tinkercad binds code to a board through a selector keyed on the
            board's name. We have exactly one board per document — detectBoard()
            refuses two — so this states the binding rather than offering a
            choice that does not exist. It becomes a <select> the day a document
            can hold two MCUs. */}
        <span
          data-testid="code-board"
          title={`This code runs on ${boardLabel} (${boardId})`}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-[3px] border border-[#dfe3e8] bg-[#f4f5f6] px-2 text-[11px] text-[#34495e]"
        >
          <span className="truncate">{boardLabel}</span>
          <span className="shrink-0 text-[#566573]">{boardId}</span>
        </span>

        <span
          data-testid="code-language"
          className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-[#566573]"
        >
          {isCpp ? 'Arduino C++' : 'MicroPython'}
        </span>

        <button
          type="button"
          data-testid="code-close"
          aria-label="Close the code panel"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-[#dfe3e8] bg-white text-[#566573] transition-colors hover:border-[#1477d1] hover:text-[#34495e]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Controls. `Run` is the same action as the toolbar's Start Simulation —
          Tinkercad shares one run control between the circuit and the code, and
          so do we. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#dfe3e8] px-3 py-2">
        <button
          type="button"
          data-testid="code-run"
          onClick={status === 'running' && !dirty ? onStop : onRun}
          /**
           * Disabled WHILE COMPILING, which is not merely cosmetic: every press
           * is a fresh POST and a fresh worker thread on the server, and the
           * student has no way of telling that the first one is still going.
           */
          disabled={status === 'loading' || compiling}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[3px] px-3 text-xs font-semibold text-white transition-colors disabled:opacity-40 ${
            status === 'running' && !dirty
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {compiling ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Compiling…
            </>
          ) : status === 'running' && !dirty ? (
            <>
              <Square className="h-3 w-3" aria-hidden="true" />
              Stop
            </>
          ) : (
            <>
              <Play className="h-3 w-3" aria-hidden="true" />
              {dirty ? (isCpp ? 'Compile & run' : 'Run new code') : 'Run'}
            </>
          )}
        </button>

        {confirmingReset ? (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              data-testid="code-reset-confirm"
              onClick={() => {
                setConfirmingReset(false)
                onReset()
              }}
              className="h-8 shrink-0 rounded-[3px] border border-red-200 bg-white px-2.5 text-xs text-red-600 transition-colors hover:border-red-500"
            >
              Discard my code
            </button>
            <button
              type="button"
              data-testid="code-reset-cancel"
              onClick={() => setConfirmingReset(false)}
              className="h-8 shrink-0 rounded-[3px] border border-[#dfe3e8] bg-white px-2.5 text-xs text-[#566573] transition-colors hover:border-[#1477d1]"
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-testid="code-reset"
            onClick={() => setConfirmingReset(true)}
            disabled={!canReset}
            title={
              canReset
                ? "Replace the editor with this experiment's original script"
                : 'This experiment ships no starter script'
            }
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[3px] border border-[#dfe3e8] bg-white px-2.5 text-xs text-[#34495e] transition-colors hover:border-[#1477d1] disabled:opacity-40 disabled:hover:border-[#dfe3e8]"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset to starter
          </button>
        )}

        <span
          data-testid="code-status"
          /* aria-live so a screen-reader user is told the compile finished;
             without it the only signal is a button label they are not on. */
          aria-live="polite"
          className={`ml-auto text-[11px] ${
            failed ? 'text-red-700' : dirty || compiling ? 'text-[#b45309]' : 'text-[#566573]'
          }`}
        >
          {statusText}
        </span>
      </div>

      {/* Editor. The gutter is a sibling rather than a background image so the
          numbers stay selectable-proof — a student copying their code must not
          get line numbers in the clipboard. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <label htmlFor="code-editor-input" className="sr-only">
          {isCpp ? 'Arduino C++' : 'MicroPython'} source for {boardLabel}
        </label>
        <div className="flex min-h-0 flex-1">
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="shrink-0 select-none overflow-hidden border-r border-[#dfe3e8] bg-[#f4f5f6] py-2 pl-2 pr-1.5 text-right font-mono text-[12px] leading-[18px] text-[#566573]"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            id="code-editor-input"
            ref={textareaRef}
            data-testid="code-editor"
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
            onScroll={syncGutter}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="off"
            aria-describedby="code-editor-help"
            className="min-h-0 w-full flex-1 resize-none bg-white px-2 py-2 font-mono text-[12px] leading-[18px] text-[#34495e] outline-none focus:bg-[#fcfdff]"
          />
        </div>
        <p
          id="code-editor-help"
          className="shrink-0 border-t border-[#dfe3e8] px-3 py-1.5 text-[10px] leading-snug text-[#566573]"
        >
          {isCpp ? (
            <>
              Tab indents, Shift-Tab outdents, Ctrl-Enter compiles and runs. Your sketch is compiled
              with avr-gcc and flashed to the board, so running restarts it from{' '}
              <code className="font-mono">setup()</code>. You do not need{' '}
              <code className="font-mono">#include &lt;Arduino.h&gt;</code> — it is added for you,
              and functions may be called above where they are defined.
            </>
          ) : (
            <>
              Tab indents, Shift-Tab outdents, Ctrl-Enter runs. Running restarts the board —
              MicroPython reboots and your program starts again from the top.
            </>
          )}
        </p>
      </div>

      {/* Serial monitor — a drawer at the foot of the panel, which is where
          Tinkercad puts it. On this track it is the USB REPL rather than a
          UART, so MicroPython's own banner and prompt appear in it too. */}
      <div className="shrink-0 border-t border-[#dfe3e8]">
        <button
          type="button"
          data-testid="code-serial-toggle"
          aria-expanded={serialOpen}
          aria-controls="code-serial-body"
          onClick={() => setSerialOpen((v) => !v)}
          className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[10px] uppercase tracking-wider text-[#566573] transition-colors hover:text-[#34495e]"
        >
          {serialOpen ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {/* Named for what it actually is on each track. On the Pico this is
              the USB REPL — it carries MicroPython's own banner and prompt as
              well as the script's output — and the parts rail has always called
              it "REPL output". Two names for one stream taught nothing. */}
          {isCpp ? 'Serial monitor' : 'REPL output'}
          {failed && (
            <span
              data-testid="code-error-badge"
              className="ml-1.5 rounded-[3px] bg-red-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-red-700 normal-case"
            >
              error
            </span>
          )}
          {/* Flash usage, where the Arduino IDE puts it. Only once something has
              actually been built — a percentage of nothing is not information. */}
          {isCpp && compile?.hasFirmware && compile.flashLimit > 0 && (
            <span data-testid="code-flash" className="ml-auto normal-case tracking-normal">
              {compile.flashBytes.toLocaleString()} B ·{' '}
              {Math.round((compile.flashBytes / compile.flashLimit) * 100)}% of flash
            </span>
          )}
        </button>

        {serialOpen && (
          <div id="code-serial-body">
            {/**
             * COMPILER ERRORS, in the compiler's own words.
             *
             * This is the Arduino track's equivalent of the traceback callout
             * below, and it is the single most important thing on the panel: a
             * student who writes bad C++ has to see `expected ';' before '}'
             * token` against a line number they can find, exactly as a Pico
             * student sees a SyntaxError. Paraphrasing it into "there is a
             * problem with your code" would remove the only part that teaches
             * anything — and the line number is the part that turns a wall of
             * red into a place to put the cursor.
             *
             * `#line` directives in lib/simulator/avr/ino.ts are what make the
             * numbers trustworthy: the injected `#include <Arduino.h>` and the
             * hoisted prototypes would otherwise shift every line below them.
             */}
            {errors.length > 0 && (
              <div
                className="mx-3 mb-2 border border-red-200 bg-red-50 px-2.5 py-2"
                role="status"
                data-testid="code-compile-errors"
              >
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-red-600">
                  {errors.length === 1 ? 'Compile error' : `${errors.length} compile errors`}
                </span>
                <ul className="space-y-1">
                  {errors.map((d, i) => (
                    <li key={i} className="font-mono text-[10px] leading-snug text-red-800">
                      {d.line !== null && (
                        <span className="font-bold">
                          Line {d.line}
                          {d.column !== null ? `:${d.column}` : ''}{' '}
                        </span>
                      )}
                      {d.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] leading-snug text-red-700">
                  {compile?.hasFirmware
                    ? 'The board is still running the last sketch that compiled.'
                    : 'Nothing has been loaded onto the board yet.'}
                </p>
              </div>
            )}

            {/* A network or permission failure. Kept visually distinct from the
                block above because it is not the student's mistake. */}
            {compile?.error && (
              <div
                className="mx-3 mb-2 border border-amber-300 bg-amber-50 px-2.5 py-2"
                role="status"
                data-testid="code-compile-transport-error"
              >
                <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-amber-700">
                  Compiler unreachable
                </span>
                <p className="text-[10px] leading-snug text-amber-900">{compile.error}</p>
              </div>
            )}

            {/* Warnings never block a run, so they are quiet — but they are the
                thing that explains a sketch which builds and misbehaves. */}
            {warnings.length > 0 && errors.length === 0 && (
              <div
                className="mx-3 mb-2 border border-[#fde68a] bg-[#fffbeb] px-2.5 py-2"
                data-testid="code-compile-warnings"
              >
                <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-[#b45309]">
                  {warnings.length === 1 ? 'Warning' : `${warnings.length} warnings`}
                </span>
                <ul className="space-y-1">
                  {warnings.slice(0, 5).map((d, i) => (
                    <li key={i} className="font-mono text-[10px] leading-snug text-[#92400e]">
                      {d.line !== null && <span className="font-bold">Line {d.line} </span>}
                      {d.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Repeated above the log, not instead of it: the raw stream stays
                so a student can see WHERE the error happened, and the callout
                makes sure they see THAT it happened. */}
            {traceback && (
              <div className="mx-3 mb-2 border border-red-200 bg-red-50 px-2.5 py-2" role="status">
                <span className="mb-0.5 block text-[9px] font-bold uppercase tracking-wider text-red-600">
                  Python error
                </span>
                <pre
                  data-testid="code-traceback"
                  className="overflow-x-auto whitespace-pre font-mono text-[10px] leading-snug text-red-800"
                >
                  {traceback}
                </pre>
              </div>
            )}
            <pre
              ref={serialRef}
              data-testid="code-serial"
              aria-label={isCpp ? 'Serial monitor output' : 'REPL output'}
              tabIndex={0}
              className="mx-3 mb-3 h-32 overflow-auto whitespace-pre-wrap break-all border border-[#dfe3e8] bg-[#f1f1f3] p-2 font-mono text-[10px] text-[#34495e]"
            >
              {serial || '(no output yet — press Run)'}
            </pre>
          </div>
        )}
      </div>
    </section>
  )
}

/* ── The drag handle between the canvas and the panel ──────────────────── */

export const CODE_PANEL_MIN = 280
export const CODE_PANEL_MAX = 900
export const CODE_PANEL_DEFAULT = 420
/** One press of an arrow key. Coarse enough to be useful, fine enough to aim. */
const NUDGE = 24

/**
 * Where the chosen panel width is kept.
 *
 * localStorage rather than the document: the split is a property of the person
 * and the screen they are sitting at, not of the circuit. Saving it into the
 * graph would sync one student's laptop layout onto another student's phone,
 * and would make "I resized the panel" an edit to their work.
 */
export const CODE_WIDTH_KEY = 'vlab.sim.codeWidth'

/**
 * Turn whatever localStorage handed back into a usable width, or null.
 *
 * Null for anything unusable rather than a silent fallback to a number, so the
 * caller can tell "never set" from "set to 280". Everything else here is
 * defensive for a reason: this string is user-writable via devtools, survives
 * deploys, and `Number(null)` is 0 — an unguarded read would collapse the panel
 * to nothing on the next reload and leave no way to get it back.
 */
export function parseCodeWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.min(CODE_PANEL_MAX, Math.max(CODE_PANEL_MIN, Math.round(n)))
}

/** Read the stored width. Returns null on a server render or a sealed store. */
export function readCodeWidth(): number | null {
  try {
    return parseCodeWidth(globalThis.localStorage?.getItem(CODE_WIDTH_KEY) ?? null)
  } catch {
    // Safari in private mode throws on localStorage access rather than
    // returning null. A panel that cannot remember its width is fine; an editor
    // that will not mount is not.
    return null
  }
}

export function writeCodeWidth(width: number): void {
  try {
    globalThis.localStorage?.setItem(CODE_WIDTH_KEY, String(Math.round(width)))
  } catch {
    /* see readCodeWidth */
  }
}

/**
 * The stored width, as an external store React can subscribe to.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, for a reason that
 * is not stylistic. localStorage does not exist during the server render, so
 * ANY approach that reads it while producing the first client render disagrees
 * with the server's HTML — React 19 treats that as a hydration mismatch and
 * repairs it by discarding the client tree, which is a visible flash on every
 * page load. Reading it in an effect instead avoids the mismatch but renders
 * once at the default and once at the stored width, which is the cascading
 * render the lint rule exists to prevent (and is a visible jump of the divider).
 *
 * This hook is the shape React provides for exactly this problem:
 * `getServerSnapshot` returns the default so the server and the first client
 * render agree, and the stored value is adopted in the same commit rather than
 * in a follow-up one.
 *
 * The `storage` subscription is a genuine bonus rather than ceremony: a student
 * with the lab open in two tabs gets the divider in the same place in both.
 */
let widthCache: number | null = null
const widthListeners = new Set<() => void>()

function subscribeCodeWidth(onChange: () => void): () => void {
  widthListeners.add(onChange)
  // Fired by OTHER tabs only, which is exactly the cross-tab case.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== CODE_WIDTH_KEY) return
    widthCache = null
    onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    widthListeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Cached deliberately. `useSyncExternalStore` calls this during render and
 * compares with `Object.is`; hitting localStorage every time would be a
 * synchronous disk-backed read per render, and any value that failed to compare
 * equal would spin.
 */
function getCodeWidthSnapshot(): number {
  if (widthCache === null) widthCache = readCodeWidth() ?? CODE_PANEL_DEFAULT
  return widthCache
}

/** No localStorage on the server, so the default is the only honest answer. */
function getCodeWidthServerSnapshot(): number {
  return CODE_PANEL_DEFAULT
}

/** The code panel's width, and a setter that persists it. */
export function useCodeWidth(): [number, (next: number) => void] {
  const width = useSyncExternalStore(
    subscribeCodeWidth,
    getCodeWidthSnapshot,
    getCodeWidthServerSnapshot,
  )
  const setWidth = useCallback((next: number) => {
    const clamped = Math.min(CODE_PANEL_MAX, Math.max(CODE_PANEL_MIN, Math.round(next)))
    if (clamped === widthCache) return
    widthCache = clamped
    writeCodeWidth(clamped)
    for (const fn of widthListeners) fn()
  }, [])
  return [width, setWidth]
}

/* ── Whether each side panel is open, remembered across reloads ─────────── */

/**
 * The two docked panels' open/closed state, stored exactly where the width is.
 *
 * localStorage rather than the document, for the reason `CODE_WIDTH_KEY` gives:
 * which panels a student has open is a property of them and the screen in front
 * of them, not of the circuit. Syncing it into the graph would push one
 * student's laptop layout onto another student's phone and make "I closed the
 * parts rail" an edit to their work.
 *
 * TRI-STATE, and that is the point of returning `boolean | null` rather than a
 * plain boolean. `null` means NOBODY HAS SAID, which is different from "closed":
 * the code panel's unset default is decided by the viewport (open beside the
 * circuit on a laptop, closed on a phone where the two cannot share the screen —
 * see useIsNarrow), and collapsing that to `false` would take the docked editor
 * away from every laptop that has never pressed the button.
 */
export const CODE_OPEN_KEY = 'vlab.sim.codeOpen'
export const RAIL_OPEN_KEY = 'vlab.sim.railOpen'

/**
 * Whatever localStorage handed back, as a decision or "never made".
 *
 * Anything unrecognised is `null` rather than `false`, so a key corrupted by
 * devtools, a half-written value or a future format lands back on the viewport
 * default instead of silently hiding a panel with no obvious way to notice why.
 */
export function parsePanelOpen(raw: string | null): boolean | null {
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return null
}

export function readPanelOpen(key: string): boolean | null {
  try {
    return parsePanelOpen(globalThis.localStorage?.getItem(key) ?? null)
  } catch {
    // Safari in private mode throws rather than returning null; see readCodeWidth.
    return null
  }
}

export function writePanelOpen(key: string, open: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, open ? '1' : '0')
  } catch {
    /* see readCodeWidth */
  }
}

/**
 * One cache and one listener set PER KEY, for the same reason the width store
 * caches: `useSyncExternalStore` calls the snapshot during render and compares
 * with `Object.is`, so an uncached read would hit a synchronous disk-backed
 * store on every render.
 *
 * `Map.has` rather than a null check is what tells "not read yet" apart from
 * "read, and nobody has decided" — both of which are `null` as a value.
 */
const openCache = new Map<string, boolean | null>()
const openListeners = new Map<string, Set<() => void>>()

/** No localStorage on the server, so "nobody has said" is the only honest answer. */
function getPanelOpenServerSnapshot(): boolean | null {
  return null
}

/**
 * A panel's remembered open/closed choice, and a setter that persists it.
 *
 * The `storage` subscription is the same bonus the width store gets: a student
 * with the lab open in two tabs sees the same panels in both.
 */
export function usePanelOpen(key: string): [boolean | null, (next: boolean) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const listeners = openListeners.get(key) ?? new Set<() => void>()
      openListeners.set(key, listeners)
      listeners.add(onChange)
      // Fired by OTHER tabs only, which is exactly the cross-tab case.
      const onStorage = (e: StorageEvent) => {
        if (e.key !== null && e.key !== key) return
        openCache.delete(key)
        onChange()
      }
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.delete(onChange)
        window.removeEventListener('storage', onStorage)
      }
    },
    [key],
  )

  const getSnapshot = useCallback(() => {
    if (!openCache.has(key)) openCache.set(key, readPanelOpen(key))
    return openCache.get(key) ?? null
  }, [key])

  const choice = useSyncExternalStore(subscribe, getSnapshot, getPanelOpenServerSnapshot)

  const setChoice = useCallback(
    (next: boolean) => {
      if (openCache.get(key) === next) return
      openCache.set(key, next)
      writePanelOpen(key, next)
      for (const fn of openListeners.get(key) ?? []) fn()
    },
    [key],
  )

  return [choice, setChoice]
}

/* ── Whether there is room for the panel and the circuit at once ────────── */

/**
 * The same `md` breakpoint Tailwind uses here, as a media query.
 *
 * Below it the editor stacks the canvas, this panel and the parts rail in one
 * column, and there is not enough height for all three.
 */
const NARROW = '(max-width: 767px)'

/**
 * True on a phone-width viewport.
 *
 * WHY THIS EXISTS. A QA sweep measured the circuit canvas at **387×0** on a
 * 390 px viewport: the panel is 45dvh and the parts rail 45dvh, both
 * `shrink-0`, so the only flexible child — the canvas — was crushed to nothing
 * and a student landed on a page with the circuit they are meant to be building
 * nowhere on it. Opening the code panel by default is right on a laptop, where
 * seeing the wire that `digitalWrite(13, …)` refers to while writing it is the
 * whole point of a docked panel, and wrong on a phone, where the two cannot
 * share the screen at all.
 *
 * `useSyncExternalStore` rather than an effect, for the reason the width store
 * above gives at length: this value is read while producing the first client
 * render, and any approach that reads it in an effect renders once wrong and
 * once right — a visible flash of the panel opening and closing. It matters
 * here more than for the width, because /dev/editor server-renders this
 * component (it is only the student route that loads it with `ssr: false`), so
 * a plain `window.innerWidth` read would be a hydration mismatch.
 * `getServerSnapshot` returns the desktop answer, which is what the server has
 * to assume, and React adopts the real one on the client in the same commit.
 */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, getNarrowServerSnapshot)
}

function subscribeNarrow(onChange: () => void): () => void {
  const mq = window.matchMedia(NARROW)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getNarrowSnapshot(): boolean {
  return window.matchMedia(NARROW).matches
}

/** No viewport on the server; the desktop layout is the honest assumption. */
function getNarrowServerSnapshot(): boolean {
  return false
}

/**
 * Resizes the code panel by pointer OR keyboard.
 *
 * `role="separator"` with a `tabIndex` is the ARIA window-splitter pattern, and
 * the keyboard half is not optional here: the pointer half is a 5-pixel target,
 * which is unusable with a trackpad on a laptop and impossible with a switch or
 * a head pointer. Arrow keys move it, Home/End go to the stops.
 */
export function CodePanelResizer({
  width,
  onWidth,
}: {
  width: number
  onWidth: (next: number) => void
}) {
  const clamp = (v: number) => Math.min(CODE_PANEL_MAX, Math.max(CODE_PANEL_MIN, v))

  /**
   * The drag listens on the WINDOW, and pointer capture is best-effort.
   *
   * Capturing on the handle and listening there is the tidier-looking version
   * and it is the one that broke: `setPointerCapture()` THROWS
   * `InvalidPointerId` whenever the pointer is not currently active, and a throw
   * inside the handler means the move/up listeners below it are never attached
   * at all — the handle simply does not drag. It was caught here with a
   * synthetic drag, but the same shape fails for real: a pointerdown whose
   * pointer is released before the handler runs, a stylus that lifts, a browser
   * that has already implicitly released capture.
   *
   * Window listeners also fix the ordinary case the element-scoped version got
   * wrong anyway — dragging FASTER than the layout can follow puts the cursor
   * outside a 6-pixel-wide handle, and without capture those moves would never
   * have arrived.
   */
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Nice to have — it keeps the cursor's hit target on the handle — but the
      // window listeners below are what actually make the drag work.
    }
    const startX = e.clientX
    const startWidth = width

    const move = (ev: PointerEvent) => onWidth(clamp(startWidth - (ev.clientX - startX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // A wider panel means a smaller canvas, so ArrowLeft — which visually drags
    // the divider left — has to INCREASE the width.
    const next =
      e.key === 'ArrowLeft'
        ? width + NUDGE
        : e.key === 'ArrowRight'
          ? width - NUDGE
          : e.key === 'Home'
            ? CODE_PANEL_MAX
            : e.key === 'End'
              ? CODE_PANEL_MIN
              : null
    if (next === null) return
    e.preventDefault()
    onWidth(clamp(next))
  }

  return (
    <div
      data-testid="code-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize code panel"
      aria-valuenow={Math.round(width)}
      aria-valuemin={CODE_PANEL_MIN}
      aria-valuemax={CODE_PANEL_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="hidden w-1.5 shrink-0 cursor-col-resize bg-[#dfe3e8] transition-colors hover:bg-[#1477d1] focus:bg-[#1477d1] focus:outline-none md:block"
    />
  )
}
