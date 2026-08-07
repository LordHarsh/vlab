import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Open_Sans, Raleway, Roboto_Slab } from 'next/font/google'
import './globals.css'

/*
 * The reference labs load exactly this pairing from Google Fonts — Raleway for
 * chrome (header, sidebar, footer, `.markdown-body`) and Open Sans for reading
 * copy (`.vlabs-page-main`) — plus Roboto Slab on the department dashboard
 * shell. Self-hosted through next/font rather than <link>ed, so there is no
 * render-blocking third-party request and no layout shift on first paint.
 */
const openSans = Open_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-open-sans',
})

const raleway = Raleway({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-raleway',
})

const robotoSlab = Roboto_Slab({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '700'],
  variable: '--font-roboto-slab',
})

export const metadata: Metadata = {
  title: 'VLab — Virtual Laboratory for Electronics & Embedded Systems',
  description:
    'An interactive virtual laboratory for electronics and embedded systems. Every experiment runs the full sequence: aim, theory, procedure, simulation, assessment and references.',
}

/* The reference sets a theme-color on every lab sub-page so mobile browser
 * chrome picks up the institutional blue. Ours points at the token rather than
 * introducing a fourth ad-hoc blue the way the reference does. */
export const viewport: Viewport = {
  themeColor: '#337ab7',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${openSans.variable} ${raleway.variable} ${robotoSlab.variable}`}
      >
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
