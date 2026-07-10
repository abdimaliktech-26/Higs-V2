"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const checkboxId = id || label?.toLowerCase().replace(/\s+/g, "-")
    return (
      <label htmlFor={checkboxId} className="flex items-center gap-2 cursor-pointer">
        <input
          id={checkboxId}
          type="checkbox"
          className={cn(
            "h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-2 focus:ring-brand-500 focus:ring-offset-0",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={ref}
          {...props}
        />
        {label && <span className="text-sm text-surface-700">{label}</span>}
      </label>
    )
  }
)
Checkbox.displayName = "Checkbox"

interface RadioGroupProps {
  name: string
  options: { value: string; label: string }[]
  value?: string
  onChange?: (value: string) => void
  className?: string
}

function RadioGroup({ name, options, value, onChange, className }: RadioGroupProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={(e) => onChange?.(e.target.value)}
            className="h-4 w-4 border-surface-300 text-brand-600 focus:ring-2 focus:ring-brand-500"
          />
          <span className="text-sm text-surface-700">{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

export { Checkbox, RadioGroup }
