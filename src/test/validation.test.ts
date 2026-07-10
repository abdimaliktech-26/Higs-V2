import { describe, it, expect } from "vitest"
import { validate, createClientSchema, createDocTemplateSchema, createSignatureSchema, createPacketSchema, createUserSchema, orgSettingsSchema, createValidationRuleSchema } from "@/lib/validation"

describe("client validation", () => {
  it("accepts valid client data", () => {
    const r = validate(createClientSchema, {
      firstName: "Ayaan", lastName: "Mohamed", status: "active",
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.firstName).toBe("Ayaan")
  })

  it("rejects missing first name", () => {
    const r = validate(createClientSchema, { lastName: "Mohamed" })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toContain("firstName")
  })

  it("rejects invalid email", () => {
    const r = validate(createClientSchema, {
      firstName: "A", lastName: "B", email: "not-an-email",
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toContain("email")
  })

  it("accepts empty optional fields", () => {
    const r = validate(createClientSchema, {
      firstName: "A", lastName: "B", email: "", phone: "", notes: "",
    })
    expect(r.success).toBe(true)
  })
})

describe("document template validation", () => {
  it("accepts valid template data", () => {
    const r = validate(createDocTemplateSchema, {
      name: "CSSP Addendum", formType: "dhs",
      fileUrl: "https://storage.test/test.pdf", fileKey: "test.pdf",
    })
    expect(r.success).toBe(true)
  })

  it("rejects missing name", () => {
    const r = validate(createDocTemplateSchema, {
      formType: "dhs", fileUrl: "https://test.pdf", fileKey: "test.pdf",
    })
    expect(r.success).toBe(false)
  })
})

describe("signature validation", () => {
  it("accepts valid signature request", () => {
    const r = validate(createSignatureSchema, {
      signerName: "John Doe", signerEmail: "john@test.com",
      signerRole: "Client", signerType: "client",
    })
    expect(r.success).toBe(true)
  })

  it("rejects invalid email", () => {
    const r = validate(createSignatureSchema, {
      signerName: "John", signerEmail: "bad",
      signerRole: "Client", signerType: "client",
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toContain("email")
  })
})

describe("user validation", () => {
  it("accepts valid user data", () => {
    const r = validate(createUserSchema, {
      email: "user@test.com", name: "Test User", role: "CASE_MANAGER",
    })
    expect(r.success).toBe(true)
  })

  it("rejects invalid role", () => {
    const r = validate(createUserSchema, {
      email: "user@test.com", name: "Test", role: "INVALID_ROLE",
    })
    expect(r.success).toBe(false)
  })
})

describe("org settings validation", () => {
  it("accepts partial settings", () => {
    const r = validate(orgSettingsSchema, { timezone: "America/Chicago" })
    expect(r.success).toBe(true)
  })

  it("accepts empty object", () => {
    const r = validate(orgSettingsSchema, {})
    expect(r.success).toBe(true)
  })
})

describe("validation rule schema", () => {
  it("accepts valid rule", () => {
    const r = validate(createValidationRuleSchema, {
      name: "Required Fields", category: "required_field", severity: "critical",
    })
    expect(r.success).toBe(true)
  })

  it("rejects invalid severity", () => {
    const r = validate(createValidationRuleSchema, {
      name: "Test", category: "test", severity: "invalid",
    })
    expect(r.success).toBe(false)
  })
})

describe("packet schema", () => {
  it("requires clientId and packetTemplateId", () => {
    const r = validate(createPacketSchema, {})
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error).toContain("clientId")
      expect(r.error).toContain("packetTemplateId")
    }
  })
})
