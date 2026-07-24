'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Play, RotateCcw, Square, X } from 'lucide-react'

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

/** Same 4 spaces PEP 8 asks for, and the same the authored scripts use. */
const INDENT = '    '

export type CodePanelStatus = 'loading' | 'stopped' | 'running'

export interface CodePanelProps {
  /** Board this code is bound to, e.g. "Raspberry Pi Pico". */
  boardLabel: string
  /** The placed part's id — Tinkercad's selector keys on the board's name. */
  boardId: string
  /** The draft: what is in the editor, which is NOT necessarily what is running. */
  source: string
  onSourceChange: (next: string) => void
  /** True when the draft differs from the source the board was given. */
  dirty: boolean
  status: CodePanelStatus
  /** How far the REPL hand-off has got, in the editor's own words. */
  replLabel: string
  /** Everything the emulated USB serial link has produced. */
  serial: string
  /** False when this experiment ships no authored script to go back to. */
  canReset: boolean
  onReset: () => void
  /** Load the draft onto the board and run it. Reboots the interpreter. */
  onRun: () => void
  onStop: () => void
  onClose: () => void
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
}: CodePanelProps) {
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
  const traceback = lastTraceback(serial)

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

  const statusText =
    status === 'loading'
      ? 'Loading MicroPython…'
      : dirty
        ? 'Edited — press Run to load this onto the board'
        : status === 'running'
          ? `On the board · ${replLabel}`
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

        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider text-[#566573]">
          MicroPython
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
          disabled={status === 'loading'}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[3px] px-3 text-xs font-semibold text-white transition-colors disabled:opacity-40 ${
            status === 'running' && !dirty
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {status === 'running' && !dirty ? (
            <>
              <Square className="h-3 w-3" aria-hidden="true" />
              Stop
            </>
          ) : (
            <>
              <Play className="h-3 w-3" aria-hidden="true" />
              {dirty ? 'Run new code' : 'Run'}
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
          className={`ml-auto text-[11px] ${dirty ? 'text-[#b45309]' : 'text-[#566573]'}`}
        >
          {statusText}
        </span>
      </div>

      {/* Editor. The gutter is a sibling rather than a background image so the
          numbers stay selectable-proof — a student copying their code must not
          get line numbers in the clipboard. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <label htmlFor="code-editor-input" className="sr-only">
          MicroPython source for {boardLabel}
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
          Tab indents, Shift-Tab outdents, Ctrl-Enter runs. Running restarts the board — MicroPython
          reboots and your program starts again from the top.
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
          Serial monitor
          {traceback && (
            <span
              data-testid="code-error-badge"
              className="ml-1.5 rounded-[3px] bg-red-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-red-700 normal-case"
            >
              error
            </span>
          )}
        </button>

        {serialOpen && (
          <div id="code-serial-body">
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
              aria-label="Serial monitor output"
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
/** One press of an arrow key. Coarse enough to be useful, fine enough to aim. */
const NUDGE = 24

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

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width

    const move = (ev: PointerEvent) => onWidth(clamp(startWidth - (ev.clientX - startX)))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
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
