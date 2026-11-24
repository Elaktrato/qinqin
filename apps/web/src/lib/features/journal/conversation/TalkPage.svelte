<script lang="ts">
	// The conversation partner's start page (#185): what it sends and to whom,
	// the start form (an optional topic, from the journal's topic ideas or
	// typed, and a level) and the open conversations. Logic: talk.ts,
	// conversations.ts.
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { formatDate } from '$lib/i18n/format';
	import { errorText } from '$lib/api/apiErrors';
	import { Button, Field, Select } from '$lib/ui';
	import IdeasPanel from '../IdeasPanel.svelte';
	import type { AiGate } from '../editorLogic';
	import { entryTitle } from '../editorLogic';
	import { journalHref } from '../route';
	import { LEVELS, LIMITS, listConversations, startConversation } from './conversations';
	import { defaultLevel, levelLabel } from './talk';
	import type { ConversationSummary, Level } from './types';

	let {
		workspaceId,
		gate,
		studyLang,
		explanationLang = 'en'
	}: { workspaceId: number; gate: AiGate; studyLang: string; explanationLang?: string } = $props();

	let list = $state<ConversationSummary[] | null>(null);
	let listError = $state('');
	let topic = $state('');
	let level = $state<Level>('beginner');
	let starting = $state(false);
	let startError = $state('');

	const levelOptions = LEVELS.map((value) => ({ value, label: levelLabel(value) }));

	$effect(() => {
		const ws = workspaceId;
		listConversations(ws).then(
			(found) => {
				list = found;
				level = defaultLevel(found);
			},
			() => (listError = t('journal.talk.listFailed'))
		);
	});

	async function start(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (starting) return;
		starting = true;
		startError = '';
		try {
			const c = await startConversation(workspaceId, entryTitle(topic).trim(), level);
			await goto(journalHref({ view: 'conversation', id: c.id }));
		} catch (err) {
			startError = errorText(err, t('journal.talk.startFailed'));
		} finally {
			starting = false;
		}
	}
</script>

<div class="talk">
	<p class="back"><a href={journalHref({ view: 'list' })}>{t('journal.list.allEntries')}</a></p>
	<h1>{t('journal.talk.title')}</h1>
	<p class="intro">{t('journal.talk.intro')}</p>
	<p class="privacy">{t('journal.talk.privacy', { messages: LIMITS.contextMessages, words: LIMITS.wordSample })}</p>

	<form class="start" onsubmit={start} aria-labelledby="talk-start">
		<h2 id="talk-start">{t('journal.talk.startHeading')}</h2>
		<Field label={t('journal.talk.topic')} bind:value={topic} hint={t('journal.talk.topicHint')} maxlength={LIMITS.topicRunes} lang={studyLang} />
		<Select label={t('journal.talk.levelLabel')} bind:value={level} options={levelOptions} />
		<div class="actions">
			<Button variant="primary" type="submit" disabled={starting}>{starting ? t('journal.talk.starting') : t('journal.talk.start')}</Button>
		</div>
		{#if startError}<p class="error" role="alert">{startError}</p>{/if}
	</form>

	<section class="ideas" aria-labelledby="talk-ideas">
		<h2 id="talk-ideas" class="visually-hidden">{t('journal.talk.ideasHeading')}</h2>
		<IdeasPanel {workspaceId} {gate} onstart={(title) => (topic = entryTitle(title))} title={t('journal.talk.ideasHeading')} {studyLang} {explanationLang} />
	</section>

	<section aria-labelledby="talk-open">
		<h2 id="talk-open">{t('journal.talk.openHeading')}</h2>
		{#if listError}
			<p class="error" role="alert">{listError}</p>
		{:else if list === null}
			<p role="status">{t('common.loading')}</p>
		{:else if list.length === 0}
			<p class="hint">{t('journal.talk.none')}</p>
		{:else}
			<ul class="open">
				{#each list as c (c.id)}
					<li>
						<a href={journalHref({ view: 'conversation', id: c.id })}>
							<span class="topic" lang={c.topic ? studyLang : undefined}>{c.topic || t('journal.talk.untitled')}</span>
							<span class="meta"
								>{levelLabel(c.level)} · {t('journal.talk.messages', { count: c.messageCount })} · {formatDate(c.updatedAt)}</span
							>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.talk {
		display: grid;
		gap: var(--space-4);
		max-width: 44rem;
	}
	h1,
	h2 {
		margin: 0;
	}
	h2 {
		font-size: var(--font-size-l);
	}
	.intro,
	.privacy,
	.hint {
		margin: 0;
	}
	.privacy,
	.hint,
	.meta {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: var(--hit);
		color: var(--readable-muted);
	}
	.start {
		display: grid;
		gap: var(--space-3);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
	}
	.error {
		margin: 0;
		color: var(--readable-bad);
	}
	.open {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
	}
	.open li + li a {
		border-top: 1px solid var(--hair);
	}
	.open a {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2);
		min-height: var(--hit);
		color: var(--text);
		text-decoration: none;
		border-radius: var(--radius);
	}
	.open a:hover {
		background: var(--raised);
	}
	.open a:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.topic {
		overflow-wrap: anywhere;
	}
</style>
