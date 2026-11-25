<script lang="ts">
	import { isImeKey } from '$lib/ui/ime';
	import type { ClozePart } from '$lib/study/cloze';
	import { t } from '$lib/i18n';
	import { choiceForKeyEvent } from '$lib/components/clozeKeys';

	interface Props {
		/** A plain string, or parts where `{ gap: true }` is an extra gap. */
		before: string | ClozePart[];
		after: string | ClozePart[];
		choices: string[];
		answer: string;
		onResult: (r: { correct: boolean }) => void;
		language?: string;
		/** The visually hidden text inside each gap. */
		gapLabel?: string;
	}

	let { before, after, choices, answer, onResult, language, gapLabel = 'blank' }: Props = $props();

	const beforeParts = $derived(typeof before === 'string' ? [before] : before);
	const afterParts = $derived(typeof after === 'string' ? [after] : after);

	// The picked choice, or null while the question is open. Choosing
	// finishes the question; a wrong pick is marked and the answer revealed.
	let picked = $state<string | null>(null);

	const finished = $derived(picked !== null);
	const correct = $derived(picked === answer);

	function pick(choice: string): void {
		if (finished) return;
		picked = choice;
		onResult({ correct: choice === answer });
	}

	function onKeydown(event: KeyboardEvent): void {
		// Once answered the digits belong to whoever grades (the session runner).
		if (finished) return;
		const index = choiceForKeyEvent(
			{
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				isComposing: isImeKey(event),
				target: event.target instanceof HTMLElement ? event.target : null
			},
			choices.length
		);
		if (index === null) return;
		event.preventDefault();
		pick(choices[index]);
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet gap(surface: string | undefined)}
	<span class="gap extra" class:right={finished && correct} class:wrong={finished && !correct}
		><span class="sr-only">{gapLabel}</span>{finished ? (surface ?? answer) : '＿＿'}</span
	>
{/snippet}

<div class="cloze">
	<p class="sentence" lang={language}>
		{#each beforeParts as part, i (i)}{#if typeof part === 'string'}{part}{:else}{@render gap(part.answer)}{/if}{/each}<span
			class="gap"
			class:right={finished && correct}
			class:wrong={finished && !correct}
			><span class="sr-only">{gapLabel}</span>{finished ? answer : '＿＿'}</span
		>{#each afterParts as part, i (i)}{#if typeof part === 'string'}{part}{:else}{@render gap(part.answer)}{/if}{/each}
	</p>

	<ul class="choices" aria-label={t('entry.cloze.choices')}>
		{#each choices as choice, i (choice)}
			<li>
				<button
					type="button"
					class="choice"
					class:right={finished && choice === answer}
					class:wrong={choice === picked && choice !== answer}
					disabled={finished}
					aria-keyshortcuts={String(i + 1)}
					lang={language}
					onclick={() => pick(choice)}
				>
					<kbd aria-hidden="true">{i + 1}</kbd>
					{choice}
				</button>
			</li>
		{/each}
	</ul>

	<p class="feedback" class:bad={finished && !correct} role="status" aria-live="polite">
		{#if !finished}
			&nbsp;
		{:else if correct}
			{t('entry.cloze.correct')}
		{:else}
			{t('entry.cloze.wrong', { answer })}
		{/if}
	</p>
</div>

<style>
	.cloze {
		display: grid;
		gap: 1rem;
	}

	.sentence {
		margin: 0;
		font-size: 1.6rem;
	}

	.gap {
		position: relative;
		display: inline-block;
		min-width: 2rem;
		margin: 0 0.15rem;
		border-bottom: 2px solid color-mix(in srgb, currentColor 50%, transparent);
		text-align: center;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.gap.right {
		border-color: var(--good);
	}

	.gap.wrong {
		color: var(--readable-bad);
		border-color: var(--bad);
	}

	.choices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.choice {
		min-width: 44px;
		min-height: 44px;
		padding: 0.4rem 0.9rem;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: color-mix(in srgb, currentColor 6%, transparent);
		color: inherit;
		font: inherit;
		font-size: 1.25rem;
		cursor: pointer;
	}

	kbd {
		font-size: 0.75rem;
		color: var(--readable-muted);
	}

	.choice:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.choice:focus-visible {
		outline: 2px solid var(--focus-colour);
		outline-offset: 2px;
	}

	.choice:disabled {
		cursor: default;
	}

	.choice.right {
		border-color: var(--good);
		background: color-mix(in srgb, var(--good) 14%, transparent);
	}

	.choice.wrong {
		border-color: var(--bad);
		background: color-mix(in srgb, var(--bad) 14%, transparent);
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0;
		font-weight: 600;
		color: var(--text);
	}

	.feedback.bad {
		color: var(--readable-bad);
	}
</style>
