<script lang="ts">
	import { listAllBooks } from '$lib/api/library';
	import { t } from '$lib/i18n';
	import { errorText } from '$lib/api/apiErrors';
	import { formatDuration, readingTotals, topBooks, type ReadingTotals } from '$lib/stats/readingTime';
	import Button from '$lib/ui/Button.svelte';
	import WidgetCard from './WidgetCard.svelte';
	import type { WidgetStatus } from './types';
	import { useSession } from '$lib/context/context';


	const session = useSession();

	// Reading time (reader plugin): tracked time in the active workspace,
	// all time, the last 7 and 30 days, and the five most read books.

	let totals = $state.raw<ReadingTotals | null>(null);
	let titles = $state.raw<Map<number, string> | null>(null);
	let loading = $state(true);
	let error = $state('');
	let noWorkspace = $state(false);

	let requestSeq = 0;

	const workspaceId = $derived(session.workspaces.current?.id ?? null);
	const top = $derived(totals === null ? [] : topBooks(totals.books, titles));
	const status = $derived<WidgetStatus>(
		noWorkspace
			? 'no-workspace'
			: loading
				? 'loading'
				: error
					? 'error'
					: (totals?.totalSeconds ?? 0) === 0
						? 'empty'
						: 'ready'
	);

	async function loadTitles(): Promise<Map<number, string> | null> {
		try {
			// Reading is credited to the workspace whose library holds the book
			// (readingWorkspace.ts; the language decides only for a book without
			// one), so this workspace's library would name it. Every library is
			// a superset kept so a live book is never labelled "A removed book".
			const books = await listAllBooks();
			return new Map((Array.isArray(books) ? books : []).map((book) => [book.id, book.title]));
		} catch {
			// The times still show; books are then numbered.
			return null;
		}
	}

	async function load(workspace: number | null, force = false): Promise<void> {
		const seq = ++requestSeq;
		loading = true;
		error = '';
		noWorkspace = false;

		if (workspace === null) {
			totals = null;
			noWorkspace = true;
			loading = false;
			return;
		}

		try {
			// All-time totals need the whole event log of the workspace (every
			// type: the endpoint has no type filter). The read is shared with
			// the flashcards widgets (events.ts: loadWorkspaceEvents); if logs
			// grow large enough to make it slow, a server-side summary endpoint
			// is the planned follow-up.
			const [events, names] = await Promise.all([
				session.events.load(workspace, { force }),
				loadTitles()
			]);
			if (seq !== requestSeq) return;
			const own = events.filter(
				(event) => event.workspaceId === workspace
			);
			totals = readingTotals(own, new Date(), session.zone.day());
			titles = names;
		} catch (err) {
			if (seq !== requestSeq) return;
			totals = null;
			error = errorText(err, t('widgets.reading.loadFailed'));
		} finally {
			if (seq === requestSeq) loading = false;
		}
	}

	$effect(() => {
		void load(workspaceId);
	});

	// A zone change moves the 7 and 30 day windows.
	$effect(() => session.zone.onChange(() => void load(workspaceId)));
</script>

<WidgetCard
	title={t('widgets.reading.title')}
	headingId="reading-time-heading"
	{status}
	noWorkspaceText={t('widgets.reading.noWorkspace')}
	loadingText={t('widgets.reading.loading')}
	{error}
	onretry={() => void load(workspaceId, true)}
	emptyText={t('widgets.reading.empty')}
>
	{#snippet actions()}
		<Button variant="plain" href="/reader">{t('widgets.reading.open')}</Button>
	{/snippet}

	{#if totals !== null}
		<dl class="totals">
			<div>
				<dt>{t('widgets.reading.allTime')}</dt>
				<dd>{formatDuration(totals.totalSeconds)}</dd>
			</div>
			<div>
				<dt>{t('widgets.reading.last7')}</dt>
				<dd>{formatDuration(totals.last7Seconds)}</dd>
			</div>
			<div>
				<dt>{t('widgets.reading.last30')}</dt>
				<dd>{formatDuration(totals.last30Seconds)}</dd>
			</div>
		</dl>

		<h3 class="sub">{t('widgets.reading.mostRead')}</h3>
		<ol class="books">
			{#each top as book (book.key)}
				<li class:removed={book.removed}>
					<span class="title">{book.title}</span>
					<span class="time">{formatDuration(book.seconds)}</span>
				</li>
			{/each}
		</ol>
		{#if titles === null}
			<p class="note" role="status">{t('widgets.reading.titlesFailed')}</p>
		{/if}

		<p class="note">{t('widgets.reading.note')}</p>
	{/if}
</WidgetCard>

<style>
	.totals {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: 0.6rem 0.75rem;
		margin: 0.9rem 0 0;
	}

	.totals dt {
		font-size: 0.75rem;
		color: var(--readable-muted);
	}

	.totals dd {
		margin: 0.15rem 0 0;
		font-size: 1.05rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.sub {
		margin: 1rem 0 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--readable-muted);
	}

	.books {
		margin: 0.4rem 0 0;
		padding: 0;
		list-style: none;
		font-size: 0.88rem;
	}

	.books li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
	}

	.title {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.removed .title {
		font-style: italic;
		color: var(--readable-muted);
	}

	.time {
		flex-shrink: 0;
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0.75rem 0 0;
		font-size: 0.8rem;
		color: var(--readable-muted);
	}
</style>
