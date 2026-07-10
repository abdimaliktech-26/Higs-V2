import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

/**
 * Health check endpoint
 *
 * Returns application health status without exposing secrets or PHI.
 * Database connectivity is verified with a lightweight query.
 * The `ready` field indicates whether the app can serve traffic.
 */

export const dynamic = "force-dynamic"

export async function GET() {
  const start = Date.now()
  const checks: Record<string, string> = {}
  let healthy = true

  // Database check
  try {
    await prisma.$queryRaw`SELECT 1`
    checks.database = "ok"
  } catch (e) {
    checks.database = "error"
    healthy = false
  }

  const statusCode = healthy ? 200 : 503

  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      ready: healthy,
      version: process.env.npm_package_version || "0.1.0",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      durationMs: Date.now() - start,
      checks,
    },
    {
      status: statusCode,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Health-Status": healthy ? "ok" : "degraded",
      },
    }
  )
}
