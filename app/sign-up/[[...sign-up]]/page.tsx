import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center px-4">
      <SignUp
        appearance={{
          elements: {
            rootBox: 'shadow-none',
            card: 'shadow-none border border-[#e8e8e8] rounded-2xl',
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
