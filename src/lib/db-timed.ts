/**
 * Database query timing wrapper
 *
 * Wraps Prisma queries with timing and logging.
 * In production, set DB_LOG_QUERIES=true to enable.
 *
 * Usage:
 *   import { db } from "@/lib/db-timed"
 *   const clients = await db.client.findMany(...)
 */

import { prisma } from "./db"

const logQueries = process.env.DB_LOG_QUERIES === "true" || process.env.NODE_ENV === "development"

export async function timedQuery<T>(label: string, query: Promise<T>): Promise<T> {
  if (!logQueries) return query

  const start = Date.now()
  try {
    const result = await query
    const ms = Date.now() - start
    if (ms > 100) {
      console.warn(`[DB] ${label} — ${ms}ms (slow)`)
    } else {
      console.log(`[DB] ${label} — ${ms}ms`)
    }
    return result
  } catch (error) {
    const ms = Date.now() - start
    console.error(`[DB] ${label} — ${ms}ms (ERROR)`)
    throw error
  }
}

export { prisma }
