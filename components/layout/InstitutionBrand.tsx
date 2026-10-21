import { INSTITUTION } from '@/lib/institution'

/**
 * Institute logo + lab title, as it sits at the left of every header.
 *
 * `stacked` puts the title under the logo for the narrow 240px console
 * sidebars, where the two side by side would not fit.
 */
export function InstitutionBrand({ stacked = false }: { stacked?: boolean }) {
  return (
    <span className={`flex min-w-0 ${stacked ? 'flex-col items-start gap-1.5' : 'items-center gap-3'}`}>
      <img
        src={INSTITUTION.logo}
        alt={INSTITUTION.name}
        width={118}
        height={40}
        className={`w-auto shrink-0 ${stacked ? 'h-9' : 'h-8 sm:h-10'}`}
      />
      <span
        className={`min-w-0 font-display font-bold leading-tight text-vlab-600 ${
          stacked ? 'text-sm' : 'text-[13px] sm:text-base'
        }`}
      >
        {INSTITUTION.title}
      </span>
    </span>
  )
}
