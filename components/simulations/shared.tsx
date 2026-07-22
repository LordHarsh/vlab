'use client'

/**
 * Shared primitives for the built-in (non-Tinkercad) simulations.
 *
 * Behaviour is ported from the reference lab HTML (`simHTML` / `simLog` and the
 * per-experiment `sim*` functions). The reference uses a dark neon aesthetic;
 * these primitives deliberately re-skin it to the light, Tinkercad-like theme
 * the circuit editor uses:
 *
 *   surface #ffffff   panel bg #f4f5f6   tile bg #f1f1f3
 *   border  #dfe3e8   body #34495e       muted #6b7c8d
 *   accent  #1477d1   radius 5px         no drop shadows
 */

import { useCallback, useRef, useState } from 'react'

export const ACCENT = '#1477d1'

/* ── Log ──────────────────────────────────────────────────────────────── */

export type LogLine = { id: number; ts: string; msg: string }

/**
 * Port of `simLog`. The reference prepends `[time] msg` and truncates the
 * buffer; we keep newest-first and cap the number of lines instead of a raw
 * character count so a line is never cut in half.
 */
export function useSimLog(max = 40) {
  const [lines, setLines] = useState<LogLine[]>([])
  const seq = useRef(0)

  const log = useCallback(
    (msg: string) => {
      const ts = new Date().toLocaleTimeString()
      setLines((prev) => [{ id: seq.current++, ts, msg }, ...prev].slice(0, max))
    },
    [max]
  )

  return { lines, log }
}

export function SimLog({ lines, label = 'Serial monitor' }: { lines: LogLine[]; label?: string }) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[#6b7c8d]">
        {label}
      </div>
      <div
        className="max-h-[220px] min-h-[104px] w-full overflow-y-auto overflow-x-hidden rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] p-2.5 font-mono text-[11px] leading-[1.7] text-[#34495e] sm:text-[12px]"
        role="log"
        aria-live="polite"
      >
        {lines.length === 0 ? (
          <span className="text-[#6b7c8d]">Waiting for data…</span>
        ) : (
          lines.map((l) => (
            <div key={l.id} className="break-words">
              <span className="text-[#6b7c8d]">[{l.ts}]</span> {l.msg}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ── Panel ────────────────────────────────────────────────────────────── */

export function SimPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-full overflow-hidden rounded-[5px] border border-[#dfe3e8] bg-white p-3 text-[#34495e] sm:p-4">
      {children}
    </div>
  )
}

/** Grouping band inside a panel — e.g. the light cluster or the relay grid. */
export function SimStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[5px] border border-[#dfe3e8] bg-[#f4f5f6] px-3 py-4">{children}</div>
  )
}

/* ── Slider ───────────────────────────────────────────────────────────── */

export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <label
          htmlFor={`sl-${label}`}
          className="min-w-0 font-mono text-[11px] leading-tight text-[#6b7c8d] sm:text-[12px]"
        >
          {label}
        </label>
        <span className="shrink-0 font-mono text-[13px] tabular-nums text-[#1477d1] sm:text-[14px]">
          {display}
        </span>
      </div>
      <input
        id={`sl-${label}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full cursor-pointer accent-[#1477d1]"
      />
    </div>
  )
}

/* ── Buttons ──────────────────────────────────────────────────────────── */

export function CtrlButton({
  children,
  onClick,
  active = false,
  ...rest
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 min-h-9 shrink-0 rounded-[3px] border px-3 font-mono text-[11px] transition-colors sm:text-[12px] ${
        active
          ? 'border-[#1477d1] bg-[#1477d1]/10 text-[#1477d1]'
          : 'border-[#dfe3e8] bg-white text-[#34495e] hover:border-[#1477d1]'
      }`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function CtrlRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap gap-2">{children}</div>
}

/* ── LED ──────────────────────────────────────────────────────────────── */

const LED_OFF_FILL = '#e3e6ea'
const LED_OFF_BORDER = '#cfd6dd'

export function Led({
  on,
  color,
  size = 20,
}: {
  on: boolean
  color: string
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full border-2 transition-colors"
      style={{
        width: size,
        height: size,
        background: on ? color : LED_OFF_FILL,
        borderColor: on ? color : LED_OFF_BORDER,
        boxShadow: on ? `0 0 0 4px ${color}26` : 'none',
      }}
    />
  )
}

/** LED with a caption underneath — the reference's stacked light columns. */
export function LedStack({
  on,
  color,
  caption,
  size = 20,
}: {
  on: boolean
  color: string
  caption: string
  size?: number
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <Led on={on} color={color} size={size} />
      <span className="font-mono text-[10px] uppercase tracking-wide text-[#6b7c8d]">
        {caption}
      </span>
    </div>
  )
}

/** LED with an inline label — the reference's `led + lbl` pairs. */
export function LedRow({ on, color, label }: { on: boolean; color: string; label: string }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <Led on={on} color={color} />
      <span className="font-mono text-[12px] text-[#34495e]">{label}</span>
    </div>
  )
}
