/**
 * Load test data generator
 *
 * Usage: npx tsx scripts/seed-load-test.ts
 *
 * Generates:
 *   - N additional clients (default 1000)
 *   - M packets per client
 *   - Documents, fields, validation results, audit events
 *
 * WARNING: This will create a lot of data. Run against a test database.
 */

import "dotenv/config"
import { PrismaClient, UserRole, OrganizationStatus, MemberStatus } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { faker } from "@faker-js/faker"

const CLIENT_COUNT = parseInt(process.env.LOAD_CLIENTS || "1000")
const PACKETS_PER_CLIENT = parseInt(process.env.LOAD_PACKETS || "3")

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
  console.log(`🌱 Generating ${CLIENT_COUNT} clients with ~${PACKETS_PER_CLIENT} packets each...\n`)

  const org = await prisma.organization.findFirst()
  if (!org) { console.error("No organization found. Run seed.ts first."); return }

  const user = await prisma.user.findFirst({ where: { email: "case@northstar.com" } })
  if (!user) { console.error("No user found. Run seed.ts first."); return }

  const program = await prisma.program.findFirst()
  const template = await prisma.packetTemplate.findFirst()
  const docTemplate = await prisma.documentTemplate.findFirst()

  if (!program || !template || !docTemplate) {
    console.error("Missing base data. Run seed.ts first.")
    return
  }

  const batchSize = 100
  let totalClients = 0
  let totalPackets = 0

  console.time("Generation")

  for (let batch = 0; batch < CLIENT_COUNT; batch += batchSize) {
    const currentBatch = Math.min(batchSize, CLIENT_COUNT - batch)
    const clientData = []

    for (let i = 0; i < currentBatch; i++) {
      const firstName = faker.person.firstName()
      const lastName = faker.person.lastName()
      clientData.push({
        organizationId: org.id,
        firstName,
        lastName,
        email: faker.internet.email({ firstName, lastName }).toLowerCase(),
        phone: faker.phone.number(),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        state: "MN",
        zipCode: faker.location.zipCode(),
        mcadId: `MN-245D-${faker.date.past({ years: 3 }).getFullYear()}-${String(faker.number.int({ min: 1, max: 9999 })).padStart(4, "0")}`,
        status: faker.helpers.arrayElement(["active", "active", "active", "inactive"]),
        fundingSource: faker.helpers.arrayElement(["Medical Assistance / Waiver", "Medical Assistance / CAC", "Medical Assistance / DD Waiver", "Medical Assistance / Brain Injury Waiver"]),
        createdAt: faker.date.past({ years: 2 }),
      })
    }

    await prisma.client.createMany({ data: clientData })
    totalClients += currentBatch

    // Create packets for each new client
    const clients = await prisma.client.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      take: currentBatch,
    })

    for (const client of clients) {
      for (let p = 0; p < PACKETS_PER_CLIENT; p++) {
        const packet = await prisma.packet.create({
          data: {
            organizationId: org.id,
            clientId: client.id,
            packetTemplateId: template.id,
            packetType: template.packetType,
            status: faker.helpers.arrayElement(["draft", "in_progress", "needs_validation", "awaiting_signature", "approved"]),
            dueDate: faker.date.future({ years: 1 }),
            assignedToId: user.id,
            createdAt: faker.date.between({ from: client.createdAt, to: new Date() }),
          },
        })
        totalPackets++

        // Generate doc + fields for each packet
        const pd = await prisma.packetDocument.create({
          data: {
            packetId: packet.id,
            documentTemplateId: docTemplate.id,
            status: packet.status === "approved" ? "completed" : faker.helpers.arrayElement(["pending", "in_progress", "completed"]),
            isRequired: true,
            sortOrder: 0,
          },
        })

        // Generate 5-15 fields per document
        const fieldCount = faker.number.int({ min: 5, max: 15 })
        for (let f = 0; f < fieldCount; f++) {
          await prisma.pdfField.create({
            data: {
              packetDocumentId: pd.id,
              name: faker.lorem.words(2),
              fieldType: faker.helpers.arrayElement(["text", "date", "checkbox", "textarea"]),
              value: pd.status === "completed" ? faker.lorem.sentence() : (faker.helpers.arrayElement(["", faker.lorem.sentence()])),
              pageNumber: 1,
              isRequired: faker.datatype.boolean(0.7),
              source: "manual",
            },
          })
        }
      }
    }

    if ((batch / batchSize) % 5 === 0) {
      console.log(`  ... ${totalClients} clients, ${totalPackets} packets`)
    }
  }

  console.timeEnd("Generation")
  console.log(`\n✅ Done: ${totalClients} clients, ${totalPackets} packets`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
