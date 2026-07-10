import "dotenv/config"
import { PrismaClient, UserRole, OrganizationStatus, MemberStatus } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import bcrypt from "bcryptjs"
import { storeFile } from "../src/lib/storage"
import { generateMinimalPDF } from "../src/lib/sample-pdf"

function createPrismaClient() {
  try {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" })
    return new PrismaClient({ adapter })
  } catch {
    return new PrismaClient({})
  }
}

const prisma = createPrismaClient()

async function main() {
  console.log("🌱 Seeding Phase 3...\n")

  const existing = await prisma.user.findUnique({ where: { email: "superadmin@higsi.com" } })
  if (existing) {
    console.log("Already seeded. Run with --force-reset first.\n")
    return
  }

  const pw = await bcrypt.hash("password123", 12)

  // 1. Super Admin
  await prisma.user.create({ data: { email: "superadmin@higsi.com", name: "Super Admin", passwordHash: pw, isSuperAdmin: true } })
  console.log("  ✓ Super Admin")

  // 2. Organization
  const org = await prisma.organization.create({
    data: { name: "North Star Care Services", slug: "north-star-care", status: OrganizationStatus.ACTIVE, plan: "professional",
      settings: { timezone: "America/Chicago", state: "MN", licenseType: "245D" } },
  })

  // 3. Staff
  const sarah = await prisma.user.create({ data: { email: "admin@northstar.com", name: "Sarah Johnson", passwordHash: pw } })
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: sarah.id, role: UserRole.ORG_ADMIN, status: MemberStatus.ACTIVE } })

  const michael = await prisma.user.create({ data: { email: "compliance@northstar.com", name: "Michael Chen", passwordHash: pw } })
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: michael.id, role: UserRole.COMPLIANCE_DIRECTOR, status: MemberStatus.ACTIVE } })

  const emily = await prisma.user.create({ data: { email: "case@northstar.com", name: "Emily Rodriguez", passwordHash: pw } })
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: emily.id, role: UserRole.CASE_MANAGER, status: MemberStatus.ACTIVE } })

  const david = await prisma.user.create({ data: { email: "dsp@northstar.com", name: "David Kim", passwordHash: pw } })
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: david.id, role: UserRole.DSP, status: MemberStatus.ACTIVE } })

  const jennifer = await prisma.user.create({ data: { email: "nurse@northstar.com", name: "Jennifer Wells, RN", passwordHash: pw } })
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: jennifer.id, role: UserRole.NURSE, status: MemberStatus.ACTIVE } })

  console.log("  ✓ Staff (5)")

  // 4. Programs
  const progs = await Promise.all([
    prisma.program.create({ data: { organizationId: org.id, name: "245D Home and Community Based Services", code: "245D-HCBS", description: "HCBS waiver program" } }),
    prisma.program.create({ data: { organizationId: org.id, name: "245D Supported Living Services", code: "245D-SLS", description: "Supported living for adults with disabilities" } }),
    prisma.program.create({ data: { organizationId: org.id, name: "245D Day Training Services", code: "245D-DT", description: "Day training and habilitation" } }),
  ])
  console.log("  ✓ Programs (3)")

  // 5. Document Templates (DHS forms)
  const formData = [
    { name: "CSSP Addendum", formType: "dhs", program: "245D-HCBS" },
    { name: "Individual Support Plan (ISP)", formType: "dhs", program: "245D-HCBS" },
    { name: "Health Risk Screening Tool", formType: "dhs", program: "245D-HCBS" },
    { name: "Emergency Preparedness Plan", formType: "dhs", program: "245D-HCBS" },
    { name: "Positive Support Transition Plan", formType: "dhs", program: "245D-SLS" },
    { name: "Medication Administration Record", formType: "medical", program: null },
    { name: "Nursing Assessment", formType: "medical", program: null },
    { name: "Daily Progress Note", formType: "progress", program: null },
    { name: "Incident Report Form", formType: "incident", program: null },
    { name: "Annual Review Checklist", formType: "dhs", program: "245D-HCBS" },
    { name: "Semiannual Review Form", formType: "dhs", program: "245D-HCBS" },
    { name: "Consent for Services", formType: "dhs", program: null },
    { name: "Rights Information Form", formType: "dhs", program: null },
    { name: "Grievance Procedure", formType: "dhs", program: null },
  ]

  const docTemplates = await Promise.all(
    formData.map(async (f, i) => {
      const key = `templates/${f.name.toLowerCase().replace(/\s+/g, "-")}.pdf`
      const pdfBuffer = generateMinimalPDF(f.name)
      const record = await storeFile(key, pdfBuffer, "application/pdf", `${f.name}.pdf`)

      return prisma.documentTemplate.create({
        data: {
          organizationId: org.id, name: f.name, formType: f.formType,
          program: f.program, status: "active", version: 1,
          fileUrl: record.url,
          fileKey: record.key,
          fileSize: record.size,
          mimeType: "application/pdf",
          uploadedById: sarah.id,
          packetTypes: JSON.stringify(["initial_intake", "annual_review", "semiannual_review", "change_of_status"]),
        },
      })
    })
  )
  console.log(`  ✓ Document Templates (${docTemplates.length})`)

  // 6. Packet Templates
  const ptData = [
    { name: "Initial Intake Packet", packetType: "initial_intake", programIdx: 0, docs: [0, 1, 2, 3, 11, 12, 13] },
    { name: "Annual Review Packet", packetType: "annual_review", programIdx: 0, docs: [9, 1, 2, 3, 4] },
    { name: "Semiannual Review Packet", packetType: "semiannual_review", programIdx: 0, docs: [10, 1, 2] },
    { name: "Change of Status Packet", packetType: "change_of_status", programIdx: null, docs: [8] },
    { name: "SLS Initial Packet", packetType: "initial_intake", programIdx: 1, docs: [0, 1, 2, 4, 11, 12] },
  ]

  const packetTemplates = []
  for (const pt of ptData) {
    const programId = pt.programIdx !== null ? progs[pt.programIdx].id : null
    const template = await prisma.packetTemplate.create({
      data: { organizationId: org.id, name: pt.name, packetType: pt.packetType, programId, isDefault: true, status: "active" },
    })

    for (let i = 0; i < pt.docs.length; i++) {
      await prisma.packetTemplateDocument.create({
        data: { packetTemplateId: template.id, documentTemplateId: docTemplates[pt.docs[i]].id, required: true, sortOrder: i },
      })
    }
    packetTemplates.push(template)
  }
  console.log(`  ✓ Packet Templates (${packetTemplates.length})`)

  // 7. Clients
  const clients = await Promise.all([
    prisma.client.create({ data: { organizationId: org.id, firstName: "Ayaan", lastName: "Mohamed", dateOfBirth: new Date("1990-06-15"), email: "ayaan@example.com", phone: "(612) 555-0101", address: "123 Main St", city: "Minneapolis", state: "MN", zipCode: "55401", mcadId: "MN-245D-2024-001", status: "active", fundingSource: "Medical Assistance / Waiver" } }),
    prisma.client.create({ data: { organizationId: org.id, firstName: "Maya", lastName: "Johnson", dateOfBirth: new Date("1985-03-22"), email: "maya@example.com", phone: "(651) 555-0201", address: "456 Oak Ave", city: "Saint Paul", state: "MN", zipCode: "55102", mcadId: "MN-245D-2024-002", status: "active", fundingSource: "Medical Assistance / CAC" } }),
    prisma.client.create({ data: { organizationId: org.id, firstName: "James", lastName: "Wilson", dateOfBirth: new Date("1978-11-08"), email: "james@example.com", phone: "(952) 555-0301", address: "789 Pine Rd", city: "Bloomington", state: "MN", zipCode: "55420", mcadId: "MN-245D-2023-015", status: "active", fundingSource: "Medical Assistance / DD Waiver" } }),
    prisma.client.create({ data: { organizationId: org.id, firstName: "Grace", lastName: "Chen", dateOfBirth: new Date("2002-09-30"), email: "grace@example.com", phone: "(763) 555-0401", address: "321 Birch Ln", city: "Brooklyn Park", state: "MN", zipCode: "55443", mcadId: "MN-245D-2025-003", status: "active", preferredLanguage: "Mandarin, English", fundingSource: "Medical Assistance / CAC" } }),
    prisma.client.create({ data: { organizationId: org.id, firstName: "Marcus", lastName: "Thompson", dateOfBirth: new Date("1995-07-12"), email: "marcus@example.com", phone: "(612) 555-0501", address: "555 Cedar Ct", city: "Minneapolis", state: "MN", zipCode: "55411", mcadId: "MN-245D-2023-008", status: "active", fundingSource: "Medical Assistance / Brain Injury Waiver" } }),
    prisma.client.create({ data: { organizationId: org.id, firstName: "Isabella", lastName: "Martinez", dateOfBirth: new Date("1968-04-18"), email: "isabella@example.com", phone: "(651) 555-0601", address: "888 Elm St", city: "Saint Paul", state: "MN", zipCode: "55104", mcadId: "MN-245D-2022-031", status: "active", preferredLanguage: "Spanish, English", fundingSource: "Medical Assistance / Elderly Waiver" } }),
  ])
  console.log(`  ✓ Clients (${clients.length})`)

  // 8. Program enrollments & staff assignments
  for (let i = 0; i < clients.length; i++) {
    const pIdx = i < 3 ? 0 : i < 5 ? 1 : 2
    await prisma.clientProgram.create({ data: { clientId: clients[i].id, programId: progs[pIdx].id, status: "active", startDate: new Date("2024-01-01") } })
    if (i < 3) {
      await prisma.staffAssignment.create({ data: { clientId: clients[i].id, staffUserId: emily.id, role: "case_manager", isPrimary: true, startDate: new Date("2024-01-15") } })
      await prisma.staffAssignment.create({ data: { clientId: clients[i].id, staffUserId: david.id, role: "support_staff", isPrimary: false, startDate: new Date("2024-01-15") } })
    }
  }
  console.log("  ✓ Enrollments & assignments")

  // 9. Create sample packets from templates
  const packetStatuses = ["draft", "in_progress", "needs_validation", "awaiting_signature"]
  for (let i = 0; i < Math.min(clients.length, 4); i++) {
    const pt = packetTemplates[i < 2 ? 0 : 1]
    const packet = await prisma.packet.create({
      data: {
        organizationId: org.id, clientId: clients[i].id,
        packetTemplateId: pt.id, packetType: pt.packetType,
        status: packetStatuses[i], dueDate: new Date(2025, 7 + i, 15),
        assignedToId: emily.id,
        metadata: { program: "245D-HCBS" },
      },
    })

    // Create packet documents from template
    const requiredDocs = await prisma.packetTemplateDocument.findMany({
      where: { packetTemplateId: pt.id },
      orderBy: { sortOrder: "asc" },
    })
    for (let j = 0; j < requiredDocs.length; j++) {
      await prisma.packetDocument.create({
        data: {
          packetId: packet.id,
          documentTemplateId: requiredDocs[j].documentTemplateId,
          status: j === 0 && i === 0 ? "completed" : j < 2 && i === 3 ? "in_progress" : "pending",
          isRequired: requiredDocs[j].required,
          sortOrder: requiredDocs[j].sortOrder,
        },
      })
    }
  }
  console.log("  ✓ Sample packets (4) with documents")

  // 10. Audit events
  await prisma.auditEvent.create({ data: { organizationId: org.id, actorId: sarah.id, action: "TEMPLATE_UPLOADED", targetType: "document_template", targetId: docTemplates[0].id, metadata: { name: "CSSP Addendum" } } })
  await prisma.auditEvent.create({ data: { organizationId: org.id, actorId: sarah.id, action: "PACKET_TEMPLATE_CREATED", targetType: "packet_template", metadata: { name: "Initial Intake Packet" } } })
  await prisma.auditEvent.create({ data: { organizationId: org.id, actorId: emily.id, action: "PACKET_CREATED", targetType: "packet", metadata: { clientName: "Ayaan Mohamed" } } })
  console.log("  ✓ Audit events")

  console.log("\n✅ Seed complete!")
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
