import "server-only"

import { prisma } from "./db"
import {
  ORGANIZATION_WIDE_CLIENT_ROLES,
  requireActiveOrganizationMembership,
  requireClientAccess,
  requireDocumentAccess,
  requireOrganizationRole,
  requirePacketAccess,
} from "./live-authorization"
import type { StaffFileResourceType } from "./storage"

export interface StaffFileAuthorization {
  actorId: string
  organizationId: string
  fileKey: string
  resourceType: StaffFileResourceType
  resourceId: string
}

export class StaffFileNotFoundError extends Error {
  constructor() {
    super("File not found")
    this.name = "StaffFileNotFoundError"
  }
}

async function authorizeDocumentTemplate(resourceId: string): Promise<StaffFileAuthorization> {
  const template = await prisma.documentTemplate.findUnique({
    where: { id: resourceId },
    select: { id: true, organizationId: true, fileKey: true },
  })
  if (!template) throw new StaffFileNotFoundError()
  const authorization = await requireActiveOrganizationMembership(template.organizationId, "download document template file")
  return {
    actorId: authorization.userId,
    organizationId: template.organizationId,
    fileKey: template.fileKey,
    resourceType: "document_template",
    resourceId: template.id,
  }
}

async function authorizePacketDocument(resourceId: string): Promise<StaffFileAuthorization> {
  const document = await prisma.packetDocument.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      documentTemplate: { select: { fileKey: true } },
      packet: { select: { organizationId: true } },
    },
  })
  if (!document) throw new StaffFileNotFoundError()
  const authorization = await requireDocumentAccess(document.id, "read", "download packet document file")
  if (authorization.organizationId !== document.packet.organizationId) throw new StaffFileNotFoundError()
  return {
    actorId: authorization.userId,
    organizationId: authorization.organizationId,
    fileKey: document.documentTemplate.fileKey,
    resourceType: "packet_document",
    resourceId: document.id,
  }
}

async function authorizePdfVersion(resourceId: string): Promise<StaffFileAuthorization> {
  const version = await prisma.pdfVersion.findUnique({
    where: { id: resourceId },
    select: { id: true, fileKey: true, packetDocumentId: true },
  })
  if (!version) throw new StaffFileNotFoundError()
  const authorization = await requireDocumentAccess(version.packetDocumentId, "read", "download packet document version")
  return {
    actorId: authorization.userId,
    organizationId: authorization.organizationId,
    fileKey: version.fileKey,
    resourceType: "pdf_version",
    resourceId: version.id,
  }
}

async function authorizeSupportingDocument(resourceId: string): Promise<StaffFileAuthorization> {
  const document = await prisma.supportingDocument.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      organizationId: true,
      clientId: true,
      packetId: true,
      fileKey: true,
      client: { select: { organizationId: true } },
      packet: { select: { organizationId: true, clientId: true } },
    },
  })
  if (!document) throw new StaffFileNotFoundError()
  if (document.client && document.client.organizationId !== document.organizationId) throw new StaffFileNotFoundError()
  if (document.packet && document.packet.organizationId !== document.organizationId) throw new StaffFileNotFoundError()
  if (document.clientId && document.packet && document.packet.clientId !== document.clientId) throw new StaffFileNotFoundError()

  const authorization = document.packetId
    ? await requirePacketAccess(document.packetId, "read", "download supporting document attached to packet")
    : document.clientId
      ? await requireClientAccess(document.clientId, "read", "download supporting document attached to client")
      : await requireOrganizationRole(
        document.organizationId,
        ORGANIZATION_WIDE_CLIENT_ROLES,
        "download organization-level supporting document",
      )
  if (authorization.organizationId !== document.organizationId) throw new StaffFileNotFoundError()

  return {
    actorId: authorization.userId,
    organizationId: document.organizationId,
    fileKey: document.fileKey,
    resourceType: "supporting_document",
    resourceId: document.id,
  }
}

export async function requireStaffFileAccess(resourceType: StaffFileResourceType, resourceId: string): Promise<StaffFileAuthorization> {
  switch (resourceType) {
    case "document_template": return authorizeDocumentTemplate(resourceId)
    case "packet_document": return authorizePacketDocument(resourceId)
    case "pdf_version": return authorizePdfVersion(resourceId)
    case "supporting_document": return authorizeSupportingDocument(resourceId)
  }
}
