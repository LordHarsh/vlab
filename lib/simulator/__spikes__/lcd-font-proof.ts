/**
 * Print every CGROM glyph as dot art.
 *
 * A 480-byte table of column bitmaps is exactly the kind of data that can be
 * wrong in a way no type checker and no unit test notices — a transposed digit
 * makes one letter subtly malformed and everything else fine. The only real
 * check is to LOOK at it, which is what this does.
 *
 * Run: npx tsx lib/simulator/__spikes__/lcd-font-proof.ts
 */

import { LCD_GLYPH_COLS, LCD_GLYPH_ROWS, lcdChar, lcdGlyph } from '../lcd-font'

const PER_LINE = 8

function art(code: number): string[] {
  const cols = lcdGlyph(code)
  const rows: string[] = []
  for (let r = 0; r < LCD_GLYPH_ROWS; r++) {
    let line = ''
    for (let c = 0; c < LCD_GLYPH_COLS; c++) line += (cols[c] >> r) & 1 ? '#' : '.'
    rows.push(line)
  }
  return rows
}

const codes: number[] = []
for (let c = 0x20; c <= 0x7f; c++) codes.push(c)
codes.push(0xff, 0x00)

for (let i = 0; i < codes.length; i += PER_LINE) {
  const group = codes.slice(i, i + PER_LINE)
  console.log(
    group
      .map((c) => `0x${c.toString(16).padStart(2, '0')} ${lcdChar(c)}`.padEnd(LCD_GLYPH_COLS + 4))
      .join(' '),
  )
  const arts = group.map(art)
  for (let r = 0; r < LCD_GLYPH_ROWS; r++) {
    console.log(arts.map((a) => a[r].padEnd(LCD_GLYPH_COLS + 4)).join(' '))
  }
  console.log('')
}
