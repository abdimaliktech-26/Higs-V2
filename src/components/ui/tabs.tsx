"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface TabsProps {
  tabs: { value: string; label: string; count?: number; badge?: React.ReactNode }[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex border-b border-surface-200", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
            value === tab.value
              ? "text-brand-700"
              : "text-surface-500 hover:text-surface-700"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={cn(
              "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
              value === tab.value
                ? "bg-brand-100 text-brand-700"
                : "bg-surface-100 text-surface-600"
            )}>
              {tab.count}
            </span>
          )}
          {tab.badge}
          {value === tab.value && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-full" />
          )}
        </button>
      ))}
    </div>
  )
}
