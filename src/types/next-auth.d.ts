import { UserRole } from "@prisma/client"

export type MembershipInfo = {
  id: string
  organizationId: string
  organizationName: string
  organizationSlug: string
  role: UserRole
}

declare module "next-auth" {
  interface User {
    isSuperAdmin: boolean
    activeOrganizationId?: string
    memberships: MembershipInfo[]
  }

  interface Session {
    user: {
      id: string
      email: string
      name: string | null
      image: string | null
      isSuperAdmin: boolean
      activeOrganizationId?: string
      memberships: MembershipInfo[]
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    isSuperAdmin: boolean
    activeOrganizationId?: string
    memberships: MembershipInfo[]
  }
}
