<script lang="ts">
	// The phone bottom bar (#188, design 2026-11-22-phone-bottom-bar): up to
	// five section items, icon with a short label; More (when the sections do
	// not fit) opens the shared bottom sheet with the rest and "Edit the bar".
	// The current item has its icon and label in the accent and a short accent
	// mark on top (design §5: no pills, no fills). Fixed to the bottom above the
	// safe-area inset, in `chrome` with a hairline on top. It steps aside while
	// the on-screen keyboard is open (lib/frame/keyboard.ts).
	//
	// Reading order (Ruling): the root layout renders the bar after the page,
	// so screen readers and Tab reach it after the content; it is a `nav`
	// landmark named like the desktop bar ("Main"), so landmark navigation
	// reaches it directly.
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import Icon from '$lib/ui/Icon.svelte';
	import Sheet from '$lib/ui/Sheet.svelte';
	import { barItems, MORE } from './barItems';
	import { watchKeyboard } from './keyboard';
	import type { FrameSection } from './sections';

	let {
		sections,
		bar,
		current
	}: {
		/** The visible sections, Home first, in frame order. */
		sections: readonly FrameSection[];
		/** The stored pins (nav-layout `bar`). */
		bar: readonly string[];
		current: string | null;
	} = $props();

	const layout = $derived(barItems(sections, bar, current));
	const uid = $props.id();
	let open = $state(false);
	let keyboard = $state(false);

	// A navigation (a row, Back) closes the sheet.
	let lastPath: string | undefined;
	$effect(() => {
		const path = page.url?.pathname;
		if (lastPath !== undefined && path !== lastPath) open = false;
		lastPath = path;
	});

	// The sheet has nothing to list once everything fits (a section switched off).
	$effect(() => {
		if (layout.more.length === 0) open = false;
	});

	$effect(() => watchKeyboard((isOpen) => (keyboard = isOpen)));
</script>

<nav class="bottom-bar" class:keyboard aria-label={t('nav.main')} data-bottom-bar>
	<ul style:--items={layout.items.length}>
		{#each layout.items as item (item === MORE ? '#more' : item.id)}
			<li>
				{#if item === MORE}
					<button
						type="button"
						class="item"
						aria-haspopup="dialog"
						aria-expanded={open}
						aria-controls={open ? `${uid}-more` : undefined}
						aria-current={layout.current === 'more' ? 'true' : undefined}
						onclick={() => (open = true)}
					>
						<Icon name="more" size="l" /><span class="label">{t('nav.more')}</span>
					</button>
				{:else}
					<a class="item" href={item.href} aria-current={layout.current === item.id ? 'page' : undefined}
						><Icon name={item.icon} size="l" /><span class="label">{item.label}</span></a
					>
				{/if}
			</li>
		{/each}
	</ul>
</nav>

<Sheet bind:open label={t('nav.more')}>
	<div class="more" id="{uid}-more">
		<ul>
			{#each layout.more as row (row.id)}
				<li>
					<a href={row.href} aria-current={current === row.id ? 'page' : undefined} onclick={() => (open = false)}
						><Icon name={row.icon} /><span>{row.label}</span></a
					>
				</li>
			{/each}
		</ul>
		<a class="edit" href="/settings?tab=layout#bottom-bar" onclick={() => (open = false)}
			><Icon name="edit" /><span>{t('nav.bar.edit')}</span></a
		>
	</div>
</Sheet>

<style>
	.bottom-bar {
		position: fixed;
		inset-inline: 0;
		inset-block-end: 0;
		/* Under menus, popups and sheets (--layer-float and up). */
		z-index: calc(var(--layer-float) - 1);
		box-sizing: border-box;
		padding-block-end: env(safe-area-inset-bottom, 0px);
		padding-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px);
		border-top: 1px solid var(--hair);
		background: var(--chrome);
		color: var(--readable-muted);
	}
	/* The on-screen keyboard is open: the bar stays out of the way. */
	.bottom-bar.keyboard {
		display: none;
	}
	ul {
		display: grid;
		grid-template-columns: repeat(var(--items), minmax(0, 1fr));
		max-width: 32rem;
		margin: 0 auto;
		padding: 0;
		list-style: none;
	}
	.item {
		position: relative;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.125rem;
		width: 100%;
		min-width: var(--hit);
		height: var(--bottom-bar-height);
		padding: 0 var(--space-1);
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.label {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--font-size-xs);
		line-height: var(--line-tight);
	}
	.item:hover {
		color: var(--text);
	}
	.item:focus-visible {
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-ring-offset) - 2px);
		border-radius: var(--radius);
	}
	/* The current place: accent icon and label, and a short accent mark
	   under the label (a shape cue as well as the colour; on the top edge it
	   read as an underline of the page text scrolling behind the bar). */
	.item[aria-current] {
		color: var(--accent);
	}
	.item[aria-current]::before {
		content: '';
		position: absolute;
		inset-block-end: 0.25rem;
		left: 50%;
		width: 1rem;
		height: 2px;
		border-radius: 1px;
		background: var(--accent);
		translate: -50% 0;
	}
	.more ul {
		display: grid;
		max-width: none;
		margin: 0;
	}
	.more a {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--hit);
		padding: 0 var(--space-2);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
	}
	.more a :global(svg) {
		color: var(--readable-muted);
	}
	.more a:hover {
		background: var(--raised);
	}
	.more a:focus-visible {
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-ring-offset));
	}
	.more a[aria-current='page'],
	.more a[aria-current='page'] :global(svg) {
		color: var(--accent);
	}
	.more a[aria-current='page']::before {
		content: '';
		position: absolute;
		inset-inline-start: 0;
		top: 25%;
		bottom: 25%;
		width: 2px;
		border-radius: 1px;
		background: var(--accent);
	}
	.more .edit {
		margin-top: var(--space-2);
		border-top: 1px solid var(--hair);
		border-radius: 0;
		color: var(--readable-muted);
	}
	@media (forced-colors: active) {
		.bottom-bar {
			border-top-color: CanvasText;
		}
		.item[aria-current],
		.more a[aria-current='page'],
		.more a[aria-current='page'] :global(svg) {
			color: Highlight;
		}
		.item[aria-current]::before,
		.more a[aria-current='page']::before {
			background: Highlight;
			forced-color-adjust: none;
		}
	}
</style>
