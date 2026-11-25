// The visual aids a component sees: the signed-in workspace's switches and the tone colours of the painted
// theme. Outside an app context or signed out (a test, the sources page) every aid is off, so a component
// that draws an aid never needs a session. Call it while the component is initialised (it reads the context).

import { existingApp } from '$lib/context/context';
import { fallbackTheme } from '$lib/theme/fallback';
import { toneColors } from './tones';
import { NO_AIDS, readVisualAids, type VisualAids } from './visualAids';
import type { PictureCache } from './pictures';

export interface VisualAidsView {
	/** The switches (reactive: reads the current workspace's settings). */
	readonly aids: VisualAids;
	/** `--tone-1: #...; ...` for the painted theme, to put on the element that holds tone-coloured text. */
	readonly toneStyle: string;
	/** The session's picture cache, or null without a session. */
	readonly pictures: PictureCache | null;
}

export function useVisualAids(): VisualAidsView {
	const app = existingApp();
	return {
		get aids(): VisualAids {
			const session = app?.session;
			return session ? readVisualAids(session.workspaces.current?.settings) : NO_AIDS;
		},
		get toneStyle(): string {
			if (!app) return '';
			const current = app.theme.current;
			const theme = app.theme.themeOf(current.theme) ?? fallbackTheme(current.slot);
			return toneColors(theme.colors)
				.map((color, i) => `--tone-${i + 1}:${color}`)
				.join(';');
		},
		get pictures(): PictureCache | null {
			return app?.session?.caches.pictures ?? null;
		}
	};
}
