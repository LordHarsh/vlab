import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/labs(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/pending-approval',
  '/profile(.*)',
  '/api/webhooks(.*)',
  // Clerk proxies its auth traffic through here on vercel.app domains.
  // Gating it would redirect Clerk's own endpoints to sign-in.
  '/__clerk(.*)',
  // Unauthenticated simulator harness, development only. The page itself also
  // calls notFound() outside development, so this matcher cannot expose
  // anything in a production deploy even if the two ever drift.
  // /sim holds the compiled .hex fixtures — the matcher below does not exempt
  // .hex the way it does .png/.css, so without this they redirect to sign-in.
  ...(process.env.NODE_ENV === 'development'
    ? ['/dev(.*)', '/sim(.*)', '/vendor(.*)', '/api/dev(.*)']
    : []),
])

// Next.js 16: Export middleware as 'proxy'
export const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
