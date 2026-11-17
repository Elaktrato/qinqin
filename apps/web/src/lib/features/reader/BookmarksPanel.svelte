<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
	import { formatDate } from '$lib/i18n/format';
	import { tick } from 'svelte';
	import type { BookmarkList } from './bookmarkList.svelte';
	import { MAX_LABEL_RUNES, sortForPanel, type Bookmark } from './bookmarks';
	import { chapterTitle, parsePosition } from './position';

	// The side rail's Bookmarks tab, and the accessible path to the
	// bookmarks (the margin markers are only decoration): the add/remove
	// button for the place at the top of the screen, then every bookmark
	// with its label, chapter and date, to jump to, rename or delete.
	// Announcements and alerts live in BookView, outside the rail, so they
	// are heard also while the rail is collapsed or the drawer is closed.
	let {
		list,
		lang,
		titles,
		onjump,
		here,
		canToggle,
		failed,
		ontoggle
	}: {
		list: BookmarkList;
		/** The lang attribute of the book text (labels are snippets of it). */
		lang: string;
		/** Chapter titles known so far (chapters opened in this visit). */
		titles: Record<number, string>;
		onjump: (bookmark: Bookmark) => void;
		/** The bookmark at the top of the screen, if there is one. */
		here: Bookmark | null;
		/** The add/remove button can act now (a place is known, the list is ready, nothing saving). */
		canToggle: boolean;
		/** The list failed to load: the button (and `b`) retries. */
		failed: boolean;
		ontoggle: () => void;
	} = $props();

	let editingId = $state<number | null>(null);
	let draft = $state('');
	let confirmingId = $state<number | null>(null);

	const sorted = $derived(sortForPanel(list.items));
	const draftRunes = $derived(Array.from(draft.trim()).length);
	
	// Another book: no rename or delete confirmation carries over.
	$effect(() => {
		void list.bookId;
		editingId = null;
		confirmingId = null;
	});

	function chapterOf(b: Bookmark): string {
		const p = parsePosition(b.position);
		if (!p) return t('reader.bookmarks.unknownPlace');
		const number = t('reader.chapter', { n: p.chapter + 1 });
		const title = titles[p.chapter]?.trim();
		return title && title !== chapterTitle('', p.chapter) ? t('reader.chapterTitled', { number, title }) : number;
	}

	// "bookmark 猫", or "untitled bookmark in chapter 3" for an empty label.
	function actionName(b: Bookmark): string {
		if (b.label) return t('reader.bookmarks.actionName', { label: b.label });
		const p = parsePosition(b.position);
		return p ? t('reader.bookmarks.actionUntitledChapter', { n: p.chapter + 1 }) : t('reader.bookmarks.actionUntitled');
	}

	function dateOf(b: Bookmark): string {
		const d = new Date(b.createdAt);
		return Number.isNaN(d.getTime()) ? '' : formatDate(d);
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
	// one, else the add button), never to the page top.
	async function confirmDelete(b: Bookmark): Promise<void> {
		const index = sorted.findIndex((x) => x.id === b.id);
		const neighbour = sorted[index + 1] ?? sorted[index - 1];
		confirmingId = null;
		void list.remove(b.id);
		await tick();
		const next = neighbour && document.getElementById(`bookmark-jump-${neighbour.id}`);
		(next || document.getElementById('bookmark-here'))?.focus({ preventScroll: true });
	}

	function confirmKey(event: KeyboardEvent, id: number): void {
		if (event.key !== 'Escape' || event.isComposing) return;
		event.preventDefault();
		cancelDelete(id);
	}
</script>

<section class="bookmarks" aria-labelledby="bookmarks-heading">
	<h2 id="bookmarks-heading">
		{list.ready ? t('reader.bookmarks.titleCount', { count: list.items.length }) : t('reader.bookmarks.title')}
	</h2>

	<button
		id="bookmark-here"
		type="button"
		class="here"
		class:remove={here !== null}
		aria-disabled={!canToggle && !failed}
		aria-busy={list.saving || list.loading}
		aria-keyshortcuts="B"
		aria-describedby={failed ? 'bookmarks-load-error' : 'bookmark-here-hint'}
		onclick={ontoggle}
	>
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
			<path
				d="M4 1.75h8a.75.75 0 0 1 .75.75v12l-4.75-3.2-4.75 3.2v-12A.75.75 0 0 1 4 1.75z"
				fill={here ? 'currentColor' : 'none'}
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
			/>
		</svg>
		{failed ? t('reader.bookmarks.loadAgain') : here ? t('reader.bookmarks.remove') : t('reader.bookmarks.addHere')}
	</button>
	<p id="bookmark-here-hint" class="hint">
		{#if here}<Msg key="reader.bookmarks.hereHint">{#snippet kbd(text: string)}<kbd>{text}</kbd>{/snippet}</Msg
			>{:else}<Msg key="reader.bookmarks.addHint">{#snippet kbd(text: string)}<kbd>{text}</kbd>{/snippet}</Msg>{/if}
	</p>

	{#if failed}
		<p class="error" id="bookmarks-load-error">
			{list.loadError}
			<button type="button" onclick={ontoggle}>{t('reader.highlights.retry')}</button>
		</p>
	{/if}
	{#if list.error}<p class="error">{list.error}</p>{/if}

	<div class="body">
		{#if list.loading}
			<p>{t('reader.bookmarks.loading')}</p>
		{:else if list.loadError}
			<!-- The error and its Retry are shown next to the button above. -->
		{:else if sorted.length === 0}
			<p class="empty">{t('reader.bookmarks.empty')}</p>
		{:else}
			<ul>
				{#each sorted as b (b.id)}
					<li>
						{#if editingId === b.id}
							<form class="rename" onsubmit={(e) => saveRename(e, b)}>
								<label class="visually-hidden" for="bookmark-rename-{b.id}">{t('reader.bookmarks.name')}</label>
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
								<button type="submit" disabled={draftRunes > MAX_LABEL_RUNES}>{t('reader.bookmarks.save')}</button>
								<button type="button" onclick={() => cancelRename(b.id)}>{t('common.action.cancel')}</button>
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
								<span class="label" lang={b.label ? lang : undefined}>{b.label || t('reader.bookmarks.untitled')}</span>
							</button>
							<span class="meta" id="bookmark-meta-{b.id}">
								{chapterOf(b)}{#if dateOf(b)}<span aria-hidden="true">{' · '}</span><span
										class="visually-hidden">{`${t('reader.bookmarks.addedOn')} `}</span
									>{dateOf(b)}{/if}
							</span>
							{#if confirmingId === b.id}
								<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
								<span
									class="actions"
									role="group"
									aria-label={t('reader.highlights.confirmDelete', { name: actionName(b) })}
									onkeydown={(e) => confirmKey(e, b.id)}
								>
									{t('reader.bookmarks.deleteQuestion')}
									<button type="button" onclick={() => confirmDelete(b)}>{t('reader.editor.yesDelete')}</button>
									<button id="bookmark-cancel-{b.id}" type="button" onclick={() => cancelDelete(b.id)}
										>{t('common.action.cancel')}</button
									>
								</span>
							{:else}
								<span class="actions">
									<button
										id="bookmark-renamebtn-{b.id}"
										type="button"
										onclick={() => startRename(b)}
										disabled={list.busy(b.id)}
										aria-label={t('reader.bookmarks.renameNamed', { name: actionName(b) })}
									>
										{t('reader.bookmarks.rename')}
									</button>
									<button
										id="bookmark-delete-{b.id}"
										type="button"
										onclick={() => askDelete(b)}
										disabled={list.busy(b.id)}
										aria-label={t('reader.highlights.deleteNamed', { name: actionName(b) })}>{t('reader.editor.delete')}</button
									>
								</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

<style>
	h2 {
		font-size: 1rem;
		margin: 0.25rem 0 0.6rem;
	}

	.here {
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		font: inherit;
	}

	.here.remove svg {
		color: #0b6bcb;
	}

	.here[aria-disabled='true'] {
		opacity: 0.6;
		cursor: default;
	}

	.hint {
		margin: 0.35rem 0 0;
		font-size: 0.8rem;
		opacity: 0.75;
	}

	.error {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.body {
		margin-top: 0.75rem;
	}

	@media (prefers-color-scheme: dark) {
		.here.remove svg {
			color: #6cb4ff;
		}
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
