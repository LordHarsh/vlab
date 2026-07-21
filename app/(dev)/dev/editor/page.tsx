import { notFound } from 'next/navigation'
import { CircuitEditor } from '@/components/simulator/CircuitEditor'

/**
 * Phase 1 circuit editor harness. Development only, gated the same way as
 * /dev/simulator — see proxy.ts and the NODE_ENV check below.
 */
export default function DevEditorPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <CircuitEditor />
}
