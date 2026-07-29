import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-vlab-surface-alt flex items-center justify-center px-4">
      <SignUp
        appearance={{
          elements: {
            rootBox: 'shadow-none',
            card: 'shadow-none border border-vlab-rule rounded-lg',
            headerTitle: 'text-vlab-ink font-bold',
            headerSubtitle: 'text-vlab-muted',
            formButtonPrimary: 'bg-vlab-600 hover:bg-vlab-700 text-white rounded-lg',
            footerActionLink: 'text-vlab-600 hover:text-vlab-700',
          },
        }}
      />
    </div>
  )
}
