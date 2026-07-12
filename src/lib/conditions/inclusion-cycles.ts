// Stage 5 Step 4b — circular DOCUMENT_INCLUSION dependency detection.
//
// Pure graph algorithm, no Prisma import — the caller (validatePacketTemplateConditions)
// is responsible for building the edge list from real TemplateConditionGroup/
// TemplateCondition rows and only ever includes DOCUMENT_INCLUSION-purpose
// groups. DOCUMENT_REQUIREDNESS groups never create materialization cycles
// on their own and are deliberately excluded by the caller.

export interface InclusionEdge {
  fromMappingId: string
  toMappingId: string
  conditionId: string
}

export interface InclusionCycleResult {
  hasCycle: boolean
  // Mapping ids in cycle order (first === last) when hasCycle is true, e.g.
  // ["A", "B", "A"] for a two-document cycle, ["A", "A"] for a self-cycle.
  cycle: string[]
}

/**
 * Detects any cycle in the directed graph of "this document's inclusion
 * depends on a field on that document" edges within one PacketTemplate.
 * Standard three-color DFS — returns the first cycle found, not all of them;
 * the caller reports it and the affected mappings can fix and re-validate.
 */
export function findInclusionCycle(edges: InclusionEdge[]): InclusionCycleResult {
  const graph = new Map<string, string[]>()
  const nodes = new Set<string>()
  for (const edge of edges) {
    nodes.add(edge.fromMappingId)
    nodes.add(edge.toMappingId)
    if (!graph.has(edge.fromMappingId)) graph.set(edge.fromMappingId, [])
    graph.get(edge.fromMappingId)!.push(edge.toMappingId)
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const pathStack: string[] = []

  function dfs(node: string): string[] | null {
    color.set(node, GRAY)
    pathStack.push(node)
    for (const next of graph.get(node) ?? []) {
      const nextColor = color.get(next) ?? WHITE
      if (nextColor === WHITE) {
        const found = dfs(next)
        if (found) return found
      } else if (nextColor === GRAY) {
        const idx = pathStack.indexOf(next)
        return [...pathStack.slice(idx), next]
      }
    }
    pathStack.pop()
    color.set(node, BLACK)
    return null
  }

  for (const node of nodes) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      const found = dfs(node)
      if (found) return { hasCycle: true, cycle: found }
    }
  }
  return { hasCycle: false, cycle: [] }
}
