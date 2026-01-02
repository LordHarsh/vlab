import { redirect } from 'next/navigation'

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ category: string; experimentId: string }>
}) {
  const { category, experimentId } = await params

  // Redirect to the aim section by default
  redirect(`/labs/${category}/${experimentId}/aim`)
}
