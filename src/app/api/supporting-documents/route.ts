import { NextRequest, NextResponse } from "next/server"
import { limiters } from "@/lib/rate-limit"
import { getLiveStaffAuthorizationContext } from "@/lib/live-authorization"
import { UploadLifecycleError } from "@/lib/uploads/errors"
import { assertUploadRuntimeAvailable, UploadRuntimeUnavailableError } from "@/lib/uploads/receipt"
import {
  authorizeStaffSupportingUpload,
  SupportingUploadAuthorizationError,
} from "@/lib/uploads/staff-supporting-authorization"
import { initiateStaffSupportingUpload } from "@/lib/uploads/supporting-upload"

const OPAQUE_ID = /^(c[a-z0-9]{20,31}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

function optionalOpaqueId(value: string | null): string | undefined | null {
  if (!value) return undefined
  return OPAQUE_ID.test(value) ? value : null
}

// PR-5B.3: receipt ends at SCANNING. Binding target IDs travel as query
// parameters so the full live authorization branch runs before any multipart
// byte is parsed; only post-authorization descriptive fields stay multipart.
export async function POST(req: NextRequest) {
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const rate = limiters.upload.check(identity.userId)
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many uploads. Try again in ${rate.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    )
  }
  const clientId = optionalOpaqueId(req.nextUrl.searchParams.get("clientId"))
  const packetId = optionalOpaqueId(req.nextUrl.searchParams.get("packetId"))
  if (clientId === null || packetId === null) {
    return NextResponse.json({ success: false, error: "Invalid upload target" }, { status: 400 })
  }
  let authorization
  try {
    authorization = await authorizeStaffSupportingUpload({ clientId, packetId })
    // Fail before multipart parsing/byte acceptance when the operating gate is closed.
    assertUploadRuntimeAvailable()
  } catch (error) {
    if (error instanceof UploadRuntimeUnavailableError || (error instanceof Error && error.name.includes("Storage"))) {
      return NextResponse.json({ success: false, error: "Secure uploads are temporarily unavailable." }, { status: 503 })
    }
    if (error instanceof SupportingUploadAuthorizationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 403 })
    }
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  const title = ((formData.get("title") as string) || file.name).slice(0, 300)
  const category = (formData.get("category") as string) || "supporting"
  const description = (formData.get("description") as string) || undefined

  try {
    const result = await initiateStaffSupportingUpload({
      organizationId: authorization.organizationId,
      staffUserId: authorization.userId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      file,
      intent: {
        title,
        category,
        description,
        clientId: authorization.clientId,
        packetId: authorization.packetId,
      },
    })
    return NextResponse.json({ success: true, data: result }, { status: result.status === "COMPLETED" ? 200 : 202 })
  } catch (error) {
    if (error instanceof UploadLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.code === "CONFLICT" ? 409 : 400 })
    }
    return NextResponse.json({ success: false, error: "Failed to receive supporting document upload" }, { status: 500 })
  }
}
