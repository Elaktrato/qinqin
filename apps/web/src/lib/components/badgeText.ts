/**
 * badgeScheme is a scheme name as the muted qualifier of a level badge
 * ("N5 · JLPT vocabulary"): a trailing parenthesised qualifier, which the
 * map's Group by list needs ("JLPT (vocabulary)"), reads plainly here.
 */
export function badgeScheme(name: string): string {
	const trimmed = name.trim();
	const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(trimmed);
	return match ? `${match[1]} ${match[2]}` : trimmed;
}
