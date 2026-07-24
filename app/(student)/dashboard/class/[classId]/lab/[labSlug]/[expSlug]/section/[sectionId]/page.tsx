import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { markSectionVisited } from '@/lib/actions/progress'

// Section content components (server-side static ones)
import { AimSection } from '@/components/sections/AimSection'
import { TheorySection } from '@/components/sections/TheorySection'
import { ComponentsSection } from '@/components/sections/ComponentsSection'
import { CircuitSection } from '@/components/sections/CircuitSection'
import { ProcedureSection } from '@/components/sections/ProcedureSection'
import { CodeSection } from '@/components/sections/CodeSection'
import { ReferencesSection } from '@/components/sections/ReferencesSection'
import { TextSection } from '@/components/sections/TextSection'
import { VideoSection } from '@/components/sections/VideoSection'

// Client-side interactive components
import { SimulationSection } from '@/components/sections/SimulationSection'
import { QuizSection } from '@/components/sections/QuizSection'
import { FeedbackSection } from '@/components/sections/FeedbackSection'

/** Derives a display platform from the experiment slug, e.g. `dht11-rpi`. */
function platformFromSlug(slug: string | undefined): string | null {
  if (!slug) return null
  const s = slug.toLowerCase()
  if (s.includes('rpi') || s.includes('raspberry')) return 'Raspberry Pi'
  if (s.includes('arduino')) return 'Arduino'
  return null
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{
    classId: string
    labSlug: string
    expSlug: string
    sectionId: string
  }>
}) {
  const { classId, expSlug, sectionId } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const supabase = await createServerSupabaseClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('clerk_user_id', userId)
    .single()

  if (!profile) redirect('/onboarding')

  // Fetch section
  const { data: section } = await supabase
    .from('experiment_sections')
    .select('id, experiment_id, type, title, content, order_index')
    .eq('id', sectionId)
    .eq('status', 'active')
    .single()

  if (!section) notFound()

  // Mark section as visited
  await markSectionVisited(section.experiment_id, classId, sectionId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = section.content as any

  // For simulation sections: fetch config server-side so iframe src is a stable prop.
  // A client-side fetch causes re-renders that keep resetting the iframe src,
  // making Tinkercad restart its load cycle indefinitely.
  let simDesignId: string | null = null
  let simHeight = 500
  let simTitle = 'Interactive Simulation'
  // 'tinkercad' stays the default so a row that predates the type column, or one
  // whose type we do not recognise, still gets the permanent Tinkercad fallback.
  let simKind = 'tinkercad'
  let simType: string | null = null
  // The native editor autosaves against this simulation id; threaded through so
  // SimulationSection can build its RemoteTarget. Null for every non-native kind.
  let simSimulationId: string | null = null
  /**
   * This experiment's own published Arduino sketch, for the native editor to
   * open on.
   *
   * WHY IT IS READ HERE. The `code` section of an experiment is the listing the
   * student reads in the lab sheet, and it is the only place that listing
   * exists — nothing in the repository duplicates it. Handing the SAME text to
   * the editor is what makes "your experiment's sketch, editable" true rather
   * than approximately true, and it means an instructor who corrects the
   * listing corrects what the board runs, in one edit, with no deploy.
   *
   * It is one extra query, on `native` simulation sections only, against a row
   * this student is already permitted to read and already reading a click away.
   * The alternative — fetching it from the client after the editor mounts —
   * would put a loading state in front of the code panel and a second round
   * trip in front of the first compile.
   *
   * `language` is checked rather than assumed: six of the twelve experiments
   * publish Python for a Raspberry Pi, and handing THAT to a C++ compiler would
   * produce a screenful of syntax errors against code the student did not write
   * for this board. Those six run on the Pico track, which sources its script
   * from lib/simulator/pico/experiments.ts because it is a port rather than a
   * transcription.
   */
  let simStarterSketch: string | null = null
  if (section.type === 'simulation') {
    const simId: string | undefined = content?.simulation_id
    if (simId) {
      simSimulationId = simId
      const { data: sim } = await supabase
        .from('simulations')
        .select('title, type, config')
        .eq('id', simId)
        .single()
      const cfg = sim?.config as Record<string, unknown> | null
      simDesignId = (cfg?.design_id as string) ?? null
      simHeight = (cfg?.height as number) ?? 500
      simTitle = sim?.title ?? 'Interactive Simulation'
      simKind = sim?.type ?? 'tinkercad'
      simType = (cfg?.sim_type as string) ?? null
    }

    if (simKind === 'native') {
      const { data: codeSection } = await supabase
        .from('experiment_sections')
        .select('content')
        .eq('experiment_id', section.experiment_id)
        .eq('type', 'code')
        .eq('status', 'active')
        .order('order_index', { ascending: true })
        .limit(1)
        .maybeSingle()
      const codeContent = codeSection?.content as Record<string, unknown> | null
      if (codeContent?.language === 'arduino_c' && typeof codeContent.code === 'string') {
        simStarterSketch = codeContent.code
      }
    }
  }

  // Best effort only — there is no platform column, so fall back to the slug.
  // Must never throw: the simulations treat an absent platform as optional.
  const simPlatform = platformFromSlug(expSlug)

  function renderSection() {
    const c = content
    switch (section!.type) {
      case 'aim':
        return <AimSection content={c} />
      case 'theory':
        return <TheorySection content={c} />
      case 'components':
        return <ComponentsSection content={c} />
      case 'circuit':
        return <CircuitSection content={c} />
      case 'procedure':
        return <ProcedureSection content={c} />
      case 'code':
        return <CodeSection content={c} />
      case 'simulation':
        return (
          <SimulationSection
            type={simKind}
            simType={simType}
            designId={simDesignId}
            height={simHeight}
            title={simTitle}
            platform={simPlatform}
            simulationId={simSimulationId}
            classId={classId}
            experimentSlug={expSlug}
            starterSketch={simStarterSketch}
          />
        )
      case 'quiz': {
        const quizId: string | undefined = c?.quiz_id
        if (!quizId) {
          return (
            <div className="py-8 text-center text-[#6a6a6a]">Quiz not configured.</div>
          )
        }
        return <QuizSection quizId={quizId} classId={classId} />
      }
      case 'feedback': {
        const formId: string | undefined = c?.form_id
        if (!formId) {
          return (
            <div className="py-8 text-center text-[#6a6a6a]">
              Feedback form not configured.
            </div>
          )
        }
        return (
          <FeedbackSection
            formId={formId}
            experimentId={section!.experiment_id}
            classId={classId}
          />
        )
      }
      case 'references':
        return <ReferencesSection content={c} />
      case 'text':
        return <TextSection content={c} />
      case 'video':
        return <VideoSection content={c} />
      default:
        return (
          <div className="py-8 text-center text-[#6a6a6a]">
            Unknown section type: {section!.type}
          </div>
        )
    }
  }

  return (
    <div>
      {section.title && (
        <h1 className="text-xl font-bold text-[#222222] mb-6">{section.title}</h1>
      )}
      {renderSection()}
    </div>
  )
}
