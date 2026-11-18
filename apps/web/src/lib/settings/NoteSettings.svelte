<script lang="ts">
	// "Show my notes on the answer side": the workspace's qinqin-core notecfg row
	// (docs/contracts/notes/README.md). Missing or unreadable reads as on.
	import type { NoteCfg } from '$lib/notes/notes';
	import { t } from '$lib/i18n';
	import { loadNoteCfg, saveNoteCfg } from '$lib/notes/store';
	import { workspaces } from '$lib/workspaces';
	import Section from '$lib/ui/Section.svelte';

	const workspaceId = $derived($workspaces.current?.id ?? null);
	let cfg = $state.raw<NoteCfg>({ onAnswer: true, extra: {} });
	let checked = $state(true);
	let busy = $state(false);
	// The box is off until the stored row has been read, so a change never
	// races the load (a stale load would overwrite it and lose unknown members).
	let loaded = $state(false);
	let error = $state('');
	let seq = 0;

	$effect(() => {
		const ws = workspaceId;
		const mine = ++seq;
		cfg = { onAnswer: true, extra: {} };
		checked = true;
		error = '';
		loaded = false;
		if (ws === null) return;
		loadNoteCfg(ws).then(
			(row) => {
				if (mine !== seq) return;
				cfg = row;
				checked = row.onAnswer;
				loaded = true;
			},
			() => {
				// Unreadable reads as the default (on); the box stays usable.
				if (mine === seq) loaded = true;
			}
		);
	});

	async function change(): Promise<void> {
		if (workspaceId === null || !loaded) return;
		const value = checked;
		busy = true;
		error = '';
		try {
			await saveNoteCfg(workspaceId, value, cfg);
			cfg = { onAnswer: value, extra: cfg.extra };
		} catch {
			checked = cfg.onAnswer;
			error = t('settings.notes.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

{#if workspaceId !== null}
	<Section title={t('settings.notes.title')}>
		<label class="check">
			<input type="checkbox" bind:checked disabled={busy || !loaded} onchange={change} />
			{t('settings.notes.onAnswer')}
		</label>
		<p class="hint">{t('settings.notes.hint')}</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</Section>
{/if}

<style>
	.check {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}
	.hint {
		color: var(--readable-muted);
	}
	.error {
		margin-block: 0.5rem;
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
