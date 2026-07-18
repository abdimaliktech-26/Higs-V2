// MN 245D form-set taxonomy for the Slice A content ingestion.
//
// The product model is workflow-packet-first (approved decision): each of the
// 44 staged DHS documents becomes its own DocumentTemplate, named by stage,
// and the four packet templates carry the workflow meaning. Source documents
// are never modified; ingestion consumes the operator-converted PDFs.

export const FORM_STAGES = ["intake", "45day", "semiannual", "annual"] as const
export type FormStage = (typeof FORM_STAGES)[number]

export interface StageDefinition {
  /** Subdirectory under the converted-PDF source root. */
  directory: FormStage
  /** Display prefix applied to every template name in the stage. */
  namePrefix: string
  packetType: string
  packetTemplateName: string
  expectedFormCount: number
}

export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  { directory: "intake", namePrefix: "Intake", packetType: "initial_intake", packetTemplateName: "245D Intake Packet", expectedFormCount: 14 },
  { directory: "45day", namePrefix: "45-Day", packetType: "45_day", packetTemplateName: "245D 45-Day Review Packet", expectedFormCount: 4 },
  { directory: "semiannual", namePrefix: "Semiannual", packetType: "semiannual_review", packetTemplateName: "245D Semiannual Review Packet", expectedFormCount: 6 },
  { directory: "annual", namePrefix: "Annual", packetType: "annual_review", packetTemplateName: "245D Annual Review Packet", expectedFormCount: 20 },
]

const SOURCE_PREFIX_PATTERNS = [
  /^INTAKE-\s*/i,
  /^45 Day Forms-\s*/i,
  /^SEMI ANNUAL-\s*/i,
  /^ANNUAL-\s*/i,
]

/**
 * Derives the stage-qualified template name from a converted source
 * filename, e.g. "INTAKE- DPF-004--Admission Form and Data Sheet.pdf" with
 * the Intake stage becomes "Intake — DPF-004 Admission Form and Data Sheet".
 */
export function templateNameFromSourceFile(fileName: string, stage: StageDefinition): string {
  let base = fileName.replace(/\.pdf$/i, "").trim()
  for (const pattern of SOURCE_PREFIX_PATTERNS) base = base.replace(pattern, "")
  base = base.replace(/--/g, " ").replace(/\s+/g, " ").trim()
  return `${stage.namePrefix} — ${base}`
}

// ── Auto-fill bindings (Slice B M2) ──
// Standardized fieldKeys shared across the 245D field maps bind to values the
// client data model already holds. Applied once at packet creation, only to
// empty fields; staff can edit or clear any auto-filled value afterwards.

export interface AutoFillClient {
  firstName: string
  lastName: string
  dateOfBirth: Date | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  mcadId: string | null
  gender: string | null
  preferredLanguage: string | null
}

function fullAddress(client: AutoFillClient): string | null {
  const street = client.address?.trim()
  if (!street) return null
  const locality = [client.city, client.state].filter(Boolean).join(", ")
  return [street, locality, client.zipCode].filter(Boolean).join(", ")
}

const isoDate = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null)

function fullName(client: AutoFillClient): string | null {
  return [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || null
}

export const CLIENT_AUTO_FILL_BINDINGS: Readonly<Record<string, (client: AutoFillClient) => string | null>> = {
  client_name: fullName,
  tenant_name: fullName,
  date_of_birth: (client) => isoDate(client.dateOfBirth),
  address: fullAddress,
  tenant_address: fullAddress,
  home_phone: (client) => client.phone,
  email_address: (client) => client.email,
  gender: (client) => client.gender,
  languages_spoken: (client) => client.preferredLanguage,
  pmi_number: (client) => client.mcadId,
}

/** Values for every bound fieldKey that resolves to a non-empty value. */
export function resolveClientAutoFill(client: AutoFillClient): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [fieldKey, resolve] of Object.entries(CLIENT_AUTO_FILL_BINDINGS)) {
    const value = resolve(client)
    if (value) values[fieldKey] = value
  }
  return values
}
