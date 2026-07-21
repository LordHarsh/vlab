import { notFound } from 'next/navigation'
import { SimulatorHarness } from './harness'

/**
 * Unauthenticated Phase 0 harness for the native simulator.
 *
 * Development only. proxy.ts additionally only marks /dev(.*) public when
 * NODE_ENV === 'development', so this is gated in two independent places —
 * a production build serves a 404 even if the middleware matcher drifts.
 */
export default function DevSimulatorPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <SimulatorHarness />
}
