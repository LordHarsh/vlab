import { notFound } from 'next/navigation'
import { CircuitEditor } from '@/components/simulator/CircuitEditor'
import { FullscreenGate } from '@/components/simulator/FullscreenGate'

/**
 * Phase 1 circuit editor harness. Development only, gated the same way as
 * /dev/simulator — see proxy.ts and the NODE_ENV check below.
 *
 * Wrapped in the same FullscreenGate the student routes use, so the harness
 * exercises what a student actually sees rather than a privileged variant of it.
 */
export default function DevEditorPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <FullscreenGate label="circuit editor">
      <CircuitEditor />
    </FullscreenGate>
  )
}
