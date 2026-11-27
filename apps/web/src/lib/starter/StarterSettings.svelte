<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import { readStarterSettings, starterPatch, starterProfile, type StarterSettings } from './starter';
	import Section from '$lib/ui/Section.svelte';
	import Select from '$lib/ui/Select.svelte';
	import StarterAdd from './StarterAdd.svelte';

	// Settings > Study: Starter mode (#214). On or off per workspace; whether it covers only the Starter words or every
	// vocabulary card; and the button that copies the Starter words into the learner's decks. A display rule only: the
	// cards, their history and their schedules are the same with it on or off.
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const settings = $derived(readStarterSettings(workspace?.settings));
	const supported = $derived(workspace !== null && workspace !== undefined && starterProfile(workspace.language) !== null);
	let error = $state('');

	const SCOPE_OPTIONS = [
		{ value: 'base', label: t('settings.starter.scope.base') },
		{ value: 'all', label: t('settings.starter.scope.all') }
	];

	async function change(patch: Partial<StarterSettings>): Promise<void> {
		if (!workspace) return;
		error = '';
		try {
			await session.workspaces.setSettings(workspace.id, starterPatch(patch));
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		}
	}
</script>

{#if workspace}
	<Section title={t('settings.starter.title')} level={4}>
		{#if !supported}
			<p class="note">{t('settings.starter.unsupported')}</p>
		{:else}
			<p class="note">{t('settings.starter.intro')}</p>
			<label>
				<input
					type="checkbox"
					data-testid="starter-enabled"
					checked={settings.enabled}
					onchange={(e) => change({ enabled: e.currentTarget.checked })}
				/>
				{t('settings.starter.enabled')}
			</label>
			<Select
				label={t('settings.starter.scope.label')}
				value={settings.scope}
				options={SCOPE_OPTIONS}
				disabled={!settings.enabled}
				hint={t('settings.starter.scope.hint')}
				onchange={(e) => change({ scope: e.currentTarget.value === 'all' ? 'all' : 'base' })}
			/>
			<p class="note">{t('settings.starter.words')}</p>
			<StarterAdd language={workspace.language} workspaceId={workspace.id} enableMode />
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		{/if}
	</Section>
{/if}

<style>
	label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}
	.note {
		margin: 0 0 var(--space-2);
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
