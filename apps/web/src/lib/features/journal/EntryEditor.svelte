<script lang="ts">
	import { t } from '$lib/i18n';
	import { errorText } from '$lib/api/apiErrors';
	import { formatDate, formatDay, formatNumber } from '$lib/i18n/format';
	import { studyLang } from '$lib/i18n/lang';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import OverallReview from './OverallReview.svelte';
	import ReviewText from './ReviewText.svelte';
	import JournalMargin from './JournalMargin.svelte';
	import CorrectionSheet from './CorrectionSheet.svelte';
	import { corrections } from './corrections';
	import { journalEntriesFor } from './journalEntries.svelte';
	import Field from '$lib/ui/Field.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { setFrameTitle } from '$lib/frame/pageFrame.svelte';
	import { aiErrorView, type AiErrorView } from './aiErrors';
	import { anchorAnnotations, isOutdated, originalCounts } from './anchor';
	import { requestReview } from './api';
	import {
		AUTOSAVE_MS,
		MAX_REVIEW_CHARS,
		codePoints,
		journalEventDue
	} from './entryDraft';
	import {
		ENTRY_MAX_CHARS,
		aiButtonGate,
		entryTitle,
		plainText,
		canGotoAfterFirstSave,
		editorTarget,
		isEntryGone,
		navigationPlan,
		tooLongHint,
		reviewAnnouncement,
		saveStatusText,
		type SaveState
	} from './editorLogic';
	import { pollForReview } from './reviewPoll';
	import { journalHref, newEntryHref } from './route';
	import { PHONE_MEDIA_QUERY } from '$lib/frame/breakpoint';
	import {
		deleteEntry,
		getEntry,
		getJournalSettings,
		getReview,
		newEntry,
		recordJournalEvent,
		saveEntry
	} from './store';
	import type { JournalEntry, Review } from './types';
	import { useSession } from '$lib/context/context';

	const session = useSession();

	let {
		workspaceId,
		entryId,
		initialTitle,
		aiAvailable,
		aiBanner,
		language
	}: {
		workspaceId: number;
		entryId: string | null;
		initialTitle: string;
		aiAvailable: boolean | null;
		aiBanner: string | null;
		language: string;
	} = $props();

	// The workspace this editor works in, fixed at creation. A save, review
	// or delete that finishes late must never reach a workspace chosen later.
	const ws = untrack(() => workspaceId);
	const aborter = new AbortController();
	let destroyed = false;
	let internalNav = false; // our own address change after the first save
	let gone = false; // the entry was deleted: stop saving it

	let entry = $state<JournalEntry | null>(null);
	let originals = $state<Record<string, number>>({});
	let loadState = $state<'loading' | 'ready' | 'notfound' | 'error'>('loading');
	let title = $state('');
	let text = $state('');
	let date = $state('');
	let persisted = $state(false); // the entry exists on the server
	let savedText = '';
	let dirty = false;
	let saveState = $state<SaveState>('idle');
	/** Why the last save failed (catalogue text, record 0001). */
	let saveError = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saveChain: Promise<boolean> = Promise.resolve(true);

	let mode = $state<'edit' | 'review'>('edit');
	let review = $state<Review | null>(null);
	let reviewing = $state(false);
	let reviewStatus = $state('');
	let failure = $state<AiErrorView | null>(null);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state('');

	let textarea = $state<HTMLTextAreaElement>();
	let heading = $state<HTMLHeadingElement>();
	let reviewHeading = $state<HTMLHeadingElement>();
	let deleteButton = $state<HTMLButtonElement>();
	let cancelDelete = $state<HTMLButtonElement>();
	let reviewText = $state<{ focusAnnotation(id: string): Promise<void> }>();
	let openCorrectionId = $state<string | null>(null);
	let explanationLang = $state('en');
	let phone = $state(false);
	let correctionSheet = $state(false);
	let ideasSheet = $state(false);
	let margin = $state<HTMLElement | null>(null);

	const chars = $derived(codePoints(text));
	const reviewGate = $derived(
		aiButtonGate({ available: aiAvailable, banner: aiBanner, chars, forReview: true })
	);
	const ideasGate = $derived(
		aiButtonGate({ available: aiAvailable, banner: aiBanner, chars, forReview: false })
	);
	const anchoring = $derived(review ? anchorAnnotations(text, review.annotations, originals) : null);
	const outdated = $derived(review ? isOutdated(text, review) : false);
	const correctionsList = $derived(review && anchoring ? corrections(review, anchoring) : []);
	function touch(): void {
		dirty = true;
		saveState = 'dirty';
		clearTimeout(timer);
		timer = setTimeout(() => void flush(), AUTOSAVE_MS);
	}

	/** Saves now if there is anything unsaved; resolves false when the save failed. */
	function flush(opts: { keepalive?: boolean } = {}): Promise<boolean> {
		clearTimeout(timer);
		saveChain = saveChain.then(() => doSave(opts));
		return saveChain;
	}

	async function doSave(opts: { keepalive?: boolean } = {}): Promise<boolean> {
		if (!entry || !dirty || gone) return true;
		// Nothing typed yet: an untouched new entry is never created.
		if (!persisted && title.trim() === '' && text.trim() === '') {
			dirty = false;
			saveState = 'idle';
			return true;
		}
		dirty = false;
		saveState = 'saving';
		// The server refuses control characters and a title over its limit: send what it takes.
		const snapshot: JournalEntry = { ...entry, title: entryTitle(title), text: plainText(text), date: date || entry.date };
		const textChanged = snapshot.text !== savedText;
		try {
			const saved = await saveEntry(ws, snapshot, opts);
			journalEntriesFor(session.caches.journalEntries, ws).upsert(saved);
			entry = saved;
			savedText = saved.text;
			const firstSave = !persisted;
			persisted = true;
			if (textChanged) void recordEvent(saved.id);
			saveState = dirty ? 'dirty' : 'saved';
			if (firstSave && canGotoAfterFirstSave({ destroyed, routeEntryId: entryId })) {
				// The address now names the entry, so a reload comes back to it.
				internalNav = true;
				try {
					await goto(journalHref({ view: 'entry', id: saved.id }), {
						replaceState: true,
						keepFocus: true,
						noScroll: true
					});
				} finally {
					internalNav = false;
				}
			}
			return true;
		} catch (err) {
			dirty = true;
			saveError = errorText(err, t('journal.save.error'));
			saveState = 'error';
			return false;
		}
	}

	async function recordEvent(id: string): Promise<void> {
		const now = new Date();
		if (!journalEventDue(id, true, now, session.caches.journalSent, session.zone.day().dayOf)) return;
		try {
			await recordJournalEvent(session.events, ws, id, now);
		} catch {
			// Telemetry only; allow another try on the next save.
			session.caches.journalSent.delete(id);
		}
	}

	async function load(id: string | null): Promise<void> {
		clearTimeout(timer);
		await flush();
		mode = 'edit';
		review = null;
		reviewStatus = '';
		openCorrectionId = null;
		correctionSheet = false;
		ideasSheet = false;
		failure = null;
		confirmingDelete = false;
		deleteError = '';
		saveState = 'idle';
		dirty = false;
		gone = false;
		originals = {};
		if (id === null) {
			const fresh = newEntry('typed', session.zone.day());
			entry = fresh;
			title = entryTitle(initialTitle);
			text = '';
			date = fresh.date;
			persisted = false;
			savedText = '';
			loadState = 'ready';
			await tick();
			(initialTitle ? textarea : heading)?.focus();
			return;
		}
		loadState = 'loading';
		try {
			const found = await getEntry(ws, id);
			if (!found) {
				entry = null;
				loadState = 'notfound';
				return;
			}
			entry = found;
			title = found.title;
			text = found.text;
			date = found.date;
			persisted = true;
			savedText = found.text;
			loadState = 'ready';
			getReview(ws, id).then(
				(r) => {
					if (entry?.id !== id) return;
					review = r;
					// The reviewed text is only known while the text is unchanged.
					originals = r && !isOutdated(text, r) ? originalCounts(text, r.annotations) : {};
					if (r && !isOutdated(text, r)) mode = 'review';
				},
				() => {}
			);
		} catch {
			entry = null;
			loadState = 'error';
		}
	}

	// Follows the address: a different entry, or a new one. The first save
	// of a new entry changes the address to its own id, which is a no-op.
	$effect(() => {
		const id = entryId;
		// Read so that a new title (Ideas → Start an entry) re-runs the effect.
		void editorTarget(entryId, initialTitle);
		untrack(() => {
			if (id !== null && id === entry?.id) return;
			void load(id);
		});
	});

	function setReview(r: Review): void {
		review = r;
		openCorrectionId = null;
		correctionSheet = false;
		if (entry) journalEntriesFor(session.caches.journalEntries, ws).markReviewed(entry.id);
		mode = 'review';
		originals = isOutdated(text, r) ? {} : originalCounts(text, r.annotations);
		const a = anchorAnnotations(text, r.annotations, originals);
		reviewStatus = reviewAnnouncement(a.placed.length + a.listOnly.length, a.missing.length);
		void tick().then(() => reviewHeading?.focus());
	}

	async function runReview(): Promise<void> {
		if (!entry || reviewing || !reviewGate.enabled) return;
		const id = entry.id;
		failure = null;
		reviewStatus = '';
		if (!(await flush())) {
			failure = {
				text: t('journal.editor.notSent'),
				settingsLink: false,
				offlineInstead: false,
				poll: false
			};
			return;
		}
		reviewing = true;
		reviewStatus = t('journal.editor.reviewing');
		const since = review?.createdAt ?? '';
		try {
			const r = await requestReview(ws, id, aborter.signal);
			if (entry?.id === id) setReview(r);
		} catch (err) {
			if (destroyed) return;
			const view = aiErrorView(err, 'review');
			if (isEntryGone(err) && view.text === t('journal.ai.entryGone')) markGone();
			if (view.poll) {
				reviewStatus = t('journal.editor.stillWaiting');
				const late = await pollForReview(() => getReview(ws, id), since, {
					signal: aborter.signal
				});
				if (destroyed) return;
				if (late) {
					if (entry?.id === id) setReview(late);
					return;
				}
			}
			reviewStatus = '';
			if (entry?.id === id) failure = view;
		} finally {
			reviewing = false;
		}
	}

	/** The entry no longer exists on the server: keep the text on screen, but stop saving. */
	function markGone(): void {
		gone = true;
		dirty = false;
		clearTimeout(timer);
		saveState = 'idle';
	}

	async function backToEdit(): Promise<void> {
		openCorrectionId = null;
		correctionSheet = false;
		mode = 'edit';
		await tick();
		textarea?.focus();
	}

	function showReview(): void {
		mode = 'review';
		void tick().then(() => reviewHeading?.focus());
	}

	async function startFromIdea(ideaTitle: string): Promise<void> {
		ideasSheet = false;
		await flush();
		await goto(newEntryHref(ideaTitle));
	}

	async function askDelete(): Promise<void> {
		confirmingDelete = true;
		await tick();
		cancelDelete?.focus();
	}

	async function abortDelete(): Promise<void> {
		confirmingDelete = false;
		await tick();
		deleteButton?.focus();
	}

	async function confirmDelete(): Promise<void> {
		if (!entry || deleting) return;
		clearTimeout(timer);
		dirty = false;
		deleting = true;
		deleteError = '';
		gone = true;
		try {
			// A save that is already on its way must land before the delete, not after.
			await saveChain.catch(() => false);
			if (persisted) await deleteEntry(ws, entry.id);
			journalEntriesFor(session.caches.journalEntries, ws).remove(entry.id);
			await goto(journalHref({ view: 'list' }));
		} catch {
			gone = false;
			deleteError = t('journal.editor.deleteFailed');
			deleting = false;
		}
	}

	let leaving = false;
	beforeNavigate((nav) => {
		// Closing the tab or reloading cannot wait; pagehide sends a keepalive save.
		if (nav.type === 'leave' || leaving || internalNav || deleting || navigationPlan(saveState) === 'proceed') {
			void flush();
			return;
		}
		// Moving inside the app: finish the save first, and ask if it fails.
		const target = nav.to?.url;
		nav.cancel();
		leaving = true;
		void flush().then(async (ok) => {
			if (ok || confirm(t('journal.editor.leaveUnsaved'))) {
				if (target) await goto(target);
			}
			leaving = false;
		});
	});

	onDestroy(() => {
		destroyed = true;
		aborter.abort();
		void flush();
	});

	function onVisibility(): void {
		if (document.visibilityState === 'hidden') void flush({ keepalive: true });
	}

	function openCorrection(id: string | null): void {
		openCorrectionId = id;
		if (id === null) return;
		if (phone) correctionSheet = true;
		else void reviewText?.focusAnnotation(id);
	}

	const sheetCorrections = $derived(correctionsList.filter((c) => c.state === 'placed'));

	function closeCorrectionSheet(): void {
		correctionSheet = false;
		openCorrectionId = null;
	}

	function openIdeas(): void {
		if (phone) ideasSheet = true;
		else if (typeof margin?.scrollIntoView === 'function') margin.scrollIntoView({ block: 'start' });
	}

	function closeIdeasSheet(): void {
		ideasSheet = false;
	}

	setFrameTitle(() => title || date);

	const studyLanguage = $derived(studyLang(language));

	$effect(() => {
		getJournalSettings(ws).then(
			(settings) => (explanationLang = settings.explanationLanguage),
			() => {}
		);
	});

	onMount(() => {
		if (typeof matchMedia !== 'function') return;
		const mq = matchMedia(PHONE_MEDIA_QUERY);
		phone = mq.matches;
		const change = (event: MediaQueryListEvent): void => {
			phone = event.matches;
		};
		mq.addEventListener?.('change', change);
		return () => mq.removeEventListener?.('change', change);
	});
