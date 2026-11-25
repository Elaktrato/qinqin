// The label of a Chinese variant shown beside the entry's word (#104):
// "traditional" or "simplified" from the written forms' flags, plain
// "variant" when the script cannot be told. Japanese forms are never
// variants (they stay in the "Also written" line).

import { profileOf } from '$lib/languages/profiles';

export type VariantLabel = 'traditional' | 'simplified' | 'variant';

export function variantLabel(
	entry: {
		language: string;
		written: string;
		forms?: readonly { text: string; flags?: readonly string[] }[];
	},
	variant: { written: string }
): VariantLabel {
	if (!profileOf(entry.language).variants) return 'variant';
	const forms = entry.forms ?? [];
	if (forms.some((f) => f.text === variant.written && (f.flags ?? []).includes('trad'))) {
		return 'traditional';
	}
	const own = forms.find((f) => f.text === entry.written);
	if (own && (own.flags ?? []).includes('trad')) return 'simplified';
	return 'variant';
}
