import { notFound } from 'next/navigation'
import { SimsHarness } from './SimsHarness'

/**
 * Built-in simulation harness. Development only, gated the same way as
 * /dev/editor — see proxy.ts and the NODE_ENV check below.
 *
 * Renders every registered `sim_type` on one page so the simulations can be
 * exercised without a Clerk session or a class enrolment.
 */
export default function DevSimsPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <SimsHarness />
}
