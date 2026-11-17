<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { tick } from 'svelte';
	import { snippetAt } from './bookmarks';
	import type { HighlightList } from './highlightList.svelte';
	import type { Highlight } from './highlights';
	import { COLOR_NAMES, panelGroups } from './highlightUi';
	import { chapterTitle } from './position';

	// The side rail's Highlights tab, and the accessible path to the
	// highlights (the marks in the text are not tab stops): every highlight
	// by chapter in reading order with its colour, text and note, to jump
	// to, edit or delete. Notes are shown as plain text. Announcements and
	// alerts live in BookView, outside the rail.
	let {
		list,
		lang,
		titles,
		changed,
		onjump,
		onedit,
		onretry
	}: {
		list: HighlightList;
		/** The lang attribute of the book text. */
		lang: string;
		/** Chapter titles known so far (chapters opened in this visit). */
		titles: Record<number, string>;
		/** Highlights of the open chapter whose text no longer matches (not drawn). */
		changed: ReadonlySet<number>;
		onjump: (h: Highlight) => void;
		onedit: (h: Highlight, opener: HTMLElement) => void;
		onretry: () => void;
	} = $props();

	let confirmingId = $state<number | null>(null);

	const groups = $derived(panelGroups(list.items));
	const flat = $derived(groups.flatMap((g) => g.items));

	$effect(() => {
		void list.bookId;
		confirmingId = null;
	});

	function chapterLabel(n: number): string {
		const number = t('reader.chapter', { n: n + 1 });
		const title = titles[n]?.trim();
		return title && title !== chapterTitle('', n) ? t('reader.chapterTitled', { number, title }) : number;
	}

	const name = (h: Highlight) => t('reader.highlights.name', { text: snippetAt(h.text, 30) });

	async function askDelete(h: Highlight): Promise<void> {
		confirmingId = h.id;
		await tick();
		document.getElementById(`hl-cancel-${h.id}`)?.focus();
	}

	async function cancelDelete(id: number): Promise<void> {
		confirmingId = null;
		await tick();
		document.getElementById(`hl-delete-${id}`)?.focus();
	}

	// After a delete, focus goes to the next highlight (else the previous
	// one, else the heading), never to the page top.
	async function confirmDelete(h: Highlight): Promise<void> {
		const index = flat.findIndex((x) => x.id === h.id);
		const neighbour = flat[index + 1] ?? flat[index - 1];
		confirmingId = null;
		void list.remove(h.id);
		await tick();
		const next = neighbour && document.getElementById(`hl-jump-${neighbour.id}`);
		(next || document.getElementById('highlights-heading'))?.focus({ preventScroll: true });
	}

	function confirmKey(event: KeyboardEvent, id: number): void {
		if (event.key !== 'Escape' || event.isComposing) return;
		event.preventDefault();
		void cancelDelete(id);
	}
</script>

<section class="highlights" aria-labelledby="highlights-heading">
	<h2 id="highlights-heading" tabindex="-1">
		{list.ready ? t('reader.highlights.titleCount', { count: list.items.length }) : t('reader.highlights.title')}
	</h2>
	<p class="hint">
		<Msg key="reader.highlights.hint">{#snippet kbd(text: string)}<kbd>{text}</kbd>{/snippet}</Msg>
	</p>

	{#if list.loadError && !list.loading}
		<p class="error" id="highlights-load-error">
			{list.loadError}
			<button type="button" onclick={onretry}>{t('reader.highlights.retry')}</button>
		</p>
	{/if}
	{#if list.error}<p class="error">{list.error}</p>{/if}

	{#if list.loading}
		<p>{t('reader.highlights.loading')}</p>
	{:else if list.loadError}
		<!-- The error and its Retry are shown above. -->
	{:else if groups.length === 0}
		<p class="empty">{t('reader.highlights.empty')}</p>
	{:else}
		{#each groups as group (group.chapter)}
			<h3>{chapterLabel(group.chapter)}</h3>
			<ul>
				{#each group.items as h (h.id)}
					<li class={h.color}>
						<button
							id="hl-jump-{h.id}"
							type="button"
							class="jump"
							onclick={() => onjump(h)}
							disabled={h.id < 0}
							aria-describedby={h.note ? `hl-meta-${h.id} hl-note-${h.id}` : `hl-meta-${h.id}`}
						>
							<span class="visually-hidden">{`${t('reader.highlights.goTo')} `}</span><span class="text" {lang}>{h.text}</span>
						</button>
						<span class="meta" id="hl-meta-{h.id}">
							<span class="visually-hidden">{t('reader.highlights.colorHighlight', { color: COLOR_NAMES[h.color] })}</span>
							{#if changed.has(h.id)}<span class="badge">{t('reader.highlights.textChanged')}</span>{/if}
							{#if h.note}<span class="visually-hidden">{`${t('reader.highlights.noteFollows')} `}</span>{/if}
						</span>
						{#if h.note}<p class="note" id="hl-note-{h.id}" {lang}>{h.note}</p>{/if}
						{#if confirmingId === h.id}
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<span
								class="actions"
								role="group"
								aria-label={t('reader.highlights.confirmDelete', { name: name(h) })}
								onkeydown={(e) => confirmKey(e, h.id)}
							>
								{t('reader.editor.deleteQuestion')}
								<button type="button" onclick={() => confirmDelete(h)}>{t('reader.editor.yesDelete')}</button>
								<button id="hl-cancel-{h.id}" type="button" onclick={() => cancelDelete(h.id)}>{t('common.action.cancel')}</button>
							</span>
						{:else}
							<span class="actions">
								<button
									id="hl-edit-{h.id}"
									type="button"
									onclick={(e) => onedit(h, e.currentTarget)}
									aria-label={t('reader.highlights.editNamed', { name: name(h) })}>{t('reader.highlights.edit')}</button
								>
								<button
									id="hl-delete-{h.id}"
									type="button"
									onclick={() => askDelete(h)}
									disabled={list.busy(h.id)}
									aria-label={t('reader.highlights.deleteNamed', { name: name(h) })}>{t('reader.editor.delete')}</button
								>
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/each}
	{/if}
</section>

<style>
	h2 {
		font-size: 1rem;
		margin: 0.25rem 0 0.4rem;
	}

	h2:focus {
		outline: none;
	}

	h3 {
		font-size: 0.85rem;
		margin: 0.9rem 0 0.2rem;
		opacity: 0.8;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		opacity: 0.75;
	}

	.error {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		color: #b3261e;
	}

	.empty {
		opacity: 0.8;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	/* The colour bar at the start of each item. */
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
		padding: 0.45rem 0 0.45rem 0.6rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
		border-inline-start: 0.3rem solid transparent;
	}

	li.yellow {
		border-inline-start-color: #e6c21a;
	}

	li.green {
		border-inline-start-color: #4caa50;
	}

	li.blue {
		border-inline-start-color: #3f86e0;
	}

	li.pink {
		border-inline-start-color: #e0619e;
	}

	.jump {
		flex: 1 1 100%;
		min-width: 0;
		text-align: start;
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.jump .text {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
		overflow-wrap: anywhere;
	}

	.jump:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.meta:empty {
		display: none;
	}

	.badge {
		font-size: 0.75rem;
		padding: 0 0.35rem;
		border-radius: 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
	}

	/* Notes keep their line breaks; long ones are cut to a few lines here
	   (the editor shows all of it). */
	.note {
		flex: 1 1 100%;
		margin: 0;
		font-size: 0.85rem;
		opacity: 0.85;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
	}

	.actions {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-inline-start: auto;
	}

	@media (prefers-color-scheme: dark) {
		.error {
			color: #ff8a80;
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
