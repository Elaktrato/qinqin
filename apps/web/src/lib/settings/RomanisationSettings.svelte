<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import {
		ROMANISATION_MODES,
		readRomanisation,
		romanisationPatch,
		romanisationsOf,
		type RomanisationMode,
		type RomanisationType
	} from '$lib/languages/romanisation';
	import Section from '$lib/ui/Section.svelte';

	// Settings > Study > Romanisation (#284): Show pinyin / bopomofo (Chinese), Show romaji (Japanese): Always or
	// Never, only the switches of the workspace's language. Stored in the workspace's settings (synced, part of a
	// backup); the one rule is lib/languages/romanisation.ts.
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const types = $derived(romanisationsOf(workspace?.language ?? ''));
	const prefs = $derived(readRomanisation(workspace?.settings));
	let pending = $state<Partial<Record<RomanisationType, RomanisationMode>>>({});
	let error = $state('');

	const LABELS: Record<RomanisationType, string> = {
		pinyin: t('settings.romanisation.pinyin'),
		bopomofo: t('settings.romanisation.bopomofo'),
		romaji: t('settings.romanisation.romaji')
	};
	const MODE_LABELS: Record<RomanisationMode, string> = {
		always: t('settings.romanisation.always'),
		never: t('settings.romanisation.never')
	};
	const NOTES: Partial<Record<RomanisationType, string>> = {
		pinyin: t('settings.romanisation.pinyinNote'),
		romaji: t('settings.romanisation.romajiNote')
	};

	async function change(type: RomanisationType, mode: RomanisationMode): Promise<void> {
		if (!workspace) return;
		error = '';
		pending = { ...pending, [type]: mode };
		try {
			await session.workspaces.setSettings(workspace.id, romanisationPatch(type, mode));
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			pending = { ...pending, [type]: undefined };
		}
	}
</script>

{#if workspace && types.length > 0}
	<Section title={t('settings.romanisation.title')} level={4}>
		<p class="note">{t('settings.romanisation.intro')}</p>
		{#each types as type (type)}
			<fieldset class="type" data-romanisation={type}>
				<legend>{LABELS[type]}</legend>
				<div class="modes">
					{#each ROMANISATION_MODES as mode (mode)}
						<label>
							<input
								type="radio"
								name="romanisation-{type}"
								value={mode}
								checked={(pending[type] ?? prefs[type]) === mode}
								onchange={() => change(type, mode)}
							/>
							{MODE_LABELS[mode]}
						</label>
					{/each}
				</div>
				{#if NOTES[type]}<p class="note">{NOTES[type]}</p>{/if}
			</fieldset>
		{/each}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	.type {
		margin: 0 0 var(--space-2);
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		font-weight: var(--weight-strong);
	}
	.modes {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}
	label {
		display: flex;
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
