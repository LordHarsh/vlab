/**
 * A small, dependency-free syntax tokeniser for the read-only code panel.
 *
 * WHY THIS EXISTS AT ALL. Upstream's SyntaxCodeViewer is named for a job it
 * does not do: it renders `<code className={`language-${language}`}>` — the
 * Prism/highlight.js convention — but never loads a highlighter, so upstream
 * the panel shows flat monochrome text. The class name is a hook nothing was
 * ever hung on. Since a display-only code panel is now half the deliverable,
 * the hook is honoured here rather than left dangling.
 *
 * It is deliberately not a parser and not a dependency. Prism plus its Arduino
 * and Python grammars is ~40 kB of JavaScript to colour twelve fixed listings
 * nobody can edit; this is 12 rules over a single ordered alternation.
 *
 * ORDER IS THE WHOLE DESIGN. Comments and strings are matched FIRST, so a
 * `//` inside a string literal and a `"` inside a comment are both consumed by
 * the construct that legitimately owns them — the classic failure of
 * naive per-token regex highlighting. Everything the alternation does not claim
 * falls through as plain text, so the worst possible outcome is under-colouring,
 * never dropped or reordered source.
 */

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'type' | 'function' | 'plain'

export interface Token {
  kind: TokenKind
  value: string
}

/** Arduino C++ — language keywords plus the sketch API students actually see. */
const CPP_KEYWORDS = new Set([
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extern',
  'for', 'goto', 'if', 'inline', 'register', 'return', 'sizeof', 'static', 'struct', 'switch',
  'typedef', 'union', 'volatile', 'while', 'class', 'public', 'private', 'protected', 'new',
  'delete', 'this', 'true', 'false', 'namespace', 'using', 'template', 'operator',
  'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'NULL',
])

const CPP_TYPES = new Set([
  'void', 'int', 'long', 'short', 'char', 'float', 'double', 'bool', 'boolean', 'byte',
  'word', 'unsigned', 'signed', 'String', 'size_t', 'uint8_t', 'uint16_t', 'uint32_t',
  'int8_t', 'int16_t', 'int32_t',
])

/** MicroPython / Python. */
const PY_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
  'with', 'yield', 'True', 'False', 'None', 'self',
])

const PY_TYPES = new Set([
  'int', 'float', 'str', 'bool', 'bytes', 'list', 'dict', 'tuple', 'set', 'object',
])

/**
 * One alternation, tried left to right at each position.
 *
 *  1 block comment            2 line comment (// and #)
 *  3 triple-quoted string     4 single/double-quoted string with escapes
 *  5 number (int, float, hex) 6 identifier
 *
 * `#` is treated as a line comment for both languages: in Python it is one, and
 * in C++ the only lines starting with it are preprocessor directives, which
 * read acceptably in the comment colour and never appear in these twelve
 * sketches anyway.
 */
const TOKEN_RE = new RegExp(
  [
    /\/\*[\s\S]*?(?:\*\/|$)/.source,
    /(?:\/\/|#)[^\n]*/.source,
    /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/.source,
    /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/.source,
    /\b(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?)\b/.source,
    /[A-Za-z_]\w*/.source,
  ].join('|'),
  'g',
)

/**
 * Split `code` into coloured tokens. Concatenating every `value` in order
 * reproduces the input exactly — the caller can rely on that for copy/paste.
 */
export function tokenize(code: string, language: 'cpp' | 'python'): Token[] {
  const keywords = language === 'python' ? PY_KEYWORDS : CPP_KEYWORDS
  const types = language === 'python' ? PY_TYPES : CPP_TYPES

  const tokens: Token[] = []
  let last = 0

  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m.index > last) tokens.push({ kind: 'plain', value: code.slice(last, m.index) })
    const value = m[0]
    last = m.index + value.length

    let kind: TokenKind
    if (value.startsWith('/*') || value.startsWith('//') || value.startsWith('#')) {
      kind = 'comment'
    } else if (value.startsWith('"') || value.startsWith("'")) {
      kind = 'string'
    } else if (/^[\d]/.test(value)) {
      kind = 'number'
    } else if (keywords.has(value)) {
      kind = 'keyword'
    } else if (types.has(value)) {
      kind = 'type'
    } else if (code[last] === '(') {
      kind = 'function'
    } else {
      kind = 'plain'
    }
    tokens.push({ kind, value })
  }

  if (last < code.length) tokens.push({ kind: 'plain', value: code.slice(last) })
  return tokens
}

/** Which tokeniser an experiment's `platform` implies. */
export function languageForPlatform(platform: 'Arduino' | 'Raspberry Pi'): 'cpp' | 'python' {
  return platform === 'Arduino' ? 'cpp' : 'python'
}
