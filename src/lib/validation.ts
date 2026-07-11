import { z } from "zod"

// ── Common Primitives ──
export const cuid = z.string().min(10).max(30)
export const email = z.string().email().max(255).optional().or(z.literal(""))
export const phone = z.string().max(30).optional().or(z.literal(""))
export const urlSafe = z.string().max(500)
export const jsonStr = z.string().max(10000).optional()
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal(""))

// ── Client ──
export const createClientSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  dateOfBirth: dateStr,
  email,
  phone,
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(2).optional().or(z.literal("")),
  zipCode: z.string().max(10).optional().or(z.literal("")),
  mcadId: z.string().max(50).optional().or(z.literal("")),
  gender: z.string().max(50).optional().or(z.literal("")),
  preferredLanguage: z.string().max(100).optional().or(z.literal("")),
  fundingSource: z.string().max(200).optional().or(z.literal("")),
  status: z.string().max(20).default("active"),
  notes: z.string().max(5000).optional().or(z.literal("")),
})

export const clientQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.string().max(20).optional(),
  program: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Packet ──
export const createPacketSchema = z.object({
  clientId: cuid,
  packetTemplateId: cuid,
  dueDate: dateStr,
  assignedToId: z.string().max(50).optional().or(z.literal("")),
})

export const packetQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.string().max(30).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Document Template ──
export const createDocTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional().or(z.literal("")),
  formType: z.string().max(50).default("dhs"),
  program: z.string().max(100).optional().or(z.literal("")),
  fileUrl: z.string().max(1000),
  fileKey: z.string().max(1000),
  fileSize: z.number().int().optional(),
})

// ── Packet Template ──
export const createPacketTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().or(z.literal("")),
  packetType: z.string().max(50),
  programId: z.string().max(50).optional().or(z.literal("")),
  documentIds: z.array(z.string().max(50)).default([]),
})

// ── PDF Document ──
export const saveFieldsSchema = z.object({
  id: z.string().max(50).optional(),
  name: z.string().min(1).max(200),
  fieldType: z.string().max(50),
  value: z.string().max(10000).optional().or(z.literal("")),
  pageNumber: z.number().int().min(1).default(1),
  posX: z.number().optional(),
  posY: z.number().optional(),
  isRequired: z.boolean().default(false),
})

export const addFieldSchema = z.object({
  packetDocumentId: cuid,
  name: z.string().min(1).max(200),
  fieldType: z.string().max(50).default("text"),
  pageNumber: z.number().int().min(1).default(1),
})

// ── Signature ──
export const createSignatureSchema = z.object({
  packetId: z.string().max(50).optional(),
  packetDocumentId: z.string().max(50).optional(),
  pdfFieldId: z.string().max(50).optional(),
  signerName: z.string().min(1).max(200),
  signerEmail: z.string().email().max(255),
  signerRole: z.string().min(1).max(100),
  signerType: z.string().min(1).max(50),
  dueDate: dateStr,
  consentText: z.string().max(10000).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
})

// ── Validation Rule ──
export const createValidationRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().or(z.literal("")),
  category: z.string().max(100),
  severity: z.enum(["critical", "warning", "info"]),
  program: z.string().max(100).optional().or(z.literal("")),
  packetType: z.string().max(50).optional().or(z.literal("")),
})

// ── User ──
export const createUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(200),
  role: z.enum(["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN", "GUARDIAN", "EXTERNAL_CASE_MANAGER"]),
  password: z.string().min(6).max(200).optional(),
  departments: z.array(z.string().max(100)).default([]),
})

export const updateUserSchema = z.object({
  name: z.string().max(200).optional(),
  role: z.enum(["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN", "GUARDIAN", "EXTERNAL_CASE_MANAGER"]).optional(),
  status: z.enum(["ACTIVE", "INVITED", "DISABLED"]).optional(),
  departments: z.array(z.string().max(100)).optional(),
})

