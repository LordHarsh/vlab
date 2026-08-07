import type { ReactNode } from 'react'

/**
 * The reference's `h3.page-name` — a single blue title standing alone at the
 * top of the content column ("Introduction", "List of Experiments", "Aim").
 *
 * It is deliberately plain: no card, no icon, no gradient, no subtitle unless
 * there is something to say. Navigational pages stay terse; the density lives
 * on the content pages underneath.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: {
  /** Small uppercase context label, e.g. "Experiment 3" or "Power Systems Lab". */
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Right-aligned controls, kept out of the title's optical line. */
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-6 border-b border-vlab-rule pb-4 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? <p className="vlab-eyebrow mb-1.5">{eyebrow}</p> : null}
          <h1 className="vlab-page-title">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? (
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-vlab-muted">
          {description}
        </p>
      ) : null}
    </div>
  )
}
