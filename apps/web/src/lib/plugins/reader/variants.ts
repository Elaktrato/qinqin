// Only the two one-way bundles are imported (not the full opencc-js
// build) to keep the reader's bundle small.
import * as Cn2t from 'opencc-js/cn2t';
import * as T2cn from 'opencc-js/t2cn';

export type Variant = 'original' | 'simplified' | 'traditional';

export const VARIANTS: readonly Variant[] = ['original', 'simplified', 'traditional'];

type Convert = (text: string) => string;

// Building a converter loads its dictionaries into a trie, so each one is
// created on first use and then reused.
let toTraditional: Convert | null = null;
let toSimplified: Convert | null = null;

/** convertText renders text in a Chinese script variant; identity for 'original'. */
export function convertText(text: string, to: Variant): string {
	if (to === 'original' || text === '') return text;
	if (to === 'traditional') {
		toTraditional ??= Cn2t.Converter({ from: 'cn', to: 't' });
		return toTraditional(text);
	}
	toSimplified ??= T2cn.Converter({ from: 't', to: 'cn' });
	return toSimplified(text);
}
