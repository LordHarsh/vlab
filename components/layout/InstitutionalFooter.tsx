import Image from 'next/image'
import { INSTITUTION, CONTENT_LICENCE } from '@/lib/institution'

/**
 * The attribution + licence block that sits at the bottom of every page inside
 * a lab.
 *
 * Reproduced from the reference lab template, which prints an identical
 * centred block on every single sub-page: copyright line naming the department
 * and institute, the programme it was funded under, the Creative Commons badge,
 * and the licence spelled out in full prose.
 *
 * Two things about the reference's version are NOT reproduced:
 *   - it hotlinks the badge PNG from i.creativecommons.org; ours is a local SVG
 *   - it computes the year with an inline <script> writing into a <span id>;
 *     ours is just a server render
 */
export function InstitutionalFooter({
  className = '',
}: {
  className?: string
}) {
  return (
    <footer
      className={`border-t border-vlab-rule bg-vlab-footer px-4 py-8 text-center ${className}`}
    >
      <div className="mx-auto max-w-3xl font-chrome text-[13px] leading-relaxed text-vlab-muted">
        <p>
          Copyright &copy; {new Date().getFullYear()} {INSTITUTION.platform} &mdash;{' '}
          {INSTITUTION.department}
        </p>
        <p className="mt-0.5">{INSTITUTION.programme}</p>

        <a
          href={CONTENT_LICENCE.url}
          rel="license noopener noreferrer"
          target="_blank"
          className="mt-4 inline-block rounded-sm transition-opacity hover:opacity-80"
        >
          <Image
            src={CONTENT_LICENCE.badge}
            alt={CONTENT_LICENCE.name}
            width={88}
            height={31}
            unoptimized
          />
        </a>

        <p className="mt-2">
          This work is licensed under a{' '}
          <a
            href={CONTENT_LICENCE.url}
            rel="license noopener noreferrer"
            target="_blank"
            className="text-vlab-600 underline underline-offset-2 hover:text-vlab-800"
          >
            {CONTENT_LICENCE.name}
          </a>
          .
        </p>
      </div>
    </footer>
  )
}
