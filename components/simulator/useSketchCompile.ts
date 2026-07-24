'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Diagnostic } from '@/lib/simulator/avr/ino'
import type { BoardType } from '@/lib/simulator/model/parts'

/**
 * Turning the student's C++ into firmware the emulator can load.
 *
 * WHY THE RESULT IS A BLOB URL. `useSimulator` already takes a URL, fetches it,
 * and posts the text to the worker — and it TAGS every piece of worker state
 * with that URL so a snapshot from the previous firmware can never be read as
 * the new one's. Handing it `URL.createObjectURL(new Blob([hex]))` therefore
 * costs no change to that hook at all, and gets the identity semantics exactly
 * right for free: a new compile is a new URL, which is a new worker, which is a
 * fresh ATmega with cleared SRAM. That is the same reboot a real board performs
 * when you flash it, so the model the student is being taught stays true.
 *
 * WHY COMPILING IS EXPLICIT. Typing changes a DRAFT and does not touch the
 * board — the same rule the MicroPython panel states in its header, and it
 * matters more here, not less: a compile is a network round trip and half a
 * second of somebody's CPU, so doing it on every keystroke would be both a
 * worse experience and a denial-of-service against our own server.
 */

export type CompileStatus = 'idle' | 'compiling' | 'ready' | 'error'

export interface SketchCompile {
  status: CompileStatus
  /** Blob URL of the compiled firmware, or '' when there is none. */
  hexUrl: string
  /**
   * The exact source that produced `hexUrl`, or null.
   *
   * This — not a boolean — is what makes "the board is running your previous
   * code" honest: it is compared against the draft on every render, so an edit
   * and an undo back to the compiled text correctly reports NOT dirty.
   */
  compiledSource: string | null
  /** Errors when the compile failed; warnings when it succeeded. */
  diagnostics: Diagnostic[]
  flashBytes: number
  flashLimit: number
  /** Milliseconds the server spent in the toolchain. */
  ms: number
  /** True when the server answered from its content-hash cache. */
  cached: boolean
  /**
   * A transport or authorisation failure — NOT a compiler error.
   *
   * Kept apart from `diagnostics` on purpose. "You are not enrolled in this
   * class" and "expected ';' before '}'" are both red text, but only one of
   * them is about the student's code, and showing them in the same place would
   * teach a student to read a network problem as a mistake they made.
   */
  error: string | null
  /**
   * Compile `source` for `board`.
   *
   * THE BOARD IS AN ARGUMENT, NOT A HOOK OPTION, and that is a bug fix rather
   * than a preference. The first version closed over a board derived from the
   * document, which is the neutral BLANK seed on the render where the restore
   * effect fires — so the first compile of a restored MEGA circuit would have
   * been built for an ATmega328P. A 328P image on a Mega does not error: it
   * runs, and moves whichever pads the 328P's register addresses happen to name
   * on an ATmega2560. Passing the board with the source makes it impossible for
   * the two to come from different renders.
   */
  compile: (source: string, board: CompileBoard) => void
}

/** The two AVRs. A Pico document has no compile step and never calls this. */
export type CompileBoard = Extract<BoardType, 'arduino_uno' | 'arduino_mega'>

export interface SketchCompileOptions {
  /** Passed through for the enrollment check. Absent in the free-form workspace. */
  classId?: string
  /** False for a Pico document, which has no compile step. */
  enabled: boolean
}

interface CompileResponse {
  ok?: boolean
  hex?: string
  flashBytes?: number
  flashLimit?: number
  diagnostics?: Diagnostic[]
  ms?: number
  cached?: boolean
  stage?: string
  error?: string
}

export function useSketchCompile({ classId, enabled }: SketchCompileOptions): SketchCompile {
  const [status, setStatus] = useState<CompileStatus>('idle')
  const [hexUrl, setHexUrl] = useState('')
  const [compiledSource, setCompiledSource] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [flash, setFlash] = useState({ bytes: 0, limit: 0 })
  const [timing, setTiming] = useState({ ms: 0, cached: false })
  const [error, setError] = useState<string | null>(null)

  /**
   * Every blob URL this hook has minted and not yet revoked.
   *
   * Revoking eagerly — the moment a new compile replaces the old URL — is
   * WRONG, and it took a hang to notice: `useSimulator` fetches the URL from an
   * effect, and React may still be committing the render that used the previous
   * one. Revoke it under that fetch and it fails with a bare network error on a
   * firmware that was perfectly good. So old URLs are held and released on
   * unmount, when nothing can be reading them. A handful of a few-KB strings is
   * a trade worth making against a race that presents as "the board stopped
   * working and the console says nothing".
   */
  const minted = useRef<string[]>([])
  useEffect(
    () => () => {
      for (const url of minted.current) URL.revokeObjectURL(url)
      minted.current = []
    },
    [],
  )

  /**
   * Sequence number, so a slow compile cannot overwrite a fast one that started
   * later. Without it a student who fixes an error and re-runs quickly can be
   * shown the older failure — and, worse, be given the older firmware.
   */
  const seq = useRef(0)
  /** Abort the previous request rather than leaving it to finish unwatched. */
  const inflight = useRef<AbortController | null>(null)
  useEffect(() => () => inflight.current?.abort(), [])

  const compile = useCallback(
    (source: string, board: CompileBoard) => {
      if (!enabled) return
      const mine = ++seq.current
      inflight.current?.abort()
      const controller = new AbortController()
      inflight.current = controller

      setStatus('compiling')
      setError(null)

      fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, board, classId }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as CompileResponse
          if (seq.current !== mine) return

          if (!res.ok) {
            setStatus('error')
            setDiagnostics([])
            setError(body.error ?? `Compile service returned ${res.status}`)
            return
          }

          setTiming({ ms: body.ms ?? 0, cached: body.cached ?? false })

          if (body.ok && typeof body.hex === 'string') {
            const url = URL.createObjectURL(new Blob([body.hex], { type: 'text/plain' }))
            minted.current.push(url)
            setHexUrl(url)
            setCompiledSource(source)
            setDiagnostics(body.diagnostics ?? [])
            setFlash({ bytes: body.flashBytes ?? 0, limit: body.flashLimit ?? 0 })
            setStatus('ready')
            return
          }

          /**
           * A failed compile leaves the PREVIOUS firmware alone.
           *
           * `hexUrl` and `compiledSource` are untouched, which is what a real
           * board does: a failed upload does not erase the chip. The panel then
           * says both true things at once — the board is still running the last
           * good build, and the new code does not compile — instead of
           * pretending the board went blank.
           */
          setDiagnostics(body.diagnostics ?? [])
          setStatus('error')
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted || seq.current !== mine) return
          setStatus('error')
          setDiagnostics([])
          setError(e instanceof Error ? e.message : String(e))
        })
    },
    [classId, enabled],
  )

  return {
    status,
    hexUrl,
    compiledSource,
    diagnostics,
    flashBytes: flash.bytes,
    flashLimit: flash.limit,
    ms: timing.ms,
    cached: timing.cached,
    error,
    compile,
  }
}