// ── Org Settings ──
export const orgSettingsSchema = z.object({
  name: z.string().max(200).optional(),
  timezone: z.string().max(100).optional(),
  departments: z.array(z.string().max(100)).optional(),
  locations: z.array(z.string().max(200)).optional(),
  defaultPacketType: z.string().max(50).optional(),
  mfaEnabled: z.boolean().optional(),
  ssoEnabled: z.boolean().optional(),
})

// ── AI ──
export const aiQuerySchema = z.object({
  documentId: z.string().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

export const aiRecQuerySchema = z.object({
  type: z.string().max(50).optional(),
  status: z.string().max(20).optional(),
  packetId: z.string().max(50).optional(),
})

// ── Reports ──
export const reportsFilterSchema = z.object({
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  program: z.string().max(100).optional(),
  packetType: z.string().max(50).optional(),
  staffId: z.string().max(50).optional(),
  status: z.string().max(30).optional(),
})

// ── Supporting Document ──
export const uploadSupportingSchema = z.object({
  title: z.string().min(1).max(200),
  category: z.string().max(100).default("supporting"),
  description: z.string().max(2000).optional().or(z.literal("")),
  clientId: z.string().max(50).optional(),
  packetId: z.string().max(50).optional(),
})

// ── Audit ──
export const auditQuerySchema = z.object({
  action: z.string().max(100).optional(),
  actorId: z.string().max(50).optional(),
  targetType: z.string().max(50).optional(),
  targetId: z.string().max(50).optional(),
  search: z.string().max(200).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

// ── Notification ──
export const notificationQuerySchema = z.object({
  type: z.string().max(50).optional(),
  unreadOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
})

// ── Portal Invitations (Stage 2) ──
export const createPortalInvitationSchema = z.object({
  clientId: cuid,
  clientContactId: z.string().max(50).optional().or(z.literal("")),
  invitedEmail: z.string().email().max(255),
  relationship: z.string().min(1, "Relationship is required").max(200),
  accessRole: z.enum(["CLIENT_SELF", "GUARDIAN", "PARENT", "RESPONSIBLE_PARTY", "AUTHORIZED_REPRESENTATIVE"]),
  canViewDocuments: z.boolean().default(false),
  canViewAppointments: z.boolean().default(false),
  canMessageCareTeam: z.boolean().default(false),
})

export const portalInvitationQuerySchema = z.object({
  clientId: z.string().max(50).optional(),
  status: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export const activatePortalAccountSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
})

// ── Portal Document Requests (Stage 4 Step 1) ──
export const createPortalDocumentRequestSchema = z.object({
  clientId: cuid,
  packetId: z.string().max(50).optional().or(z.literal("")),
  packetDocumentId: z.string().max(50).optional().or(z.literal("")),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  category: z.enum(["INSURANCE", "IDENTIFICATION", "MEDICATION", "CARE_PLAN", "LEGAL", "CONSENT", "PHOTO", "OTHER"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  isRequired: z.boolean().default(true),
  dueDate: dateStr,
})

// ── Portal Document Review (Stage 4 Step 3) ──
export const reviewPortalDocumentRequestSchema = z.object({
  decision: z.enum(["APPROVED", "NEEDS_REPLACEMENT"]),
  note: z.string().max(2000).optional().or(z.literal("")),
  category: z.enum(["PHOTO_QUALITY", "UNREADABLE", "MISSING_PAGES", "WRONG_DOCUMENT", "INCOMPLETE", "EXPIRED", "MISMATCHED_INFO", "OTHER"]).optional(),
  severity: z.enum(["REQUIRED", "SUGGESTED"]).optional(),
}).refine(
  (data) => data.decision !== "NEEDS_REPLACEMENT" || (data.note && data.note.trim().length > 0),
  { message: "Feedback note is required when requesting a replacement", path: ["note"] }
)

// ── Helper: Wrapped parse that returns error string ──
export function validate<T>(schema: z.ZodType<T>, input: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input)
  if (result.success) return { success: true, data: result.data }
  const messages = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)
  return { success: false, error: messages.join("; ") }
}
