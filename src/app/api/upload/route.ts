import { NextResponse } from "next/server"

export async function POST() {
  // Unowned uploads cannot be authorized safely at download time. All live
  // callers use resource-specific template, supporting-document, or portal
  // upload workflows that create the owning database row atomically.
  return NextResponse.json({
    success: false,
    error: "Generic uploads are disabled. Use a resource-specific upload workflow.",
  }, { status: 410 })
}
