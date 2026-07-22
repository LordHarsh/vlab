import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

/**
 * Development-only build tool.
 *
 * Receives harvested component art from /vendor/harvest.html and writes it to
 * source. SIMULATOR_ARCHITECTURE.md §3 calls for harvesting wokwi-elements'
 * SVG and pinInfo at BUILD time rather than mounting the Lit components at
 * runtime — that keeps the art without taking on a web-component dependency,
 * shadow DOM, or their rendering lifecycle.
 *
 * Rendering Lit needs a real DOM, so the harvest runs in a browser and posts
 * the result here. The generated file is committed; the bundle is not shipped.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = await req.json()
  if (!body || typeof body !== 'object' || !body.parts) {
    return NextResponse.json({ error: 'expected { parts: {...} }' }, { status: 400 })
  }

  const target = join(process.cwd(), 'lib/simulator/model/wokwi-art.generated.json')
  await mkdir(dirname(target), { recursive: true })

  // Merge, so the harvest can run in batches. A single request carrying every
  // part's SVG is large enough to time out the browser automation channel.
  let existing: { parts?: Record<string, unknown> } = {}
  try {
    existing = JSON.parse(await readFile(target, 'utf8'))
  } catch {
    // first batch
  }

  const merged = {
    ...existing,
    ...body,
    parts: { ...(existing.parts ?? {}), ...body.parts },
  }
  await writeFile(target, JSON.stringify(merged, null, 1), 'utf8')

  const count = Object.keys(merged.parts).length
  return NextResponse.json({ ok: true, parts: count, path: target })
}
