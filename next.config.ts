import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
    ],
  },
  /**
   * Ship the AVR toolchain into the compile route's serverless function.
   *
   * `lib/simulator/avr/build.ts` resolves both the toolchain and the worker
   * from `process.cwd()` rather than importing them — deliberately, so the
   * bundler never sees a static specifier for a 139 MB tree of WASM. The cost
   * of that choice is that Next's file tracer cannot infer the dependency
   * either, so without this the function deploys WITHOUT a compiler and a
   * student's first sketch fails at runtime rather than at build time.
   *
   * The excludes matter as much as the includes: `.cache/avr/` keeps the
   * downloaded archives beside the unpacked trees, and shipping those would add
   * ~54 MB of tarball to the bundle that nothing ever reads.
   */
  outputFileTracingIncludes: {
    '/api/compile': [
      './.cache/avr/wasm/**',
      './.cache/avr/ArduinoCore-avr-1.8.7/**',
      './.cache/avr/avr/**',
      './lib/simulator/avr/build-worker.mjs',
    ],
  },
  outputFileTracingExcludes: {
    // No leading './' — these are matched against the traced paths, and the
    // './' form silently matches nothing (verified: the archives still showed
    // up in the route's .nft.json).
    '/api/compile': ['**/.cache/avr/*.tar.bz2', '**/.cache/avr/*.tgz'],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig
