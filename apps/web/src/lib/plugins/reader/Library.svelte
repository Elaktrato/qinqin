<script lang="ts">
	import { onMount } from 'svelte';
	import { deleteBook, listBooks, uploadEpub } from '$lib/api/library';
	import type { Book } from '$lib/api/types';
	import { currentLanguage } from '$lib/workspaces';
	import { apiErrorMessage } from './errors';
	import { initialUploadLanguage } from './uploadLanguage';
	import { SOURCES_HREF, bookHref } from './route';

	const MAX_BYTES = 20 * 1024 * 1024;

	let books = $state<Book[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let actionError = $state('');
	let status = $state('');
	let uploading = $state(false);
	let confirmingId = $state<number | null>(null);
	let deletingId = $state<number | null>(null);
	let language = $state('');
	let input = $state<HTMLInputElement | null>(null);

	// Follows the workspace until the user touches the select.
	let touched = false;
	$effect(() => {
		const initial = initialUploadLanguage($currentLanguage);
		if (!touched) language = initial;
	});

	async function load(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			books = await listBooks();
		} catch (err) {
			books = [];
			loadError = apiErrorMessage(err, 'list');
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function onFile(event: Event): Promise<void> {
		const el = event.currentTarget as HTMLInputElement;
		const file = el.files?.[0];
		if (!file) return;
		actionError = '';
		status = '';
		if (file.size > MAX_BYTES) {
			actionError = 'This file is too large (max 20 MB).';
			el.value = '';
			return;
		}
		uploading = true;
		try {
			const book = await uploadEpub(file, language || undefined);
			books = [book, ...books];
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
	<h1>Library</h1>

	<section class="upload" aria-labelledby="upload-heading">
		<h2 id="upload-heading">Add an epub</h2>
		<div class="row">
			<label for="epub-language">Language (used only if the file does not declare Chinese or Japanese)</label>
			<select
				id="epub-language"
				bind:value={language}
				onchange={() => (touched = true)}
				disabled={uploading}
			>
				<option value="">Detect from file</option>
				<option value="zh">Chinese</option>
				<option value="ja">Japanese</option>
			</select>
		</div>
		<div class="row">
			<label for="epub-file">Epub file (max 20 MB)</label>
			<input
				id="epub-file"
				type="file"
				accept=".epub,application/epub+zip"
				bind:this={input}
				onchange={onFile}
				disabled={uploading}
			/>
		</div>
		<p>
			Or <a href={SOURCES_HREF}>browse public-domain texts</a> from Aozora Bunko and Project
			Gutenberg.
		</p>
	</section>

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
		<button type="button" onclick={load}>Retry</button>
	{:else if books.length === 0}
		<p>Your library is empty. Upload an epub or import a text from a source.</p>
	{:else}
		<ul class="books">
			{#each books as book (book.id)}
				<li>
					<div class="info">
						<a class="title" href={bookHref(book.id, 0)}>{book.title}</a>
						<span class="meta">
							{book.author || 'Unknown author'} · {book.language} · {book.source} · {book.chapterCount}
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
