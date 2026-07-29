import { SignIn } from '@clerk/nextjs'
import { AuthShell, clerkAppearance } from '@/components/layout/AuthShell'

export default function SignInPage() {
  return (
    <AuthShell caption="Sign in to open the laboratories assigned to your class.">
      <SignIn appearance={clerkAppearance} />
    </AuthShell>
  )
}
