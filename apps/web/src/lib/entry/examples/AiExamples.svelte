<script lang="ts">
	// AI example sentences on the entry page (#186): offered while the word has
	// few examples (or drafts wait). The learner picks a level and generates
	// with their own AI key; the drafts show with Keep, Delete and Report. A kept
	// one joins the entry's examples (onkept). Logic: examples.ts; routes:
	// $lib/api/examples.ts; contract: docs/contracts/examples/.
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { Button, Select } from '$lib/ui';
	import { studyLang, readingLang, glossLang } from '$lib/i18n/lang';
	import { getAiStatus } from '$lib/api/ai';
	import {
		discardExample,
		EXAMPLE_LEVELS,
		generateExamples,
		getExamples,
		keepExample,
		type ExampleDraft,
		type ExampleLevel,
		type ExamplesView,
		type ReportReason
	} from '$lib/api/examples';
	import type { Sentence } from '$lib/api/types';
	import { useSession } from '$lib/context/context';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { loadProviderNames } from '$lib/features/journal/providerNames';
	import { newUlid } from '$lib/events/ulid';
	import ExampleActions from './ExampleActions.svelte';
	import { aiLabel, generatedText, generateErrorText, levelLabel, needsExamples, runGenerate } from './examples';

	let {
		entry,
		onkept
	}: {
		entry: { id: number; language: string; sentences: Sentence[] };
		onkept: (sentence: Sentence) => void;
	} = $props();

	const session = useSession();

	let view = $state<ExamplesView | null>(null);
	let available = $state<boolean | null>(null);
	let names = $state<ReadonlyMap<string, string>>(new Map());
	let level = $state<ExampleLevel>('beginner');
	let levelPicked = $state(false);
	let busy = $state(false);
	let status = $state('');
	let error = $state('');
	// One request id per generation until it is answered: a retry after a lost
	// answer at the same level is free; another level is another request.
	let pendingRequest: { id: string; level: ExampleLevel } | null = null;
	// Stops a running poll or in_flight backoff when the panel goes away.
	const stop = new AbortController();
	$effect(() => () => stop.abort());

	const levelOptions = EXAMPLE_LEVELS.map((value) => ({ value, label: levelLabel(value) }));
	const drafts = $derived(view?.drafts ?? []);
	const shown = $derived(view !== null && needsExamples(entry.sentences, drafts));

	// The drafts load once per entry: a new entry object of the same word (the
	// page adding a kept sentence) must not reset them or the status.
	const entryId = $derived(entry.id);
	$effect(() => {
		const id = entryId;
		view = null;
		status = '';
		error = '';
		pendingRequest = null;
		getExamples(id).then(
			(v) => {
				if (id !== entryId) return;
				view = v;
				if (!levelPicked) level = v.defaultLevel;
			},
			() => {
				// Offline or an old server: the panel stays hidden.
			}
		);
	});

	$effect(() => {
		getAiStatus().then(
			(s) => (available = s.available),
			() => (available = false)
		);
		void loadProviderNames(session.caches.providerNames).then((m) => (names = m));
	});

	async function generate(): Promise<void> {
		if (busy || available !== true) return;
		busy = true;
		error = '';
		status = t('entry.examples.writing');
		const id = entryId;
		if (pendingRequest?.level !== level) pendingRequest = { id: newUlid(), level };
		const requestId = pendingRequest.id;
		const r = await runGenerate(
			{
				send: (lvl, req) => generateExamples(id, lvl, req),
				reload: () => getExamples(id).catch(() => null)
			},
			level,
			requestId,
			{ onWaiting: () => (status = t('entry.examples.stillWaiting')), signal: stop.signal }
		);
		busy = false;
		if (id !== entryId) return;
		if (r.generated) {
			pendingRequest = null;
			const g = r.generated;
			view = { drafts: g.drafts, defaultLevel: level, lastRequest: { requestId: g.requestId, dropped: g.dropped, provider: g.provider, model: g.model } };
			status = generatedText(r.generated);
		} else {
			status = '';
			error = generateErrorText(r.error);
		}
	}

	/** dropDraft removes a decided draft and moves the focus to the next one's first button, else the heading. */
	async function dropDraft(draft: ExampleDraft): Promise<void> {
		if (!view) return;
		const index = view.drafts.findIndex((d) => d.id === draft.id);
		view = { ...view, drafts: view.drafts.filter((d) => d.id !== draft.id) };
		await tick();
		const left = view?.drafts ?? [];
		const next = left[Math.min(Math.max(index, 0), left.length - 1)];
		const button = next ? document.querySelector<HTMLElement>(`[aria-describedby="ai-draft-${next.id}"]`) : null;
		(button ?? document.getElementById('ai-examples-heading') ?? document.getElementById('sentences-heading'))?.focus();
	}

	async function keep(draft: ExampleDraft): Promise<void> {
		error = '';
		try {
			const sentence = await keepExample(entry.id, draft.id);
			onkept(sentence);
			await dropDraft(draft);
			status = t('entry.examples.kept');
		} catch (err) {
			error = generateErrorText(err);
		}
	}

	async function remove(draft: ExampleDraft, reason?: ReportReason): Promise<void> {
		error = '';
		try {
			await discardExample(entry.id, draft.id, reason);
			await dropDraft(draft);
			status = reason ? t('entry.examples.reported') : t('entry.examples.deleted');
		} catch (err) {
			error = generateErrorText(err);
		}
	}
	const roman = useRomanisation();
