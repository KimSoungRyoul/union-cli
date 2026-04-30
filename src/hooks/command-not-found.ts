import {type Hook, toConfiguredId} from '@oclif/core'
import type {PluginManifest} from '../core/types.js'

// ── Levenshtein distance (zero-dep) ──

/**
 * Compute the Levenshtein edit distance between two strings.
 * Iterative two-row dynamic programming. Time O(m·n), space O(min(m, n)).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Ensure b is the shorter string for memory efficiency
  if (a.length < b.length) {
    const tmp = a
    a = b
    b = tmp
  }

  let prev = new Array<number>(b.length + 1)
  let curr = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      )
    }
    const swap = prev
    prev = curr
    curr = swap
  }
  return prev[b.length]
}

// ── Candidate collection ──

interface ExecutorLike {
  registry: {
    getAllManifests(): PluginManifest[]
  }
}

/**
 * Build a set of candidate command IDs from:
 * 1. config.commandIDs (built-in commands oclif knows about)
 * 2. config.commands aliases
 * 3. dynamic manifests registered via the init hook (registry on globalThis)
 *
 * All IDs are normalized to use ':' separator (oclif standard form).
 */
export function collectCandidates(opts: {
  commandIDs: readonly string[]
  commandAliases?: readonly string[]
  manifests?: readonly PluginManifest[]
}): string[] {
  const set = new Set<string>()

  for (const id of opts.commandIDs) {
    if (id) set.add(id)
  }
  for (const alias of opts.commandAliases ?? []) {
    if (alias) set.add(alias)
  }

  // Dynamic manifests: namespace itself + each command path
  for (const m of opts.manifests ?? []) {
    if (!m.namespace) continue
    set.add(m.namespace)
    for (const cmd of m.commands ?? []) {
      if (!cmd.id) continue
      set.add(`${m.namespace}:${cmd.id}`)
    }
  }

  return [...set]
}

// ── Suggestion ranking ──

export interface Suggestion {
  id: string
  distance: number
}

/**
 * Rank candidates by Levenshtein distance to `target`.
 * Returns up to `limit` suggestions whose distance is within `maxDistance`,
 * sorted ascending by distance and then alphabetically for stable output.
 */
export function rankSuggestions(
  target: string,
  candidates: readonly string[],
  limit = 3,
  maxDistance = 3,
): Suggestion[] {
  if (!target || candidates.length === 0) return []

  const scored: Suggestion[] = []
  for (const id of candidates) {
    const distance = levenshtein(target, id)
    if (distance <= maxDistance) {
      scored.push({id, distance})
    }
  }

  scored.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance
    return a.id.localeCompare(b.id)
  })

  return scored.slice(0, limit)
}

// ── Hook ──

const hook: Hook<'command_not_found'> = async function (opts) {
  const userId = opts.id ?? ''

  // Pull dynamic manifests from globalThis (populated by hooks/init.ts)
  let manifests: PluginManifest[] = []
  try {
    const exec = (globalThis as Record<string, unknown>).__unionCliExecutor as
      | ExecutorLike
      | undefined
    if (exec?.registry?.getAllManifests) {
      manifests = exec.registry.getAllManifests()
    }
  } catch {
    // ignore — best-effort enrichment
  }

  // Aliases from loaded commands
  const hiddenIds = new Set(opts.config.commands.filter((c) => c.hidden).map((c) => c.id))
  const aliases = opts.config.commands
    .flatMap((c) => c.aliases ?? [])
    .filter((a) => !hiddenIds.has(a))
  const baseIds = opts.config.commandIDs.filter((id) => !hiddenIds.has(id))

  const candidates = collectCandidates({
    commandIDs: baseIds,
    commandAliases: aliases,
    manifests,
  })

  const suggestions = rankSuggestions(userId, candidates, 3, 3)

  // Render in user-facing form (topicSeparator may be a space)
  const display = (id: string): string => toConfiguredId(id, opts.config)
  const original = display(userId)
  const bin = opts.config.bin

  process.stderr.write(`'${original}' is not a ${bin} command.\n`)

  if (suggestions.length > 0) {
    process.stderr.write('\nDid you mean one of these?\n')
    for (const s of suggestions) {
      process.stderr.write(`  ${bin} ${display(s.id)}\n`)
    }
    process.stderr.write(`\nRun '${bin} --help' for the full list of commands.\n`)
  } else {
    process.stderr.write(`\nRun '${bin} --help' for a list of available commands.\n`)
  }

  // Suggest only — never auto-run. Exit non-zero so shells / CI surface failure.
  this.exit(1)
}

export default hook
