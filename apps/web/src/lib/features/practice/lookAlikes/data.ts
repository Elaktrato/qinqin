// The bundled look-alike sets (#228; lookAlikes/data, written for the project, CC BY 4.0): loaded when the drill needs
// them (a chunk of its own), parsed by the contract's rules; a file with a problem is never used.

import { parseSetsFile, type SetsFile } from './sets';

/** loadSetsFile: the sets of a workspace language's primary subtag, or null (no file, or a file with a problem). */
export async function loadSetsFile(language: string): Promise<SetsFile | null> {
	const primary = language.trim().toLowerCase().split(/[-_]/)[0];
	if (primary === 'zh') return parseSetsFile((await import('./data/look-alikes-zh.json')).default);
	if (primary === 'ja') return parseSetsFile((await import('./data/look-alikes-ja.json')).default);
	return null;
}
