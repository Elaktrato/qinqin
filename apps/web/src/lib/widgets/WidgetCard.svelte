<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '$lib/i18n';
	import type { WidgetStatus } from './types';

	// The shared frame of every widget: an unboxed group (design §5: a box
	// needs a reason; space groups the widgets), a small sentence-case
	// heading, optional header actions and the states a widget passes through. A widget owns its data and tells the card which
	// state it is in; only `ready` renders the widget's own content.

	interface Props {
		title: string;
		/** id of the heading; the card is labelled by it. */
		headingId: string;
		status: WidgetStatus;
		/** Shown with no workspace selected. */
		noWorkspaceText?: string;
		loadingText?: string;
		/** The failure, shown with a Try again button when onretry is set. */
		error?: string;
		onretry?: () => void;
		emptyText?: string;
		/** Links or buttons on the right of the title. */
		actions?: Snippet;
		children?: Snippet;
	}

	let {
		title,
		headingId,
		status,
		noWorkspaceText = t('widgets.card.noWorkspace'),
		loadingText = t('common.loading'),
		error = '',
		onretry,
		emptyText = t('widgets.card.empty'),
		actions,
		children
	}: Props = $props();
</script>

<section class="widget-card" aria-labelledby={headingId}>
	<header class="head">
		<h2 id={headingId}>{title}</h2>
		{@render actions?.()}
	</header>

	{#if status === 'no-workspace'}
		<p class="hint">{noWorkspaceText}</p>
	{:else if status === 'loading'}
		<p class="hint" aria-live="polite">{loadingText}</p>
	{:else if status === 'error'}
		<p class="hint muted" role="status">
			{error}
			{#if onretry}
				<button type="button" class="retry" onclick={onretry}>{t('common.action.retry')}</button>
			{/if}
		</p>
	{:else if status === 'empty'}
		<p class="hint">{emptyText}</p>
	{:else}
		{@render children?.()}
	{/if}
</section>

<style>
	.widget-card {
		box-sizing: border-box;
		height: 100%;
		min-width: 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}

	h2 {
		margin: 0;
		font-size: var(--font-size-s);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}

	.hint {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.muted {
		color: var(--readable-muted);
	}

	.retry {
		font: inherit;
		font-size: 0.8rem;
		margin-left: 0.35rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 999px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
</style>
