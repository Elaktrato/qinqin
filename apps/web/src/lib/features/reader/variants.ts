// Chinese script variants via opencc-js. Its dictionaries are large (about
// half a megabyte gzipped), and the reader is part of the app's
// eagerly loaded registry, so each one-way converter bundle is fetched on
// first use (prepareVariant) rather than imported statically. Only the two
// one-way bundles are used, never the full build.

export type Variant = 'original' | 'simplified' | 'traditional';

export const VARIANTS: readonly Variant[] = ['original', 'simplified', 'traditional'];

type Convert = (text: string) => string;

const converters: Partial<Record<Exclude<Variant, 'original'>, Convert>> = {};
const loading: Partial<Record<Exclude<Variant, 'original'>, Promise<void>>> = {};

async function load(to: Exclude<Variant, 'original'>): Promise<void> {
	// Building a converter loads its dictionaries into a trie: once each.
	if (to === 'traditional') {
		const { Converter } = await import('opencc-js/cn2t');
		converters.traditional = Converter({ from: 'cn', to: 't' });
	} else {
		const { Converter } = await import('opencc-js/t2cn');
		converters.simplified = Converter({ from: 't', to: 'cn' });
	}
}

/** prepareVariant loads the converter for a variant; resolves at once for 'original'. */
export function prepareVariant(to: Variant): Promise<void> {
	if (to === 'original' || converters[to]) return Promise.resolve();
	loading[to] ??= load(to).catch((err: unknown) => {
		delete loading[to];
		throw err;
	});
	return loading[to];
}

/**
 * convertText renders text in a Chinese script variant; identity for
 * 'original'. The variant must have been prepared (prepareVariant).
 */
export function convertText(text: string, to: Variant): string {
	if (to === 'original' || text === '') return text;
	const convert = converters[to];
	if (!convert) throw new Error(`convertText: variant ${to} is not prepared`);
	return convert(text);
}
