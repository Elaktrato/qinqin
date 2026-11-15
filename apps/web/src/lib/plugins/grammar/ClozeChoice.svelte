<script lang="ts">
	import { choiceForKeyEvent } from './clozeKeys';

	interface Props {
		before: string;
		after: string;
		choices: string[];
		answer: string;
		onResult: (r: { correct: boolean }) => void;
		language?: string;
	}

	let { before, after, choices, answer, onResult, language }: Props = $props();

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
		const index = choiceForKeyEvent(
			{
				key: event.key,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				isComposing: event.isComposing,
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

<div class="cloze">
	<p class="sentence" lang={language}>
		{before}<span class="gap" class:right={finished && correct} class:wrong={finished && !correct}
			>{finished ? answer : '＿＿'}</span
		>{after}
	</p>

	<ul class="choices" aria-label="Choices">
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
			Correct!
		{:else}
			Not quite. The answer is {answer}.
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
		display: inline-block;
		min-width: 2rem;
		margin: 0 0.15rem;
		border-bottom: 2px solid color-mix(in srgb, currentColor 50%, transparent);
		text-align: center;
	}

	.gap.right {
		color: #2e7d32;
		border-color: #2e7d32;
	}

	.gap.wrong {
		color: #c62828;
		border-color: #c62828;
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
		opacity: 0.6;
	}

	.choice:hover:not(:disabled) {
		border-color: #0b6bcb;
	}

	.choice:focus-visible {
		outline: 2px solid #0b6bcb;
		outline-offset: 2px;
	}

	.choice:disabled {
		cursor: default;
	}

	.choice.right {
		border-color: #2e7d32;
		background: color-mix(in srgb, #2e7d32 14%, transparent);
	}

	.choice.wrong {
		border-color: #c62828;
		background: color-mix(in srgb, #c62828 14%, transparent);
	}

	.feedback {
		min-height: 1.4rem;
		margin: 0;
		font-weight: 600;
		color: #2e7d32;
	}

	.feedback.bad {
		color: #c62828;
	}
</style>
