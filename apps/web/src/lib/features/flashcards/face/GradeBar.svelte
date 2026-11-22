<script lang="ts">
	// The grade bar (#101, design §9): four grades as coloured text over a
	// thin underline in their grade colour, each with the next interval the
	// same scheduler would give (`nextIntervals`); the suggested one has the
	// full-strength line and a faint wash of its colour. Text in the
	// readable grade tokens (a grade colour below 4.5:1 reads in --text),
	// lines in the raw grade colour. A re-show (intervals null) is practice.
	//
	// Back (#131): `chosen` is the grade the card got; the buttons become
	// toggles (aria-pressed) and the chosen one says "your grade".
	//
	// API: <GradeBar intervals suggested chosen? busy ongrade bind:buttons />
	import { t } from '$lib/i18n';
	import { longInterval, shortInterval } from '$lib/study/intervalText';
	import type { ReviewGrade } from '$lib/study/types';

	type Source = 'click' | 'activation';

	let {
		intervals,
		suggested,
		chosen = null,
		busy,
		ongrade,
		buttons = $bindable([])
	}: {
		intervals: Record<ReviewGrade, number> | null;
		suggested: ReviewGrade | null;
		chosen?: ReviewGrade | null;
		busy: boolean;
		ongrade: (grade: ReviewGrade, source: Source) => void;
		buttons?: (HTMLButtonElement | null)[];
	} = $props();

	const GRADES: { grade: ReviewGrade; key: string; label: string }[] = [
		{ grade: 1, key: 'again', label: t('study.grade.again') },
		{ grade: 2, key: 'hard', label: t('study.grade.hard') },
		{ grade: 3, key: 'good', label: t('study.grade.good') },
		{ grade: 4, key: 'easy', label: t('study.grade.easy') }
	];

	function nameOf(grade: ReviewGrade, label: string): string {
		const isSuggested = suggested === grade;
		if (intervals === null) {
			return isSuggested
				? t('study.session.gradePracticeSuggested', { grade: label, key: grade })
				: t('study.session.gradePractice', { grade: label, key: grade });
		}
		const when = longInterval(intervals[grade]);
		return isSuggested
			? t('study.session.gradeNextSuggested', { grade: label, when, key: grade })
			: t('study.session.gradeNext', { grade: label, when, key: grade });
	}
</script>

<div class="grades" role="group" aria-label={t('study.session.grades')} aria-busy={busy ? 'true' : undefined}>
	{#each GRADES as option (option.grade)}
		<button
			type="button"
			class="gb {option.key}"
			class:sugg={suggested === option.grade}
			class:mine={chosen === option.grade}
			aria-pressed={chosen === null ? undefined : chosen === option.grade ? 'true' : 'false'}
			data-suggested={suggested === option.grade ? '' : undefined}
			bind:this={buttons[option.grade - 1]}
			disabled={busy}
			aria-label={nameOf(option.grade, option.label)}
			onclick={(event) =>
				// detail 0: activated from the keyboard, not a pointer.
				ongrade(option.grade, event.detail === 0 ? 'activation' : 'click')}
		>
			<span class="name">{option.label}</span>
			<span class="when"
				>{intervals === null ? t('study.session.practice') : shortInterval(intervals[option.grade])}</span
			>
			{#if chosen === option.grade}<span class="yours">{t('study.session.regrade.yourGrade')}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.grades {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-2);
	}
	.gb {
		display: grid;
		justify-items: center;
		gap: 1px;
		min-width: 0;
		padding: var(--space-2) var(--space-1) 0.5625rem;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--line-colour) 35%, transparent);
		color: var(--text-colour);
		font: inherit;
		font-size: var(--font-size-s);
		font-weight: var(--weight-strong);
		line-height: var(--line-tight);
		cursor: pointer;
		transition: background-color var(--motion-fast) var(--ease-standard);
	}
	.again {
		--line-colour: var(--grade-again);
		--text-colour: var(--readable-grade-again);
	}
	.hard {
		--line-colour: var(--grade-hard);
		--text-colour: var(--readable-grade-hard);
	}
	.good {
		--line-colour: var(--grade-good);
		--text-colour: var(--readable-grade-good);
	}
	.easy {
		--line-colour: var(--grade-easy);
		--text-colour: var(--readable-grade-easy);
	}
	.gb.sugg {
		box-shadow: inset 0 -2px 0 var(--line-colour);
		background: color-mix(in srgb, var(--line-colour) 10%, transparent);
	}
	.gb.mine .name {
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 0.2em;
	}
	.yours {
		color: var(--readable-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-regular);
	}
	.gb:hover:not(:disabled) .name {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.gb:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-ring-offset);
	}
	.gb:disabled {
		cursor: progress;
	}
	.name {
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.when {
		color: var(--readable-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-regular);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.gb {
			min-height: var(--hit);
		}
	}
	@media (forced-colors: active) {
		.gb {
			box-shadow: none;
			border-bottom: 2px solid ButtonText;
		}
		.gb.sugg {
			border-bottom: 3px solid Highlight;
		}
	}
</style>
