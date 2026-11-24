<script lang="ts">
	// One conversation with the partner (#185). The learner's messages show the
	// journal's corrections (ReviewText marks; the margin on a wide screen, the
	// shared bottom sheet on a phone); the partner's replies are lookup
	// paragraphs with the reader's popup ("+" adds a word to a deck). Save turns
	// the conversation into a journal entry, Discard deletes it. Logic: talk.ts.
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { PHONE_MEDIA_QUERY } from '$lib/frame/breakpoint';
	import { Button, Field } from '$lib/ui';
	import PopupStackView from '$lib/features/reader/PopupStackView.svelte';
	import { LookupController } from '$lib/features/reader/useLookup.svelte';
	import { recordLookup } from '$lib/lookups/sink';
	import { newUlid } from '$lib/ulid';
	import { useSession } from '$lib/context/context';
	import { aiErrorView } from '../aiErrors';
	import { answeredBy } from '../answeredBy';
	import CorrectionSheet from '../CorrectionSheet.svelte';
	import JournalMargin from '../JournalMargin.svelte';
	import ReviewText from '../ReviewText.svelte';
	import { journalEntriesFor } from '../journalEntries.svelte';
	import { loadProviderNames } from '../providerNames';
	import { journalHref } from '../route';
	import { getJournalSettings, recordJournalEvent } from '../store';
	import { discardConversation, getConversation, saveConversation, sendTurn } from './conversations';
	import { conversationCorrections, isFull, lastAnswer, levelLabel, runTurn, saveAsEntry, sendableText, turnErrorText, turnGate } from './talk';
	import type { Conversation } from './types';
	const session = useSession();

	let {
		workspaceId,
		id,
		studyLang,
		aiAvailable,
		aiBanner
	}: { workspaceId: number; id: string; studyLang: string; aiAvailable: boolean | null; aiBanner: string | null } = $props();

	const ws = untrack(() => workspaceId);
	const aborter = new AbortController();
	onDestroy(() => aborter.abort());

	let conversation = $state<Conversation | null>(null);
	let status = $state<'loading' | 'ready' | 'gone' | 'error'>('loading');
	let text = $state('');
	let busy = $state(false);
	let live = $state('');
	let failure = $state<{ text: string; settingsLink: boolean } | null>(null);
	// The id of the turn being sent; a retry of the same message reuses it, so
	// the server answers a turn it already stored instead of a second AI call.
	let pendingTurn: string | null = null;
	let field = $state<HTMLInputElement | HTMLTextAreaElement>();
	let actionError = $state('');
	let confirmingDiscard = $state(false);
	let saving = $state(false);
	let explanationLang = $state('en');
	let names = $state<Map<string, string> | null>(null);
	let openId = $state<string | null>(null);
	let phone = $state(false);
	let sheet = $state(false);
	let container = $state<HTMLElement | null>(null);
	let marks: Record<number, { focusAnnotation(id: string): Promise<void> } | undefined> = $state({});

	const messages = $derived(conversation?.messages ?? []);
	const corrections = $derived(conversationCorrections(messages));
	const sheetCorrections = $derived(corrections.list.filter((c) => c.state === 'placed'));
	const full = $derived(isFull(messages));
	const gate = $derived(turnGate({ available: aiAvailable, banner: aiBanner, opened: messages.length > 0, full, busy, text }));
	const answer = $derived(lastAnswer(messages));
	const answerLine = $derived(answer ? answeredBy(answer.model, answer.provider ? (names?.get(answer.provider) ?? answer.provider) : undefined) : '');
	// One lookup paragraph per partner message: data-p is the message's index.
	const partnerTexts = $derived(messages.map((m) => (m.role === 'partner' ? m.text : '')));

	const lookup = new LookupController({
		container: () => container,
		lang: () => studyLang,
		textLang: () => studyLang,
		runsOf: (p) => [{ text: partnerTexts[p] ?? '' }],
		onLookup: (entryId) => recordLookup(session.lookups.recorder, ws, { entryId, source: 'reader' })
	});
	$effect(() => lookup.attach());
	$effect(() => {
		const el = container;
		if (!el) return;
		const options = { passive: true };
		el.addEventListener('pointermove', lookup.pointermove, options);
		el.addEventListener('pointerleave', lookup.pointerleave, options);
		el.addEventListener('pointerdown', lookup.pointerdown, options);
		return () => {
			el.removeEventListener('pointermove', lookup.pointermove);
			el.removeEventListener('pointerleave', lookup.pointerleave);
			el.removeEventListener('pointerdown', lookup.pointerdown);
		};
	});

	onMount(() => {
		void loadProviderNames(session.caches.providerNames).then((m) => (names = m));
		getJournalSettings(ws).then((s) => (explanationLang = s.explanationLanguage), () => {});
		getConversation(ws, id).then(
			(c) => {
				conversation = c;
				status = c === null ? 'gone' : 'ready';
			},
			() => (status = 'error')
		);
		if (typeof matchMedia !== 'function') return;
		const mq = matchMedia(PHONE_MEDIA_QUERY);
		phone = mq.matches;
		const change = (event: MediaQueryListEvent): void => {
			phone = event.matches;
		};
		mq.addEventListener?.('change', change);
		return () => mq.removeEventListener?.('change', change);
	});

	async function send(event?: SubmitEvent): Promise<void> {
		event?.preventDefault();
		if (!conversation || !gate.enabled) return;
		busy = true;
		failure = null;
		live = t('journal.talk.thinking');
		lookup.close();
		const turnId = (pendingTurn ??= newUlid());
		const r = await runTurn(
			{ send: (s, tid) => sendTurn(ws, id, s, tid, aborter.signal), reload: () => getConversation(ws, id) },
			sendableText(text),
			turnId,
			{ signal: aborter.signal, onWaiting: () => (live = t('journal.talk.waiting')) }
		);
		if (aborter.signal.aborted) return;
		busy = false;
		if (r.gone) {
			status = 'gone';
			live = '';
		} else if (r.conversation) {
			conversation = r.conversation;
			pendingTurn = null;
			text = '';
			const reply = [...r.conversation.messages].reverse().find((m) => m.role === 'partner');
			live = reply ? t('journal.talk.partnerSaid', { text: reply.text }) : t('journal.talk.answered');
		} else {
			failure = { text: turnErrorText(r.error), settingsLink: aiErrorView(r.error, 'ideas').settingsLink };
			live = '';
		}
		await tick();
		if (document.activeElement === document.body) field?.focus();
	}

	function keydown(event: KeyboardEvent): void {
		// Ctrl or Cmd + Enter sends; Enter alone is a new line (a phone keyboard has no modifier).
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send();
	}

	function openCorrection(next: string | null): void {
		openId = next;
		if (next === null) return;
		if (phone) sheet = true;
		else {
			const seq = Number(/^m(\d+)a/.exec(next)?.[1]);
			void marks[seq]?.focusAnnotation(next);
		}
	}

	async function save(): Promise<void> {
		if (saving) return;
		saving = true;
		actionError = '';
		try {
			const entry = await saveAsEntry({
				save: () => saveConversation(ws, id, newUlid(), session.zone.day().today(Date.now())),
				upsert: (e) => journalEntriesFor(session.caches.journalEntries, ws).upsert(e),
				record: (entryId) => recordJournalEvent(session.events, ws, entryId, new Date())
			});
			await goto(entry ? journalHref({ view: 'entry', id: entry.id }) : journalHref({ view: 'list' }));
		} catch (err) {
			actionError = errorText(err, t('journal.talk.saveFailed'));
		} finally {
			saving = false;
		}
	}

	async function discard(): Promise<void> {
		actionError = '';
		try {
			await discardConversation(ws, id);
			await goto(journalHref({ view: 'talk' }));
		} catch (err) {
			actionError = errorText(err, t('journal.talk.discardFailed'));
		}
	}

	async function askDiscard(): Promise<void> {
		confirmingDiscard = true;
		await tick();
		document.getElementById('talk-keep')?.focus();
	}
