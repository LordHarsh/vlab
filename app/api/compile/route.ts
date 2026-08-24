import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import {
  compileSketch,
  isCompileBoard,
  MAX_SOURCE_BYTES,
  type CompileResult,
} from '@/lib/simulator/avr/build'

/**
 * Compile a student's Arduino sketch to Intel HEX.
 *
 * This is the endpoint that closes the gap between the two tracks: a Pico
 * student has always been able to type MicroPython and watch it run, because
 * the interpreter is on the board. An Arduino student could not, because C++
 * needs a compiler and there is no lawful one to put in the browser —
 * docs/AVR_COMPILE_FINDINGS.md proved the WebAssembly toolchain WORKS and then
 * showed it cannot be shipped, since serving GPL-3.0 `cc1plus.wasm` to a
 * browser is conveying under §6 and obliges us to publish Corresponding Source
 * that upstream does not have. Running the identical toolchain here does not
 * convey it: GPLv3 §0 excludes "mere interaction with a user through a computer
 * network, with no transfer of a copy". The student receives Intel HEX, which
 * is compiler OUTPUT and already covered by GCC's Runtime Library Exception.
 *
 * THE NODE RUNTIME IS MANDATORY. The compile runs in a `worker_thread` reading
 * a 23 MB toolchain off the filesystem; neither exists on the Edge runtime.
 *
 * WHY THIS IS GATED. It executes a compiler on text a stranger typed. The gate
 * is four things, not one: a signed-in Clerk user (re-derived from the session,
 * never trusted from the body), enrollment when the request names a class, a
 * source-size cap, and — in build.ts — a hard timeout with a killable worker
 * plus a concurrency ceiling. Without them this is an open compile service
 * attached to somebody's Supabase bill.
 *
 * A COMPILER ERROR IS A 200. This is the part worth stating loudly, because
 * getting it wrong would defeat the point of the feature. A student writing
 * `Serial.begin(9600)` without a semicolon has not made a bad request — they
 * have done the ordinary thing that learning C++ consists of, and the response
 * they need is `expected ';' before '}' token` with a line number, exactly as
 * the Pico track hands back a Python traceback. So a failed compile is a
 * successful HTTP exchange carrying `ok: false` and structured diagnostics.
 * Non-200s are reserved for the request being wrong: not signed in, not
 * enrolled, malformed, or too big.
 */
export const runtime = 'nodejs'
/** Nothing here is cacheable by the framework; build.ts owns the real cache. */
export const dynamic = 'force-dynamic'

/**
 * One compile in flight per student.
 *
 * The global ceiling in build.ts stops the server running out of memory; this
 * stops one impatient student holding all of those slots while a class of forty
 * waits. Keyed on the Clerk id, cleared in a `finally` so a thrown request
 * cannot lock somebody out of the feature permanently.
 */
const inFlight = new Set<string>()

interface CompileRequest {
  source?: unknown
  board?: unknown
  classId?: unknown
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: CompileRequest
  try {
    body = (await req.json()) as CompileRequest
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const { source, board, classId } = body

  if (typeof source !== 'string') {
    return NextResponse.json({ error: 'source must be a string' }, { status: 400 })
  }
  if (!isCompileBoard(board)) {
    return NextResponse.json(
      { error: 'board must be "arduino_uno" or "arduino_mega"' },
      { status: 400 },
    )
  }

  /**
   * Measured in BYTES, not characters. A sketch full of astral-plane emoji is
   * two to four times its `.length` on the wire and in the compiler's buffer,
   * so counting UTF-16 units would let the cap be walked straight past.
   */
  const bytes = Buffer.byteLength(source, 'utf8')
  if (bytes > MAX_SOURCE_BYTES) {
    return NextResponse.json(
      {
        error: `Sketch is ${Math.round(bytes / 1024)} KB; the limit is ${MAX_SOURCE_BYTES / 1024} KB.`,
      },
      { status: 413 },
    )
  }

  /**
   * Enrollment, when the caller names a class.
   *
   * Mirrors studentContext() in lib/actions/simulator.ts rather than importing
   * it — that module is `'use server'`, so its exports are server ACTIONS with
   * a public HTTP surface of their own, and re-exporting a bare helper through
   * it would widen that surface for no gain.
   *
   * The free-form workspace at /dashboard/workspace has no class, and a
   * signed-in student is the whole of the gate there. That is deliberate: the
   * compiler returns nothing about anyone else's data, so enrollment protects
   * the resource, not a secret.
   */
  if (typeof classId === 'string' && classId !== '') {
    const supabase = await createServerSupabaseClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('clerk_user_id', userId)
      .single()
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('class_id', classId)
      .eq('student_id', profile.id)
      .eq('status', 'active')
      .single()
    if (!enrollment) {
      return NextResponse.json({ error: 'You are not enrolled in this class.' }, { status: 403 })
    }
  }

  if (inFlight.has(userId)) {
    return NextResponse.json(
      { error: 'A compile is already running. Wait for it to finish.' },
      { status: 429 },
    )
  }
  inFlight.add(userId)

  let result: CompileResult
  try {
    result = await compileSketch(source, board)
  } catch (e) {
    // compileSketch models failure as a result, so reaching here means the
    // module itself broke. Say so rather than blaming the student's code.
    return NextResponse.json(
      { error: `Compiler failed unexpectedly: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  } finally {
    inFlight.delete(userId)
  }

  return NextResponse.json(result, {
    status: 200,
    headers: {
      // The HEX belongs to one student's one revision of one sketch. build.ts
      // caches it in memory keyed on a hash of the exact bytes; letting a
      // shared cache hold it as well would only add a way for it to go stale.
      'Cache-Control': 'no-store',
    },
  })
}
