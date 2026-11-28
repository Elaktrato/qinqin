<script lang="ts">
	// The picture of an entry (#212, images packs #216), drawn from the theme (black outlines take the text
	// colour) with its credit. Nothing is drawn when the Pictures aid is off, no installed images pack maps the
	// entry, or the request fails; the layout does not wait for it. The svg passed safeSvg in entryPicture; it
	// is drawn from DOM nodes built by svgElement (checked against an allowlist again, never {@html}).
	// "Report picture" (#274) asks why, sends the report (reportPicture) and asks again: the server then answers the
	// next picture of the entry, or none.
	import { errorText } from '$lib/api/apiErrors';
	import { pictureCreditLine, themeSvg, type EntryPicture } from '$lib/api/images';
	import { svgElement } from '$lib/api/svg';
	import Button from '$lib/ui/Button.svelte';
	import { t, type MessageKey } from '$lib/i18n';
	import { glossLang } from '$lib/i18n/lang';
	import { PICTURE_REPORT_REASONS, pictureFor, reportPicture, type PictureReportReason } from './pictures';
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
	/** The report flow: closed, asking why, sending. */
	let reporting = $state<'closed' | 'asking' | 'sending'>('closed');
	let reportNote = $state('');
	let reportError = $state('');
	/** Bumped after a report: the effect asks for the entry's picture again. */
	let asked = $state(0);

	const REASON_KEYS: Record<PictureReportReason, MessageKey> = {
		wrong: 'entry.picture.reason.wrong',
		unclear: 'entry.picture.reason.unclear',
		offensive: 'entry.picture.reason.offensive',
		other: 'entry.picture.reason.other'
	};

	async function report(reason: PictureReportReason) {
		const cache = view.pictures;
		const shown = picture;
		if (cache === null || shown === null) return;
		reporting = 'sending';
		reportError = '';
		try {
			await reportPicture(cache, entryId, shown, reason);
			reporting = 'closed';
			reportNote = t('entry.picture.reported');
			asked += 1;
		} catch (err) {
			reporting = 'asking';
			reportError = errorText(err, t('entry.picture.reportFailed'));
		}
	}

	$effect(() => {
		const id = entryId;
		void asked;
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
	<div class="picture" style:--picture-size={`${size}rem`}>
		<figure data-testid="entry-picture">
			<div class="art" role="img" aria-label={picture.label} lang={glossLang(undefined)} use:draw={themeSvg(picture.svg)}></div>
			<figcaption>{pictureCreditLine(picture)}</figcaption>
		</figure>
		{#if reporting === 'closed'}
			<Button variant="plain" onclick={() => (reporting = 'asking')}>{t('entry.picture.report')}</Button>
		{:else}
			<div class="ask" role="group" aria-label={t('entry.picture.reportQuestion')}>
				<p>{t('entry.picture.reportQuestion')}</p>
				{#each PICTURE_REPORT_REASONS as reason (reason)}
					<Button disabled={reporting === 'sending'} onclick={() => report(reason)}>{t(REASON_KEYS[reason])}</Button>
				{/each}
				<Button variant="plain" disabled={reporting === 'sending'} onclick={() => ((reporting = 'closed'), (reportError = ''))}>{t('common.action.cancel')}</Button>
				{#if reportError}<p class="error" role="alert">{reportError}</p>{/if}
			</div>
		{/if}
	</div>
{/if}
{#if reportNote}<p class="note" role="status">{reportNote}</p>{/if}

<style>
	.picture,
	figure {
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
	.ask {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1);
		max-width: 20rem;
	}
	.ask p {
		flex-basis: 100%;
		margin: 0;
		text-align: center;
		font-size: var(--font-size-label);
	}
	.ask .error {
		color: var(--readable-bad);
	}
	.note {
		margin: 0;
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
