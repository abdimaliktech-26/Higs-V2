// Stage 5 Step 4c.4a — packet-level readiness/priority derivation must
// silently exclude conditionally inactive PacketDocuments (applicabilityStatus
// persisted by the packet condition system) from required-document totals,
// incomplete-document totals, completion percentage, and priority-item
// selection. No condition evaluation happens here — these are pure functions
// over already-loaded data, exactly as before this step.
import { describe, it, expect } from "vitest"
import { deriveReadiness, derivePriorityItem, type PacketDocLike } from "@/app/packets/[id]/packet-overview-metrics"

function doc(overrides: Partial<PacketDocLike> & { id: string }): PacketDocLike {
  return {
    status: "completed",
    isRequired: true,
    applicabilityStatus: "ACTIVE",
    documentTemplate: { name: "Doc" },
    ...overrides,
  }
}

describe("deriveReadiness", () => {
  it("counts an active required incomplete document against readiness", () => {
    const docs = [doc({ id: "d1", status: "in_progress", isRequired: true, applicabilityStatus: "ACTIVE" })]
    const r = deriveReadiness(docs, null, [], null)
    expect(r.breakdown.incompleteDocuments).toBe(1)
    expect(r.pct).toBeLessThan(100)
  })

  it("does not count a conditionally inactive required incomplete document against readiness", () => {
    const docs = [doc({ id: "d1", status: "in_progress", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" })]
    const r = deriveReadiness(docs, null, [], null)
    expect(r.breakdown.incompleteDocuments).toBe(0)
    expect(r.pct).toBe(100)
  })

  it("does not let a conditionally inactive document lower the document completion percentage", () => {
    const docs = [
      doc({ id: "d1", status: "completed", isRequired: true, applicabilityStatus: "ACTIVE" }),
      doc({ id: "d2", status: "not_started", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" }),
    ]
    const r = deriveReadiness(docs, null, [], null)
    // Only d1 (active + required) counts; it's complete, so completion is 100%.
    expect(r.breakdown.incompleteDocuments).toBe(0)
    expect(r.pct).toBe(100)
  })

  it("produces correct totals and readiness for a mixed packet (active/inactive, required/optional, complete/incomplete)", () => {
    const docs = [
      doc({ id: "d1", status: "completed", isRequired: true, applicabilityStatus: "ACTIVE" }),
      doc({ id: "d2", status: "in_progress", isRequired: true, applicabilityStatus: "ACTIVE" }),
      doc({ id: "d3", status: "not_started", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" }),
      doc({ id: "d4", status: "not_started", isRequired: false, applicabilityStatus: "ACTIVE" }),
      doc({ id: "d5", status: "in_progress", isRequired: false, applicabilityStatus: "CONDITIONALLY_INACTIVE" }),
    ]
    const r = deriveReadiness(docs, null, [], null)
    // Applicable required docs: d1 (complete), d2 (incomplete). d3 excluded
    // (inactive), d4/d5 excluded (optional).
    expect(r.breakdown.incompleteDocuments).toBe(1)
    expect(r.pct).toBe(88) // docsPct 50 (1/2 complete), signatures/validation/approval all default 100 -> round((50+100+100+100)/4)
  })

  it("does not produce a false incomplete state when every required document is conditionally inactive", () => {
    const docs = [
      doc({ id: "d1", status: "not_started", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" }),
      doc({ id: "d2", status: "not_started", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" }),
    ]
    const r = deriveReadiness(docs, null, [], null)
    expect(r.breakdown.incompleteDocuments).toBe(0)
    expect(r.pct).toBe(100)
    expect(r.tone).toBe("success")
  })

  it("legacy behavior is unchanged when no document is conditionally inactive", () => {
    const docs = [
      doc({ id: "d1", status: "completed", isRequired: true, applicabilityStatus: "ACTIVE" }),
      doc({ id: "d2", status: "in_progress", isRequired: true, applicabilityStatus: "ACTIVE" }),
    ]
    const r = deriveReadiness(docs, null, [], null)
    expect(r.breakdown.incompleteDocuments).toBe(1)
    expect(r.pct).toBe(88) // docsPct 50 (1/2 complete), signatures/validation/approval all default 100 -> round((50+100+100+100)/4)
  })
})

describe("derivePriorityItem", () => {
  it("selects an active incomplete required document as the priority item", () => {
    const docs = [doc({ id: "d1", status: "in_progress", isRequired: true, applicabilityStatus: "ACTIVE" })]
    const item = derivePriorityItem("pkt-1", docs, null, [], null)
    expect(item.kind).toBe("document")
  })

  it("never selects a conditionally inactive document as the priority item", () => {
    const docs = [doc({ id: "d1", status: "in_progress", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" })]
    const item = derivePriorityItem("pkt-1", docs, null, [], null)
    expect(item.kind).not.toBe("document")
    expect(item.kind).toBe("approval_ready")
  })

  it("falls through to the next applicable document when the first incomplete required document is conditionally inactive", () => {
    const docs = [
      doc({ id: "d1", status: "in_progress", isRequired: true, applicabilityStatus: "CONDITIONALLY_INACTIVE" }),
      doc({ id: "d2", status: "in_progress", isRequired: true, applicabilityStatus: "ACTIVE", documentTemplate: { name: "ISP" } }),
    ]
    const item = derivePriorityItem("pkt-1", docs, null, [], null)
    expect(item.kind).toBe("document")
    expect(item.title).toBe("ISP")
  })
})
