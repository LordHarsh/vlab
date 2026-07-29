import { AuthShell } from '@/components/layout/AuthShell'

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AuthShell>{children}</AuthShell>
}
