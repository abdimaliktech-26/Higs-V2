import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import { generatePortalToken, hashPortalToken } from "@/lib/portal/tokens"

export const PORTAL_SESSION_COOKIE = "portal_session"
// Shorter than staff's 8h session — portal is often used on shared/family
// devices, so a tighter idle window reduces shared-device exposure.
export const PORTAL_SESSION_MAX_AGE_MS = 60 * 60 * 1000

export async function createPortalSession(portalUserId: string, ipAtLogin: string | null, userAgent: string | null) {
  const { raw, hash } = generatePortalToken()
  const expires = new Date(Date.now() + PORTAL_SESSION_MAX_AGE_MS)
  const session = await prisma.portalSession.create({
    data: { portalUserId, sessionTokenHash: hash, expires, ipAtLogin, userAgent },
  })
  return { raw, session }
}

export async function setPortalSessionCookie(raw: string) {
  const store = await cookies()
  store.set(PORTAL_SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PORTAL_SESSION_MAX_AGE_MS / 1000,
  })
}

export async function clearPortalSessionCookie() {
  const store = await cookies()
  store.delete(PORTAL_SESSION_COOKIE)
}

/**
 * Reads the raw portal session cookie, hashes it, and looks up a live
 * (unexpired, non-revoked) PortalSession + its PortalUser. Returns null for
 * any invalid state rather than throwing — callers in src/lib/portal/auth.ts
 * decide what "no session" means for their specific check.
 */
export async function getPortalSessionFromCookie() {
  const store = await cookies()
  const raw = store.get(PORTAL_SESSION_COOKIE)?.value
  if (!raw) return null

  const hash = hashPortalToken(raw)
  const session = await prisma.portalSession.findUnique({
    where: { sessionTokenHash: hash },
    include: { portalUser: true },
  })
  if (!session) return null
  if (session.revokedAt || session.expires < new Date()) return null

  return session
}

export async function revokePortalSession(sessionId: string) {
  await prisma.portalSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
}
