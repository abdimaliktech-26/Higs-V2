import { cn } from "@/lib/utils"
import { AlertTriangle, CheckCircle2, Info, Lock, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

interface EmptyStateProps {
  title: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-100">
        {icon ?? <Inbox className="h-7 w-7 text-surface-400" />}
      </div>
      <h3 className="text-base font-semibold text-surface-900">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-surface-500">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

interface ErrorStateProps {
  title?: string
  description?: string
  error?: Error | string | null
  onRetry?: () => void
  className?: string
}

export function ErrorState({ title = "Something went wrong", description, error, onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-50">
        <AlertTriangle className="h-7 w-7 text-danger-500" />
      </div>
      <h3 className="text-base font-semibold text-surface-900">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-surface-500">
        {description || "An unexpected error occurred. Please try again."}
      </p>
      {error && typeof error === "string" ? (
        <p className="mt-2 max-w-md text-xs text-surface-400 font-mono">{error}</p>
      ) : error instanceof Error ? (
        <p className="mt-2 max-w-md text-xs text-surface-400 font-mono">{error.message}</p>
      ) : null}
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry} className="mt-6">Try again</Button>}
    </div>
  )
}

interface LoadingStateProps {
  title?: string
  className?: string
}

export function LoadingState({ title = "Loading...", className }: LoadingStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="mb-4">
        <svg className="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
      <p className="text-sm text-surface-500">{title}</p>
    </div>
  )
}

interface AccessDeniedStateProps {
  title?: string
  description?: string
  className?: string
}

export function AccessDeniedState({ title = "Access Denied", description, className }: AccessDeniedStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning-50">
        <Lock className="h-7 w-7 text-warning-500" />
      </div>
      <h3 className="text-base font-semibold text-surface-900">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-surface-500">
        {description || "You do not have permission to access this page."}
      </p>
    </div>
  )
}

export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-[400px] w-full rounded-xl" />
    </div>
  )
}
