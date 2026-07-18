// @vitest-environment node
import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { TEMPLATE_FIELD_TYPES } from "@/lib/validation"
import { CLIENT_AUTO_FILL_BINDINGS, resolveClientAutoFill } from "@/lib/content/forms-245d"

const MAP_DIR = path.join(process.cwd(), "content", "245d", "field-maps")

interface MapField {
  fieldKey: string
  name: string
  fieldType: string
  pageNumber: number
  posX: number
  posY: number
  width: number
  height: number
  isRequired: boolean
  requiredWhen?: { fieldKey: string; operator: string }
}

interface FieldMap {
  templateName: string
  coordinateUnits: string
  pageSize: { width: number; height: number }
  fields: MapField[]
}

async function loadMaps(): Promise<Map<string, FieldMap>> {
  const maps = new Map<string, FieldMap>()
  for (const file of (await fs.readdir(MAP_DIR)).filter((f) => f.endsWith(".json")).sort()) {
    maps.set(file.replace(/\.json$/, ""), JSON.parse(await fs.readFile(path.join(MAP_DIR, file), "utf8")))
  }
  return maps
}

// Per-form expectations: field count, signature-anchor count, authored
// condition count, and representative required keys. Changing a map without
// updating this table is a reviewable event.
const EXPECTATIONS: Record<string, { fields: number; signatures: number; conditions: number; requiredKeys: string[] }> = {
  "intake-245d-iapp": { fields: 55, signatures: 5, conditions: 5, requiredKeys: ["client_name", "program", "sig_completing"] },
  "intake-dhf-007": { fields: 12, signatures: 1, conditions: 1, requiredKeys: ["client_name", "date_of_birth", "person_served_signature"] },
  "intake-dhf-008": { fields: 17, signatures: 3, conditions: 1, requiredKeys: ["client_name", "person_served_signature"] },
  "intake-dhf-009": { fields: 19, signatures: 1, conditions: 1, requiredKeys: ["client_name", "person_served_signature"] },
  "intake-dhs-7176": { fields: 13, signatures: 3, conditions: 0, requiredKeys: ["tenant_name", "provider_name", "person_signature"] },
  "intake-dpf-001": { fields: 8, signatures: 1, conditions: 0, requiredKeys: ["person_served_signature"] },
  "intake-dpf-002": { fields: 17, signatures: 1, conditions: 0, requiredKeys: ["client_name", "rights_restricted", "person_served_signature"] },
  "intake-dpf-004": { fields: 78, signatures: 2, conditions: 0, requiredKeys: ["client_name", "date_of_birth", "admission_date"] },
  "intake-dpf-007": { fields: 42, signatures: 2, conditions: 6, requiredKeys: ["client_name", "person_served_signature"] },
  "intake-dpf-008": { fields: 17, signatures: 4, conditions: 0, requiredKeys: ["client_name", "admission_date", "final_signature"] },
  "intake-dpf-010": { fields: 4, signatures: 1, conditions: 0, requiredKeys: ["client_name", "person_served_signature"] },
  "intake-dpf-016a": { fields: 126, signatures: 6, conditions: 23, requiredKeys: ["client_name", "scope_of_services", "sig_person_served"] },
  "intake-dpf-023": { fields: 130, signatures: 6, conditions: 0, requiredKeys: ["client_name", "assessment_date", "sig_person_served"] },
  "intake-dpf-039": { fields: 41, signatures: 0, conditions: 0, requiredKeys: ["client_name", "form_date"] },
}

