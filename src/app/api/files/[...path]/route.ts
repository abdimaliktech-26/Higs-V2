import { NextRequest, NextResponse } from "next/server"
import { getFileStream, verifySignedUrl } from "@/lib/storage"
import { auth } from "@/lib/auth"
import { limiters } from "@/lib/rate-limit"

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const fileKey = path.join("/")

  const session = await auth()
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 })
  }

  const userId = (session.user as Record<string, unknown>).id as string
  const rl = limiters.fileAccess.check(userId)
  if (!rl.allowed) {
    return new NextResponse("Too many requests. Please slow down.", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfter) },
    })
  }

  const url = new URL(req.url)

  // Signed URL verification (required for every request — no unsigned bypass)
  const expires = parseInt(url.searchParams.get("expires") || "0")
  const sig = url.searchParams.get("sig") || ""
  if (!verifySignedUrl(fileKey, expires, sig)) {
    return new NextResponse("Invalid or expired link", { status: 403 })
  }

  const result = await getFileStream(fileKey)
  if (!result) return new NextResponse("Not found", { status: 404 })
  const blob = await result.stream.readFile() as any
  return new NextResponse(Buffer.from(blob), {
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.size),
      "Cache-Control": "private, max-age=300",
    },
  })
}
