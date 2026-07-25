#!/usr/bin/env node
/**
 * Compile an Arduino sketch to Intel HEX with a toolchain that is entirely
 * WebAssembly — no avr-gcc, no arduino-cli, nothing installed on the machine.
 *
 *   node scripts/build-avr-hex.mjs --board uno  --sketch sketch.cpp --out out.hex
 *   node scripts/build-avr-hex.mjs --board mega --sketch sketch.cpp --out out.hex
 *
 * WHY THIS SCRIPT EXISTS AT ALL. public/sim/ held three .hex files built offline
 * with arduino-cli on a machine that no longer has it, which made every one of
 * them an unreproducible binary blob: nobody could change the blink rate, fix a
 * sketch, or build a fourth. public/sim/traffic-mega.hex — the ATmega2560 image
 * experiment 11 runs — was produced by this script, and can be produced again by
 * anyone with node and a network connection. See AVR_COMPILE_FINDINGS.md.
 *
 * THIS IS A BUILD-TIME SCRIPT, NOT THE PRODUCT. It runs the WASM modules under
 * Node so the output is reproducible and reviewable in CI. The same four modules
 * run in a browser Worker unchanged — that is the whole point of the finding —
 * but shipping them to students is a separate decision with a licence question
 * attached, and this script does not presume it.
 *
 * WHAT IT DOWNLOADS, once, into .cache/avr/ (gitignored):
 *
 *   @horang-corp/avr-gcc-wasm 0.2.0   11 MB  cc1plus/as/ld/objcopy as .wasm,
 *                                            avr-libc + Arduino headers, and
 *                                            ATmega328P core objects
 *   ArduinoCore-avr 1.8.7              7 MB  the core SOURCES, needed for the
 *                                            Mega because no 2560 objects exist
 *   avr-gcc 7.3.0-atmel3.6.1-arduino7 37 MB  target libraries only — the avr6
 *                                            multilib libc/libm/libgcc and
 *                                            crtatmega2560.o. NOT a compiler:
 *                                            no host binary from it is executed.
 *
 * The two Arduino downloads are resolved through downloads.arduino.cc's own
 * package index and checked against the SHA-256 the index publishes, so a
 * corrupted or substituted archive fails loudly instead of silently changing
 * what students run.
 *
 * REQUIRES `tar` on PATH able to read .tar.bz2 — bsdtar on Windows 10+, GNU tar
 * elsewhere. Node has no bzip2 decompressor, and adding a dependency to unpack
 * two build-time archives is not worth it.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = path.join(ROOT, '.cache', 'avr')

const WASM_PKG = '@horang-corp/avr-gcc-wasm'
const WASM_PKG_VERSION = '0.2.0'
const WASM_PKG_TARBALL = `https://registry.npmjs.org/${WASM_PKG}/-/avr-gcc-wasm-${WASM_PKG_VERSION}.tgz`
const ARDUINO_CORE_VERSION = '1.8.7'
const AVR_GCC_VERSION = '7.3.0-atmel3.6.1-arduino7'
/** The host build is irrelevant — only its `avr/lib/**` target libraries are read. */
const AVR_GCC_HOST = 'x86_64-linux-gnu'

// ─── boards ───────────────────────────────────────────────────────────────────

/**
 * Everything that differs between the two AVRs, in one table.
 *
 * `dataOrigin` is the one entry that will silently ruin a build if it is wrong.
 * ld's avr5/avr6 emulations default .data to 0x800060, but on both these parts
 * the bytes below RAMSTART are the memory-mapped I/O registers — 0x100 on a
 * 328P, 0x200 on a 2560. Left at the default, every global variable is laid on
 * top of the UART and timer registers: the firmware links cleanly, runs, and
 * emits garbage. avr-gcc's own driver passes -Tdata for you; driving ld directly
 * means passing it here.
 */
const BOARDS = {
  uno: {
    mcu: 'atmega328p',
    multilib: 'avr5',
    dataOrigin: '0x800100',
    defines: ['-D__AVR_ATmega328P__', '-D__AVR_DEVICE_NAME__=atmega328p', '-DARDUINO_AVR_UNO'],
    /** -mn-flash is the number of 64 KB flash pages; it sizes __memx pointers. */
    nFlash: 1,
    deviceHeaders: [/iom328p\.h$/],
    /** The package already ships 328P core objects, so nothing is built here. */
    coreFromSource: false,
  },
  mega: {
    mcu: 'atmega2560',
    multilib: 'avr6',
    dataOrigin: '0x800200',
    defines: ['-D__AVR_ATmega2560__', '-D__AVR_DEVICE_NAME__=atmega2560', '-DARDUINO_AVR_MEGA2560'],
    nFlash: 4,
    deviceHeaders: [/iom2560\.h$/, /iomxx0_1\.h$/],
    /**
     * The package ships ATmega328P objects only, so the whole Arduino core is
     * recompiled here for avr6. That is the interesting half of this script and
     * the thing that proves the WASM toolchain can build the core rather than
     * merely link against someone's prebuilt copy of it.
     */
    coreFromSource: true,
  },
}

