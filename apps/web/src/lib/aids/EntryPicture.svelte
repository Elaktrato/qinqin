<script lang="ts">
	// The picture of an entry (#212, images packs #216), drawn from the theme (black outlines take the text
	// colour) with its credit. Nothing is drawn when the Pictures aid is off, no installed images pack maps the
	// entry, or the request fails; the layout does not wait for it. The svg passed safeSvg in entryPicture; it
	// is drawn from DOM nodes built by svgElement (checked against an allowlist again, never {@html}).
	import { pictureCreditLine, themeSvg, type EntryPicture } from '$lib/api/images';
	import { svgElement } from '$lib/api/svg';
	import { glossLang } from '$lib/i18n/lang';
	import { pictureFor } from './pictures';
	import { useVisualAids } from './useAids';

	let { entryId, size = 7 }: { entryId: number; /** Edge of the picture in rem. */ size?: number } = $props();
	const view = useVisualAids();

	/** Svelte action: draws the picture as created nodes (nothing is parsed as HTML); nothing when it is refused. */
	function draw(node: HTMLElement, svg: string) {
		const apply = (value: string) => {
			const el = svgElement(value);
			node.replaceChildren(...(el ? [el] : []));
		};
		apply(svg);
		return { update: apply };
	}
	let picture = $state<EntryPicture | null>(null);

	$effect(() => {
		const id = entryId;
		const cache = view.pictures;
		if (!view.aids.pictures || cache === null) {
			picture = null;
			return;
		}
		picture = cache.peek(id) ?? null;
		let live = true;
		void pictureFor(cache, id).then((p) => {
			if (live) picture = p;
		});
		return () => {
			live = false;
		};
	});
</script>

{#if picture}
	<figure class="picture" data-testid="entry-picture" style:--picture-size={`${size}rem`}>
		<div class="art" role="img" aria-label={picture.label} lang={glossLang(undefined)} use:draw={themeSvg(picture.svg)}></div>
		<figcaption>{pictureCreditLine(picture)}</figcaption>
	</figure>
{/if}

<style>
	.picture {
		display: grid;
		justify-items: center;
		gap: var(--space-1);
		margin: 0;
	}
	.art {
		width: var(--picture-size);
		height: var(--picture-size);
		color: var(--text);
	}
	.art :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
	figcaption {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
		text-align: center;
	}
	@media (forced-colors: active) {
		.art {
			color: CanvasText;
		}
	}
</style>
