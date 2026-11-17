// Settings → Appearance, the pure part: which themes a slot offers (grouped
// by family), which accents a theme offers (3:1 on panel), the draft's
// change, and what the live preview paints.

import type { ListedTheme } from '$lib/api/themes';
import type { Appearance, AppearanceChange, Slot } from '$lib/theme/appearance';
import { accentChoices } from '$lib/theme/derive';
import type { Theme } from '$lib/theme/types';

export interface ThemeGroup {
	/** The family name ("" for a theme without one). */
	family: string;
	themes: ListedTheme[];
}

/**
 * slotThemeGroups: the themes of the slot's scheme, grouped by family in the
 * list's order; the chosen theme is kept even when it is of the other scheme
 * (a slot may hold either), so the choice stays visible and selected.
 */
export function slotThemeGroups(themes: readonly ListedTheme[], slot: Slot, chosen: string): ThemeGroup[] {
	const groups: ThemeGroup[] = [];
	for (const theme of themes) {
		if (theme.scheme !== slot && theme.id !== chosen) continue;
		const group = groups.find((g) => g.family === theme.family);
		if (group) group.themes.push(theme);
		else groups.push({ family: theme.family, themes: [theme] });
	}
	return groups;
}

export interface AccentOption {
	key: string;
	color: string;
}

/** accentOptions: the accents the picker offers (at least 3:1 on panel), in file order. */
export function accentOptions(theme: Theme): AccentOption[] {
	return accentChoices(theme).map((key) => ({ key, color: theme.accents[key] }));
}

/** changeFrom: the change that writes every member of the draft. */
export function changeFrom(a: Appearance): AppearanceChange {
	return {
		mode: a.mode,
		light: { theme: a.light.theme, accent: a.light.accent },
		dark: { theme: a.dark.theme, accent: a.dark.accent },
		corners: a.corners,
		spacing: a.spacing,
		hanziFont: a.hanziFont
	};
}

export function isDirty(draft: Appearance, saved: Appearance): boolean {
	return JSON.stringify(changeFrom(draft)) !== JSON.stringify(changeFrom(saved));
}

/** previewOf: the draft as painted — the slot being edited, so a dark theme picked on a light device is seen. */
export function previewOf(draft: Appearance, editing: Slot | null): Appearance {
	return editing === null ? draft : { ...draft, mode: editing };
}
