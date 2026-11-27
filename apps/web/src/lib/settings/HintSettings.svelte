<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import {
		HINT_KINDS,
		HINT_MODES,
		hintApplies,
		hintPatch,
		readHintSettings,
		type HintKind,
		type HintMode
	} from '$lib/features/flashcards/face/hints';
	import { CARD_KINDS, type StudyCardKind } from '$lib/studycore/types';
	import Section from '$lib/ui/Section.svelte';
	import Select from '$lib/ui/Select.svelte';

	// Settings > Study: which hints a flashcard may offer, per hint kind and card type (#215). Stored in the
	// workspace's settings (synced and part of a backup); the rules are in lib/features/flashcards/face/hints.ts.
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const settings = $derived(readHintSettings(workspace?.settings));
	let error = $state('');

	const KIND_LABELS: Record<HintKind, string> = {
		reading: t('settings.hints.kind.reading'),
		picture: t('settings.hints.kind.picture')
	};
	const KIND_NOTES: Record<HintKind, string> = {
		reading: t('settings.hints.kind.readingNote'),
		picture: t('settings.hints.kind.pictureNote')
	};
	const MODE_LABELS: Record<HintMode, string> = {
		always: t('settings.hints.mode.always'),
		hint: t('settings.hints.mode.hint'),
		never: t('settings.hints.mode.never')
	};
	const CARD_LABELS: Record<StudyCardKind, string> = {
		vocab: t('study.session.kind.vocab'),
		sentence: t('study.session.kind.sentence'),
		writing: t('study.session.kind.writing'),
		tone: t('study.session.kind.tone'),
		reverse: t('study.session.kind.reverse'),
		cloze: t('study.session.kind.cloze')
	};
	const MODE_OPTIONS = HINT_MODES.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }));

	async function change(kind: HintKind, card: StudyCardKind, value: string): Promise<void> {
		if (!workspace) return;
		const mode = HINT_MODES.find((m) => m === value);
		if (mode === undefined || mode === settings[kind][card]) return;
		error = '';
		try {
			await session.workspaces.setSettings(workspace.id, hintPatch(kind, card, mode));
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		}
	}
</script>

{#if workspace}
	<Section title={t('settings.hints.title')} level={4}>
		<p class="note">{t('settings.hints.intro')}</p>
		{#each HINT_KINDS as kind (kind)}
			<fieldset data-hint-kind={kind}>
				<legend>{KIND_LABELS[kind]}</legend>
				<p class="note">{KIND_NOTES[kind]}</p>
				<ul>
					{#each CARD_KINDS as card (card)}
						<li>
							<span class="card">{CARD_LABELS[card]}</span>
							{#if hintApplies(kind, card)}
								<Select
									label={t('settings.hints.rowLabel', { kind: KIND_LABELS[kind], card: CARD_LABELS[card] })}
									hideLabel
									value={settings[kind][card]}
									options={MODE_OPTIONS}
									onchange={(e) => change(kind, card, e.currentTarget.value)}
								/>
							{:else}
								<span class="note">{t('settings.hints.notOffered')}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</fieldset>
		{/each}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	fieldset {
		margin: 0 0 var(--space-3);
		padding: 0;
		border: 0;
	}
	legend {
		font-weight: var(--weight-strong);
		padding: 0;
	}
	ul {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: minmax(7rem, 1fr) minmax(10rem, 2fr);
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}
	.note {
		margin: 0;
		color: var(--readable-muted);
		font-size: var(--font-size-s);
	}
	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
