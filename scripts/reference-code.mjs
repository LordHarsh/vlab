/**
 * Print one experiment's sketch out of `reference/iot_virtual_lab.html`, decoded.
 *
 *   node scripts/reference-code.mjs 6
 *
 * WHY THIS EXISTS RATHER THAN A ONE-LINER. The reference's `code` fields are
 * HTML: `<` is `&lt;`, and every token is wrapped in a `<span class="kw|fn|str
 * |num|cm|pp">` for highlighting. Stripping tags with a regex — the obvious
 * approach, and the one I reached for first — eats real code: `i < 10` looks
 * like the start of a tag, so `for (int i = 0; i < 10; i++)` came out as
 * `for (int i = 0; i 10; i++)` and read as a bug in the lab sheet that was
 * never there.
 *
 * So: strip only the span wrappers, then decode entities, `&amp;` LAST (decode
 * it first and an escaped ampersand gets a second pass). Anything reading that
 * file for code should come through here.
 */
import { readFileSync } from 'node:fs'

const want = Number(process.argv[2] ?? 1)
const html = readFileSync('reference/iot_virtual_lab.html', 'utf8')
const block = html.slice(html.indexOf('const experiments = ['))

// Locate this experiment's `code:` template literal.
const idAt = block.indexOf(`id:${want},`)
if (idAt < 0) throw new Error(`no experiment ${want}`)
const codeAt = block.indexOf('code:`', idAt)
const end = block.indexOf('`,', codeAt + 6)
let code = block.slice(codeAt + 6, end)

// Strip ONLY the highlighting spans, then decode entities. Order matters:
// &amp; last, or an escaped ampersand becomes a second decode pass.
code = code
  .replace(/<span class="[a-z]+">/g, '')
  .replace(/<\/span>/g, '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')

console.log(code)
