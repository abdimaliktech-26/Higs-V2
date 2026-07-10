import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
  {
    variants: {
      variant: {
        default: "border-brand-200 bg-brand-50 text-brand-700",
        secondary: "border-surface-200 bg-surface-50 text-surface-600",
        success: "border-success-200 bg-success-50 text-success-700",
        warning: "border-warning-200 bg-warning-50 text-warning-700",
        danger: "border-danger-200 bg-danger-50 text-danger-700",
        info: "border-sky-200 bg-sky-50 text-sky-700",
        outline: "border-surface-300 text-surface-600 bg-transparent",
      },
      size: {
        sm: "px-2 py-0 text-[10px]",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && (
        <span className={cn(
          "mr-1.5 h-1.5 w-1.5 rounded-full",
          variant === "success" && "bg-success-500",
          variant === "warning" && "bg-warning-500",
          variant === "danger" && "bg-danger-500",
          variant === "default" && "bg-brand-500",
          variant === "secondary" && "bg-surface-400",
          variant === "info" && "bg-sky-500",
          (!variant || variant === "outline") && "bg-surface-400",
        )} />
      )}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
