import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * Institutional buttons: squared corners, a real 1px border on every variant,
 * Raleway. No pill radius, no gradient, no drop shadow — the reference's
 * controls are flat Bootstrap-era rectangles and that plainness is the point.
 *
 * `default` is a filled blue with a matching border rather than a borderless
 * fill, so a row of primary + outline buttons lines up on the same optical box.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm border font-chrome text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vlab-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-vlab-600 bg-vlab-600 text-white hover:border-vlab-700 hover:bg-vlab-700",
        destructive:
          "border-destructive bg-destructive text-destructive-foreground hover:opacity-90",
        outline:
          "border-vlab-rule-strong bg-white text-vlab-steel hover:border-vlab-600 hover:text-vlab-800",
        secondary: "border-vlab-rule bg-vlab-surface text-vlab-ink hover:bg-vlab-100",
        ghost: "border-transparent text-vlab-steel hover:bg-vlab-surface hover:text-vlab-800",
        link: "h-auto border-transparent p-0 text-vlab-600 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
