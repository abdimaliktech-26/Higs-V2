import { describe, it, expect } from "vitest"
import { canAccessModule, filterNavByRole } from "@/lib/utils"
import type { UserRole } from "@prisma/client"

describe("RBAC — role permission checks", () => {
  it("SUPER_ADMIN can access everything (role in allowed list)", () => {
    expect(canAccessModule("SUPER_ADMIN" as any, [])).toBe(false)
    expect(canAccessModule("SUPER_ADMIN" as any, ["CASE_MANAGER"])).toBe(false)
    expect(canAccessModule("SUPER_ADMIN" as any, ["SUPER_ADMIN"])).toBe(true)
    expect(canAccessModule("SUPER_ADMIN" as any, ["SUPER_ADMIN", "ORG_ADMIN"])).toBe(true)
  })

  it("CASE_MANAGER can access assigned roles only", () => {
    expect(canAccessModule("CASE_MANAGER" as any, ["CASE_MANAGER"])).toBe(true)
    expect(canAccessModule("CASE_MANAGER" as any, ["ORG_ADMIN"])).toBe(false)
    expect(canAccessModule("CASE_MANAGER" as any, ["CASE_MANAGER", "DSP"])).toBe(true)
  })

  it("DSP has limited access", () => {
    expect(canAccessModule("DSP" as any, ["DSP"])).toBe(true)
    expect(canAccessModule("DSP" as any, ["CASE_MANAGER"])).toBe(false)
    expect(canAccessModule("DSP" as any, ["SUPER_ADMIN", "ORG_ADMIN"])).toBe(false)
  })

  it("NURSE clinical access only", () => {
    expect(canAccessModule("NURSE" as any, ["NURSE"])).toBe(true)
    expect(canAccessModule("NURSE" as any, ["DSP"])).toBe(false)
  })

  it("GUARDIAN has no internal access", () => {
    expect(canAccessModule("GUARDIAN" as any, ["CASE_MANAGER"])).toBe(false)
    expect(canAccessModule("GUARDIAN" as any, ["GUARDIAN"])).toBe(true)
  })
})

describe("filterNavByRole", () => {
  const items: { title: string; roles: UserRole[] }[] = [
    { title: "Dashboard", roles: ["ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
    { title: "Clients", roles: ["ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
    { title: "Packets", roles: ["ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"] },
    { title: "Validation", roles: ["ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
    { title: "Admin", roles: ["SUPER_ADMIN"] },
  ]

  it("ORG_ADMIN sees admin-level items", () => {
    const result = filterNavByRole(items, "ORG_ADMIN" as any, false)
    expect(result.find(i => i.title === "Dashboard")).toBeTruthy()
    expect(result.find(i => i.title === "Packets")).toBeTruthy()
    expect(result.find(i => i.title === "Admin")).toBeFalsy()
  })

  it("CASE_MANAGER sees assigned items only", () => {
    const result = filterNavByRole(items, "CASE_MANAGER" as any, false)
    expect(result.find(i => i.title === "Dashboard")).toBeTruthy()
    expect(result.find(i => i.title === "Validation")).toBeFalsy()
    expect(result.find(i => i.title === "Admin")).toBeFalsy()
  })

  it("SUPER_ADMIN sees everything including admin items", () => {
    const result = filterNavByRole(items, "SUPER_ADMIN" as any, true)
    expect(result.length).toBe(items.length)
    expect(result.find(i => i.title === "Admin")).toBeTruthy()
  })

  it("DSP sees limited items", () => {
    const result = filterNavByRole(items, "DSP" as any, false)
    expect(result.find(i => i.title === "Dashboard")).toBeTruthy()
    expect(result.find(i => i.title === "Clients")).toBeTruthy()
    expect(result.find(i => i.title === "Packets")).toBeFalsy()
    expect(result.find(i => i.title === "Validation")).toBeFalsy()
  })
})
