import NextAuth, { CredentialsSignin } from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./db"
import { limiters, getClientIp } from "./rate-limit"
import { refreshStaffSessionToken } from "./staff-session"

export class TooManyAttemptsError extends CredentialsSignin {
  code = "too_many_attempts"
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        const email = (credentials.email as string).trim().toLowerCase()
        const password = credentials.password as string

        // Keyed by IP + email (not IP alone) so one attacker can't lock out
        // every user behind the same NAT/office IP by hammering one login.
        const ip = getClientIp(request)
        const attempt = limiters.auth.check(`${ip}:${email}`)
        if (!attempt.allowed) {
          throw new TooManyAttemptsError()
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            memberships: {
              include: {
                organization: true,
              },
            },
          },
        })

        if (!user || !user.passwordHash) return null

        const isValid = await bcrypt.compare(password, user.passwordHash)
        if (!isValid) return null

        // Pick default org: first active membership
        const activeMembership = user.memberships.find((m) => m.status === "ACTIVE")

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          isSuperAdmin: user.isSuperAdmin,
          staffSessionVersion: user.sessionVersion,
          activeOrganizationId: activeMembership?.organizationId ?? undefined,
          memberships: user.memberships.filter((m) => m.status === "ACTIVE").map((m) => ({
            id: m.id,
            organizationId: m.organizationId,
            organizationName: m.organization.name,
            organizationSlug: m.organization.slug,
            role: m.role,
          })),
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id
        const u = user as unknown as Record<string, unknown>
        const t = token as unknown as Record<string, unknown>
        t.isSuperAdmin = u.isSuperAdmin
        t.activeOrganizationId = u.activeOrganizationId
        t.memberships = u.memberships
        t.staffSessionVersion = u.staffSessionVersion
      }
      if (trigger === "update" && session) {
        const t = token as unknown as Record<string, unknown>
        t.activeOrganizationId = (session as unknown as Record<string, unknown>).activeOrganizationId
      }
      return refreshStaffSessionToken(token as unknown as Record<string, unknown>, Boolean(user))
    },
    async session({ session, token }) {
      const t = token as unknown as Record<string, unknown>
      const s = session.user as unknown as Record<string, unknown>
      s.id = t.id as string
      s.isSuperAdmin = t.isSuperAdmin as boolean
      s.activeOrganizationId = t.activeOrganizationId as string | undefined
      s.memberships = t.memberships
      return session
    },
  },
})
