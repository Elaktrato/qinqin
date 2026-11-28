<script lang="ts">
	// The answer of a look-alike question (#228): every member of the set, drawn with the strokes that make the
	// difference highlighted, its readings (romanisation settings, #284), meaning, example word and note; the member
	// asked and the one chosen are marked in words.
	import { t } from '$lib/i18n';
	import { studyLang } from '$lib/i18n/lang';
	import { useRomanisation } from '$lib/languages/useRomanisation';
	import { exampleOf, meaningOf, soundsOf } from './labels';
	import type { LookAlikeSet, SetsFile } from './sets';
	import LookAlikeGlyph from './LookAlikeGlyph.svelte';

	let { set, file, language, asked, given }: { set: LookAlikeSet; file: SetsFile; language: string; asked: string; given: string } = $props();

	const roman = useRomanisation();
	const lang = $derived(studyLang(language));
</script>

<ul class="members" aria-label={t('practice.lookAlikes.membersLabel')}>
	{#each set.members as member (member)}
		{@const c = file.characters[member]}
		{@const example = exampleOf(c, language, roman)}
		<li class:asked={member === asked}>
			<LookAlikeGlyph char={member} {lang} strokeLang={file.language} count={c.kind === 'kana' ? undefined : c.strokes} marks={set.marks[member] ?? []} />
			<div class="about">
				<p class="head">
					{#each soundsOf(c, roman) as sound, i (i)}<span class="sound" lang={sound.lang}>{sound.text}</span>{/each}
					{#if meaningOf(c)}<span>{meaningOf(c)}</span>{/if}
					{#if member === asked}<span class="tag">{t('practice.lookAlikes.asked')}</span>{/if}
					{#if member === given && given !== asked}<span class="tag">{t('practice.lookAlikes.chosen')}</span>{/if}
				</p>
				<p class="note">{set.notes[member]}</p>
				<p class="example">
					<span lang={example.lang}>{example.word}</span>
					{#each example.sounds as sound, i (i)}<span class="sound" lang={sound.lang}>{sound.text}</span>{/each}
					<span>{example.meaning}</span>
				</p>
			</div>
		</li>
	{/each}
</ul>

<style>
	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--space-2);
	}
	li {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		min-width: 0;
		padding: var(--space-1);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
	}
	li.asked {
		border-color: var(--accent);
	}
	.about {
		display: grid;
		gap: var(--space-1);
		min-width: 0;
	}
	.about p {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
		overflow-wrap: anywhere;
	}
	.note,
	.example {
		color: var(--readable-muted);
	}
	.tag {
		font-size: var(--font-size-s);
		padding-inline: var(--space-1);
		border: 1px solid currentColor;
		border-radius: var(--radius);
	}
</style>
