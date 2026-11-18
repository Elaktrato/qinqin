<script lang="ts">
	import { t } from '$lib/i18n';

	// The reader rail's Contents panel (design §9 "Reader"): the book's
	// chapters as links, the open one marked aria-current="page" with an
	// accent bar at its start (a shape, not colour alone). A book only knows
	// its chapter count; titles are those seen so far in this visit, the
	// others are named by their number.
	//
	// API: <ContentsPanel titles current hrefOf lang onjump? />
	//   titles   one entry per chapter: its title, or ''/undefined when unknown
	//   current  the open chapter's index
	//   hrefOf   the link of chapter n
	//   lang     the book text's lang (titles only; interface text has none)
	//   onjump   called when a link is activated (the phone sheet closes)
	let {
		titles,
		current,
		hrefOf,
		lang,
		onjump
	}: {
		titles: (string | undefined)[];
		current: number;
		hrefOf: (n: number) => string;
		lang: string;
		onjump?: () => void;
	} = $props();

	const id = $props.id();
</script>

<nav class="contents" aria-label={t('reader.rail.contents')}>
	<h2 class="heading">{t('reader.rail.contents')}</h2>
	<ol>
		{#each titles as title, n (n)}
			{@const named = (title ?? '').trim()}
			{@const titleId = `${id}-title-${n}`}
			<li>
				<a
					href={hrefOf(n)}
					aria-current={n === current ? 'page' : undefined}
					aria-labelledby={n === current ? `${titleId} ${id}-now` : undefined}
					onclick={() => onjump?.()}
				>
					{#if named}<span id={titleId} {lang}>{named}</span>{:else}<span id={titleId}>{t('reader.chapter', { n: n + 1 })}</span>{/if}
					<!-- The "reading now" suffix is interface text: outside the title's lang. -->
					{#if n === current}<span id="{id}-now" class="visually-hidden">{t('reader.contents.currentSuffix')}</span>{/if}
				</a>
			</li>
		{/each}
	</ol>
</nav>

<style>
	.heading {
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1px;
	}
	a {
		position: relative;
		display: block;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	a:hover {
		background: var(--raised);
	}
	a[aria-current='page'] {
		background: var(--selected-wash);
	}
	/* The current chapter's accent bar: a shape beside the wash. */
	a[aria-current='page']::before {
		content: '';
		position: absolute;
		inset-block: var(--space-1);
		inset-inline-start: 0;
		width: 3px;
		border-radius: 2px;
		background: var(--accent);
	}
	@media (forced-colors: active) {
		a[aria-current='page']::before {
			background: Highlight;
		}
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
