/**
 * The AVR toolchain, run in a worker thread on the SERVER.
 *
 * WHY A WORKER THREAD AND NOT A FUNCTION CALL. `mod.callMain()` is synchronous
 * WebAssembly: once cc1plus starts, nothing else in that thread runs until it
 * returns. In a Next.js route that thread is the server's event loop, so a
 * sketch that makes the compiler take ten seconds — deep template recursion is
 * the classic — would stall every other request, and there would be no way to
 * abort it. A worker gives the caller the one thing an in-process compile
 * cannot: `terminate()`. That is what makes "cap compile time" true rather than
 * aspirational.
 *
 * WHY THIS IS .mjs AND LOADED BY ABSOLUTE PATH. It must reach the runtime as a
 * file Node can execute, not as something a bundler has rewritten — and it must
 * be able to `import()` the four Emscripten glue modules out of `.cache/avr/`,
 * whose paths are only known at run time. build.ts therefore resolves it from
 * `process.cwd()` and never lets the bundler see a static specifier.
 *
 * WHY THE LICENCE ALLOWS THIS AT ALL. `cc1plus.wasm` is compiled GCC and the
 * binutils are compiled binutils; both are GPL-3.0-or-later, and
 * docs/AVR_COMPILE_FINDINGS.md correctly concluded that SERVING those binaries to a
 * student's browser is conveying under §6 and would oblige us to supply
 * Corresponding Source that upstream does not publish. Running them here does
 * not convey anything: GPLv3 §0 says in terms that "mere interaction with a
 * user through a computer network, with no transfer of a copy, is not
 * conveying". The student receives Intel HEX — the compiler's OUTPUT, which
 * GCC's Runtime Library Exception and avr-libc's BSD licence already cover, and
 * which the three .hex files in public/sim/ have been shipping for months. No
 * .wasm ever leaves this process. (GPL-3.0, note, not AGPL-3.0: the AGPL's §13
 * is the clause that would have made network use a conveyance, and neither GCC
 * nor binutils carries it.)
 *
 * SHARED LINEAGE WITH scripts/build-avr-hex.mjs. That script is the reproducible
 * builder for the committed .hex files and remains the authority on HOW the
 * toolchain is driven — the flag list, the -Tdata origins, the hooks shim, the
 * avr6 core build. This file is the same recipe with three differences that only
 * matter when the input is a stranger's: it never touches the disk for output,
 * it stops at the first stage that reports an error instead of running on into a
 * confusing link failure, and it returns diagnostics as data. The two are pinned
 * together by lib/simulator/__tests__/sketchbuild.test.ts, which rebuilds every
 * shipped .hex through THIS file and compares bytes.
 */

// Bare specifiers, NOT `node:`. This file is loaded by absolute path at
// runtime, but Turbopack's Node-file-trace pass still walks it from build.ts
// and cannot resolve a `node:`-prefixed builtin when writing the .nft.json —
// `next build` dies with `NftJsonAsset: cannot handle filepath node:crypto`.
// Identical resolution at runtime; see the same note in build.ts.
import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { parentPort, workerData } from 'worker_threads'

/* ── boards ──────────────────────────────────────────────────────────────
 * Kept identical to scripts/build-avr-hex.mjs. `dataOrigin` is the entry that
 * silently ruins a build if it is wrong: ld's avr5/avr6 emulations default
 * .data to 0x800060, but on both parts the bytes below RAMSTART are the
 * memory-mapped I/O registers, so the default lays every global on top of the
 * UART and timer registers — links clean, runs, emits garbage.
 */
