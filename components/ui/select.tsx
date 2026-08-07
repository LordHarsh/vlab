import * as React from 'react'
import { cn } from '@/lib/utils'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-10 w-full rounded-sm border border-vlab-rule-strong bg-white px-3 py-2 text-sm text-vlab-ink transition focus-visible:border-vlab-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vlab-600/30 disabled:cursor-not-allowed disabled:bg-vlab-surface-alt disabled:opacity-60',
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  },
)
Select.displayName = 'Select'

export { Select }
