<script lang="ts">
	// One member on a look-alike answer (#228): drawn from the stroke data with the strokes that make the difference in
	// the accent colour and the other strokes in the muted text colour (a cue that is not a hue; forced colours: Highlight), or the font's glyph where there is no usable data (a kana, a
	// character no installed pack has, data with another stroke count). The member's note says the same in words.
	import { useSession } from '$lib/context/context';
	import { fetchStrokeData } from '$lib/writing/strokeData';
	import { strokesFor, type DrawnStroke } from './glyph';

	let {
		char,
		lang,
		strokeLang,
		count,
		marks
	}: {
		char: string;
		/** The `lang` of the glyph (zh-Hans, zh-Hant, ja): the font's shapes. */
		lang: string | undefined;
		/** The language the stroke data is asked in (zh, ja). */
		strokeLang: string;
		/** The set file's stroke count; none for a kana. */
		count: number | undefined;
		marks: readonly number[];
	} = $props();

	const session = useSession();
	let drawn = $state<DrawnStroke[] | null>(null);

	$effect(() => {
		const ch = char;
		const n = count;
		const m = marks;
		drawn = null;
		if (n === undefined) return;
		let live = true;
		void fetchStrokeData(session.caches.strokes, ch, undefined, strokeLang).then((result) => {
			if (live && result.kind === 'ok') drawn = strokesFor(ch, result.data, n, m);
		});
		return () => {
			live = false;
		};
	});
</script>

{#if drawn !== null}
	<svg class="glyph" viewBox="0 0 1024 1024" role="img" aria-label={char}>
		<g transform="translate(0 900) scale(1 -1)">
			{#each drawn as stroke, index (index)}
				<path d={stroke.outline} class:marked={stroke.marked} class:rest={!stroke.marked && marks.length > 0} />
			{/each}
		</g>
	</svg>
{:else}
	<span class="glyph text" {lang}>{char}</span>
{/if}

<style>
	.glyph {
		display: inline-grid;
		place-items: center;
		inline-size: 4.5rem;
		block-size: 4.5rem;
		flex: none;
	}
	svg.glyph path {
		fill: var(--text);
	}
	svg.glyph path.marked {
		fill: var(--accent);
	}
	svg.glyph path.rest {
		fill: var(--readable-muted);
	}
	.text {
		font-size: 3.5rem;
		line-height: 1;
		font-weight: 400;
		font-synthesis: none;
	}
	@media (forced-colors: active) {
		svg.glyph path {
			fill: CanvasText;
		}
		svg.glyph path.marked {
			fill: Highlight;
		}
		svg.glyph path.rest {
			fill: GrayText;
		}
	}
</style>
