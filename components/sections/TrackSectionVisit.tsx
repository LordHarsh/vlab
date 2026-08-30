'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { markSectionVisited } from '@/lib/actions/progress'

/**
 * Records the visit from the client so the tick can appear immediately.
 *
 * The section page used to await markSectionVisited during its own render,
 * which stored the visit but changed nothing on screen: the progress bar and
 * the sidebar ticks are rendered by the experiment layout, and Next keeps that
 * layout mounted while only [sectionId] changes. The counter therefore sat at
 * its page-load value until a manual reload. Refreshing only when the action
 * reports a new section keeps this from looping.
 */
export function TrackSectionVisit({
  experimentId,
  classId,
  sectionId,
}: {
  experimentId: string
  classId: string
  sectionId: string
}) {
  const router = useRouter()
  const recorded = useRef<string | null>(null)

  useEffect(() => {
    if (recorded.current === sectionId) return
    recorded.current = sectionId

    markSectionVisited(experimentId, classId, sectionId).then((changed) => {
      if (changed) router.refresh()
    })
  }, [experimentId, classId, sectionId, router])

  return null
}
