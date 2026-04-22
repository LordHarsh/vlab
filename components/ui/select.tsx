import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          'flex h-10 w-full rounded-xl border border-[#c1c1c1] bg-white px-3 py-2 text-sm text-[#222222] focus-visible:outline-none focus-visible:border-[#ff385c] focus-visible:ring-1 focus-visible:ring-[#ff385c] transition disabled:cursor-not-allowed disabled:opacity-50',
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
