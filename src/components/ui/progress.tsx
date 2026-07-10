"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface ProgressProps {
  value: number
  max?: number
  size?: "sm" | "md" | "lg"
  variant?: "default" | "success" | "warning" | "danger"
  label?: string
  showValue?: boolean
  className?: string
}

const sizeClasses = {
  sm: "h-1.5",
  md: "h-2.5",
  lg: "h-4",
}

const variantClasses = {
  default: "bg-brand-600",
  success: "bg-success-600",
  warning: "bg-warning-600",
  danger: "bg-danger-600",
}

export function Progress({ value, max = 100, size = "md", variant = "default", label, showValue, className }: ProgressProps) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100)

  return (
    <div className={cn("space-y-1", className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-sm">
          {label && <span className="text-surface-600">{label}</span>}
          {showValue && <span className="text-surface-500 font-medium">{Math.round(pct)}%</span>}
        </div>
      )}
      <div className={cn("w-full overflow-hidden rounded-full bg-surface-100", sizeClasses[size])}>
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", variantClasses[variant])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
