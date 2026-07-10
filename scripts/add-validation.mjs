const fs = require("fs")
const path = require("path")

// ── client.ts ──
let c = fs.readFileSync("src/lib/actions/client.ts", "utf-8")

c = c.replace(
  `import { validate } from '@/lib/validation'`,
  `import { validate, createClientSchema, clientQuerySchema } from '@/lib/validation'`
)

c = c.replace(
  "export async function createClient(data: ClientFormData)",
  "export async function createClient(raw: Record<string, unknown>)"
)

c = c.replace(
  `const client = await prisma.client.create({\n      data: {\n        organizationId: orgId,\n        firstName: data.firstName,\n        lastName: data.lastName,\n        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,\n        email: data.email || null,\n        phone: data.phone || null,\n        address: data.address || null,\n        city: data.city || null,\n        state: data.state || null,\n        zipCode: data.zipCode || null,\n        mcadId: data.mcadId || null,\n        ssn: data.ssn || null,\n        gender: data.gender || null,\n        preferredLanguage: data.preferredLanguage || null,\n        fundingSource: data.fundingSource || null,\n        status: data.status || "active",\n        notes: data.notes || null,\n      },\n    })`,
  `const parsed = validate(createClientSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        firstName: data.firstName,
        lastName: data.lastName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        email: data.email || null,
        phone: data.phone || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        zipCode: data.zipCode || null,
        mcadId: data.mcadId || null,
        ssn: data.ssn || null,
        gender: data.gender || null,
        preferredLanguage: data.preferredLanguage || null,
        fundingSource: data.fundingSource || null,
        status: data.status || "active",
        notes: data.notes || null,
      },
    })`
)

c = c.replace(
  "export async function getClients(\n  orgId: string,\n  params: { search?: string; status?: string; program?: string; page?: number; pageSize?: number }\n) {",
  `export async function getClients(
  orgId: string,
  raw: Record<string, unknown> = {}
) {
  const parsed = validate(clientQuerySchema, raw)
  const params = parsed.success ? parsed.data : { page: 1, pageSize: 20, search: raw.search as string | undefined }`
)

c = c.replace(
  "export async function updateClient(clientId: string, data: Partial<ClientFormData>)",
  "export async function updateClient(clientId: string, raw: Record<string, unknown>)"
)

c = c.replace(
  `const client = await prisma.client.update({\n      where: { id: clientId },\n      data: {\n        ...data,\n        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,\n      },\n    })`,
  `const parsed = validate(createClientSchema.partial(), raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data as Record<string, unknown>
  const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        ...data,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth as string) : undefined,
      },
    })`
)

fs.writeFileSync("src/lib/actions/client.ts", c)
console.log("client.ts done")
