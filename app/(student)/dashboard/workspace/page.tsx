import { CircuitEditor } from '@/components/simulator/CircuitEditor'
import { BLANK } from '@/lib/simulator/model/examples'

/**
 * Free-form circuit workspace — a student's personal sandbox.
 *
 * Auth/enrollment gating and the StudentShell chrome both come from
 * app/(student)/layout.tsx (it redirects anyone without a completed profile and
 * wraps children in the shell), so this page renders content only — the same way
 * app/(student)/dashboard/page.tsx does. No extra auth check is added here.
 *
 * No `remote` prop is passed, so the editor autosaves to local IndexedDB only.
 * A free sandbox has neither a simulation_id nor a class_id, and sim_attempts
 * requires both, so local-only is the correct target here — not a shortcut.
 *
 * The editor owns a full 100dvh column. On desktop the shell's <main> is exactly
 * the viewport height, so the editor fills it with no second scrollbar; its own
 * side rail scrolls internally. The wrapper clips any sub-pixel overflow so the
 * shell's <main> never grows a scrollbar of its own.
 */
export default function WorkspacePage() {
  return (
    <div className="h-[100dvh] overflow-hidden">
      <CircuitEditor initial={BLANK} />
    </div>
  )
}
