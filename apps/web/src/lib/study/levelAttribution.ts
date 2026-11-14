import type { Scheme } from '$lib/api/types';

/**
 * levelAttributionLine is the credit line the character map shows under
 * "Group by" while a level scheme groups it: "Levels: <attribution> ·
 * <license>", from the scheme's own manifest fields (GET /api/schemes).
 * An empty attribution leaves just the licence and vice versa; a scheme
 * with neither (or none selected) has no line. The page adds a link to
 * the Sources page after it.
 */
export function levelAttributionLine(
	scheme: Pick<Scheme, 'attribution' | 'license'> | null | undefined
): string | null {
	if (!scheme) return null;
	const parts = [scheme.attribution, scheme.license]
		.map((part) => (part ?? '').trim())
		.filter((part) => part !== '');
	if (parts.length === 0) return null;
	return `Levels: ${parts.join(' · ')}`;
}
