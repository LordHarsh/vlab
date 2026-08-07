import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          /* Squared field with a real border, the way a form on a departmental
             site looks. The focus ring is 2px and clearly visible — the
             reference ships no focus state at all, which is the one thing about
             its form controls not worth inheriting. */
          'flex h-10 w-full rounded-sm border border-vlab-rule-strong bg-white px-3 py-2 text-sm text-vlab-ink transition placeholder:text-vlab-faint file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:border-vlab-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vlab-600/30 disabled:cursor-not-allowed disabled:bg-vlab-surface-alt disabled:opacity-60',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
