import Link from 'next/link'
import { INSTITUTION } from '@/lib/institution'

/**
 * Frame for the Clerk-hosted sign-in / sign-up / onboarding forms.
 *
 * The reference site has no auth at all, so there is nothing to copy directly.
 * What it does have is a consistent institutional frame on every page, and that
 * is what is applied here: the department wordmark over the sage-and-circuit
 * board treatment from its dashboard, so arriving at the sign-in page does not
 * feel like landing on a different product.
 */
export function AuthShell({
  children,
  caption,
}: {
  children: React.ReactNode
  /** One line under the wordmark saying what this page is for. */
  caption?: string
}) {
  return (
    <div className="vlab-circuit-bg flex min-h-screen flex-col bg-vlab-sage">
      <header className="vlab-header-rule bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <Link href="/" className="min-w-0">
            <span className="block font-display text-base font-bold leading-tight text-vlab-600 sm:text-lg">
              {INSTITUTION.platform.toUpperCase()}
            </span>
            <span className="hidden truncate font-chrome text-[11px] uppercase tracking-[0.11em] text-vlab-muted sm:block">
              {INSTITUTION.department}
            </span>
          </Link>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        {caption ? (
          <p className="mb-5 max-w-sm text-center font-chrome text-sm font-semibold text-white/90">
            {caption}
          </p>
        ) : null}
        {children}
      </div>

      <p className="px-4 pb-6 text-center font-chrome text-xs text-white/70">
        {INSTITUTION.programme}
      </p>
    </div>
  )
}

/**
 * Clerk appearance overrides, shared by both auth pages so the two forms cannot
 * drift apart. Squared corners, a real border, no drop shadow — the same
 * controls as the rest of the platform.
 */
export const clerkAppearance = {
  elements: {
    rootBox: 'shadow-none',
    card: 'shadow-none border border-vlab-rule-strong rounded-sm',
    headerTitle: 'font-chrome text-vlab-800 font-bold',
    headerSubtitle: 'text-vlab-muted',
    formButtonPrimary:
      'bg-vlab-600 hover:bg-vlab-700 text-white rounded-sm font-chrome font-semibold normal-case',
    formFieldInput: 'rounded-sm border-vlab-rule-strong',
    footerActionLink: 'text-vlab-600 hover:text-vlab-800',
    socialButtonsBlockButton: 'rounded-sm border-vlab-rule-strong',
  },
} as const
