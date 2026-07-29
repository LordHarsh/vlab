import { UserProfile } from '@clerk/nextjs'

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-vlab-surface-alt flex items-start justify-center py-12 px-4">
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'shadow-none w-full max-w-3xl',
            card: 'shadow-none border border-vlab-rule rounded-lg',
            navbar: 'border-r border-vlab-rule',
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
