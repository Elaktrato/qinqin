// Hanzi and kanji font stacks (#97, design §8), shared by the app-wide choice
// (`appearance.hanziFont`) and the reader's own font. Without a font pack every
// choice is a system stack (no CJK font is bundled: 10-20 MB per weight); an
// installed pack's face (registered by packFaces under `qq-<face>-<script>`)
// goes first. The study `lang` picks the script and so the regional glyph
// forms. Every stack ends with a generic family.

export const HANZI_FACES = ['sans', 'serif', 'kai'] as const;
export type HanziFace = (typeof HANZI_FACES)[number];
export const HANZI_SCRIPTS = ['Hans', 'Hant', 'Jpan'] as const;
export type HanziScript = (typeof HANZI_SCRIPTS)[number];

/** The installed pack faces, as `<face>-<script>` keys (installedFaces builds it). */
export type InstalledFaces = ReadonlySet<string>;

export function installedFaces(faces: readonly { face: string; script: string }[]): InstalledFaces {
	return new Set(faces.map((f) => `${f.face}-${f.script}`));
}

/** packFamily: the FontFace family of an installed face. */
export function packFamily(face: HanziFace, script: HanziScript): string {
	return `qq-${face}-${script}`;
}

const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/**
 * hanziScript: the script of study text in `lang` — `zh`, `zh-Hans`, `zh-CN` → Hans; `zh-Hant`, `zh-TW`,
 * `zh-HK`, `zh-MO`, `zh-Bopo` → Hant; `ja` → Jpan; null for other languages and romanisations (`*-Latn`).
 */
export function hanziScript(lang: string): HanziScript | null {
	const sub = lang.trim().toLowerCase().split('-');
	if (sub[0] === 'ja') return sub[1] === 'latn' ? null : 'Jpan';
	if (sub[0] !== 'zh') return null;
	const second = sub[1] ?? '';
	if (second === 'latn') return null;
	if (second === 'hant' || second === 'bopo' || TRADITIONAL_REGIONS.has(second)) return 'Hant';
	return 'Hans';
}

const SYSTEM: Record<HanziFace, Record<HanziScript, string>> = {
	sans: {
		Hans: '"PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
		Hant: '"PingFang TC", "Noto Sans CJK TC", "Source Han Sans TC", "Microsoft JhengHei", sans-serif',
		Jpan: '"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", Meiryo, sans-serif'
	},
	serif: {
		Hans: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif',
		Hant: '"Songti TC", "Noto Serif CJK TC", "Source Han Serif TC", PMingLiU, serif',
		Jpan: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif'
	},
	kai: {
		Hans: '"Kaiti SC", STKaiti, KaiTi, "AR PL UKai CN", serif',
		Hant: '"Kaiti TC", BiauKai, DFKai-SB, "AR PL UKai TW", serif',
		Jpan: '"UD Digi Kyokasho N-R", "YuKyokasho", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif'
	}
};

/** hanziStack: the CSS font-family of a face for study text in `lang`, an installed pack face first. */
export function hanziStack(face: HanziFace, lang: string, installed: InstalledFaces): string {
	const script = hanziScript(lang);
	if (script === null) return face === 'sans' ? 'sans-serif' : 'serif';
	const system = SYSTEM[face][script];
	return installed.has(`${face}-${script}`) ? `"${packFamily(face, script)}", ${system}` : system;
}
