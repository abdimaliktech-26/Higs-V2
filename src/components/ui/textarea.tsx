"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("text-sm font-medium text-surface-700", className)} {...props} />
  )
)
Label.displayName = "Label"

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, "-")
    return (
      <div className="space-y-1.5">
        {label && <Label htmlFor={textareaId}>{label}</Label>}
        <textarea
          id={textareaId}
          className={cn(
            "flex min-h-[80px] w-full rounded-lg border bg-white px-3 py-2 text-sm text-surface-900 placeholder:text-surface-400",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-0",
            "disabled:cursor-not-allowed disabled:bg-surface-50",
            error ? "border-danger-300" : "border-surface-300",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = "Textarea"

export { Label, Textarea }
