<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { ApiError } from '$lib/api/client';
	import { languageUsage, registerLanguage, removeLanguage } from '$lib/api/adminLanguages';
	import { listLanguages } from '$lib/api/languages';
	import { listPacks } from '$lib/api/packs';
	import { languageLabel } from '$lib/languages';
	import { languageRows, normalizeCode, type LanguageRow } from './languagesView';

	// Admin view of every known language: where its data comes from, how
	// many workspaces use it, and registration/removal of data-only ones.
	// `refreshKey` changes when the Packs section installs or uninstalls.
	let { refreshKey = 0 }: { refreshKey?: number } = $props();

	let rows = $state<LanguageRow[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let code = $state('');
	let adding = $state(false);
	let error = $state('');
	let notice = $state('');
	let confirmCode = $state<string | null>(null);
	let confirmButton = $state<HTMLButtonElement | null>(null);
	const removeButtons: Record<string, HTMLButtonElement | undefined> = {};

	async function askRemove(code: string): Promise<void> {
		confirmCode = code;
		await tick();
		confirmButton?.focus();
	}

	async function cancelRemove(code: string): Promise<void> {
		confirmCode = null;
		await tick();
		removeButtons[code]?.focus();
	}
	let heading = $state<HTMLHeadingElement>();

	const normalized = $derived(normalizeCode(code));
	const preview = $derived(normalized ? languageLabel(normalized) : '');

	async function load(): Promise<void> {
		loadError = '';
		try {
			const [langs, packs, usage] = await Promise.all([listLanguages(), listPacks(), languageUsage()]);
			rows = languageRows(langs, packs, usage);
		} catch (err) {
			loadError = err instanceof ApiError ? err.message : 'Could not load the languages.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let first = true;
	$effect(() => {
		void refreshKey;
		if (first) {
			first = false;
			return;
		}
		void load();
	});

	async function add(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (adding) return;
		error = '';
		notice = '';
		if (!normalized) {
			error = 'language must be a code like es or pt-br';
			return;
		}
		adding = true;
		try {
			const added = await registerLanguage(normalized);
			notice = `Added ${languageLabel(added.code)} (${added.code}).`;
			code = '';
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not add the language.';
		} finally {
			adding = false;
		}
	}

	async function remove(row: LanguageRow): Promise<void> {
		error = '';
		notice = '';
		try {
			await removeLanguage(row.code);
			notice = `Removed ${row.label} (${row.code}).`;
			await load();
		} catch (err) {
			error = err instanceof ApiError ? err.message : 'Could not remove the language.';
		} finally {
			confirmCode = null;
			heading?.focus();
		}
	}
</script>

<section class="languages" aria-labelledby="languages-heading">
	<h3 id="languages-heading" bind:this={heading} tabindex="-1">Languages</h3>
	{#if loading}
		<p class="hint" aria-live="polite">Loading languages…</p>
	{:else if loadError}
		<p class="error" role="alert">{loadError}</p>
		<button type="button" onclick={load}>Try again</button>
	{:else}
		<div class="scroll">
			<table>
				<thead>
					<tr><th>Language</th><th>Code</th><th>Kind</th><th>Packs</th><th>Workspaces</th><th><span class="sr-only">Actions</span></th></tr>
				</thead>
				<tbody>
					{#each rows as row (row.code)}
						<tr>
							<td>{row.label}</td>
							<td>
								<code>{row.code}</code>
								{#if !row.valid}<span class="flag">not a valid code</span>{/if}
							</td>
							<td>{row.kind === 'code' ? 'built-in' : 'data only'}</td>
							<td>
								{#if row.packs.length === 0}<span class="none">none</span>{/if}
								{#each row.packs as pack (pack)}<div>{pack}</div>{/each}
							</td>
							<td>{row.workspaces}</td>
							<td>
								{#if row.removable}
									{#if confirmCode === row.code}
										<button type="button" class="danger" bind:this={confirmButton} onclick={() => remove(row)}>
											Confirm remove {row.label}
										</button>
										<button type="button" onclick={() => cancelRemove(row.code)}>Cancel</button>
									{:else}
										<button
											type="button"
											bind:this={removeButtons[row.code]}
											onclick={() => askRemove(row.code)}
											aria-label="Remove {row.label} ({row.code})"
										>
											Remove
										</button>
									{/if}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<form class="add" onsubmit={add}>
		<h4>Add a language</h4>
		<label for="language-code">Language code</label>
		<input
			id="language-code"
			bind:value={code}
			autocomplete="off"
			spellcheck="false"
			maxlength="20"
			placeholder="e.g. pt-br"
			aria-describedby="language-code-help"
		/>
		<p id="language-code-help" class="hint">
			Two or three letters, optionally with a region or script, like es or pt-br.
			{#if preview}<strong>{preview}</strong>{/if}
		</p>
		<p class="hint">Adds the language to the workspace list. It has no dictionary until you install a pack for it.</p>
		<button type="submit" class="primary" disabled={!normalized} aria-busy={adding}>
			{adding ? 'Adding…' : 'Add language'}
		</button>
	</form>
	{#if notice}<p class="hint" role="status">{notice}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
	.languages {
		margin-top: 2rem;
		display: grid;
		gap: 0.6rem;
	}

	h3,
	h4 {
		margin: 0;
	}

	.scroll {
		overflow-x: auto;
	}

	table {
		border-collapse: collapse;
		min-width: 100%;
	}

	th,
	td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
		vertical-align: top;
	}

	.flag {
		margin-left: 0.4rem;
		font-size: 0.75rem;
		color: #c62828;
		font-weight: 600;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.none {
		opacity: 0.6;
	}

	.add {
		display: grid;
		gap: 0.4rem;
		max-width: 28rem;
	}

	.hint {
		margin: 0;
		opacity: 0.8;
	}

	.error {
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}

	input,
	button {
		font: inherit;
		min-height: 44px;
		border-radius: 0.4rem;
		padding: 0.35rem 0.7rem;
	}

	input {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: Canvas;
		color: inherit;
	}

	button {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.primary {
		border: 0;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
	}

	.primary:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.danger {
		border-color: #c62828;
		color: #c62828;
	}
</style>
