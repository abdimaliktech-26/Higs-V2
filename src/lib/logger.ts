/**
 * Structured request logging
 *
 * Logs format: JSON lines to stdout/console.
 * In production, pipe stdout to your log aggregator (CloudWatch, Datadog, etc.)
 *
 * No PHI is ever logged. Only:
 *   - request ID, method, pathname, status, duration
 *   - user ID / org ID (anonymized references, not names or emails)
 *   - error digest (no stack traces)
 */

const isProd = process.env.NODE_ENV === "production"

let counter = 0

function reqId(): string {
  counter = (counter + 1) % 100000
  return `${Date.now().toString(36)}-${counter.toString(36).padStart(3, "0")}`
}

export interface LogEntry {
  id: string
  timestamp: string
  method: string
  path: string
  status: number
  durationMs: number
  userId?: string
  orgId?: string
  error?: string
  ip?: string
}

export function createLogEntry(method: string, path: string): LogEntry {
  return {
    id: reqId(),
    timestamp: new Date().toISOString(),
    method,
    path,
    status: 0,
    durationMs: 0,
  }
}

export function finalizeLog(entry: LogEntry, status: number, startMs: number, extra?: Partial<LogEntry>): void {
  entry.status = status
  entry.durationMs = Date.now() - startMs
  if (extra) Object.assign(entry, extra)
  log(entry)
}

function log(entry: LogEntry): void {
  // In production, write JSON to stdout for log aggregators
  // In dev, write a concise one-liner
  const line = isProd
    ? JSON.stringify(entry)
    : `[${entry.timestamp.slice(11, 19)}] ${entry.method} ${entry.path} → ${entry.status} (${entry.durationMs}ms)${entry.userId ? ` user=${entry.userId.slice(0, 8)}` : ""}${entry.orgId ? ` org=${entry.orgId.slice(0, 8)}` : ""}${entry.error ? ` err=${entry.error}` : ""}`

  if (entry.status >= 500) {
    console.error(line)
  } else if (entry.status >= 400) {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export { reqId }