const BOARDS = {
  arduino_uno: {
    mcu: 'atmega328p',
    multilib: 'avr5',
    dataOrigin: '0x800100',
    defines: ['-D__AVR_ATmega328P__', '-D__AVR_DEVICE_NAME__=atmega328p', '-DARDUINO_AVR_UNO'],
    nFlash: 1,
    deviceHeaders: [/iom328p\.h$/],
    coreFromSource: false,
    /**
     * Core units the prebuilt 328P object set omits, compiled on demand.
     *
     * The shipped objects cover 15 core translation units but NOT
     * WInterrupts.o, so `attachInterrupt` — which the water-flow experiment's
     * published sketch calls three times — failed at link with "undefined
     * reference". One extra unit from the pinned 1.8.7 sources closes it, and
     * compiling a .c as C++ is safe for the reason HOOKS_SHIM documents:
     * Arduino.h wraps these declarations in `extern "C"`, so the definitions
     * inherit C linkage.
     *
     * `needle` IS NOT AN OPTIMISATION. WInterrupts.c defines the INT0/INT1
     * interrupt vectors, and a vector is reachable from the table in crt — so
     * `--gc-sections` cannot drop it, and linking it unconditionally added 162
     * bytes to EVERY Uno sketch. That silently broke the property that makes
     * this file trustworthy: scripts/build-avr-hex.mjs, which does not link
     * this unit, would no longer reproduce what a student gets. Compiling it
     * only when the source mentions the function keeps the two byte-identical
     * for every sketch that does not need it, which is nearly all of them. A
     * mention inside a comment costs 162 bytes and nothing else; a sketch that
     * somehow reaches attachInterrupt without naming it gets the same honest
     * link error it got before.
     */
    extraCoreUnits: [{ file: 'WInterrupts.c', needle: 'attachInterrupt' }],
    /** ATmega328P flash, minus the 512-byte optiboot bootloader. */
    flashLimit: 32256,
  },
  arduino_mega: {
    mcu: 'atmega2560',
    multilib: 'avr6',
    dataOrigin: '0x800200',
    defines: ['-D__AVR_ATmega2560__', '-D__AVR_DEVICE_NAME__=atmega2560', '-DARDUINO_AVR_MEGA2560'],
    nFlash: 4,
    deviceHeaders: [/iom2560\.h$/, /iomxx0_1\.h$/],
    coreFromSource: true,
    /** ATmega2560 flash, minus the 8 KB stk500v2 bootloader. */
    flashLimit: 253952,
  },
}

const CORE_UNITS = [
  'wiring.c', 'wiring_analog.c', 'wiring_digital.c', 'wiring_shift.c',
  'main.cpp', 'abi.cpp', 'HardwareSerial.cpp', 'HardwareSerial0.cpp',
  'Print.cpp', 'Stream.cpp', 'Tone.cpp', 'WMath.cpp', 'WString.cpp', 'new.cpp',
]

/**
 * hooks.c with C linkage. The package ships cc1plus and no cc1, so every core
 * .c compiles as C++; `static void __empty()` then mangles and the weak alias
 * names a symbol that does not exist, breaking every delay(). See the same
 * constant in scripts/build-avr-hex.mjs for the full diagnosis.
 */
const HOOKS_SHIM = `
extern "C" {
  static void __empty() { }
  void yield(void) __attribute__ ((weak, alias("__empty")));
}
`

const WASM_FILE = {
  cc1plus: 'cc1plus.wasm',
  'avr-as': 'avr-as.wasm',
  'avr-ld': 'avr-ld.wasm',
  'avr-objcopy': 'avr-objcopy.wasm',
}

/* ── in-memory filesystem helpers ────────────────────────────────────────── */

function ensureDir(FS, dir) {
  if (!dir || dir === '/') return
  let cur = ''
  for (const part of dir.split('/').filter(Boolean)) {
    cur += `/${part}`
    try {
      FS.mkdir(cur)
    } catch {
      /* already there */
    }
  }
}

function put(FS, p, data) {
  ensureDir(FS, p.split('/').slice(0, -1).join('/'))
  FS.writeFile(p, data)
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function importDefault(file) {
  return import(new URL(`file:///${file.replace(/\\/g, '/')}`).href).then((m) => m.default)
}

/* ── the build ───────────────────────────────────────────────────────────── */

/**
 * Data bytes an Intel HEX actually loads — the number that must fit in flash.
 * Record type 00 only; 01/02/04 carry no program bytes.
 */
function countFlashBytes(hex) {
  let total = 0
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue
    if (parseInt(line.substring(7, 9), 16) === 0) total += parseInt(line.substring(1, 3), 16)
  }
  return total
}