</script>

{#if shown}
	<section class="ai-examples" aria-labelledby="ai-examples-heading">
		<h2 id="ai-examples-heading" tabindex="-1">{t('entry.examples.heading')}</h2>
		{#if drafts.length === 0}<p class="intro">{t('entry.examples.intro')}</p>{/if}
		{#if available === false}
			<p class="hint">{t('entry.examples.noKey')} <a href="/settings?tab=ai">{t('entry.examples.settingsLink')}</a></p>
		{:else}
			<div class="generate">
				<Select label={t('entry.examples.level')} bind:value={level} options={levelOptions} onchange={() => (levelPicked = true)} />
				<Button variant={drafts.length === 0 ? 'primary' : 'secondary'} aria-disabled={busy || available === null} onclick={generate}
					>{drafts.length === 0 ? t('entry.examples.generate') : t('entry.examples.generateAgain')}</Button
				>
			</div>
			<p class="note">{drafts.length > 0 ? `${t('entry.examples.replaceNote')} ` : ''}{t('entry.examples.sent')}</p>
		{/if}
		<p class="status" role="status" aria-live="polite">{status}</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if drafts.length > 0}
			<h3>{t('entry.examples.drafts')}</h3>
			<ul>
				{#each drafts as draft (draft.id)}
					<li class="draft">
						<p class="hanzi" id={`ai-draft-${draft.id}`} lang={studyLang(entry.language)}>{draft.hanzi}</p>
						{#if draft.pinyin && roman.showsText(draft.pinyin, entry.language)}<p class="pinyin" lang={readingLang('pinyin', entry.language)}>{draft.pinyin}</p>{/if}
						<p class="translation" lang={glossLang(undefined)}>{draft.translation}</p>
						<span class="origin">{aiLabel({ provider: draft.provider, model: draft.model }, names)}</span>
						<ExampleActions describedBy={`ai-draft-${draft.id}`} onkeep={() => keep(draft)} onremove={(reason) => remove(draft, reason)} />
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.ai-examples {
		display: grid;
		gap: var(--space-2);
	}

	.ai-examples h2,
	.ai-examples h3,
	.ai-examples p,
	.ai-examples ul {
		margin: 0;
	}

	.ai-examples h2,
	.ai-examples h3 {
		font-size: var(--font-size-label);
		font-weight: var(--weight-medium);
		color: var(--readable-muted);
	}

	.generate {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: end;
	}

	.intro,
	.note,
	.hint,
	.status {
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
	}

	ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: var(--space-3);
	}

	.draft {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-2);
		border: 1px dashed var(--line);
		border-radius: var(--radius);
	}

	.hanzi {
		font-size: 1.125rem;
		overflow-wrap: anywhere;
	}

	.pinyin,
	.translation {
		font-size: 0.9rem;
		color: var(--readable-muted);
	}

	.origin {
		font-size: 0.7rem;
		color: var(--readable-muted);
	}
</style>
