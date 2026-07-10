import { NextRequest, NextResponse } from "next/server"
import { storeFile } from "@/lib/storage"
import { auth } from "@/lib/auth"
import { limiters } from "@/lib/rate-limit"
import crypto from "crypto"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = (session.user as Record<string, unknown>).id as string
  const rl = limiters.upload.check(userId)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait before uploading again.", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter), "X-RateLimit-Remaining": "0" } }
    )
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 })
  }

  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "File exceeds 50MB limit" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const id = crypto.randomUUID()
  const safeName = file.name.replace(/[/\\]/g, "_").replace(/^\.+/, "")
  const key = `uploads/${id}/${safeName}`

  let record
  try {
    record = await storeFile(key, buffer, "application/pdf", file.name)
  } catch {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    data: {
      key: record.key,
      signedUrl: record.signedUrl,
      size: record.size,
      originalName: file.name,
    },
  })
}
