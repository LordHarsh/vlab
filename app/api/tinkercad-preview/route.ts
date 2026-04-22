import { NextRequest, NextResponse } from 'next/server'

// Server-side proxy: scrapes the og:image from Tinkercad's design page.
// Returns { imageUrl: string | null, designUrl: string }
// The og:image contains the rev param needed for the thumbnail CDN.

export async function GET(req: NextRequest) {
  const designId = req.nextUrl.searchParams.get('id')
  if (!designId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }

  const designUrl = `https://www.tinkercad.com/things/${designId}`

  try {
    const res = await fetch(designUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VLabBot/1.0)',
        Accept: 'text/html',
      },
      next: { revalidate: 3600 }, // cache for 1 hour
    })

    if (!res.ok) {
      return NextResponse.json({ imageUrl: null, designUrl }, { status: 200 })
    }

    const html = await res.text()

    // Extract og:image meta tag
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)

    const imageUrl = match?.[1] ?? null

    return NextResponse.json({ imageUrl, designUrl }, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch {
    return NextResponse.json({ imageUrl: null, designUrl }, { status: 200 })
  }
}