async function build({ cpp, board, cacheDir }) {
  const spec = BOARDS[board]
  if (!spec) throw new Error(`unknown board "${board}"`)

  const pkgDir = path.join(cacheDir, 'wasm', 'package')
  if (!fs.existsSync(path.join(pkgDir, 'tools', 'cc1plus.wasm'))) {
    const err = new Error('TOOLCHAIN_MISSING')
    err.code = 'TOOLCHAIN_MISSING'
    throw err
  }

  const coreDir = path.join(cacheDir, 'ArduinoCore-avr-1.8.7')
  const libDir = path.join(cacheDir, 'avr')
  if (spec.coreFromSource && !fs.existsSync(path.join(libDir, 'avr', 'lib', 'avr6', 'libc.a'))) {
    const err = new Error('TOOLCHAIN_MISSING')
    err.code = 'TOOLCHAIN_MISSING'
    throw err
  }

  const createCc1plus = await importDefault(path.join(pkgDir, 'tools/cc1plus.mjs'))
  const createAvrAs = await importDefault(path.join(pkgDir, 'tools/avr-as.mjs'))
  const createAvrLd = await importDefault(path.join(pkgDir, 'tools/avr-ld.mjs'))
  const createObjcopy = await importDefault(path.join(pkgDir, 'tools/avr-objcopy.mjs'))

  /** Optional core units this particular sketch turns out to need. */
  const extraUnits = (spec.extraCoreUnits ?? []).filter((u) => cpp.includes(u.needle))

  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'assets/manifest.json'), 'utf8'))
  const asset = (p) =>
    new Uint8Array(fs.readFileSync(path.join(pkgDir, 'assets', p.replace(/^\/+/, ''))))

  /**
   * Diagnostics are collected PER STAGE and per translation unit.
   *
   * The build script lumps everything into one array, which is why a sketch
   * with a syntax error there reports the cc1plus errors AND a wall of
   * "undefined reference to `setup'" from a linker that should never have been
   * run. A student must not have to work out which half is theirs.
   */
  let stageDiagnostics = []

  async function run(tool, factory, args, setup, outPath) {
    const mod = await factory({
      noInitialRun: true,
      // Emscripten's browser path fetches the .wasm; under Node it must be
      // handed over directly or instantiation fails outright.
      wasmBinary: new Uint8Array(fs.readFileSync(path.join(pkgDir, 'tools', WASM_FILE[tool]))),
      print: () => {},
      printErr: (line) => line && stageDiagnostics.push(line),
    })
    if (setup) setup(mod.FS)
    let threw = null
    try {
      mod.callMain(args)
    } catch (e) {
      const message = String(e?.message ?? e)
      // Emscripten throws ExitStatus even on success when noInitialRun is set.
      if (e?.status !== 0 && !/exit\(0\)/.test(message)) threw = message
    }
    let out
    if (outPath) {
      try {
        out = mod.FS.readFile(outPath)
      } catch {
        out = undefined
      }
    }
    return { out, threw }
  }

  /**
   * Everything the compiler is allowed to see. The 310 device headers for parts
   * we do not emulate are filtered out — they are ~90% of the header tree.
   */
  const sysrootDir = path.join(pkgDir, 'assets/fs/sysroot')
  const seeds = []
  for (const f of walk(sysrootDir)) {
    const virtual = '/sysroot' + f.slice(sysrootDir.length).replace(/\\/g, '/')
    if (/\/avr\/io[a-z0-9_]+\.h$/i.test(virtual) && !spec.deviceHeaders.some((re) => re.test(virtual))) {
      continue
    }
    seeds.push([virtual, new Uint8Array(fs.readFileSync(f))])
  }
  if (spec.coreFromSource) {
    for (const f of walk(path.join(coreDir, 'cores/arduino'))) {
      seeds.push([`/arduino/core/${path.basename(f)}`, new Uint8Array(fs.readFileSync(f))])
    }
    seeds.push([
      '/arduino/variant/pins_arduino.h',
      new Uint8Array(fs.readFileSync(path.join(coreDir, 'variants/mega/pins_arduino.h'))),
    ])
  } else {
    for (const virtual of manifest.headerFiles) seeds.push([virtual, asset(`/fs${virtual}`)])
    // The handful of core SOURCES the prebuilt object set omits. Seeded beside
    // the shipped headers so `-I /arduino/core` resolves them the same way.
    for (const { file } of extraUnits) {
      seeds.push([
        `/arduino/core/${file}`,
        new Uint8Array(fs.readFileSync(path.join(coreDir, 'cores/arduino', file))),
      ])
    }
  }

  const seedFs = (FS) => {
    ensureDir(FS, '/build')
    for (const [p, b] of seeds) put(FS, p, b)
  }

  const cc1Args = (srcPath, name) => [
    '-quiet',
    '-imultilib', spec.multilib,
    ...spec.defines,
    '-DF_CPU=16000000L',
    '-DARDUINO=10819',
    '-DARDUINO_ARCH_AVR',
    '-isystem', '/sysroot/gcc/include',
    '-isystem', '/sysroot/avr/include',
    '-I', '/arduino/core',
    '-I', '/arduino/variant',
    ...(spec.coreFromSource ? [] : [
      '-I', '/arduino/libraries/Wire/src',
      '-I', '/arduino/libraries/SPI/src',
      '-I', '/arduino/libraries/Wire/src/utility',
      '-I', '/libraries/Servo/src',
      '-I', '/libraries/Servo/src/avr',
      '-I', '/libraries/DHT_sensor_library',
      '-I', '/libraries/Adafruit_Unified_Sensor',
      '-I', '/libraries/Adafruit_BMP085_Library',
      '-I', '/libraries/Adafruit_BusIO',
    ]),
    srcPath,
    `-mn-flash=${spec.nFlash}`,
    '-mno-skip-bug',
    '-quiet',
    '-dumpbase', `${name}.cpp`,
    `-mmcu=${spec.multilib}`,
    '-auxbase-strip', `/build/${name}.s`,
    '-Os',
    '-std=gnu++11',
    '-fpermissive',
    '-fno-exceptions',
    '-fno-threadsafe-statics',
    '-fno-rtti',
    '-fno-enforce-eh-specs',
    '-ffunction-sections',
    '-fdata-sections',
    '-o', `/build/${name}.s`,
  ]

  async function compileUnit(srcPath, name, extraSeed) {
    const c = await run('cc1plus', createCc1plus, cc1Args(srcPath, name), (FS) => {
      seedFs(FS)
      if (extraSeed) extraSeed(FS)
    }, `/build/${name}.s`)

    /**
     * cc1plus WRITES A PARTIAL .s EVEN WHEN IT HAS REPORTED ERRORS, so the
     * presence of output proves nothing. The honest signal is a diagnostic
     * whose severity is `error` — which is exactly what the caller checks — so
     * the assembler is only reached when the compiler said nothing fatal.
     */
    if (!c.out || stageDiagnostics.some((d) => /:\s*(?:fatal )?error:/.test(d))) {
      return { failed: 'compile' }
    }

    const a = await run('avr-as', createAvrAs,
      [`-mmcu=${spec.mcu}`, '-o', `/build/${name}.o`, `/build/${name}.s`],
      (FS) => put(FS, `/build/${name}.s`, c.out),
      `/build/${name}.o`)
    if (!a.out) return { failed: 'assemble' }
    return { obj: a.out }
  }

  const started = performance.now()
  const objects = []

  // ── the Arduino core ──────────────────────────────────────────────────
  // A core failure is OUR bug, never the student's, so its diagnostics are
  // never shown as if they were theirs.
  if (spec.coreFromSource) {
    const hooks = await compileUnit('/build/hooks_shim.cpp', 'core_hooks',
      (FS) => put(FS, '/build/hooks_shim.cpp', HOOKS_SHIM))
    if (hooks.failed) throw new Error(`core build failed (hooks): ${stageDiagnostics.slice(-5).join('; ')}`)
    objects.push(['/objects/core_hooks.o', hooks.obj])
    for (const unit of CORE_UNITS) {
      const name = `core_${unit.replace(/\.(c|cpp)$/, '')}`
      stageDiagnostics = []
      const r = await compileUnit(`/arduino/core/${unit}`, name)
      if (r.failed) throw new Error(`core build failed (${unit}): ${stageDiagnostics.slice(-5).join('; ')}`)
      objects.push([`/objects/${name}.o`, r.obj])
    }
  } else {
    for (const virtual of ['/objects/core_abi.o', ...manifest.objectGroups.base]) {
      objects.push([virtual, asset(virtual)])
    }
    for (const { file } of extraUnits) {
      const name = `core_${file.replace(/\.(c|cpp)$/, '')}`
      stageDiagnostics = []
      const r = await compileUnit(`/arduino/core/${file}`, name)
      if (r.failed) throw new Error(`core build failed (${file}): ${stageDiagnostics.slice(-5).join('; ')}`)
      objects.push([`/objects/${name}.o`, r.obj])
    }
  }
  const coreMs = performance.now() - started

  // ── the student's sketch ──────────────────────────────────────────────
  stageDiagnostics = []
  const sketchStarted = performance.now()
  const sketch = await compileUnit('/build/sketch.cpp', 'sketch',
    (FS) => put(FS, '/build/sketch.cpp', cpp))
  if (sketch.failed) {
    return {
      ok: false,
      stage: sketch.failed,
      diagnostics: stageDiagnostics,
      ms: Math.round(performance.now() - started),
    }
  }
  const compileMs = performance.now() - sketchStarted

  // ── link ──────────────────────────────────────────────────────────────
  const compileDiagnostics = stageDiagnostics // warnings worth keeping on success
  stageDiagnostics = []

  const libs = spec.coreFromSource
    ? [
        ['/libs/crtatmega2560.o', path.join(libDir, 'avr/lib/avr6/crtatmega2560.o')],
        ['/libs/libc.a', path.join(libDir, 'avr/lib/avr6/libc.a')],
        ['/libs/libm.a', path.join(libDir, 'avr/lib/avr6/libm.a')],
        ['/libs/libgcc.a', path.join(libDir, 'lib/gcc/avr/7.3.0/avr6/libgcc.a')],
      ]
    : null

  const elf = await run('avr-ld', createAvrLd, [
    '-m', spec.multilib,
    `-Tdata=${spec.dataOrigin}`,
    '--gc-sections',
    '-o', '/build/sketch.elf',
    `/libs/crt${spec.mcu}.o`,
    '/build/sketch.o',
    ...objects.map(([p]) => p),
    '-L/libs', '-lm', '-lc', '-lgcc',
  ], (FS) => {
    put(FS, '/build/sketch.o', sketch.obj)
    for (const [p, b] of objects) put(FS, p, b)
    if (libs) {
      put(FS, `/ldscripts/${spec.multilib}.xn`,
        new Uint8Array(fs.readFileSync(path.join(libDir, `avr/lib/ldscripts/${spec.multilib}.xn`))))
      for (const [dst, src] of libs) put(FS, dst, new Uint8Array(fs.readFileSync(src)))
    } else {
      put(FS, `/ldscripts/${spec.multilib}.xn`, asset(`/ldscripts/${spec.multilib}.xn`))
      for (const virtual of manifest.libs) put(FS, virtual, asset(virtual))
    }
  }, '/build/sketch.elf')

  if (!elf.out) {
    /**
     * A LINK failure is usually the student's too, and usually one of two
     * things: they called a function that does not exist, or they called one
     * this toolchain cannot provide. `attachInterrupt` is the live example —
     * the package ships no WInterrupts object, so it fails HERE rather than in
     * the compiler. Passing the linker's own words through is what lets the
     * route turn that into an honest sentence.
     */
    return {
      ok: false,
      stage: 'link',
      diagnostics: stageDiagnostics,
      ms: Math.round(performance.now() - started),
    }
  }

  const hexOut = await run('avr-objcopy', createObjcopy,
    ['-O', 'ihex', '-R', '.eeprom', '/build/sketch.elf', '/build/sketch.hex'],
    (FS) => put(FS, '/build/sketch.elf', elf.out),
    '/build/sketch.hex')
  if (!hexOut.out) {
    return {
      ok: false,
      stage: 'objcopy',
      diagnostics: stageDiagnostics,
      ms: Math.round(performance.now() - started),
    }
  }

  const hex = new TextDecoder().decode(hexOut.out)
  const flashBytes = countFlashBytes(hex)

  /**
   * A sketch that does not fit is a FAILURE, not a warning.
   *
   * avr-ld links it happily — there is no size check in the linker script we
   * drive — and the engine would then load an image that a real board could
   * never hold. Reporting it in the compiler's own idiom keeps the lie out.
   */
  if (flashBytes > spec.flashLimit) {
    return {
      ok: false,
      stage: 'size',
      diagnostics: [
        `sketch too big: ${flashBytes} bytes used of ${spec.flashLimit} available on the ${spec.mcu}`,
      ],
      ms: Math.round(performance.now() - started),
    }
  }

  return {
    ok: true,
    hex,
    flashBytes,
    flashLimit: spec.flashLimit,
    sha256: createHash('sha256').update(hex).digest('hex'),
    diagnostics: compileDiagnostics,
    ms: Math.round(performance.now() - started),
    coreMs: Math.round(coreMs),
    compileMs: Math.round(compileMs),
  }
}

build(workerData)
  .then((result) => parentPort.postMessage(result))
  .catch((e) =>
    parentPort.postMessage({
      ok: false,
      stage: e?.code === 'TOOLCHAIN_MISSING' ? 'toolchain' : 'internal',
      diagnostics: [String(e?.message ?? e)],
      ms: 0,
    }),
  )
