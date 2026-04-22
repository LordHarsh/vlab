import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded-xl border border-[#c1c1c1] bg-white px-3 py-2 text-sm text-[#222222] placeholder:text-[#c1c1c1] file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:border-[#ff385c] focus-visible:ring-1 focus-visible:ring-[#ff385c] transition disabled:cursor-not-allowed disabled:opacity-50',
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
