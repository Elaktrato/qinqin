<script lang="ts">
	// The account's avatar (design §9): the name's first letter in a circle.
	// Always decorative: the button around it carries the name.
	let { name, size = 'm' }: { name: string; size?: 'm' | 'l' } = $props();

	// The first user-perceived character (a grapheme: a letter with its
	// combining marks, a flag, a ZWJ emoji), else the first code point where
	// Intl.Segmenter is missing. Upper-cased only when that keeps it one
	// character long (ß would become SS).
	function firstGrapheme(text: string): string | undefined {
		if (typeof Intl.Segmenter === 'function') {
			for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return segment;
			return undefined;
		}
		return Array.from(text)[0];
	}

	function upper(char: string): string {
		const up = char.toLocaleUpperCase();
		return up.length === char.length ? up : char;
	}

	const initial = $derived(upper(firstGrapheme(name.trim()) ?? '?'));
</script>

<span class="avatar {size}" aria-hidden="true">{initial}</span>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: var(--selected-wash);
		color: var(--reading-accent);
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		line-height: 1;
	}
	.l {
		width: 2.25rem;
		height: 2.25rem;
		font-size: 1rem;
	}
	@media (forced-colors: active) {
		.avatar {
			border: 1px solid CanvasText;
		}
	}
</style>
