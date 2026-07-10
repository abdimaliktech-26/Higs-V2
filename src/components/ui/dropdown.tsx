"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown, Check } from "lucide-react"

interface DropdownOption {
  value: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  divider?: boolean
}

interface DropdownProps {
  trigger: React.ReactNode
  options: DropdownOption[]
  value?: string | string[]
  onSelect?: (value: string) => void
  multiple?: boolean
  align?: "left" | "right"
  className?: string
}

export function Dropdown({ trigger, options, value, onSelect, multiple, align = "left", className }: DropdownProps) {
  const [open, setOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const triggerProps = React.isValidElement(trigger)
    ? (trigger.props as React.HTMLAttributes<HTMLElement>)
    : null

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  React.useEffect(() => {
    if (open) {
      const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
      document.addEventListener("keydown", handler)
      return () => document.removeEventListener("keydown", handler)
    }
  }, [open])

  const isSelected = (optValue: string) => {
    if (multiple && Array.isArray(value)) return value.includes(optValue)
    return value === optValue
  }

  return (
    <div ref={dropdownRef} className="relative inline-block">
      {React.isValidElement(trigger) ? (
        React.cloneElement(trigger as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
          "aria-expanded": open,
          "aria-haspopup": "menu",
          onClick: (event: React.MouseEvent<HTMLElement>) => {
            triggerProps?.onClick?.(event)
            setOpen(!open)
          },
        })
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2"
        >
          {trigger}
        </button>
      )}
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 min-w-[180px] rounded-lg border border-surface-200 bg-white py-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            className
          )}
        >
          {options.map((opt) => (
            <React.Fragment key={opt.value}>
              {opt.divider && <div className="my-1 border-t border-surface-100" />}
              <button
                type="button"
                disabled={opt.disabled}
                onClick={() => { onSelect?.(opt.value); if (!multiple) setOpen(false) }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                  "hover:bg-surface-50 disabled:opacity-50 disabled:cursor-not-allowed",
                  isSelected(opt.value) && "bg-brand-50 text-brand-700"
                )}
              >
                {opt.icon && <span className="text-surface-400">{opt.icon}</span>}
                <span className="flex-1">{opt.label}</span>
                {isSelected(opt.value) && <Check className="h-4 w-4 text-brand-600" />}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
