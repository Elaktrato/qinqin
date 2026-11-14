/**
 * badgeScheme is a scheme name as the muted qualifier of a level badge
 * ("N5 · JLPT vocabulary"): a trailing parenthesised qualifier, which the
 * map's Group by list needs ("JLPT (vocabulary)"), reads plainly here. An
 * "(approximate)" qualifier stays a qualifier, shortened, so the badge
 * still says the level is an estimate ("N5 · JLPT kanji (approx.)").
 */
export function badgeScheme(name: string): string {
	const trimmed = name.trim();
	const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(trimmed);
	if (!match) return trimmed;
	if (match[2].trim().toLowerCase() === 'approximate') return `${match[1]} (approx.)`;
	return `${match[1]} ${match[2]}`;
}
