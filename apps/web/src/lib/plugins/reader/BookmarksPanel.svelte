<script lang="ts">
	import { tick } from 'svelte';
	import type { BookmarkList } from './bookmarkList.svelte';
	import { MAX_LABEL_RUNES, bookmarkName, sortForPanel, type Bookmark } from './bookmarks';
	import { chapterTitle, parsePosition } from './position';

	// The accessible path to the bookmarks (the margin markers are only
	// decoration): a disclosure listing every bookmark with its label,
	// chapter and date, to jump to, rename or delete. Additions and removals,
	// also those made with the toolbar button or the `b` key, are announced
	// in a polite live region.
	let {
		list,
		lang,
		titles,
		onjump
	}: {
		list: BookmarkList;
		/** The lang attribute of the book text (labels are snippets of it). */
		lang: string;
		/** Chapter titles known so far (chapters opened in this visit). */
		titles: Record<number, string>;
		onjump: (bookmark: Bookmark) => void;
	} = $props();

	let open = $state(false);
	let editingId = $state<number | null>(null);
	let draft = $state('');
	let confirmingId = $state<number | null>(null);

	const sorted = $derived(sortForPanel(list.items));
	const draftRunes = $derived(Array.from(draft.trim()).length);
	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

	// Another book: no rename or delete confirmation carries over.
	$effect(() => {
		void list.bookId;
		editingId = null;
		confirmingId = null;
	});

	function chapterOf(b: Bookmark): string {
		const p = parsePosition(b.position);
		if (!p) return 'Unknown place';
		const number = `Chapter ${p.chapter + 1}`;
		const title = titles[p.chapter]?.trim();
		return title && title !== chapterTitle('', p.chapter) ? `${number} · ${title}` : number;
	}

	// "bookmark 猫", or "untitled bookmark in chapter 3" for an empty label.
	function actionName(b: Bookmark): string {
		return b.label ? `bookmark ${b.label}` : bookmarkName(b).replace(/^U/, 'u');
	}

	function dateOf(b: Bookmark): string {
		const d = new Date(b.createdAt);
		return Number.isNaN(d.getTime()) ? '' : dateFormat.format(d);
	}

	async function startRename(b: Bookmark): Promise<void> {
		confirmingId = null;
		editingId = b.id;
		draft = b.label;
		await tick();
		document.getElementById(`bookmark-rename-${b.id}`)?.focus();
	}

	// Focus returns to the item: the action that was left, or (after a
	// save, while Rename/Delete are disabled until it lands) its label.
	async function focusAction(id: number, action: 'jump' | 'rename' | 'delete'): Promise<void> {
		await tick();
		const prefix = { jump: 'bookmark-jump', rename: 'bookmark-renamebtn', delete: 'bookmark-delete' }[action];
		document.getElementById(`${prefix}-${id}`)?.focus();
	}

	function saveRename(event: SubmitEvent, b: Bookmark): void {
		event.preventDefault();
		if (draftRunes > MAX_LABEL_RUNES) return;
		editingId = null;
		void list.rename(b.id, draft);
		void focusAction(b.id, 'jump');
	}

	function cancelRename(id: number): void {
		editingId = null;
		void focusAction(id, 'rename');
	}

	function renameKey(event: KeyboardEvent, id: number): void {
		if (event.key !== 'Escape' || event.isComposing) return;
		event.preventDefault();
		cancelRename(id);
	}

	async function askDelete(b: Bookmark): Promise<void> {
		editingId = null;
		confirmingId = b.id;
		await tick();
		document.getElementById(`bookmark-cancel-${b.id}`)?.focus();
	}

	function cancelDelete(id: number): void {
		confirmingId = null;
		void focusAction(id, 'delete');
	}

	// After a delete, focus goes to the next bookmark (else the previous
	// one, else the panel's toggle), never to the page top.
	async function confirmDelete(b: Bookmark): Promise<void> {
		const index = sorted.findIndex((x) => x.id === b.id);
		const neighbour = sorted[index + 1] ?? sorted[index - 1];
		confirmingId = null;
		void list.remove(b.id);
		await tick();
		const next = neighbour && document.getElementById(`bookmark-jump-${neighbour.id}`);
		(next || document.getElementById('bookmarks-toggle'))?.focus();
	}

	function confirmKey(event: KeyboardEvent, id: number): void {
		if (event.key !== 'Escape' || event.isComposing) return;
		event.preventDefault();
		cancelDelete(id);
	}
</script>

