/**
 * Database client (Prisma)
 *
 * Development:
 *   DATABASE_URL="postgresql://localhost:5432/higsi_v2?schema=public"
 *
 * Production:
 *   DATABASE_URL="postgresql://user:pass@host:5432/higsi_db?schema=public&connection_limit=10&pool_timeout=10&connect_timeout=10"
 *
 * Connection pooling (production):
 *   For serverless/edge deployments, use PgBouncer or Supabase pooler:
 *   DATABASE_URL="postgresql://user:pass@host:6543/higsi_db?schema=public&pgbouncer=true&connection_limit=5"
 *
 *   The @prisma/adapter-pg handles pooling via the pg driver.
 *   Set DATABASE_URL with `pgbouncer=true` when using PgBouncer transaction mode.
 *   Set `connection_limit` to match your pooler's max connections per instance.
 *
 * Prisma Accelerate (alternative):
 *   Accelerate provides global connection pooling + caching:
 *   DATABASE_URL="prisma+accelerate://accelerate://your-api-key"
 *   Then use `@prisma/extension-accelerate` for the adapter.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL || ""

  try {
    // Prisma Accelerate
    if (url.startsWith("prisma+")) {
      return new PrismaClient()
    }

    // Direct PostgreSQL with adapter
    const adapter = new PrismaPg({ connectionString: url })
    return new PrismaClient({ adapter })
  } catch {
    // Fallback for environments where @prisma/adapter-pg is unavailable
    return new PrismaClient()
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
