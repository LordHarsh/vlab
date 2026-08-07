import Image from 'next/image'
import { INSTITUTION, CONTENT_LICENCE } from '@/lib/institution'

/**
 * The attribution + licence line that sits at the bottom of every page inside
 * a lab.
 *
 * Collapsed from four stacked lines (copyright+department, programme, a
 * standalone badge image, then the licence name spelled out again in a full
 * sentence) to two: copyright+programme together, badge and licence name
 * inline beside each other. The department name and the licence's full
 * bureaucratic title are still available from `INSTITUTION`/`CONTENT_LICENCE`
 * for anywhere that needs the formal wording — this footer just no longer
 * repeats both the badge AND the sentence for the same fact.
 */
export function InstitutionalFooter({
  className = '',
}: {
  className?: string
}) {
  return (
    <footer
      className={`border-t border-vlab-rule bg-vlab-footer px-4 py-6 text-center ${className}`}
    >
      <div className="mx-auto max-w-3xl font-chrome text-[13px] leading-relaxed text-vlab-muted">
        <p>
          &copy; {new Date().getFullYear()} {INSTITUTION.platform} &mdash; {INSTITUTION.programme}
        </p>

        <a
          href={CONTENT_LICENCE.url}
          rel="license noopener noreferrer"
          target="_blank"
          className="mt-2 inline-flex items-center gap-1.5 transition-opacity hover:opacity-80"
        >
          <Image src={CONTENT_LICENCE.badge} alt="" width={66} height={23} unoptimized />
          <span className="underline underline-offset-2">Licensed under {CONTENT_LICENCE.shortName}</span>
        </a>
      </div>
    </footer>
  )
}
