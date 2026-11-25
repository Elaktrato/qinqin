<script lang="ts">
	// One practice round (recognise, recall, read or type): ten questions, feedback after each, a score at the end.
	// The round is built once from the progress at its start; each answer goes to `onanswer`, which records it.
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import PlayButton from '$lib/components/PlayButton.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Field from '$lib/ui/Field.svelte';
	import { isImeKey } from '$lib/ui/ime';
	import { keyboardNote, modeLabel, promptLabel, systemLabel } from './labels';
	import { buildRound } from './queue';
	import { advance, startRun, submit, type RunState } from './run';
	import { scriptsHref } from './route';
	import type { ItemState } from './progress';
	import type { Mode, Question, ScriptSystem } from './types';

	let {
		system,
		mode,
		progress,
		deviceVoice,
		onanswer
	}: {
		system: ScriptSystem;
		mode: Mode;
		progress: ReadonlyMap<string, ItemState>;
		deviceVoice: boolean;
		onanswer: (q: Question, ok: boolean) => void;
	} = $props();

	let run = $state.raw<RunState>(untrack(() => startRun(buildRound(system, mode, progress, Date.now(), Math.random))));
	let given = $state('');
	let typed = $state('');
	let showKey = $state(false);

	const q = $derived(run.done ? null : run.questions[run.index]);
	const back = $derived(scriptsHref({ view: 'overview', system: system.id }));

	function answer(text: string): void {
		const current = q;
		if (current === null || run.answered) return;
		given = text;
		run = submit(run, text);
		onanswer(current, run.ok === true);
	}

	function next(): void {
		run = advance(run);
		given = '';
		typed = '';
		showKey = false;
	}

	function again(): void {
		run = startRun(buildRound(system, mode, progress, Date.now(), Math.random));
		given = '';
		typed = '';
		showKey = false;
	}

	function onkeydown(e: KeyboardEvent): void {
		if (e.key !== 'Enter') return;
		// Enter that confirms an input-method candidate is not the answer.
		if (isImeKey(e)) return;
		e.preventDefault();
		if (run.answered) next();
		else if (typed.trim() !== '') answer(typed);
	}
</script>

<div class="run">
	<p class="meta">
		<span>{systemLabel(system.id)} · {modeLabel(mode)}</span>
		{#if q}<span>{t('scripts.run.progress', { n: run.index + 1, total: run.questions.length })}</span>{/if}
	</p>

	{#if run.questions.length === 0}
		<p>{t('scripts.run.empty')}</p>
		<Button href={back}>{t('scripts.run.back')}</Button>
	{:else if q === null}
		<h2>{t('scripts.run.done')}</h2>
		<p class="score" role="status">{t('scripts.run.score', { right: run.right, total: run.questions.length })}</p>
		<div class="actions">
			<Button variant="primary" onclick={again}>{t('scripts.run.again')}</Button>
			<Button href={back}>{t('scripts.run.back')}</Button>
		</div>
	{:else}
		<p class="ask">{promptLabel(mode)}</p>
		<div class="prompt">
			<span class="shown" lang={q.mode === 'recognise' || q.mode === 'read' ? system.language : undefined}>{q.prompt}</span>
			{#if q.speak !== null}
				<PlayButton clips={[]} speakText={q.speak} lang={system.language} {deviceVoice} label={q.prompt} />
			{/if}
		</div>

		{#if q.mode === 'type'}
			<p class="hint">{keyboardNote(system.id)}</p>
			<Field label={t('scripts.run.typeLabel')} bind:value={typed} disabled={run.answered} lang={system.language} autocomplete="off" autocapitalize="off" spellcheck={false} {onkeydown} />
			{#if q.key}
				{#if showKey}
					<p class="hint">{t('scripts.run.keyHint', { key: q.key })}</p>
				{:else}
					<Button variant="plain" onclick={() => (showKey = true)}>{t('scripts.run.showKey')}</Button>
				{/if}
			{/if}
			{#if !run.answered}
				<Button variant="primary" disabled={typed.trim() === ''} onclick={() => answer(typed)}>{t('scripts.run.check')}</Button>
			{/if}
		{:else}
			<ul class="options">
				{#each q.options as option (option)}
					<li>
						<button
							type="button"
							class="option"
							class:right={run.answered && q.accepts.includes(option)}
							class:wrong={run.answered && option === given && !q.accepts.includes(option)}
							disabled={run.answered}
							lang={q.mode === 'recall' ? system.language : undefined}
							onclick={() => answer(option)}>{option}</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if run.answered}
			<p class="feedback" class:good={run.ok} role="status">
				{run.ok ? t('scripts.run.right') : t('scripts.run.wrong', { answer: q.answer })}
				{#if q.gloss}<span class="gloss">{t('scripts.run.gloss', { gloss: q.gloss })}</span>{/if}
			</p>
			<div class="actions">
				<Button variant="primary" onclick={next}>{run.index + 1 >= run.questions.length ? t('scripts.run.finish') : t('scripts.run.next')}</Button>
			</div>
		{/if}
		<p class="quit"><Button variant="plain" href={back}>{t('scripts.run.quit')}</Button></p>
	{/if}
</div>

<style>
	.run {
		display: grid;
		gap: var(--space-3);
		max-width: 32rem;
	}

	.meta {
		display: flex;
		justify-content: space-between;
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}

	.ask,
	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.prompt {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.shown {
		font-size: var(--font-size-xxl);
	}

	.options {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.option {
		width: 100%;
		min-height: var(--hit);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		background: transparent;
		color: inherit;
		font-size: var(--font-size-l);
		cursor: pointer;
	}

	.option.right {
		background: var(--primary-wash);
		border-color: var(--good);
	}

	.option.wrong {
		border-color: var(--bad);
		text-decoration: line-through;
	}

	.option:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}

	.feedback {
		margin: 0;
		font-weight: var(--weight-medium);
		color: var(--readable-bad);
	}

	.feedback.good {
		color: var(--text);
	}

	.gloss {
		display: block;
		font-weight: var(--weight-regular);
		color: var(--readable-muted);
	}

	.actions {
		display: flex;
		gap: var(--space-3);
	}

	.quit {
		margin: 0;
	}

	.score {
		font-size: var(--font-size-l);
		margin: 0;
	}
</style>
