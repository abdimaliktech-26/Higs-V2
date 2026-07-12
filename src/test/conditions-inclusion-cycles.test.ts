import { describe, it, expect } from "vitest"
import { findInclusionCycle, type InclusionEdge } from "@/lib/conditions/inclusion-cycles"

function edge(from: string, to: string, id = `${from}->${to}`): InclusionEdge {
  return { fromMappingId: from, toMappingId: to, conditionId: id }
}

describe("findInclusionCycle", () => {
  it("acyclic graph is accepted", () => {
    const result = findInclusionCycle([edge("A", "B"), edge("B", "C")])
    expect(result.hasCycle).toBe(false)
    expect(result.cycle).toEqual([])
  })

  it("no edges at all is trivially acyclic", () => {
    expect(findInclusionCycle([]).hasCycle).toBe(false)
  })

  it("self-cycle: a mapping's inclusion depends on its own field", () => {
    const result = findInclusionCycle([edge("A", "A")])
    expect(result.hasCycle).toBe(true)
    expect(result.cycle).toEqual(["A", "A"])
  })

  it("two-document cycle: A -> B -> A", () => {
    const result = findInclusionCycle([edge("A", "B"), edge("B", "A")])
    expect(result.hasCycle).toBe(true)
    expect(result.cycle[0]).toBe(result.cycle[result.cycle.length - 1])
    expect(result.cycle).toContain("A")
    expect(result.cycle).toContain("B")
  })

  it("longer cycle: A -> B -> C -> A", () => {
    const result = findInclusionCycle([edge("A", "B"), edge("B", "C"), edge("C", "A")])
    expect(result.hasCycle).toBe(true)
    expect(result.cycle[0]).toBe(result.cycle[result.cycle.length - 1])
    expect(new Set(result.cycle)).toEqual(new Set(["A", "B", "C"]))
  })

  it("a branching acyclic graph with a shared descendant is still accepted", () => {
    // A -> B, A -> C, B -> D, C -> D (diamond, no back-edge)
    const result = findInclusionCycle([edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")])
    expect(result.hasCycle).toBe(false)
  })

  it("a cycle in one disconnected component is still detected even with an unrelated acyclic component", () => {
    const result = findInclusionCycle([edge("X", "Y"), edge("A", "B"), edge("B", "A")])
    expect(result.hasCycle).toBe(true)
  })

  it("multiple edges from the same mapping (nested-group conditions) are all included in the graph", () => {
    // Root group condition: A -> B. Nested child-group condition: A -> C. B -> C closes no cycle; C -> A would.
    const result = findInclusionCycle([edge("A", "B"), edge("A", "C"), edge("C", "A")])
    expect(result.hasCycle).toBe(true)
    expect(new Set(result.cycle)).toEqual(new Set(["A", "C"]))
  })
})
