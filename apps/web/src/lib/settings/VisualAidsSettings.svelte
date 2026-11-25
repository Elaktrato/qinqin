<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { readingLang, studyLang } from '$lib/i18n/lang';
	import ToneText from '$lib/aids/ToneText.svelte';
	import { AID_KEYS, readVisualAids, visualAidPatch, type AidKey } from '$lib/aids/visualAids';
	import Section from '$lib/ui/Section.svelte';

	// Settings > Study > Visual aids (#212): one switch per aid, with a preview. Stored in the workspace's
	// settings (synced and part of a backup); the rules are in lib/aids/visualAids.ts.
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const aids = $derived(readVisualAids(workspace?.settings));
	let pending = $state<Partial<Record<AidKey, boolean>>>({});
	let error = $state('');

	const LABELS: Record<AidKey, string> = {
		pictures: t('settings.aids.pictures'),
		toneColors: t('settings.aids.toneColors'),
		anatomy: t('settings.aids.anatomy')
	};
	const NOTES: Record<AidKey, string> = {
		pictures: t('settings.aids.picturesNote'),
		toneColors: t('settings.aids.toneColorsNote'),
		anatomy: t('settings.aids.anatomyNote')
	};

	async function change(key: AidKey, on: boolean): Promise<void> {
		if (!workspace) return;
		error = '';
		pending = { ...pending, [key]: on };
		try {
			await session.workspaces.setSettings(workspace.id, visualAidPatch(key, on));
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			pending = { ...pending, [key]: undefined };
		}
	}
</script>

{#if workspace}
	<Section title={t('settings.aids.title')} level={4}>
		<p class="note">{t('settings.aids.intro')}</p>
		{#each AID_KEYS as key (key)}
			<div class="aid" data-aid={key}>
				<label>
					<input type="checkbox" checked={pending[key] ?? aids[key]} onchange={(e) => change(key, e.currentTarget.checked)} />
					{LABELS[key]}
				</label>
				<p class="note">{NOTES[key]}</p>
				{#if key === 'toneColors'}
					<p class="preview" role="group" data-testid="tone-preview" aria-label={t('settings.aids.preview')}>
						<span lang={readingLang('pinyin', 'zh')}><ToneText force value="mā má mǎ mà ma" /></span>
					</p>
				{:else if key === 'anatomy'}
					<p class="preview" role="group" data-testid="anatomy-preview" aria-label={t('settings.aids.preview')}>
						<span lang={studyLang('zh')} class="glyph">明</span>
						<span aria-hidden="true">=</span>
						<span lang={studyLang('zh')} class="glyph">日</span> {t('settings.aids.anatomySun')}
						<span aria-hidden="true">+</span>
						<span lang={studyLang('zh')} class="glyph">月</span> {t('settings.aids.anatomyMoon')}
					</p>
				{/if}
			</div>
		{/each}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	.aid {
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
	.preview {
		margin: var(--space-1) 0 0;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--hair);
		border-radius: var(--radius);
		font-size: 1.25rem;
	}
	.glyph {
		font-family: var(--font-hanzi);
		font-size: 1.5rem;
	}
	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
