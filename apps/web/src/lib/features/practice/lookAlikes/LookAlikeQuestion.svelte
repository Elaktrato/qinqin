<script lang="ts">
	// One question of the look-alike drill (#228; docs/contracts/lookalikes/): `recognise` shows a member large and asks
	// its meaning among the set's; `choose` shows the member's example word with a gap and asks the character. The
	// member asked is random; the mode takes turns with the set's answers. The characters are set in the learner's
	// hanzi face for the workspace's script (`lang`), large and at a regular weight, so look-alikes stay apart on a
	// phone. Readings only through the romanisation settings (#284); kana readings of kanji always. After the answer every
	// member is shown with its readings, meaning, example, note and highlighted strokes.
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { Button } from '$lib/ui';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import type { DrillQuestionProps } from '../types';
	import type { LookAlikeItemData } from './items';
	import { meaningOf, soundsOf } from './labels';
	import { answerOf, gapPrompt, modeFor } from './sets';
	import LookAlikeAnswer from './LookAlikeAnswer.svelte';

	let { item, answered, onAnswer }: DrillQuestionProps = $props();

	const roman = useRomanisation();
	const data = $derived(item.data as LookAlikeItemData);
	const set = $derived(data.set);
	const lang = $derived(studyLang(data.language));
	const mode = $derived(modeFor(data.answers));
	// A new item draws its member (the component is not remounted between items).
	const asked = $derived.by(() => {
		void item.key;
		const members = (item.data as LookAlikeItemData).set.members;
		return members[Math.min(members.length - 1, Math.floor(Math.random() * members.length))];
	});
	const prompt = $derived(gapPrompt(data.file, asked, data.language));

	let given = $state('');
	$effect(() => {
		void item.key;
		given = '';
	});

	function pick(member: string): void {
		if (answered || given !== '') return;
		const answer = answerOf(set.key, mode, asked, member);
		if (answer === null) return;
		given = member;
		onAnswer({ mode, grade: answer.grade, extra: { asked, given: member } });
	}

	const variant = (member: string): 'primary' | 'secondary' => (answered && member === asked ? 'primary' : 'secondary');
</script>

{#if mode === 'recognise'}
	<p class="ask">{t('practice.lookAlikes.recogniseAsk')}</p>
	<p class="shown" {lang}>{asked}</p>
	<div class="choices meanings" role="group" aria-label={t('practice.lookAlikes.meaningsLabel')}>
		{#each set.members as member (member)}
			{@const c = data.file.characters[member]}
			<Button variant={variant(member)} disabled={answered} aria-pressed={given === member} onclick={() => pick(member)}>
				<span class="meaning">
					{#if meaningOf(c)}<span>{meaningOf(c)}</span>{/if}
					{#each soundsOf(c, roman) as sound, i (i)}<span class="sound" lang={sound.lang}>{sound.text}</span>{/each}
				</span>
			</Button>
		{/each}
	</div>
{:else}
	<p class="ask">{t('practice.lookAlikes.chooseAsk')}</p>
	<p class="gap" {lang}>{prompt.gap}</p>
	<p class="gloss">{prompt.meaning}</p>
	<div class="choices glyphs" role="group" aria-label={t('practice.lookAlikes.charactersLabel')}>
		{#each set.members as member (member)}
			<Button variant={variant(member)} disabled={answered} aria-pressed={given === member} onclick={() => pick(member)}>
				<span class="choice" {lang}>{member}</span>
			</Button>
		{/each}
	</div>
{/if}

{#if answered && given !== ''}
	<p class="verdict" class:wrong={given !== asked} role="status">
		{#if given === asked}
			{t('practice.lookAlikes.right', { char: asked })}
		{:else}
			{t('practice.lookAlikes.wrong', { char: asked, given })}
		{/if}
	</p>
	<LookAlikeAnswer {set} file={data.file} language={data.language} {asked} {given} />
{/if}

<style>
	.ask,
	.gloss {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.gloss {
		color: var(--readable-muted);
	}
	/* The asked character: large, regular weight, no synthesised bold (a bold face closes 己's gap). */
	.shown,
	.gap,
	.choice {
		margin: 0;
		line-height: 1.1;
		font-weight: 400;
		font-synthesis: none;
	}
	.shown {
		font-size: clamp(4rem, 22vw, 6rem);
		text-align: center;
	}
	.gap {
		font-size: var(--font-size-xxl);
		overflow-wrap: anywhere;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.meanings {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.meaning {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
		justify-content: center;
		overflow-wrap: anywhere;
		text-align: center;
		white-space: normal;
	}
	.sound {
		color: inherit;
	}
	/* At least 56 px glyphs in the answer buttons (the teachers' floor for 己/已/巳 at phone size). */
	.choice {
		display: inline-block;
		min-inline-size: 1em;
		font-size: 3.5rem;
	}
	.verdict {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.verdict.wrong {
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
