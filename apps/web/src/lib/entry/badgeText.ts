import { t } from '$lib/i18n';

/** BadgeQualifier is a qualifier a badge keeps: shown short, spoken in full. */
export interface BadgeQualifier {
	shown: string;
	spoken: string;
}

const approximate = (): BadgeQualifier => ({ shown: t('entry.badges.approxShown'), spoken: t('entry.badges.approxSpoken') });

/**
 * badgeSchemeParts is a scheme name as the muted qualifier of a level badge
 * ("N5 · JLPT vocabulary"): a trailing parenthesised qualifier, which the
 * map's Group by list needs ("JLPT (vocabulary)"), reads plainly here. An
 * "(approximate)" qualifier stays a qualifier, so the badge still says the
 * level is an estimate: shown shortened ("(approx.)"), spoken in full.
 */
export function badgeSchemeParts(name: string): { base: string; qualifier: BadgeQualifier | null } {
	const trimmed = name.trim();
	const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(trimmed);
	if (!match) return { base: trimmed, qualifier: null };
	if (match[2].trim().toLowerCase() === 'approximate') return { base: match[1], qualifier: approximate() };
	return { base: `${match[1]} ${match[2]}`, qualifier: null };
}

/** badgeScheme is badgeSchemeParts as one visible string ("JLPT kanji (approx.)"). */
export function badgeScheme(name: string): string {
	const { base, qualifier } = badgeSchemeParts(name);
	return qualifier ? `${base} ${qualifier.shown}` : base;
}
