// src/repl/levenshtein.ts

/**
 * Computes the Levenshtein edit distance between two strings.
 * Pure function, no dependencies.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two rows (previous + current) to save memory
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,         // deletion
        (curr[j - 1] ?? 0) + 1,    // insertion
        (prev[j - 1] ?? 0) + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? 0;
}

/**
 * Returns the closest command name(s) within maxDistance, sorted by distance.
 */
export function findClosestCommands(
  input: string,
  knownCommands: string[],
  maxDistance = 2
): Array<{ command: string; distance: number }> {
  const results = knownCommands
    .map((cmd) => ({ command: cmd, distance: levenshtein(input, cmd) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
  return results;
}
