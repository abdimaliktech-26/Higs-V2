import { describe, expect, it } from "vitest"
import { productionSecurityEnvironmentErrors } from "@/lib/security-environment"

describe("production security environment", () => {
  it("does not require deployment secrets outside production", () => {
    expect(productionSecurityEnvironmentErrors({}, "test")).toEqual([])
  })

  it("requires both stable secrets in production", () => {
    expect(productionSecurityEnvironmentErrors({}, "production")).toEqual([
      "AUTH_SECRET must be a non-placeholder value of at least 32 characters",
      "FILE_SIGNING_KEY must be a non-placeholder value of at least 32 characters",
    ])
  })

  it("rejects short and documented placeholder values", () => {
    expect(productionSecurityEnvironmentErrors({
      AUTH_SECRET: "short",
      FILE_SIGNING_KEY: "change-me-to-a-random-key-at-least-32-chars",
    }, "production")).toHaveLength(2)
  })

  it("accepts independently configured production secrets", () => {
    expect(productionSecurityEnvironmentErrors({
      AUTH_SECRET: "a".repeat(64),
      FILE_SIGNING_KEY: "b".repeat(64),
    }, "production")).toEqual([])
  })
})
