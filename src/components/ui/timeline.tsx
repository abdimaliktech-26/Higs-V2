"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Check } from "lucide-react"

interface TimelineItem {
  id: string
  title: string
  description?: string
  timestamp?: string
  status?: "complete" | "current" | "pending" | "error"
  icon?: React.ReactNode
}

interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

const statusStyles = {
  complete: "bg-success-500 border-success-500 text-white",
  current: "bg-brand-600 border-brand-600 text-white",
  pending: "bg-white border-surface-300 text-surface-400",
  error: "bg-danger-500 border-danger-500 text-white",
}

export function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {items.map((item, index) => (
        <div key={item.id} className="relative flex gap-4 pb-8 last:pb-0">
          {/* Connecting line */}
          {index < items.length - 1 && (
            <div className="absolute left-[15px] top-8 bottom-0 w-px bg-surface-200" />
          )}

          {/* Dot */}
          <div className={cn(
            "relative z-10 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
            statusStyles[item.status || "pending"]
          )}>
            {item.status === "complete" ? <Check className="h-3.5 w-3.5" /> : item.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-surface-900">{item.title}</p>
              {item.timestamp && <span className="text-xs text-surface-400">{item.timestamp}</span>}
            </div>
            {item.description && <p className="mt-0.5 text-sm text-surface-500">{item.description}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
