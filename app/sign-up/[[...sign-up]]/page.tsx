import { SignUp } from '@clerk/nextjs'
import { AuthShell, clerkAppearance } from '@/components/layout/AuthShell'

export default function SignUpPage() {
  return (
    <AuthShell caption="Register to enrol in a class. Educator accounts are reviewed by the department before activation.">
      <SignUp appearance={clerkAppearance} />
    </AuthShell>
  )
}
