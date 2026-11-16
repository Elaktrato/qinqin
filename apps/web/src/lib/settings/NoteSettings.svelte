<script lang="ts">
	// "Show my notes on the answer side": the workspace's qinqin-core notecfg row
	// (docs/contracts/notes/README.md). Missing or unreadable reads as on.
	import type { NoteCfg } from '$lib/notes/notes';
	import { loadNoteCfg, saveNoteCfg } from '$lib/notes/store';
	import { workspaces } from '$lib/workspaces';

	const workspaceId = $derived($workspaces.current?.id ?? null);
	let cfg = $state.raw<NoteCfg>({ onAnswer: true, extra: {} });
	let checked = $state(true);
	let busy = $state(false);
	let error = $state('');
	let seq = 0;

	$effect(() => {
		const ws = workspaceId;
		const mine = ++seq;
		cfg = { onAnswer: true, extra: {} };
		checked = true;
		error = '';
		if (ws === null) return;
		loadNoteCfg(ws).then(
			(loaded) => {
				if (mine !== seq) return;
				cfg = loaded;
				checked = loaded.onAnswer;
			},
			() => {
				// Unreadable reads as the default (on).
			}
		);
	});

	async function change(): Promise<void> {
		if (workspaceId === null) return;
		const value = checked;
		busy = true;
		error = '';
		try {
			await saveNoteCfg(workspaceId, value, cfg);
			cfg = { onAnswer: value, extra: cfg.extra };
		} catch {
			checked = cfg.onAnswer;
			error = 'Could not save this setting. Try again.';
		} finally {
			busy = false;
		}
	}
</script>

{#if workspaceId !== null}
	<section class="notes">
		<h2>Personal notes</h2>
		<label class="check">
			<input type="checkbox" bind:checked disabled={busy} onchange={change} />
			Show my notes on the answer side
		</label>
		<p class="hint">Your notes on words appear below a flashcard once its answer is shown, in this workspace.</p>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</section>
{/if}

<style>
	.check {
		display: inline-flex;
		gap: 0.4rem;
		align-items: center;
	}
	.hint {
		opacity: 0.75;
	}
	.error {
		margin-block: 0.5rem;
		color: #c62828;
	}
</style>
