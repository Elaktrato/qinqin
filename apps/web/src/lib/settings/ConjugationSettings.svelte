<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { useSession } from '$lib/context/context';
	import {
		CONJUGATION_FAMILIES,
		conjugationFamilyPatch,
		enabledFamilies,
		hasConjugationSettings,
		type ConjugationFamily
	} from '$lib/exercises/conjugationSettings';
	import { familyLabel } from '$lib/features/practice/conjugation/labels';
	import Section from '$lib/ui/Section.svelte';

	// Settings > Study > Conjugation (#178): one switch per form family of the conjugation drill (Practice), for a
	// Japanese workspace. Stored in the workspace's settings (`conjugation.families`, synced, part of a backup); the
	// rules are lib/exercises/conjugationSettings.ts and docs/contracts/conjugation/.
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const on = $derived(enabledFamilies(workspace?.settings));
	let pending = $state<Partial<Record<ConjugationFamily, boolean>>>({});
	let error = $state('');

	async function change(family: ConjugationFamily, value: boolean): Promise<void> {
		if (!workspace) return;
		error = '';
		pending = { ...pending, [family]: value };
		try {
			await session.workspaces.setSettings(workspace.id, conjugationFamilyPatch(family, value));
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			pending = { ...pending, [family]: undefined };
		}
	}
</script>

{#if workspace && hasConjugationSettings(workspace.language)}
	<Section title={t('settings.conjugation.title')} level={4}>
		<p class="note">{t('settings.conjugation.intro')}</p>
		<p class="note">{t('settings.conjugation.later')}</p>
		{#each CONJUGATION_FAMILIES as family (family)}
			<label data-conjugation-family={family}>
				<input type="checkbox" checked={pending[family] ?? on.includes(family)} onchange={(e) => change(family, e.currentTarget.checked)} />
				<span>{familyLabel(family)}</span>
			</label>
		{/each}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit);
		overflow-wrap: anywhere;
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
