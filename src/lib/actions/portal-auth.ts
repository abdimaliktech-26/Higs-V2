"use server"

import { headers } from "next/headers"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/db"
import { limiters } from "@/lib/rate-limit"
import { createPortalAuditEvent } from "@/lib/audit"
import { createPortalSession, setPortalSessionCookie, clearPortalSessionCookie, revokePortalSession } from "@/lib/portal/session"
import { requirePortalAuth, PortalAuthError } from "@/lib/portal/auth"

const LOCKOUT_THRESHOLD = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000

type ActionResult<T = Record<string, unknown>> = { success: true; data: T } | { success: false; error: string }

async function getRequestMeta() {
  const hdrs = await headers()
  const forwardedFor = hdrs.get("x-forwarded-for")
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : hdrs.get("x-real-ip")?.trim() || "unknown"
  const userAgent = hdrs.get("user-agent")
  return { ip, userAgent }
}

const GENERIC_LOGIN_ERROR = "Invalid email or password."

export async function portalLogin(raw: { email: string; password: string }): Promise<ActionResult<{ loggedIn: true }>> {
  const email = (raw.email || "").trim().toLowerCase()
  const password = raw.password || ""
  if (!email || !password) return { success: false, error: GENERIC_LOGIN_ERROR }

  const { ip, userAgent } = await getRequestMeta()
  const limited = limiters.portalLogin.check(`${ip}:${email}`)
  if (!limited.allowed) {
    return { success: false, error: `Too many attempts. Try again in ${limited.retryAfter} seconds.` }
  }

  const portalUser = await prisma.portalUser.findUnique({ where: { email } })

  // Same generic message whether the account doesn't exist or the password
  // is wrong — never confirm which email addresses have portal accounts.
  if (!portalUser) {
    return { success: false, error: GENERIC_LOGIN_ERROR }
  }

  if (portalUser.lockedUntil && portalUser.lockedUntil > new Date()) {
    return { success: false, error: "This account is temporarily locked. Please try again later." }
  }
  if (portalUser.status === "SUSPENDED" || portalUser.status === "LOCKED" || portalUser.status === "DEACTIVATED") {
    return { success: false, error: GENERIC_LOGIN_ERROR }
  }
  if (portalUser.status === "PENDING_VERIFICATION" || !portalUser.emailVerifiedAt) {
    return { success: false, error: "Please finish activating your account using your invitation link first." }
  }

  const passwordValid = portalUser.passwordHash ? await bcrypt.compare(password, portalUser.passwordHash) : false

  if (!passwordValid) {
    const failedLoginCount = portalUser.failedLoginCount + 1
    const lockedUntil = failedLoginCount >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null
    await prisma.portalUser.update({ where: { id: portalUser.id }, data: { failedLoginCount, lockedUntil } })
    await createPortalAuditEvent({ portalUserId: portalUser.id, action: "PORTAL_LOGIN_FAILED", ipAddress: ip, userAgent })
    return { success: false, error: GENERIC_LOGIN_ERROR }
  }

  await prisma.portalUser.update({
    where: { id: portalUser.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  })

  const { raw: rawSessionToken } = await createPortalSession(portalUser.id, ip, userAgent ?? null)
  await setPortalSessionCookie(rawSessionToken)

  await createPortalAuditEvent({ portalUserId: portalUser.id, action: "PORTAL_LOGIN_SUCCESS", ipAddress: ip, userAgent })

  return { success: true, data: { loggedIn: true } }
}

export async function portalLogout(): Promise<ActionResult<{ loggedOut: true }>> {
  try {
    const auth = await requirePortalAuth()
    await revokePortalSession(auth.sessionId)
    await createPortalAuditEvent({ portalUserId: auth.portalUserId, action: "PORTAL_SESSION_REVOKED" })
  } catch (error) {
    if (!(error instanceof PortalAuthError)) {
      return { success: false, error: "Failed to log out" }
    }
    // Already signed out — clearing the cookie below is still correct.
  }
  await clearPortalSessionCookie()
  return { success: true, data: { loggedOut: true } }
}
