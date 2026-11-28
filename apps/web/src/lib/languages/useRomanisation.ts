// The romanisation a component may show (#284): the signed-in workspace's `romanisation` setting through the one
// rule of ./romanisation.ts. EVERY component that renders a reading (a reading object, a word's reading string, a
// sentence's reading line, ruby) asks this view, or renders through `ReadingText`, which does. Outside an app
// context or signed out everything is shown (the default). Call it while the component is initialised (it reads
// the context); its getters are reactive.

import { existingApp } from '$lib/context/context';
import {
	ROMANISATION_DEFAULTS,
	hiddenReadings,
	isReadingShown,
	isReadingTextShown,
	readRomanisation,
	shownReadings,
	type Romanisation
} from './romanisation';

export interface RomanisationView {
	/** The modes of the current workspace. */
	readonly prefs: Romanisation;
	/** Whether a reading of this type shows. */
	shows(type: string): boolean;
	/** Whether a reading string without a type (typed by its script) shows in this language. */
	showsText(text: string | null | undefined, language: string): boolean;
	/** The reading string itself when it shows, else '' (for markup that prints a plain reading string). */
	text(text: string | null | undefined, language: string): string;
	/** The readings that show, in their order. */
	shown<T extends { type: string }>(readings: readonly T[]): T[];
	/** The readings the setting hides (the romanisation hint), in their order. */
	hidden<T extends { type: string }>(readings: readonly T[]): T[];
}

/** romanisationView: the view over a source of modes (tests and the session pass their own). */
export function romanisationView(prefs: () => Readonly<Romanisation>): RomanisationView {
	return {
		get prefs(): Romanisation {
			return { ...prefs() };
		},
		shows: (type) => isReadingShown(type, prefs()),
		showsText: (text, language) => isReadingTextShown(text ?? '', language, prefs()),
		text: (text, language) => (text && isReadingTextShown(text, language, prefs()) ? text : ''),
		shown: (readings) => shownReadings(readings, prefs()),
		hidden: (readings) => hiddenReadings(readings, prefs())
	};
}

export function useRomanisation(): RomanisationView {
	const app = existingApp();
	return romanisationView(() => {
		const session = app?.session;
		return session ? readRomanisation(session.workspaces.current?.settings) : ROMANISATION_DEFAULTS;
	});
}