/**
 * The core translation units built for the Mega, and the three that are not.
 *
 * WInterrupts.c is omitted (attachInterrupt), and so are the USB/CDC files,
 * which an AVR-with-no-USB-stack board does not use. wiring_pulse.S is omitted
 * because it is preprocessed assembly and the package ships no preprocessor
 * driver for .S — pulseIn() therefore fails at LINK time, loudly, rather than
 * behaving strangely at run time. --gc-sections drops whatever a sketch does not
 * reach, so the omissions cost nothing until a sketch needs one.
 */
const CORE_UNITS = [
  'wiring.c', 'wiring_analog.c', 'wiring_digital.c', 'wiring_shift.c',
  'main.cpp', 'abi.cpp', 'HardwareSerial.cpp', 'HardwareSerial0.cpp',
  'Print.cpp', 'Stream.cpp', 'Tone.cpp', 'WMath.cpp', 'WString.cpp', 'new.cpp',
]

/**
 * hooks.c, rewritten with C linkage — the one source change this script makes.
 *
 * The package ships cc1plus and no cc1, so every core .c is compiled as C++.
 * That is harmless for the wiring files, whose declarations Arduino.h already
 * wraps in `extern "C"`, so their definitions inherit C linkage. hooks.c is the
 * exception:
 *
 *     static void __empty() { }
 *     void yield(void) __attribute__ ((weak, alias("__empty")));
 *
 * In C++ the static function is mangled to _Z7__emptyv, so the alias names a
 * symbol that does not exist; cc1plus says "aliased to undefined symbol" and the
 * link then fails on delay()'s call to yield(). These four lines are the same
 * two declarations with the linkage the C compiler would have given them.
 */
const HOOKS_SHIM = `
extern "C" {
  static void __empty() { }
  void yield(void) __attribute__ ((weak, alias("__empty")));
}
`

// ─── fetching ─────────────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(`${msg}\n`)
}

