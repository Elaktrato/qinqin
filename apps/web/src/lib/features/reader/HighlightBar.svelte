<script lang="ts">
	import { t } from '$lib/i18n';
	import { HIGHLIGHT_COLORS } from './highlights';
	import { HIGHLIGHT_IN, type HighlightActions } from './highlightUi';

	// The selection popup's action bar: highlight the selection in one of
	// four colours, or highlight it in the last colour and open the editor
	// on its note. The `h` key does what the marked (last used) swatch does.
	// While the highlights are loading (or failed to) the buttons still
	// answer, with the same message the `h` key gets, shown under them.
	// `live`: inside the phone sheet the page's own live regions are inert,
	// so the notice is the status region that announces the result.
	let { actions, live = false }: { actions: HighlightActions; live?: boolean } = $props();
</script>

<div
	class="hl-bar"
	class:not-ready={!actions.ready}
	role="group"
	aria-label={t('reader.highlights.bar')}
	aria-describedby={actions.notice ? 'hl-bar-notice' : undefined}
>
	{#each HIGHLIGHT_COLORS as color (color)}
		<button
			type="button"
			class="swatch {color}"
			class:last={color === actions.color}
			aria-label={color === actions.color
				? t('reader.highlights.lastUsed', { label: t(HIGHLIGHT_IN[color]) })
				: t(HIGHLIGHT_IN[color])}
			title={color === actions.color ? t('reader.highlights.lastUsedShort', { label: t(HIGHLIGHT_IN[color]) }) : t(HIGHLIGHT_IN[color])}
			onclick={() => actions.pick(color)}
		></button>
	{/each}
	<button
		type="button"
		class="note-btn"
		aria-label={t('reader.highlights.withNote')}
		onclick={() => actions.note()}
	>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path
				d="M2.5 13.5h2.6l7.3-7.3-2.6-2.6-7.3 7.3zM9.1 4.3l2.6 2.6"
				fill="none"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linejoin="round"
			/>
		</svg>
		{t('reader.highlights.note')}
	</button>
</div>
<p
	class="hl-notice"
	id="hl-bar-notice"
	role={live ? 'status' : undefined}
	aria-live={live ? 'polite' : undefined}>{actions.notice}</p>

<style>
	.hl-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin: 0.15rem 0 0.35rem;
	}

	.swatch {
		box-sizing: border-box;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--line);
		cursor: pointer;
	}

	/* The colour a new highlight gets (and the `h` key uses). */
	.swatch.last {
		outline: 2px solid currentColor;
		outline-offset: 1px;
	}

	.swatch.yellow {
		background: var(--highlight-yellow);
	}

	.swatch.green {
		background: var(--highlight-green);
	}

	.swatch.blue {
		background: var(--highlight-blue);
	}

	.swatch.pink {
		background: var(--highlight-pink);
	}

	.note-btn {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 0.3rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.not-ready {
		color: var(--readable-muted);
	}

	.hl-notice {
		margin: 0 0 0.35rem;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}

	.hl-notice:empty {
		margin: 0;
	}
</style>
