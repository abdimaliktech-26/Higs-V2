import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { STAFF_FILE_RESOURCE_TYPES, verifyStaffFileUrl, type StaffFileResourceType } from "@/lib/storage"
import { limiters } from "@/lib/rate-limit"
import { createAuditEvent } from "@/lib/audit"
import { StaffAuthorizationError } from "@/lib/live-authorization"
import { requireStaffFileAccess, StaffFileNotFoundError } from "@/lib/staff-file-access"
import { DurableReadUnavailableError, openAuthoritativeFileSource } from "@/lib/uploads/durable-read"

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  if (path.length !== 2 || !STAFF_FILE_RESOURCE_TYPES.includes(path[0] as StaffFileResourceType) || !path[1]) {
    return new NextResponse("Not found", { status: 404 })
  }
  const resourceType = path[0] as StaffFileResourceType
  const resourceId = path[1]

  const url = new URL(req.url)
  const expires = parseInt(url.searchParams.get("expires") || "0")
  const sig = url.searchParams.get("sig") || ""
  if (!verifyStaffFileUrl(resourceType, resourceId, expires, sig)) {
    return new NextResponse("Invalid or expired link", { status: 403 })
  }

  let authorization
  try {
    authorization = await requireStaffFileAccess(resourceType, resourceId)
  } catch (error) {
    if (error instanceof StaffFileNotFoundError) return new NextResponse("Not found", { status: 404 })
    if (error instanceof StaffAuthorizationError) return new NextResponse("Forbidden", { status: 403 })
    throw error
  }

  const rl = limiters.fileAccess.check(authorization.actorId)
  if (!rl.allowed) {
    return new NextResponse("Too many requests. Please slow down.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    })
  }

  // PR-5C.1: rows linked to a StoredObject stream the exact durable object
  // version; unlinked legacy rows keep the local compatibility read.
  let result
  try {
    result = await openAuthoritativeFileSource({
      organizationId: authorization.organizationId,
      storedObjectId: authorization.storedObjectId,
      legacyFileKey: authorization.storedObjectId ? null : authorization.fileKey,
    })
  } catch (error) {
    if (error instanceof DurableReadUnavailableError) {
      return new NextResponse("File delivery is temporarily unavailable", { status: 503 })
    }
    throw error
  }
  if (!result) return new NextResponse("Not found", { status: 404 })

  await createAuditEvent({
    organizationId: authorization.organizationId,
    actorId: authorization.actorId,
    action: "DOCUMENT_DOWNLOADED",
    targetType: authorization.resourceType,
    targetId: authorization.resourceId,
    metadata: { resourceType: authorization.resourceType },
  })
  return new NextResponse(Readable.toWeb(result.stream) as ReadableStream, {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
