// The frame's sections (design §9): what the desktop bar and the phone
// drawer list, in one order, and which one a path belongs to. Pure, so the
// order and the matching are tested without rendering.
//
// Order (plan Ruling): Search first (owner request, 2026-11-18), then the
// core features (Decks, Reader), then the enabled plugin pages in the user's
// plugin order, then Stats last. Before the plugin states are loaded only
// Search and Stats show, so a switched-off feature never flashes in.

import { t } from '$lib/i18n';
import { coreFeatures, featureEnabled } from '$lib/features';
import { visibleNavPages, webPlugins, type WebPlugin } from '$lib/plugins';
import type { PluginStatesValue } from '$lib/plugins/states';
import { ICONS, type IconName } from '$lib/ui/icons/lucide';

export interface FrameSection {
	/** Stable id: a feature or plugin slug, `search`, `stats`, `home`. */
	id: string;
	/** The tooltip, the accessible name and the drawer label (catalogue text). */
	label: string;
	href: string;
	icon: IconName;
	/** Path prefixes that count as this section (whole segments). */
	match: string[];
}

const FEATURE_ICONS: Record<string, IconName> = { flashcards: 'study', reader: 'reader' };
const FEATURE_MATCH: Record<string, string[]> = { flashcards: ['/flashcards', '/study'], reader: ['/reader'] };

/** iconOf maps a manifest icon name to the icon set; unknown or absent names get the generic `plugin` icon. */
export function iconOf(name: string | undefined): IconName {
	return name !== undefined && Object.hasOwn(ICONS, name) ? (name as IconName) : 'plugin';
}

/** homeSection: Home, the logo's target on desktop and the drawer's first row on the phone. */
export function homeSection(): FrameSection {
	return { id: 'home', label: t('nav.home'), href: '/', icon: 'home', match: [] };
}

/** frameSections lists the sections of the bar and the drawer (Home not included). */
export function frameSections(state: PluginStatesValue, plugins: WebPlugin[] = webPlugins): FrameSection[] {
	const features: FrameSection[] =
		state.status === 'ready'
			? coreFeatures
					.filter((f) => featureEnabled(f.id, state.list))
					.map((f) => ({
						id: f.slug,
						label: f.title,
						href: f.href,
						icon: FEATURE_ICONS[f.slug] ?? 'plugin',
						match: FEATURE_MATCH[f.slug] ?? [f.href]
					}))
			: [];
	// A plugin page never takes an id the frame uses itself (Home, Search,
	// Stats, a core feature, the bottom bar's More): ids stay unique.
	const taken = new Set<string>(['home', 'search', 'stats', 'more', ...features.map((f) => f.id)]);
	const pages: FrameSection[] = visibleNavPages(plugins, state)
		.filter((p) => !taken.has(p.slug))
		.map((p) => ({
		id: p.slug,
		label: p.title,
		href: p.href,
		icon: iconOf(p.icon),
		match: [p.href]
	}));
	return [
		{ id: 'search', label: t('nav.search'), href: '/search', icon: 'search', match: ['/search', '/entry', '/lookups'] },
		...features,
		...pages,
		{ id: 'stats', label: t('nav.stats'), href: '/stats', icon: 'stats', match: ['/stats'] }
	];
}

function under(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * currentSection: the id of the section a path belongs to (the longest
 * matching prefix), `home` for `/` only, else null (Settings, Sources and
 * the account pages live in the account menu).
 */
export function currentSection(path: string, sections: readonly FrameSection[]): string | null {
	if (path === '/') return 'home';
	let best: { id: string; length: number } | null = null;
	for (const section of sections) {
		for (const prefix of section.match) {
			if (under(path, prefix) && (best === null || prefix.length > best.length)) {
				best = { id: section.id, length: prefix.length };
			}
		}
	}
	return best?.id ?? null;
}
