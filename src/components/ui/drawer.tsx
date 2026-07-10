"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  side?: "left" | "right"
  size?: "sm" | "md" | "lg"
  className?: string
}

const widthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
}

export function Drawer({ open, onClose, title, description, children, footer, side = "right", size = "md", className }: DrawerProps) {
  React.useEffect(() => {
    if (open) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className={cn(
        "fixed inset-y-0 flex flex-col bg-white shadow-xl",
        side === "right" ? "right-0" : "left-0",
        widthClasses[size],
        className
      )}>
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 border-b border-surface-200 px-5 py-4">
            <div className="flex-1 min-w-0">
              {title && <h2 className="text-lg font-semibold text-surface-900">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-surface-500">{description}</p>}
            </div>
            <button onClick={onClose} className="shrink-0 rounded-md p-1 text-surface-400 hover:bg-surface-100 hover:text-surface-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-surface-200 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
