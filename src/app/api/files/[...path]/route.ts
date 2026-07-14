import { NextRequest, NextResponse } from "next/server"
import { getFileStream, STAFF_FILE_RESOURCE_TYPES, verifyStaffFileUrl, type StaffFileResourceType } from "@/lib/storage"
import { limiters } from "@/lib/rate-limit"
import { createAuditEvent } from "@/lib/audit"
import { StaffAuthorizationError } from "@/lib/live-authorization"
import { requireStaffFileAccess, StaffFileNotFoundError } from "@/lib/staff-file-access"

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

  const result = await getFileStream(authorization.fileKey)
  if (!result) return new NextResponse("Not found", { status: 404 })
  let blob: Buffer
  try {
    blob = Buffer.from(await result.stream.readFile())
  } finally {
    await result.stream.close()
  }
  await createAuditEvent({
    organizationId: authorization.organizationId,
    actorId: authorization.actorId,
    action: "DOCUMENT_DOWNLOADED",
    targetType: authorization.resourceType,
    targetId: authorization.resourceId,
    metadata: { resourceType: authorization.resourceType },
  })
  return new NextResponse(Buffer.from(blob), {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.size),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
