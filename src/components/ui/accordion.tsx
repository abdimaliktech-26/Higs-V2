"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDown } from "lucide-react"

interface AccordionItem {
  id: string
  title: string
  content: React.ReactNode
  disabled?: boolean
}

interface AccordionProps {
  items: AccordionItem[]
  type?: "single" | "multiple"
  defaultValue?: string | string[]
  className?: string
}

export function Accordion({ items, type = "single", defaultValue, className }: AccordionProps) {
  const [openItems, setOpenItems] = React.useState<string[]>(
    type === "single"
      ? defaultValue ? [defaultValue as string] : []
      : (defaultValue as string[]) ?? []
  )

  const toggle = (id: string) => {
    if (type === "single") {
      setOpenItems(openItems.includes(id) ? [] : [id])
    } else {
      setOpenItems(openItems.includes(id) ? openItems.filter((i) => i !== id) : [...openItems, id])
    }
  }

  return (
    <div className={cn("divide-y divide-surface-200 rounded-lg border border-surface-200", className)}>
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => toggle(item.id)}
            className={cn(
              "flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-left transition-colors",
              "hover:bg-surface-50 disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <span>{item.title}</span>
            <ChevronDown className={cn(
              "h-4 w-4 text-surface-400 transition-transform duration-200",
              openItems.includes(item.id) && "rotate-180"
            )} />
          </button>
          {openItems.includes(item.id) && (
            <div className="px-4 pb-3 pt-0 text-sm text-surface-600">
              {item.content}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
