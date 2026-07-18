import { NextResponse } from "next/server"
import { getLiveStaffAuthorizationContext } from "@/lib/live-authorization"
import { generateUploadReconciliationReport } from "@/lib/uploads/reconciliation"

// Read-only, super-admin-only, database-only reconciliation view. It runs no
// storage probe and performs no write; storage-backed probing and any cleanup
// execution are operator-script-only and never reachable from app traffic.
export async function GET() {
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  if (!identity.isGlobalSuperAdmin) {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }

  const findings = await generateUploadReconciliationReport()
  const countsByCategory: Record<string, number> = {}
  for (const finding of findings) {
    countsByCategory[finding.category] = (countsByCategory[finding.category] ?? 0) + 1
  }
  return NextResponse.json(
    { success: true, data: { generatedAt: new Date().toISOString(), total: findings.length, countsByCategory, findings } },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
