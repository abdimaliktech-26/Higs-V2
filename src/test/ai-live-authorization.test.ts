import { beforeEach, describe, expect, it, vi } from "vitest"

const requireDocumentAccess = vi.fn()
const requirePacketAccess = vi.fn()
const requireOrganizationRole = vi.fn()
const packetDocumentFindUnique = vi.fn()
const packetFindUnique = vi.fn()
const aiExtractionCreate = vi.fn()
const aiExtractionFindMany = vi.fn()
const aiExtractionCount = vi.fn()
const aiRecommendationCreate = vi.fn()
const aiRecommendationFindUnique = vi.fn()
const aiRecommendationUpdate = vi.fn()
const aiRecommendationFindMany = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  requireDocumentAccess: (...args: unknown[]) => requireDocumentAccess(...args),
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: { findUnique: (...args: unknown[]) => packetDocumentFindUnique(...args) },
    packet: { findUnique: (...args: unknown[]) => packetFindUnique(...args) },
    aiExtraction: {
      create: (...args: unknown[]) => aiExtractionCreate(...args),
      findMany: (...args: unknown[]) => aiExtractionFindMany(...args),
      count: (...args: unknown[]) => aiExtractionCount(...args),
    },
    aiRecommendation: {
      create: (...args: unknown[]) => aiRecommendationCreate(...args),
      findUnique: (...args: unknown[]) => aiRecommendationFindUnique(...args),
      update: (...args: unknown[]) => aiRecommendationUpdate(...args),
      findMany: (...args: unknown[]) => aiRecommendationFindMany(...args),
    },
  },
}))
vi.mock("@/lib/ai-engine", () => ({
  runExtraction: vi.fn(() => ({ extractedFields: [], overallConfidence: 0.9, suggestions: [] })),
  generatePacketRecommendations: vi.fn(() => []),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("@/lib/rate-limit", () => ({ limiters: { ai: {} }, checkRateLimit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const USER_ID = "case-manager-1"
const PACKET_ID = "packet-1"
const DOCUMENT_ID = "document-1"

beforeEach(() => {
  vi.clearAllMocks()
  const authorization = { userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" }
  requireDocumentAccess.mockResolvedValue(authorization)
  requirePacketAccess.mockResolvedValue(authorization)
  requireOrganizationRole.mockResolvedValue(authorization)
  packetDocumentFindUnique.mockResolvedValue({ id: DOCUMENT_ID, packet: { organizationId: ORG_ID }, fields: [] })
  packetFindUnique.mockResolvedValue({
    id: PACKET_ID, organizationId: ORG_ID, status: "in_progress", dueDate: null,
    documents: [], validationResults: [], signatureRequests: [],
  })
  aiExtractionCreate.mockResolvedValue({ id: "extraction-1" })
  aiExtractionFindMany.mockResolvedValue([])
  aiExtractionCount.mockResolvedValue(0)
  aiRecommendationCreate.mockResolvedValue({})
  aiRecommendationFindUnique.mockResolvedValue({
    id: "recommendation-1", organizationId: ORG_ID, packetId: null, packetDocumentId: DOCUMENT_ID,
    type: "compliance", message: "Potentially sensitive recommendation text",
  })
  aiRecommendationUpdate.mockResolvedValue({})
  aiRecommendationFindMany.mockResolvedValue([])
  createAuditEvent.mockResolvedValue(undefined)
})

describe("AI actions use live packet/document authorization", () => {
  it("records the live actor for document extraction", async () => {
    const { runDocumentExtraction } = await import("@/lib/actions/ai")
    const result = await runDocumentExtraction(DOCUMENT_ID)
    expect(result.success).toBe(true)
    expect(requireDocumentAccess).toHaveBeenCalledWith(DOCUMENT_ID, "write", "run AI document extraction")
    expect(aiExtractionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ ranById: USER_ID, organizationId: ORG_ID }) })
  })

  it("authorizes packet analysis against the owning packet", async () => {
    const { runPacketAnalysis } = await import("@/lib/actions/ai")
    const result = await runPacketAnalysis(PACKET_ID)
    expect(result.success).toBe(true)
    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "manage", "run AI packet analysis")
  })

  it("authorizes a recommendation through its linked document and omits message text from audit metadata", async () => {
    const { applyRecommendation } = await import("@/lib/actions/ai")
    const result = await applyRecommendation("recommendation-1", "applied")
    expect(result.success).toBe(true)
    expect(requireDocumentAccess).toHaveBeenCalledWith(DOCUMENT_ID, "write", "apply AI recommendation")
    expect(aiRecommendationUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ appliedById: USER_ID }) }))
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { type: "compliance" } }))
  })

  it("limits Case Manager extraction and recommendation lists to current client assignments", async () => {
    const { getAiExtractions, getAiRecommendations } = await import("@/lib/actions/ai")
    await getAiExtractions(ORG_ID)
    await getAiRecommendations(ORG_ID)
    const extractionAssignments = aiExtractionFindMany.mock.calls[0][0].where.packetDocument.packet.client.assignments
    expect(extractionAssignments.some.staffUserId).toBe(USER_ID)
    expect(extractionAssignments.some.AND).toHaveLength(2)
    const recommendationScope = aiRecommendationFindMany.mock.calls[0][0].where.OR
    expect(recommendationScope).toHaveLength(2)
    expect(recommendationScope[0].packet.client.assignments.some.staffUserId).toBe(USER_ID)
  })
})
