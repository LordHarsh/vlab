import { UserProfile } from '@clerk/nextjs'

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-[#f7f7f7] flex items-start justify-center py-12 px-4">
      <UserProfile
        appearance={{
          elements: {
            rootBox: 'shadow-none w-full max-w-3xl',
            card: 'shadow-none border border-[#e8e8e8] rounded-2xl',
            navbar: 'border-r border-[#e8e8e8]',
            headerTitle: 'text-[#222222] font-bold',
            headerSubtitle: 'text-[#6a6a6a]',
            formButtonPrimary: 'bg-[#ff385c] hover:bg-[#e0334f] text-white rounded-lg',
            footerActionLink: 'text-[#ff385c] hover:text-[#e0334f]',
          },
        }}
      />
    </div>
  )
}