<section class="bookmarks" aria-label="Bookmarks">
	<button
		id="bookmarks-toggle"
		type="button"
		class="disclosure"
		aria-expanded={open}
		aria-controls="bookmarks-body"
		onclick={() => (open = !open)}
	>
		<span aria-hidden="true">{open ? '▾' : '▸'}</span>
		Bookmarks{list.ready ? ` (${list.items.length})` : ''}
	</button>

	<p class="visually-hidden" role="status" aria-live="polite">{list.announcement}</p>
	{#if list.error}<p class="error" role="alert">{list.error}</p>{/if}

	{#if open}
		<div id="bookmarks-body" class="body">
			{#if list.loading}
				<p>Loading bookmarks…</p>
			{:else if list.loadError}
				<p class="error">{list.loadError}</p>
				<button type="button" onclick={() => list.bookId !== null && list.load(list.bookId)}>
					Retry
				</button>
			{:else if sorted.length === 0}
				<p class="empty">
					No bookmarks yet. The bookmark button (or the <kbd>B</kbd> key) marks the paragraph at the top
					of the screen.
				</p>
			{:else}
				<ul>
					{#each sorted as b (b.id)}
						<li>
							{#if editingId === b.id}
								<form class="rename" onsubmit={(e) => saveRename(e, b)}>
									<label class="visually-hidden" for="bookmark-rename-{b.id}">Bookmark name</label>
									<input
										id="bookmark-rename-{b.id}"
										{lang}
										bind:value={draft}
										onkeydown={(e) => renameKey(e, b.id)}
										aria-invalid={draftRunes > MAX_LABEL_RUNES}
										aria-describedby="bookmark-count-{b.id}"
									/>
									<span id="bookmark-count-{b.id}" class="count" class:over={draftRunes > MAX_LABEL_RUNES}>
										{draftRunes}/{MAX_LABEL_RUNES}
									</span>
									<button type="submit" disabled={draftRunes > MAX_LABEL_RUNES}>Save</button>
									<button type="button" onclick={() => cancelRename(b.id)}>Cancel</button>
								</form>
							{:else}
								<button
									id="bookmark-jump-{b.id}"
									type="button"
									class="jump"
									onclick={() => onjump(b)}
									disabled={b.id < 0}
									aria-describedby="bookmark-meta-{b.id}"
								>
									<span class="label" lang={b.label ? lang : undefined}>{b.label || 'Untitled bookmark'}</span>
								</button>
								<span class="meta" id="bookmark-meta-{b.id}">
									{chapterOf(b)}{#if dateOf(b)}<span aria-hidden="true">{' · '}</span><span
											class="visually-hidden">{', added '}</span
										>{dateOf(b)}{/if}
								</span>
								{#if confirmingId === b.id}
									<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
									<span
										class="actions"
										role="group"
										aria-label="Confirm delete of {actionName(b)}"
										onkeydown={(e) => confirmKey(e, b.id)}
									>
										Delete this bookmark?
										<button type="button" onclick={() => confirmDelete(b)}>Yes, delete</button>
										<button id="bookmark-cancel-{b.id}" type="button" onclick={() => cancelDelete(b.id)}
											>Cancel</button
										>
									</span>
								{:else}
									<span class="actions">
										<button
											id="bookmark-renamebtn-{b.id}"
											type="button"
											onclick={() => startRename(b)}
											disabled={list.busy(b.id)}
											aria-label="Rename {actionName(b)}"
										>
											Rename
										</button>
										<button
											id="bookmark-delete-{b.id}"
											type="button"
											onclick={() => askDelete(b)}
											disabled={list.busy(b.id)}
											aria-label="Delete {actionName(b)}">Delete</button
										>
									</span>
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</section>

<style>
	.bookmarks {
		margin: 0.75rem 0;
	}

	.disclosure {
		font: inherit;
	}

	.body {
		margin-top: 0.5rem;
	}

	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
		padding: 0.5rem 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
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

	/* Two lines at most in the list; the full label stays the button's name. */
	.jump .label {
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

	.meta {
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.actions {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-inline-start: auto;
	}

	.rename {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		width: 100%;
	}

	.rename input {
		flex: 1 1 12rem;
		min-width: 0;
		font: inherit;
	}

	.count {
		font-size: 0.8rem;
		opacity: 0.7;
	}

	.count.over {
		color: #b3261e;
		opacity: 1;
	}

	.empty {
		opacity: 0.8;
	}

	.error {
		color: #b3261e;
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
