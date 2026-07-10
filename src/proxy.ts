import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { createLogEntry, finalizeLog, reqId } from "@/lib/logger"

const publicRoutes = ["/login", "/api/health"]
const protectedPrefixes = [
  "/dashboard", "/clients", "/packets", "/documents", "/pdf-editor",
  "/validation", "/signatures", "/approvals", "/audit", "/reports",
  "/library", "/templates", "/settings", "/search", "/help", "/training",
  "/ai-copilot", "/integrations", "/automation", "/command-center",
  "/notifications",
]

export default auth((req) => {
  const start = Date.now()
  const { nextUrl } = req
  const isLoggedIn = !!req.auth
  const pathname = nextUrl.pathname
  const log = createLogEntry(req.method || "GET", pathname)

  // Attach request ID to response headers
  const addLogHeaders = (res: NextResponse): NextResponse => {
    res.headers.set("X-Request-ID", log.id)
    return res
  }

  // Public routes
  if (publicRoutes.includes(pathname)) {
    if (isLoggedIn) {
      const res = NextResponse.redirect(new URL("/dashboard", nextUrl))
      finalizeLog(log, 302, start, { userId: (req.auth?.user as Record<string, unknown>)?.id as string | undefined })
      addLogHeaders(res)
      return res
    }
    const res = NextResponse.next()
    finalizeLog(log, 200, start)
    addLogHeaders(res)
    return res
  }

  // Protected routes
  if (protectedPrefixes.some((p) => pathname.startsWith(p))) {
    if (!isLoggedIn) {
      const loginUrl = new URL("/login", nextUrl)
      loginUrl.searchParams.set("callbackUrl", pathname)
      const res = NextResponse.redirect(loginUrl)
      finalizeLog(log, 302, start, { error: "Unauthenticated" })
      addLogHeaders(res)
      return res
    }
    const user = req.auth?.user as Record<string, unknown> | undefined
    const res = NextResponse.next()
    finalizeLog(log, 200, start, {
      userId: user?.id as string | undefined,
      orgId: user?.activeOrganizationId as string | undefined,
    })
    addLogHeaders(res)
    return res
  }

  const res = NextResponse.next()
  finalizeLog(log, 200, start)
  addLogHeaders(res)
  return res
})

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.).*)"],
}
