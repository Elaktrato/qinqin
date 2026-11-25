<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { GRADE_HAPTICS_KEY, hapticsAvailable, readGradeHaptics } from '$lib/native/haptics';
	import { useSession } from '$lib/context/context';
	import Section from '$lib/ui/Section.svelte';

	// Settings > Study: the grading buzz. Only offered where it can happen (the Android app, a phone browser).
	const session = useSession();
	const available = hapticsAvailable();
	const workspace = $derived(session.workspaces.current);
	const current = $derived(readGradeHaptics(workspace?.settings));
	let pending = $state<boolean | null>(null);
	let error = $state('');

	async function change(value: boolean): Promise<void> {
		if (!workspace) return;
		error = '';
		pending = value;
		try {
			await session.workspaces.setSettings(workspace.id, { [GRADE_HAPTICS_KEY]: value });
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			pending = null;
		}
	}
</script>

{#if available && workspace}
	<Section title={t('settings.feedback.title')} level={4}>
		<label>
			<input type="checkbox" checked={pending ?? current} onchange={(e) => change(e.currentTarget.checked)} />
			{t('settings.feedback.haptics')}
		</label>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