</script>

<svelte:document onvisibilitychange={onVisibility} />
<svelte:window onpagehide={() => void flush({ keepalive: true })} />

<div class="entry-layout" class:page-with-margin={!phone}>
	<div class="page">
		<p class="back"><a href={journalHref({ view: 'list' })}>{t('journal.settings.back')}</a></p>

		{#if loadState === 'loading'}
			<p role="status">{t('common.loading')}</p>
		{:else if loadState === 'notfound'}
			<h1>{t('journal.editor.notFound')}</h1>
			<p>{t('journal.editor.notFoundHint')}</p>
			<p><a href={journalHref({ view: 'list' })}>{t('journal.editor.backToList')}</a></p>
		{:else if loadState === 'error' || !entry}
			<p class="error" role="alert">{t('journal.editor.loadFailed')}</p>
			<Button variant="secondary" onclick={() => load(entryId)}>{t('journal.list.retry')}</Button>
		{:else}
			<h1 bind:this={heading} tabindex="-1" class="visually-hidden"
				>{persisted ? t('journal.editor.entry') : t('journal.editor.new')}</h1
			>

			{#if mode === 'edit'}
				<form class="editor" onsubmit={(e) => e.preventDefault()}>
					<div class="top">
						<Field
							label={t('journal.editor.date')}
							type="date"
							bind:value={date}
							required
							oninput={touch}
							onblur={() => void flush()}
						/>
						<Field
							label={t('journal.editor.titleLabel')}
							hideLabel
							data-testid="journal-title"
							lang={studyLanguage}
							bind:value={title}
							maxlength={200}
							oninput={touch}
							onblur={() => void flush()}
						/>
					</div>
					<Field
						label={t('journal.editor.entry')}
						hideLabel
						multiline
						lang={studyLanguage}
						data-testid="journal-entry"
						bind:value={text}
						bind:element={textarea}
						maxlength={ENTRY_MAX_CHARS}
						style="min-height: 18rem; line-height: 1.9"
						aria-describedby="entry-count"
						oninput={touch}
						onblur={() => void flush()}
					/>
					<p id="entry-count" class="count" class:over={chars > MAX_REVIEW_CHARS}>
						{t('journal.editor.count', { count: formatNumber(chars), max: formatNumber(MAX_REVIEW_CHARS) })}
					</p>
					{#if chars > MAX_REVIEW_CHARS}
						<p class="count over">{tooLongHint(chars)}</p>
					{/if}
					{#if text.length >= ENTRY_MAX_CHARS}
						<p class="count over">{t('journal.editor.longest')}</p>
					{/if}
				</form>
				<p class="foot" aria-live="polite">{saveStatusText(saveState)
					? t('journal.editor.foot', {
							count: formatNumber(chars),
							status: saveState === 'error' ? saveError : saveStatusText(saveState)
						})
					: formatNumber(chars)}</p>
				{#if saveState === 'error'}
					<Button variant="secondary" onclick={() => void flush()}>{t('journal.editor.save')}</Button>
				{/if}
				<div class="actions">
					<Button
						variant="primary"
						onclick={runReview}
						disabled={reviewing || !reviewGate.enabled}
						aria-describedby={reviewGate.hint ? 'review-hint' : undefined}
					>
						{reviewing ? t('journal.editor.reviewingShort') : t('journal.editor.review')}
					</Button>
					<Button variant="secondary" href={journalHref({ view: 'photo' })}>{t('journal.editor.photo')}</Button>
					<Button
						variant="secondary"
						onclick={openIdeas}
						disabled={!ideasGate.enabled}
						aria-describedby={ideasGate.hint ? 'ideas-hint' : undefined}
					>
						{t('journal.ideas.title')}
					</Button>
					{#if review}
						<Button variant="secondary" onclick={showReview}>
							{t('journal.margin.corrections', { count: correctionsList.length })}
						</Button>
					{/if}
					{#if confirmingDelete}
						<span class="confirm" role="group" aria-label={t('journal.editor.deleteQuestion')}>
							{t('journal.editor.deleteText')}
							<Button
								variant="secondary"
								tone="danger"
								onclick={confirmDelete}
								disabled={deleting}
							>
								{t('journal.editor.yesDelete')}
							</Button>
							<Button variant="secondary" bind:element={cancelDelete} onclick={abortDelete}>
								{t('common.action.cancel')}
							</Button>
						</span>
					{:else}
						<Button
							variant="plain"
							tone="danger"
							bind:element={deleteButton}
							onclick={askDelete}
						>
							{t('journal.editor.delete')}
						</Button>
					{/if}
				</div>
				{#if reviewGate.hint && !reviewGate.enabled}
					<p id="review-hint" class="hint">
						{reviewGate.hint}{#if reviewGate.settingsLink}
							{' '}<a href="/settings?tab=ai">{t('journal.openAiSettings')}</a>{/if}
					</p>
				{/if}
				{#if ideasGate.hint && !ideasGate.enabled}
					<p id="ideas-hint" class="hint">{ideasGate.hint}</p>
				{/if}
				{#if review && outdated}
					<div class="outdated">
						<p>{t('journal.editor.outdated')}</p>
						<Button
							variant="secondary"
							onclick={runReview}
							disabled={reviewing || !reviewGate.enabled}
						>
							{t('journal.editor.reviewAgain')}
						</Button>
						<Button variant="secondary" onclick={showReview}>
							{t('journal.margin.corrections', { count: correctionsList.length })}
						</Button>
					</div>
				{/if}
			{:else if review && anchoring}
				<h2 bind:this={reviewHeading} tabindex="-1">{t('journal.editor.review')}</h2>
				<p class="meta">{formatDay(date, { dateStyle: 'full' })}{#if title.trim()} · <span lang={studyLanguage}>{title.trim()}</span>{/if}</p>
				{#if outdated}
					<div class="outdated">
						<p>{t('journal.editor.outdated')}</p>
						<Button
							variant="secondary"
							onclick={runReview}
							disabled={reviewing || !reviewGate.enabled}
							aria-describedby={reviewGate.hint ? 'review-hint' : undefined}
						>
							{t('journal.editor.reviewAgain')}
						</Button>
					</div>
				{/if}
				{#if phone && sheetCorrections.length > 0}
					<Button variant="secondary" onclick={() => { openCorrection(sheetCorrections[0].annotation.id); correctionSheet = true; }}>
						{t('journal.sheet.open', { count: sheetCorrections.length })}
					</Button>
				{/if}
				<ReviewText
					bind:this={reviewText}
					{text}
					placed={anchoring.placed}
					annotations={review.annotations}
					openId={openCorrectionId}
					onopen={openCorrection}
					studyLang={studyLanguage ?? language}
				/>
				<OverallReview {review} explanationLang={explanationLang} />
				<p class="foot">
					{t('journal.editor.reviewedAt', { time: formatDate(review.createdAt) })}
				</p>
				<div class="actions">
					<Button variant="secondary" onclick={backToEdit}>{t('journal.editor.edit')}</Button>
					{#if !outdated}
						<Button variant="secondary" onclick={runReview} disabled={reviewing || !reviewGate.enabled}>
							{t('journal.editor.reviewAgain')}
						</Button>
					{/if}
				</div>
			{/if}

			<div class="live" aria-live="polite">{reviewStatus}</div>
			{#if failure}
				<p class="error" role="alert">
					{failure.text}
					{#if failure.settingsLink}<a href="/settings?tab=ai">{t('journal.openAiSettings')}</a>{/if}
				</p>
			{/if}
			{#if deleteError}<p class="error" role="alert">{deleteError}</p>{/if}
		{/if}
	</div>

	{#if !phone}
		<div class="margin-col" bind:this={margin}>
			{#if mode === 'review' && review && anchoring}
				<JournalMargin
					mode="corrections"
					corrections={correctionsList}
					openId={openCorrectionId}
					onopen={openCorrection}
					workspaceId={ws}
					gate={ideasGate}
					onstart={startFromIdea}
					studyLang={studyLanguage ?? language}
					explanationLang={explanationLang}
				/>
			{:else}
				<JournalMargin
					mode="ideas"
					corrections={[]}
					openId={null}
					onopen={() => {}}
					workspaceId={ws}
					gate={ideasGate}
					onstart={startFromIdea}
					studyLang={studyLanguage ?? language}
					explanationLang={explanationLang}
				/>
			{/if}
		</div>
	{/if}
</div>

{#if phone}
	{#if correctionSheet}
		<CorrectionSheet
			mode="corrections"
			corrections={sheetCorrections}
			openId={openCorrectionId}
			onopen={openCorrection}
			onclose={closeCorrectionSheet}
			workspaceId={ws}
			gate={ideasGate}
			onstart={startFromIdea}
			studyLang={studyLanguage ?? language}
			explanationLang={explanationLang}
		/>
	{/if}
	{#if ideasSheet}
		<CorrectionSheet
			mode="ideas"
			corrections={[]}
			openId={null}
			onopen={() => {}}
			onclose={closeIdeasSheet}
			workspaceId={ws}
			gate={ideasGate}
			onstart={startFromIdea}
			studyLang={studyLanguage ?? language}
			explanationLang={explanationLang}
		/>
	{/if}
{/if}

<style>
	h1:focus,
	h2:focus {
		outline: none;
	}

	.entry-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6);
		align-items: start;
	}
	.page {
		min-width: 0;
		display: grid;
		gap: var(--space-3);
		align-content: start;
		max-width: 38em;
		justify-self: center;
		width: 100%;
	}
	.margin-col {
		min-width: 0;
		border-inline-start: 1px solid var(--hair);
		padding-inline-start: var(--space-4);
	}
	.back {
		margin: 0;
	}
	.back a {
		color: var(--readable-muted);
	}
	.editor {
		display: grid;
		gap: var(--space-3);
	}
	.top {
		display: grid;
		grid-template-columns: minmax(9rem, auto) minmax(0, 1fr);
		gap: var(--space-3);
		align-items: end;
	}
	.count,
	.foot {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
	.count.over {
		color: var(--readable-bad);
		font-weight: var(--weight-strong);
	}
	.live {
		min-height: 1.4em;
		font-size: var(--font-size-label);
	}
	.actions,
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.outdated {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		border-inline-start: 2px solid var(--warn);
		padding: var(--space-1) var(--space-3);
	}
	.outdated p {
		margin: 0;
		font-weight: var(--weight-strong);
	}
	.meta {
		color: var(--readable-muted);
		overflow-wrap: anywhere;
	}
	.hint {
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
	}
	@media (max-width: 61.24rem) {
		.entry-layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.margin-col {
			display: none;
		}
	}
	@media (min-width: 45rem) {
		.entry-layout.page-with-margin {
			grid-template-columns: minmax(0, 1fr) 16rem;
		}
	}
</style>
