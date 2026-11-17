<script lang="ts">
	import { deleteBook, listAllBooks, listBooks, uploadBook } from '$lib/api/library';
	import type { Book } from '$lib/api/types';
	import WorkspaceLabel from '$lib/components/WorkspaceLabel.svelte';
	import { languageLabel } from '$lib/languages';
	import { select, workspaces } from '$lib/workspaces';
	import { apiErrorMessage } from './errors';
	import { workspacesWithBooks } from './libraryElsewhere';
	import { initialUploadLanguage } from './uploadLanguage';
	import { savedChapter } from './position';
	import { SOURCES_HREF, bookHref } from './route';

	const MAX_BYTES = 20 * 1024 * 1024;

	// The library of the selected workspace: switching the workspace in
	// the header shows that workspace's books, and uploads go there.
	const workspace = $derived($workspaces.current);
	const workspaceId = $derived(workspace?.id ?? null);
	// The language books of this workspace must have; '' when the reader
	// does not support the workspace's language (no uploads then).
	const bookLanguage = $derived(initialUploadLanguage(workspace?.language ?? null));

	let books = $state<Book[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let actionError = $state('');
	let status = $state('');
	let uploading = $state(false);
	let confirmingId = $state<number | null>(null);
	let deletingId = $state<number | null>(null);
	// When this library is empty: the user's books in other workspaces
	// (after the upgrade they may sit in another workspace than this one).
	let elsewhere = $state<Book[]>([]);
	const others = $derived(workspacesWithBooks(elsewhere, $workspaces.list, workspaceId ?? undefined));

	// A response for a workspace that is no longer selected is dropped.
	let loadSeq = 0;

	async function load(id: number): Promise<void> {
		const seq = ++loadSeq;
		loading = true;
		loadError = '';
		try {
			const list = await listBooks(id);
			if (seq !== loadSeq) return;
			books = list;
			if (list.length === 0) {
				// Only a hint: a failure here leaves the plain empty state.
				const all = await listAllBooks().catch(() => [] as Book[]);
				if (seq !== loadSeq) return;
				elsewhere = all;
			}
		} catch (err) {
			if (seq !== loadSeq) return;
			books = [];
			loadError = apiErrorMessage(err, 'list');
		} finally {
			if (seq === loadSeq) loading = false;
		}
	}

	$effect(() => {
		const id = workspaceId;
		books = [];
		elsewhere = [];
		actionError = '';
		status = '';
		confirmingId = null;
		if (id === null) {
			loadSeq++;
			loading = true;
			return;
		}
		void load(id);
	});

	async function onFile(event: Event): Promise<void> {
		const el = event.currentTarget as HTMLInputElement;
		const file = el.files?.[0];
		if (!file) return;
		actionError = '';
		status = '';
		const id = workspaceId;
		if (id === null || !bookLanguage) {
			el.value = '';
			return;
		}
		if (file.size > MAX_BYTES) {
			actionError = 'This file is too large (max 20 MB).';
			el.value = '';
			return;
		}
		uploading = true;
		try {
			// The language fills in for an epub that does not declare one.
			const book = await uploadBook(file, id, bookLanguage);
			if (id === workspaceId) books = [book, ...books];
			status = `Added "${book.title}".`;
		} catch (err) {
			actionError = apiErrorMessage(err, 'upload');
		} finally {
			uploading = false;
			el.value = '';
		}
	}

	async function remove(book: Book): Promise<void> {
		deletingId = book.id;
		actionError = '';
		status = '';
		try {
			await deleteBook(book.id);
			books = books.filter((b) => b.id !== book.id);
			status = `Deleted "${book.title}".`;
			confirmingId = null;
		} catch (err) {
			actionError = apiErrorMessage(err, 'delete');
		} finally {
			deletingId = null;
		}
	}
</script>

<main class="library">
	<h1 class="heading">
		Library
		{#if workspace}<WorkspaceLabel {workspace} list={$workspaces.list} size={18} />{/if}
	</h1>

	{#if workspace}
		<section class="upload" aria-labelledby="upload-heading">
			<h2 id="upload-heading">Add an epub</h2>
			{#if bookLanguage}
				<p class="hint">
					Books go to this workspace's library and must be in {languageLabel(bookLanguage)}. A
					file that does not declare its language is read as {languageLabel(bookLanguage)}.
				</p>
				<div class="row">
					<label for="epub-file">Epub file (max 20 MB)</label>
					<input
						id="epub-file"
						type="file"
						accept=".epub,application/epub+zip"
						onchange={onFile}
						disabled={uploading}
					/>
				</div>
				<p>
					Or <a href={SOURCES_HREF}>browse public-domain texts</a> from Aozora Bunko and Project
					Gutenberg.
				</p>
			{:else}
				<p class="hint">
					The reader supports Chinese and Japanese books. Switch to a Chinese or Japanese
					workspace to add books.
				</p>
			{/if}
		</section>
	{/if}

	<p class="status" role="status" aria-live="polite">
		{#if uploading}Uploading…{:else}{status}{/if}
	</p>
	{#if actionError}
		<p class="error" role="alert">{actionError}</p>
	{/if}

	{#if loading}
		<p>Loading your library…</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" onclick={() => workspaceId !== null && load(workspaceId)}>Retry</button>
	{:else if books.length === 0}
		<p>
			This workspace's library is empty.{#if bookLanguage}
				Upload an epub or import a text from a source.{/if}
		</p>
		{#if others.length > 0}
			<section class="elsewhere" aria-labelledby="elsewhere-heading">
				<h2 id="elsewhere-heading">Your books in other workspaces</h2>
				<ul>
					{#each others as { workspace: other, count } (other.id)}
						<li>
							<span>
								{count}
								{count === 1 ? 'book' : 'books'} in
								<WorkspaceLabel workspace={other} list={$workspaces.list} withLanguage />
							</span>
							<button type="button" onclick={() => select(other.id)}>Switch to this workspace</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{:else}
		<ul class="books">
			{#each books as book (book.id)}
				<li>
					<div class="info">
						<a
							class="title"
							lang={book.language}
							href={bookHref(book.id, savedChapter(book.position, book.chapterCount))}>{book.title}</a
						>
						<span class="meta">
							<span lang={book.language}>{book.author || 'Unknown author'}</span> · {languageLabel(
								book.language
							)} · {book.source} · {book.chapterCount}
							{book.chapterCount === 1 ? 'chapter' : 'chapters'}
						</span>
					</div>
					{#if confirmingId === book.id}
						<span class="confirm" role="group" aria-label="Confirm delete of {book.title}">
							Delete this book?
							<button type="button" onclick={() => remove(book)} disabled={deletingId === book.id}>
								Yes, delete
							</button>
							<button type="button" onclick={() => (confirmingId = null)}>Cancel</button>
						</span>
					{:else}
						<button
							type="button"
							aria-label="Delete {book.title}"
							onclick={() => (confirmingId = book.id)}>Delete</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.upload,
	.books {
		margin-top: 1.5rem;
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}

	.hint {
		font-size: 0.9rem;
		opacity: 0.8;
	}

	.elsewhere h2 {
		font-size: 1.05rem;
	}

	.elsewhere ul {
		list-style: none;
		padding: 0;
	}

	.elsewhere li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.4rem 0;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.books {
		list-style: none;
		padding: 0;
	}

	.books li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}

	.info {
		display: flex;
		flex-direction: column;
	}

	.title {
		font-weight: 600;
	}

	.meta {
		font-size: 0.9rem;
		opacity: 0.75;
	}

	.confirm {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}

	.error {
		color: #b3261e;
	}
</style>