describe("MN 245D intake field maps", () => {
  it("covers all 14 intake forms with the expected shape", async () => {
    const maps = await loadMaps()
    expect([...maps.keys()].sort()).toEqual(Object.keys(EXPECTATIONS).sort())
    for (const [slug, map] of maps) {
      const expected = EXPECTATIONS[slug]
      expect(map.fields.length, slug).toBe(expected.fields)
      expect(map.fields.filter((f) => f.fieldType === "signature").length, slug).toBe(expected.signatures)
      expect(map.fields.filter((f) => f.requiredWhen).length, slug).toBe(expected.conditions)
      const keys = new Set(map.fields.map((f) => f.fieldKey))
      for (const requiredKey of expected.requiredKeys) {
        const field = map.fields.find((f) => f.fieldKey === requiredKey)
        expect(field, `${slug}:${requiredKey}`).toBeDefined()
        expect(field?.isRequired, `${slug}:${requiredKey} must be required`).toBe(true)
      }
      expect(keys.size, slug).toBe(map.fields.length)
    }
  })

  it("keeps every field inside its page bounds with valid types and units", async () => {
    for (const [slug, map] of await loadMaps()) {
      expect(map.coordinateUnits, slug).toBe("pdf-points-top-down")
      for (const field of map.fields) {
        expect(TEMPLATE_FIELD_TYPES as readonly string[], `${slug}:${field.fieldKey}`).toContain(field.fieldType)
        expect(field.posX, `${slug}:${field.fieldKey} posX`).toBeGreaterThanOrEqual(0)
        expect(field.posY, `${slug}:${field.fieldKey} posY`).toBeGreaterThanOrEqual(0)
        expect(field.posX + field.width, `${slug}:${field.fieldKey} exceeds page width`).toBeLessThanOrEqual(map.pageSize.width)
        expect(field.posY + field.height, `${slug}:${field.fieldKey} exceeds page height`).toBeLessThanOrEqual(map.pageSize.height)
        expect(field.pageNumber, `${slug}:${field.fieldKey}`).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it("authors conditions only against existing checkbox trigger fields", async () => {
    for (const [slug, map] of await loadMaps()) {
      const byKey = new Map(map.fields.map((f) => [f.fieldKey, f]))
      for (const field of map.fields.filter((f) => f.requiredWhen)) {
        const trigger = byKey.get(field.requiredWhen!.fieldKey)
        expect(trigger, `${slug}:${field.fieldKey} trigger`).toBeDefined()
        expect(trigger?.fieldType, `${slug}:${field.fieldKey} trigger type`).toBe("checkbox")
        expect(["CHECKED", "UNCHECKED"], `${slug}:${field.fieldKey} operator`).toContain(field.requiredWhen!.operator)
      }
    }
  })

  it("binds auto-fill keys that actually exist in the maps", async () => {
    const allKeys = new Set<string>()
    for (const [, map] of await loadMaps()) for (const field of map.fields) allKeys.add(field.fieldKey)
    for (const boundKey of Object.keys(CLIENT_AUTO_FILL_BINDINGS)) {
      expect(allKeys.has(boundKey), `binding ${boundKey} has no matching field in any map`).toBe(true)
    }
    const values = resolveClientAutoFill({
      firstName: "Maria", lastName: "Gonzalez", dateOfBirth: new Date("1990-04-12T00:00:00Z"),
      email: "m@example.com", phone: "(651) 555-0142", address: "1420 Maple St", city: "St. Paul",
      state: "MN", zipCode: "55104", mcadId: "12345678", gender: "Female", preferredLanguage: "English",
    })
    expect(values.client_name).toBe("Maria Gonzalez")
    expect(values.tenant_name).toBe("Maria Gonzalez")
    expect(values.date_of_birth).toBe("1990-04-12")
    expect(values.address).toBe("1420 Maple St, St. Paul, MN, 55104")
    expect(values.pmi_number).toBe("12345678")
    // Missing data yields no binding rather than an empty string.
    const sparse = resolveClientAutoFill({
      firstName: "A", lastName: "B", dateOfBirth: null, email: null, phone: null,
      address: null, city: null, state: null, zipCode: null, mcadId: null, gender: null, preferredLanguage: null,
    })
    expect(Object.keys(sparse).sort()).toEqual(["client_name", "tenant_name"])
  })
})
