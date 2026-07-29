'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a message stays up before it fades itself out, in ms. */
const DWELL_MS = 2600

/**
 * A short-lived message explaining why a control in this panel did nothing.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ WHY THIS IS PANEL-LOCAL AND NOT A PORTAL TO `document.body`.            │
 * │                                                                         │
 * │ This panel has a fullscreen mode, and a fullscreen element renders ONLY │
 * │ its own subtree — anything portalled to the body is simply not painted  │
 * │ while it is up. A global toast would therefore be invisible in exactly  │
 * │ the mode where a student is most likely to be poking at the toolbar.    │
 * │ So the toast is rendered inside the panel, by the panel.                │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * It also means no provider, no context and no dependency on
 * `@radix-ui/react-toast` (which this project carries but has never mounted).
 * One string and one timer is the whole requirement.
 *
 * WHAT IT IS FOR. The toolbar around this circuit is mostly furniture — copy,
 * paste, delete, undo, the routing dropdowns. They used to be `<span>`s with
 * `aria-hidden`, on the reasoning that a control which cannot work should not
 * pretend to be one. The owner's judgement was that this reads as fake rather
 * than as honest, and a control that SAYS why it is unavailable is better than
 * one that is silently dead. So they are real buttons now, and pressing one
 * explains itself here.
 *
 * Re-pressing the same button restarts the dwell rather than queuing: a queue
 * would let a student's third impatient click keep a message up long after
 * they stopped reading it.
 */
export function useInertToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((next: string) => {
    setMessage(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(null), DWELL_MS)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { message, show }
}
