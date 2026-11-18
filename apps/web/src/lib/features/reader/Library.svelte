<script lang="ts">
	import { t } from '$lib/i18n';
	import Msg from '$lib/i18n/Msg.svelte';
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
	import { Button } from '$lib/ui';

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
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
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
			actionError = t('reader.error.fileTooLarge');
			el.value = '';
			return;
		}
		uploading = true;
		try {
			// The language fills in for an epub that does not declare one.
			const book = await uploadBook(file, id, bookLanguage);
			if (id === workspaceId) books = [book, ...books];
			status = t('reader.library.added', { title: book.title });
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
			status = t('reader.library.deleted', { title: book.title });
			confirmingId = null;
		} catch (err) {
			actionError = apiErrorMessage(err, 'delete');
		} finally {
			deletingId = null;
		}
	}
</script>

<div class="page-body library">
	<h1 class="heading">
		{t('reader.library.title')}
		{#if workspace}<WorkspaceLabel {workspace} list={$workspaces.list} size={18} />{/if}
	</h1>

	{#if workspace}
		<section class="upload" aria-labelledby="upload-heading">
			<h2 id="upload-heading">{t('reader.library.addEpub')}</h2>
			{#if bookLanguage}
				<p class="hint">
					{t('reader.library.languageHint', { language: languageLabel(bookLanguage) })}
				</p>
				<div class="row">
					<input
						bind:this={fileInput}
						id="epub-file"
						class="visually-hidden"
						type="file"
						accept=".epub,application/epub+zip"
						aria-label={t('reader.library.file')}
						onchange={onFile}
						disabled={uploading}
					/>
					<Button variant="primary" disabled={uploading} onclick={() => fileInput?.click()}
						>{t('reader.library.addEpub')}</Button
					>
				</div>
				<p>
					<Msg key="reader.library.browse">{#snippet link(text: string)}<a href={SOURCES_HREF}>{text}</a>{/snippet}</Msg>
				</p>
			{:else}
				<p class="hint">
					{t('reader.library.unsupported')}
				</p>
			{/if}
		</section>
	{/if}

	<p class="status" role="status" aria-live="polite">
		{#if uploading}{t('reader.library.uploading')}{:else}{status}{/if}
	</p>
	{#if actionError}
		<p class="error" role="alert">{actionError}</p>
	{/if}

	{#if loading}
		<p>{t('reader.library.loading')}</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<Button onclick={() => workspaceId !== null && load(workspaceId)}>{t('reader.library.retry')}</Button>
	{:else if books.length === 0}
		<p>
			{t('reader.library.empty')}{#if bookLanguage}
				{t('reader.library.emptyHint')}{/if}
		</p>
		{#if others.length > 0}
			<section class="elsewhere" aria-labelledby="elsewhere-heading">
				<h2 id="elsewhere-heading">{t('reader.library.elsewhere')}</h2>
				<ul>
					{#each others as { workspace: other, count } (other.id)}
						<li>
							<span>
								{t('reader.library.booksIn', { count })}
								<WorkspaceLabel workspace={other} list={$workspaces.list} withLanguage />
							</span>
							<Button onclick={() => select(other.id)}>{t('reader.library.switch')}</Button>
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
							<span lang={book.language}>{book.author || t('reader.library.unknownAuthor')}</span> · {languageLabel(
								book.language
							)} · {book.source} · {t('reader.library.chapters', { count: book.chapterCount })}
						</span>
					</div>
					{#if confirmingId === book.id}
						<span class="confirm" role="group" aria-label={t('reader.library.confirmDelete', { title: book.title })}>
							{t('reader.library.deleteQuestion')}
							<Button variant="primary" tone="danger" onclick={() => remove(book)} disabled={deletingId === book.id}>
								{t('reader.editor.yesDelete')}
							</Button>
							<Button onclick={() => (confirmingId = null)}>{t('common.action.cancel')}</Button>
						</span>
					{:else}
						<Button
							tone="danger"
							aria-label={t('reader.library.deleteNamed', { title: book.title })}
							onclick={() => (confirmingId = book.id)}>{t('reader.editor.delete')}</Button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.upload,
	.books {
		margin-top: var(--space-6);
	}

	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.hint {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.elsewhere ul {
		list-style: none;
		padding: 0;
	}

	.elsewhere li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		padding-block: var(--space-2);
		border-bottom: 1px solid var(--hair);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		margin-bottom: var(--space-2);
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
		gap: var(--space-2);
		padding-block: var(--space-3);
		border-bottom: 1px solid var(--hair);
	}

	.info {
		display: flex;
		flex-direction: column;
	}

	.title {
		font-weight: var(--weight-strong);
	}

	.meta {
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}

	.confirm {
		display: inline-flex;
		gap: var(--space-1);
		align-items: center;
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
