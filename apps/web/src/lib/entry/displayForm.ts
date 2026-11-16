// The display form rule: the text an entry is shown and snapshotted as.
// Contract: docs/contracts/frequency/display-form.json; the server's
// lexicon.Entry.DisplayForm implements the same rule (entry bases, starter
// decks, lookup terms). The web applies it itself only where it builds a
// snapshot from a lookup result (the reader popup).

export interface DisplayEntry {
	forms: readonly { text: string; flags?: readonly string[] }[];
	readings: readonly { type: string; value: string; flags?: readonly string[] }[];
	/** The entry's senses in order; only the first one's tags matter (uk). */
	senses?: readonly { tags?: readonly string[] }[];
}

// Rare written forms (JMdict ke_inf): rarely used, outdated, irregular,
// search-only. sK is never shown.
const RARE_FORM = ['rK', 'oK', 'iK', 'sK'];
// The same flags of kana readings (re_inf).
const RARE_READING = ['rk', 'ok', 'ik', 'sk'];

const KANA = /^[ぁ-ゖァ-ヺー]+$/u;

interface Flagged {
	text: string;
	flags: readonly string[];
}

function best(items: readonly Flagged[], rare: readonly string[], hidden: string): string | null {
	const plain = items.find((it) => !it.flags.some((f) => rare.includes(f)));
	if (plain) return plain.text;
	return items.find((it) => !it.flags.includes(hidden))?.text ?? null;
}

function firstSenseUK(entry: DisplayEntry): boolean {
	return (entry.senses?.[0]?.tags ?? []).includes('uk');
}

/**
 * displayForm: 1. a list form written only in kana that is one of the
 * entry's kana readings (not search-only); 2. when the first sense is tagged
 * uk, the best kana reading; 3. the best written form; 4. the best kana
 * reading (else the first), else the first reading, else ''. Best = the
 * first without a rare flag, else the first that is not search-only.
 */
export function displayForm(entry: DisplayEntry, listForm?: string): string {
	const kana: Flagged[] = entry.readings
		.filter((r) => r.type === 'kana')
		.map((r) => ({ text: r.value, flags: r.flags ?? [] }));
	const listed = kana.some((r) => r.text === listForm && !r.flags.includes('sk'));
	if (listForm && KANA.test(listForm) && listed) return listForm;
	const bestKana = (): string => best(kana, RARE_READING, 'sk') ?? kana[0].text;
	if (kana.length > 0 && firstSenseUK(entry)) return bestKana();
	const forms = entry.forms.map((f) => ({ text: f.text, flags: f.flags ?? [] }));
	const form = best(forms, RARE_FORM, 'sK');
	if (form !== null) return form;
	if (kana.length > 0) return bestKana();
	return entry.readings[0]?.value ?? '';
}