</script>

<div class="conversation-grid">
	<div class="chat">
		<p class="back"><a href={journalHref({ view: 'talk' })}>{t('journal.talk.back')}</a></p>
		{#if status === 'loading'}
			<p role="status">{t('journal.talk.loading')}</p>
		{:else if status === 'error'}
			<p class="error" role="alert">{t('journal.talk.loadFailed')}</p>
		{:else if status === 'gone' || conversation === null}
			<p>{t('journal.talk.gone')}</p>
		{:else}
			<h1 lang={conversation.topic ? studyLang : undefined}>{conversation.topic || t('journal.talk.untitled')}</h1>
			<p class="meta">{levelLabel(conversation.level)}{#if answerLine} · {answerLine}{/if}</p>
			{#if messages.some((m) => m.role === 'partner')}<p class="hint">{t('journal.talk.lookupHint')}</p>{/if}

			<ol class="messages" aria-label={t('journal.talk.listLabel')} bind:this={container}>
				{#each messages as m, i (m.seq)}
					<li class={m.role}>
						<span class="who">{m.role === 'partner' ? t('journal.talk.partner') : t('journal.talk.you')}</span>
						{#if m.role === 'partner'}
							<p class="text" lang={studyLang} data-p={i}><span data-r="0">{m.text}</span></p>
						{:else}
							<ReviewText
								bind:this={marks[m.seq]}
								text={m.text}
								placed={corrections.placed.get(m.seq) ?? []}
								annotations={m.annotations}
								{openId}
								onopen={openCorrection}
								{studyLang}
							/>
						{/if}
					</li>
				{/each}
			</ol>

			{#if phone && sheetCorrections.length > 0}
				<Button variant="secondary" onclick={() => openCorrection(sheetCorrections[0].annotation.id)}>
					{t('journal.talk.openCorrections', { count: sheetCorrections.length })}
				</Button>
			{/if}

			{#if messages.length === 0}
				<div class="actions">
					<Button variant="primary" onclick={() => send()} disabled={!gate.enabled} aria-describedby={gate.hint ? 'turn-hint' : undefined}>
						{t('journal.talk.begin')}
					</Button>
				</div>
			{:else}
				<form class="composer" onsubmit={send}>
					<Field
						label={t('journal.talk.messageLabel')}
						bind:value={text}
						multiline
						lang={studyLang}
						bind:element={field}
						readonly={busy}
						aria-busy={busy}
						disabled={full && !busy}
						onkeydown={keydown}
					/>
					<div class="actions">
						<Button variant="primary" type="submit" disabled={!gate.enabled} aria-describedby={gate.hint ? 'turn-hint' : undefined}>
							{t('journal.talk.send')}
						</Button>
					</div>
				</form>
			{/if}
			{#if gate.hint}
				<p class="hint" id="turn-hint">
					{gate.hint}
					{#if gate.settingsLink}<a href="/settings?tab=ai">{t('journal.openAiSettings')}</a>{/if}
				</p>
			{/if}
			<div class="live" aria-live="polite">{live}</div>
			{#if failure}
				<p class="error" role="alert">
					{failure.text}
					{#if failure.settingsLink}<a href="/settings?tab=ai">{t('journal.openAiSettings')}</a>{/if}
				</p>
			{/if}

			<div class="actions end">
				<Button variant="secondary" onclick={save} disabled={saving || busy || messages.length === 0}>
					{saving ? t('journal.talk.saving') : t('journal.talk.save')}
				</Button>
				{#if confirmingDiscard}
					<span role="group" aria-label={t('journal.talk.discardConfirm')} class="confirm">
						<span>{t('journal.talk.discardConfirm')}</span>
						<Button variant="secondary" tone="danger" onclick={discard}>{t('journal.talk.discardYes')}</Button>
						<Button variant="secondary" id="talk-keep" onclick={() => (confirmingDiscard = false)}>{t('journal.talk.keep')}</Button>
					</span>
				{:else}
					<Button variant="secondary" onclick={askDiscard} disabled={busy}>{t('journal.talk.discard')}</Button>
				{/if}
			</div>
			{#if actionError}<p class="error" role="alert">{actionError}</p>{/if}

			<PopupStackView {lookup} studyWorkspaceId={ws} />
		{/if}
	</div>

	{#if !phone && status === 'ready' && corrections.list.length > 0}
		<div class="margin-col">
			<JournalMargin mode="corrections" corrections={corrections.list} {openId} onopen={openCorrection} {studyLang} {explanationLang} />
		</div>
	{/if}
</div>

{#if phone && sheet}
	<CorrectionSheet
		mode="corrections"
		corrections={sheetCorrections}
		{openId}
		onopen={openCorrection}
		onclose={() => {
			sheet = false;
			openId = null;
		}}
		{studyLang}
		{explanationLang}
	/>
{/if}

<style>
	.conversation-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
		align-items: start;
	}
	.chat {
		display: grid;
		gap: var(--space-3);
		min-width: 0;
		max-width: 44rem;
	}
	h1 {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.meta,
	.hint {
		margin: 0;
		font-size: var(--font-size-label);
		color: var(--readable-muted);
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
		color: var(--readable-muted);
	}
	.messages {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: var(--space-3);
	}
	.messages li {
		display: grid;
		gap: var(--space-1);
		padding-inline-start: var(--space-3);
		box-shadow: inset 2px 0 0 var(--hair);
	}
	.messages li.learner {
		box-shadow: inset 2px 0 0 var(--accent);
	}
	.who {
		font-size: var(--font-size-label);
		font-weight: var(--weight-strong);
		color: var(--readable-muted);
	}
	.text {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.9;
		font-size: 1.1rem;
	}
	.composer {
		display: grid;
		gap: var(--space-2);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.confirm {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.error {
		margin: 0;
		color: var(--readable-bad);
	}
	.live {
		min-height: 1.4em;
		font-size: var(--font-size-label);
	}
	.margin-col {
		min-width: 0;
	}
	@media (min-width: 62.5rem) {
		.conversation-grid {
			grid-template-columns: minmax(0, 1fr) 16rem;
		}
		.margin-col {
			border-inline-start: 1px solid var(--hair);
			padding-inline-start: var(--space-3);
		}
	}
	@media (forced-colors: active) {
		.messages li,
		.messages li.learner {
			box-shadow: none;
			border-inline-start: 2px solid CanvasText;
		}
	}
</style>
