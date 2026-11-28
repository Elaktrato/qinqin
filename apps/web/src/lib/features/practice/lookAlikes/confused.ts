// "Easily confused with" on entry pages (#228): for each Han character of a written form (once, in order), the other
// Han members of its sets in the workspace's script. Kana and kana look-alikes are left to the drill (a kana word's
// page would list them on every word).

import { loadSetsFile } from './data';
import { chineseScript, isKana, type SetsFile } from './sets';

export interface Confusion {
	char: string;
	others: string[];
}

/** confusedWith: the look-alikes of the characters of `written` in a workspace of `language`. */
export function confusedWith(file: SetsFile, written: string, language: string): Confusion[] {
	if (language.trim().toLowerCase().split(/[-_]/)[0] !== file.language) return [];
	const script = chineseScript(language);
	const sets = file.sets.filter((s) => file.language !== 'zh' || s.script === undefined || s.script === script);
	const out: Confusion[] = [];
	const seen = new Set<string>();
	for (const ch of written) {
		if (seen.has(ch) || isKana(ch)) continue;
		seen.add(ch);
		const others: string[] = [];
		for (const s of sets) {
			if (!s.members.includes(ch)) continue;
			for (const m of s.members) if (m !== ch && !isKana(m) && !others.includes(m)) others.push(m);
		}
		if (others.length > 0) out.push({ char: ch, others });
	}
	return out;
}

/**
 * confusionLanguage: the language whose sets and script an entry page uses: the workspace's when it reads the entry's
 * language (zh-Hant reads traditional), else the entry's.
 */
export function confusionLanguage(entryLanguage: string, workspaceLanguage: string | undefined): string {
	const primary = (l: string) => l.trim().toLowerCase().split(/[-_]/)[0];
	return workspaceLanguage !== undefined && primary(workspaceLanguage) === primary(entryLanguage) ? workspaceLanguage : entryLanguage;
}

/** loadConfusions: the look-alikes of a written form from the bundled sets (none for a language without sets). */
export async function loadConfusions(written: string, language: string): Promise<Confusion[]> {
	const file = await loadSetsFile(language);
	return file === null ? [] : confusedWith(file, written, language);
}