async function download(url, dest, expectSha256) {
  if (fs.existsSync(dest)) return dest
  log(`  fetching ${path.basename(dest)} …`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (expectSha256) {
    const got = createHash('sha256').update(buf).digest('hex')
    if (got !== expectSha256) {
      throw new Error(`checksum mismatch for ${url}\n  expected ${expectSha256}\n  got      ${got}`)
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
  return dest
}

/**
 * Extract `archive` into `into`, optionally only the named members.
 *
 * The archive is passed as a path RELATIVE to the extraction directory, and tar
 * is run with its cwd there. That is not tidiness: GNU tar reads a leading
 * `E:\` as a remote host specification and fails with "Cannot connect to E:
 * resolve failed", and its `--force-local` escape is not accepted by the bsdtar
 * that ships with Windows. A relative path has no colon in it and works on both.
 */
function untar(archive, into, members = []) {
  fs.mkdirSync(into, { recursive: true })
  const rel = path.relative(into, archive).replace(/\\/g, '/')
  execFileSync('tar', ['xf', rel, ...members], {
    cwd: into,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
}

/** The WASM tools, avr-libc headers and 328P core objects. */
async function ensureWasmToolchain() {
  const dir = path.join(CACHE, 'wasm')
  if (!fs.existsSync(path.join(dir, 'package', 'tools', 'cc1plus.wasm'))) {
    const tgz = await download(WASM_PKG_TARBALL, path.join(CACHE, 'avr-gcc-wasm.tgz'))
    log('  extracting the WASM toolchain …')
    untar(tgz, dir)
  }
  return path.join(dir, 'package')
}

/** Arduino AVR core sources + the mega variant, and the avr6 target libraries. */
async function ensureArduinoSources(needsToolchainLibs) {
  const index = await download(
    'https://downloads.arduino.cc/packages/package_index.json',
    path.join(CACHE, 'package_index.json'),
  )
  const json = JSON.parse(fs.readFileSync(index, 'utf8'))
  const arduino = json.packages.find((p) => p.name === 'arduino')

  const platform = arduino?.platforms.find(
    (p) => p.architecture === 'avr' && p.version === ARDUINO_CORE_VERSION,
  )
  if (!platform) throw new Error(`Arduino AVR core ${ARDUINO_CORE_VERSION} is not in the package index`)
  const coreDir = path.join(CACHE, `ArduinoCore-avr-${ARDUINO_CORE_VERSION}`)
  if (!fs.existsSync(coreDir)) {
    const tgz = await download(
      platform.url,
      path.join(CACHE, path.basename(platform.url)),
      platform.checksum.replace(/^SHA-256:/, ''),
    )
    log('  extracting the Arduino AVR core …')
    untar(tgz, CACHE)
  }

  let libDir = null
  if (needsToolchainLibs) {
    libDir = path.join(CACHE, 'avr')
    if (!fs.existsSync(path.join(libDir, 'avr', 'lib', 'avr6', 'libc.a'))) {
      const tool = arduino?.tools.find((t) => t.name === 'avr-gcc' && t.version === AVR_GCC_VERSION)
      const system = tool?.systems.find((s) => s.host === AVR_GCC_HOST)
      if (!system) throw new Error(`avr-gcc ${AVR_GCC_VERSION} for ${AVR_GCC_HOST} is not in the index`)
      const tgz = await download(
        system.url,
        path.join(CACHE, path.basename(system.url)),
        system.checksum.replace(/^SHA-256:/, ''),
      )
      log('  extracting the avr6 target libraries …')
      untar(tgz, CACHE, [
        'avr/lib/gcc/avr/7.3.0/avr6/libgcc.a',
        'avr/avr/lib/ldscripts/avr6.xn',
        'avr/avr/lib/avr6/crtatmega2560.o',
        'avr/avr/lib/avr6/libm.a',
        'avr/avr/lib/avr6/libc.a',
      ])
    }
  }
  return { coreDir, libDir }
}

// ─── the in-memory filesystem the tools see ───────────────────────────────────

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

// ─── running the tools ────────────────────────────────────────────────────────

const WASM_FILE = {
  cc1plus: 'cc1plus.wasm',
  'avr-as': 'avr-as.wasm',
  'avr-ld': 'avr-ld.wasm',
  'avr-objcopy': 'avr-objcopy.wasm',
}

function makeRunner(pkgDir, diagnostics) {
  return async function run(tool, factory, args, setup, outPath) {
    const started = performance.now()
    const mod = await factory({
      noInitialRun: true,
      // Emscripten's browser path fetches the .wasm; under Node it must be handed
      // over directly or instantiation fails with "both async and sync fetching
      // of the wasm failed".
      wasmBinary: new Uint8Array(fs.readFileSync(path.join(pkgDir, 'tools', WASM_FILE[tool]))),
      print: () => {},
      printErr: (line) => line && diagnostics.push(`[${tool}] ${line}`),
    })
    if (setup) setup(mod.FS)
    try {
      mod.callMain(args)
    } catch (e) {
      const message = String(e?.message ?? e)
      // Emscripten throws ExitStatus even on success when noInitialRun is set.
      if (e?.status !== 0 && !/exit\(0\)/.test(message)) {
        throw new Error(`${tool} failed: ${message}\n${diagnostics.slice(-40).join('\n')}`)
      }
    }
    let out
    if (outPath) {
      try {
        out = mod.FS.readFile(outPath)
      } catch {
        throw new Error(`${tool} produced no ${outPath}\n${diagnostics.slice(-40).join('\n')}`)
      }
    }
    return { out, ms: performance.now() - started }
  }
}

// ─── build ────────────────────────────────────────────────────────────────────

async function build({ board, sketchPath, outPath }) {
  const spec = BOARDS[board]
  if (!spec) throw new Error(`unknown board "${board}" — expected uno or mega`)

  log(`preparing the toolchain (cached in ${path.relative(ROOT, CACHE)}) …`)
  const pkgDir = await ensureWasmToolchain()
  const { coreDir, libDir } = await ensureArduinoSources(spec.coreFromSource)

  const createCc1plus = (await importDefault(path.join(pkgDir, 'tools/cc1plus.mjs')))
  const createAvrAs = (await importDefault(path.join(pkgDir, 'tools/avr-as.mjs')))
  const createAvrLd = (await importDefault(path.join(pkgDir, 'tools/avr-ld.mjs')))
  const createObjcopy = (await importDefault(path.join(pkgDir, 'tools/avr-objcopy.mjs')))

  const diagnostics = []
  const run = makeRunner(pkgDir, diagnostics)
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'assets/manifest.json'), 'utf8'))
  const asset = (p) => new Uint8Array(fs.readFileSync(path.join(pkgDir, 'assets', p.replace(/^\/+/, ''))))

  // Headers: avr-libc and gcc's own, minus the 310 device headers for parts that
  // are not this one, plus the Arduino core headers. For the Mega the core
  // SOURCES go in too, because they are about to be compiled.
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

  /** One translation unit → an object file, via cc1plus then avr-as. */
  async function compileUnit(srcPath, name, extraSeed) {
    const c = await run('cc1plus', createCc1plus, cc1Args(srcPath, name), (FS) => {
      seedFs(FS)
      if (extraSeed) extraSeed(FS)
    }, `/build/${name}.s`)
    const a = await run('avr-as', createAvrAs,
      [`-mmcu=${spec.mcu}`, '-o', `/build/${name}.o`, `/build/${name}.s`],
      (FS) => put(FS, `/build/${name}.s`, c.out),
      `/build/${name}.o`)
    return { obj: a.out, ms: c.ms + a.ms }
  }

  const started = performance.now()
  const objects = []

  if (spec.coreFromSource) {
    log(`compiling the Arduino core for ${spec.mcu} (${CORE_UNITS.length + 1} units) …`)
    const hooks = await compileUnit('/build/hooks_shim.cpp', 'core_hooks',
      (FS) => put(FS, '/build/hooks_shim.cpp', HOOKS_SHIM))
    objects.push(['/objects/core_hooks.o', hooks.obj])
    for (const unit of CORE_UNITS) {
      const name = `core_${unit.replace(/\.(c|cpp)$/, '')}`
      const r = await compileUnit(`/arduino/core/${unit}`, name)
      objects.push([`/objects/${name}.o`, r.obj])
    }
  } else {
    for (const virtual of ['/objects/core_abi.o', ...manifest.objectGroups.base]) {
      objects.push([virtual, asset(virtual)])
    }
  }

  log(`compiling ${path.relative(ROOT, sketchPath)} …`)
  const source = fs.readFileSync(sketchPath, 'utf8')
  const sketch = await compileUnit('/build/sketch.cpp', 'sketch',
    (FS) => put(FS, '/build/sketch.cpp', source))

  log('linking …')
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

  const hexOut = await run('avr-objcopy', createObjcopy,
    ['-O', 'ihex', '-R', '.eeprom', '/build/sketch.elf', '/build/sketch.hex'],
    (FS) => put(FS, '/build/sketch.elf', elf.out),
    '/build/sketch.hex')

  const hex = new TextDecoder().decode(hexOut.out)
  const flash = countFlashBytes(hex)
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  fs.writeFileSync(outPath, hex)

  log('')
  log(`wrote ${outPath}`)
  log(`  board       : ${board} (${spec.mcu})`)
  log(`  flash used  : ${flash} bytes`)
  log(`  wall clock  : ${(performance.now() - started).toFixed(0)} ms`)
  const warnings = diagnostics.filter((d) => !d.startsWith('[avr-as]'))
  if (warnings.length) {
    log(`  diagnostics : ${warnings.length} (first 10 below)`)
    for (const w of warnings.slice(0, 10)) log(`    ${w}`)
  }
}

/** Data bytes an Intel HEX actually loads — the number that must fit in flash. */
function countFlashBytes(hex) {
  let total = 0
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue
    if (parseInt(line.substring(7, 9), 16) === 0) total += parseInt(line.substring(1, 3), 16)
  }
  return total
}

function importDefault(file) {
  return import(new URL(`file:///${file.replace(/\\/g, '/')}`).href).then((m) => m.default)
}

// ─── cli ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { board: 'uno' }
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const value = argv[i + 1]
    if (!key || value === undefined) throw new Error(`missing value for --${key}`)
    out[key] = value
  }
  if (!out.sketch) throw new Error('--sketch is required')
  if (!out.out) throw new Error('--out is required')
  return out
}

try {
  const args = parseArgs(process.argv.slice(2))
  await build({
    board: args.board,
    sketchPath: path.resolve(ROOT, args.sketch),
    outPath: path.resolve(ROOT, args.out),
  })
} catch (e) {
  log(`\nbuild failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
