/**
 * Dense LU decomposition with partial pivoting, on flat Float64Arrays.
 *
 * Dense is the right call here: docs/SIMULATOR_ARCHITECTURE.md caps the interactive
 * engine at ~15 analog unknowns, and below n≈50 a dense solve beats sparse
 * bookkeeping. ngspice (server-side, Sparse 1.3) handles anything larger.
 */

/**
 * Factor A (row-major, n×n) in place into LU. Returns the pivot permutation,
 * or null if the matrix is singular.
 *
 * A is DESTROYED. Caller keeps a copy if it needs the original.
 */
export function luFactor(A: Float64Array, n: number): Int32Array | null {
  const piv = new Int32Array(n)
  for (let i = 0; i < n; i++) piv[i] = i

  for (let k = 0; k < n; k++) {
    // Partial pivot: find the largest magnitude in column k at or below row k.
    let max = 0
    let maxRow = k
    for (let i = k; i < n; i++) {
      const v = Math.abs(A[i * n + k])
      if (v > max) {
        max = v
        maxRow = i
      }
    }

    // A truly zero column means the matrix is singular — typically a floating
    // subnet that gmin failed to tie down, or a voltage source loop.
    if (max < 1e-300) return null

    if (maxRow !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j]
        A[k * n + j] = A[maxRow * n + j]
        A[maxRow * n + j] = t
      }
      const tp = piv[k]
      piv[k] = piv[maxRow]
      piv[maxRow] = tp
    }

    const pivot = A[k * n + k]
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / pivot
      A[i * n + k] = f
      if (f === 0) continue
      for (let j = k + 1; j < n; j++) {
        A[i * n + j] -= f * A[k * n + j]
      }
    }
  }

  return piv
}

/** Solve LUx = Pb for x, given a factored A and its pivot vector. */
export function luSolve(
  LU: Float64Array,
  piv: Int32Array,
  b: Float64Array,
  n: number,
): Float64Array {
  const x = new Float64Array(n)

  // Forward substitution through L (unit diagonal), applying the permutation.
  for (let i = 0; i < n; i++) {
    let sum = b[piv[i]]
    for (let j = 0; j < i; j++) sum -= LU[i * n + j] * x[j]
    x[i] = sum
  }

  // Back substitution through U.
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]
    for (let j = i + 1; j < n; j++) sum -= LU[i * n + j] * x[j]
    x[i] = sum / LU[i * n + i]
  }

  return x
}

/** Convenience: factor a copy of A and solve once. */
export function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const LU = A.slice()
  const piv = luFactor(LU, n)
  if (!piv) return null
  return luSolve(LU, piv, b, n)
}
