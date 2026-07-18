import { Readable } from "node:stream"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyPortalFileUrl, type PortalDocType, type PortalFileMode } from "@/lib/storage"
import { limiters } from "@/lib/rate-limit"
import { requirePortalAuth, requirePortalPermission } from "@/lib/portal/auth"
import { DurableReadUnavailableError, openAuthoritativeFileSource } from "@/lib/uploads/durable-read"

const VALID_DOC_TYPES: PortalDocType[] = ["packet_document", "supporting_document"]
const VALID_MODES: PortalFileMode[] = ["view", "download"]

export async function GET(req: NextRequest, { params }: { params: Promise<{ docType: string; docId: string }> }) {
  const { docType, docId } = await params
  if (!VALID_DOC_TYPES.includes(docType as PortalDocType)) {
    return new NextResponse("Not found", { status: 404 })
  }

  const url = new URL(req.url)
  const mode = url.searchParams.get("mode") || ""
  const expires = parseInt(url.searchParams.get("expires") || "0")
  const sig = url.searchParams.get("sig") || ""

  if (!VALID_MODES.includes(mode as PortalFileMode)) {
    return new NextResponse("Invalid request", { status: 400 })
  }
  if (!verifyPortalFileUrl(docType as PortalDocType, docId, mode as PortalFileMode, expires, sig)) {
    return new NextResponse("Invalid or expired link", { status: 403 })
  }

  let portalUserId: string
  try {
    const auth = await requirePortalAuth()
    portalUserId = auth.portalUserId
  } catch {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const rl = limiters.portalFileAccess.check(portalUserId)
  if (!rl.allowed) {
    return new NextResponse("Too many requests. Please slow down.", { status: 429, headers: { "Retry-After": String(rl.retryAfter) } })
  }

  let fileKey: string | null = null
  let storedObjectId: string | null = null
  let organizationId: string | null = null
  let clientId: string | null = null
  let originalName = "document.pdf"

  if (docType === "packet_document") {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: docId },
      include: {
        packet: { select: { clientId: true, organizationId: true } },
        versions: { orderBy: { version: "desc" }, take: 1 },
        documentTemplate: { select: { name: true } },
      },
    })
    // Step 4c.4c — portal availability is portalVisible AND applicable
    // (persisted applicabilityStatus only, no condition-runtime evaluation).
    // Same 404 as the pre-existing !portalVisible case, before any storage
    // fetch, for both view and download — a previously issued, bookmarked,
    // or still-unexpired signed URL cannot bypass this.
    if (!doc || !doc.portalVisible || doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") return new NextResponse("Not found", { status: 404 })
    if (mode === "download" && doc.portalAccessLevel !== "VIEW_AND_DOWNLOAD") {
      return new NextResponse("Download not permitted for this document", { status: 403 })
    }
    const latestVersion = doc.versions[0]
    if (!latestVersion) return new NextResponse("Not found", { status: 404 })
    // pdf_version rows are placeholder-only and excluded from PR-5C
    // dual-source reads; this branch keeps its existing legacy behavior.
    fileKey = latestVersion.fileKey
    organizationId = doc.packet.organizationId
    clientId = doc.packet.clientId
    originalName = `${doc.documentTemplate.name}.pdf`
  } else {
    const doc = await prisma.supportingDocument.findUnique({ where: { id: docId } })
    if (!doc || !doc.portalVisible || !doc.clientId) return new NextResponse("Not found", { status: 404 })
    if (mode === "download" && doc.portalAccessLevel !== "VIEW_AND_DOWNLOAD") {
      return new NextResponse("Download not permitted for this document", { status: 403 })
    }
    fileKey = doc.fileKey
    storedObjectId = doc.storedObjectId
    organizationId = doc.organizationId
    clientId = doc.clientId
    originalName = doc.title
  }

  try {
    await requirePortalPermission(clientId, "canViewDocuments")
  } catch {
    return new NextResponse("Not found", { status: 404 })
  }

  // PR-5C.1: supporting documents linked to a StoredObject stream the exact
  // durable object version; unlinked legacy rows keep the local read.
  let result
  try {
    result = await openAuthoritativeFileSource({
      organizationId: organizationId as string,
      storedObjectId,
      legacyFileKey: storedObjectId ? null : fileKey,
    })
  } catch (error) {
    if (error instanceof DurableReadUnavailableError) {
      return new NextResponse("File delivery is temporarily unavailable", { status: 503 })
    }
    throw error
  }
  if (!result) return new NextResponse("Not found", { status: 404 })

  return new NextResponse(Readable.toWeb(result.stream) as ReadableStream, {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.size),
      "Content-Disposition": `${mode === "download" ? "attachment" : "inline"}; filename="${originalName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=60",
    },
  })
}
