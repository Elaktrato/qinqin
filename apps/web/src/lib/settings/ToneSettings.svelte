<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import {
		TONE_SETTINGS_MEMBERS,
		hasToneSettings,
		readToneSettings,
		toneSettingPatch,
		type ToneSettingMember
	} from '$lib/exercises/toneSettings';
	import Section from '$lib/ui/Section.svelte';

	// Settings > Study > Tones (#300, #180): Show tone sandhi (on by default) and Grade spoken tones (off by
	// default), for a workspace whose language has tones. Stored in the workspace's settings (synced, part of a
	// backup); the rules are lib/exercises/toneSettings.ts and docs/contracts/tones/. The notes name characters,
	// never pinyin (hidden romanisation, #284).
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const settings = $derived(readToneSettings(workspace?.settings));
	let pending = $state<Partial<Record<ToneSettingMember, boolean>>>({});
	let error = $state('');

	const LABELS: Record<ToneSettingMember, string> = {
		showSandhi: t('settings.tones.showSandhi'),
		gradeSpoken: t('settings.tones.gradeSpoken')
	};
	const NOTES: Record<ToneSettingMember, string> = {
		showSandhi: t('settings.tones.showSandhiNote'),
		gradeSpoken: t('settings.tones.gradeSpokenNote')
	};

	async function change(member: ToneSettingMember, on: boolean): Promise<void> {
		if (!workspace) return;
		error = '';
		pending = { ...pending, [member]: on };
		try {
			await session.workspaces.setSettings(workspace.id, toneSettingPatch(member, on));
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			pending = { ...pending, [member]: undefined };
		}
	}
</script>

{#if workspace && hasToneSettings(workspace.language)}
	<Section title={t('settings.tones.title')} level={4}>
		<p class="note">{t('settings.tones.intro')}</p>
		{#each TONE_SETTINGS_MEMBERS as member (member)}
			<div class="switch" data-tone-setting={member}>
				<label>
					<input
						type="checkbox"
						checked={pending[member] ?? settings[member]}
						onchange={(e) => change(member, e.currentTarget.checked)}
					/>
					{LABELS[member]}
				</label>
				<p class="note">{NOTES[member]}</p>
			</div>
		{/each}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	.switch {
		margin-bottom: var(--space-2);
	}
	label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		font-weight: var(--weight-strong);
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
