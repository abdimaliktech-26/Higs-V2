"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from "lucide-react"

const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        info: "border-sky-200 bg-sky-50 text-sky-800",
        success: "border-success-200 bg-success-50 text-success-800",
        warning: "border-warning-200 bg-warning-50 text-warning-800",
        error: "border-danger-200 bg-danger-50 text-danger-800",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
}

interface AlertProps extends VariantProps<typeof alertVariants> {
  title?: string
  children: React.ReactNode
  onClose?: () => void
  className?: string
}

export function Alert({ variant, title, children, onClose, className }: AlertProps) {
  const v = variant ?? "info"
  const Icon = iconMap[v]
  return (
    <div className={cn(alertVariants({ variant: v }), className)}>
      <div className="flex gap-3">
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="flex-1">
          {title && <p className="mb-1 font-medium">{title}</p>}
          <div className="text-sm opacity-90">{children}</div>
        </div>
        {onClose && (
          <button onClick={onClose} className="shrink-0 rounded-md p-0.5 opacity-70 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
