// The app-wide hanzi font (#97, design §8): `appearance.hanziFont` becomes one
// stack per script on :root; hanzi.css lets every element that carries a study
// `lang` pick its script's stack as --font-hanzi and sets study text in it.

import { hanziStack, type HanziFace, type InstalledFaces } from './hanzi';

export interface HanziVars {
	'--font-hanzi-hans': string;
	'--font-hanzi-hant': string;
	'--font-hanzi-jpan': string;
}

/** hanziVars: the stacks of the chosen face for simplified, traditional and Japanese text. */
export function hanziVars(face: HanziFace, installed: InstalledFaces): HanziVars {
	return {
		'--font-hanzi-hans': hanziStack(face, 'zh-Hans', installed),
		'--font-hanzi-hant': hanziStack(face, 'zh-Hant', installed),
		'--font-hanzi-jpan': hanziStack(face, 'ja', installed)
	};
}

export function applyHanziVars(vars: HanziVars, root: HTMLElement): void {
	for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}
