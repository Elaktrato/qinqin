<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError, api } from '$lib/api/client';
	import type { PluginInfo } from '$lib/api/types';
	import { create, workspaces } from '$lib/workspaces';

	interface PluginRow {
		id: string;
		name: string;
		enabled: boolean;
		order: number;
		saving: boolean;
		saved: boolean;
		error: string;
	}

	let language = $state('');
	let creating = $state(false);
	let createError = $state('');

	let plugins = $state<PluginRow[]>([]);
	let pluginsLoading = $state(true);
	let pluginsError = $state('');

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	function pluginName(plugin: PluginInfo): string {
		const name = plugin.manifest?.name;
		return typeof name === 'string' && name.trim() ? name : plugin.id;
	}

	async function loadPlugins(): Promise<void> {
		pluginsLoading = true;
		pluginsError = '';
		try {
			const list = await api<PluginInfo[]>('/api/plugins');
			plugins = list.map((plugin) => ({
				id: plugin.id,
				name: pluginName(plugin),
				enabled: plugin.enabled,
				order: plugin.order,
				saving: false,
				saved: false,
				error: ''
			}));
		} catch (err) {
			pluginsError = message(err, 'Could not load plugins.');
		} finally {
			pluginsLoading = false;
		}
	}

	onMount(loadPlugins);

	async function addWorkspace(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const code = language.trim().toLowerCase();
		if (!code || creating) return;

		creating = true;
		createError = '';
		try {
			await create(code);
			language = '';
		} catch (err) {
			createError = message(err, 'Could not create workspace.');
		} finally {
			creating = false;
		}
	}

	async function savePlugin(row: PluginRow): Promise<void> {
		if (row.saving) return;

		row.saving = true;
		row.saved = false;
		row.error = '';
		try {
			await api(`/api/plugins/${encodeURIComponent(row.id)}/state`, {
				method: 'PUT',
				body: { enabled: row.enabled, order: row.order }
			});
			row.saved = true;
		} catch (err) {
			row.error = message(err, 'Could not save plugin state.');
		} finally {
			row.saving = false;
		}
	}
</script>

<main class="settings">
	<h1>Settings</h1>

	<section>
		<h2>Workspaces</h2>
		<p class="hint">One workspace per language. The switcher in the header changes the active one.</p>

		{#if $workspaces.list.length === 0}
			<p>No workspaces yet.</p>
		{:else}
			<ul class="workspaces">
				{#each $workspaces.list as workspace (workspace.id)}
					<li>
						<span class="language">{workspace.language}</span>
						<code>#{workspace.id}</code>
						{#if $workspaces.current?.id === workspace.id}
							<span class="current">current</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<form class="create" onsubmit={addWorkspace}>
			<label>
				Language code
				<input
					bind:value={language}
					placeholder="zh, ja, es"
					maxlength="16"
					autocomplete="off"
					required
				/>
			</label>
			<button type="submit" disabled={creating}>
				{creating ? 'Creating…' : 'Create workspace'}
			</button>
		</form>

		{#if createError}
			<p class="error" role="alert">{createError}</p>
		{/if}
	</section>

	<section>
		<h2>Plugins</h2>
		<p class="hint">
			The server registers built-in widgets, such as the study heatmap, at startup. Enabled
			plugins appear on the home page in ascending order.
		</p>

		{#if pluginsLoading}
			<p>Loading plugins…</p>
		{:else if pluginsError}
			<p class="error" role="alert">{pluginsError}</p>
		{:else if plugins.length === 0}
			<p>No plugins are registered.</p>
		{:else}
			<ul class="plugins">
				{#each plugins as plugin (plugin.id)}
					<li class="plugin">
						<div class="plugin-head">
							<strong>{plugin.name}</strong>
							<code>{plugin.id}</code>
						</div>

						<div class="plugin-controls">
							<label class="inline">
								<input
									type="checkbox"
									bind:checked={plugin.enabled}
									onchange={() => (plugin.saved = false)}
								/>
								Enabled
							</label>

							<label class="inline">
								Order
								<input
									type="number"
									min="0"
									step="1"
									bind:value={plugin.order}
									oninput={() => (plugin.saved = false)}
								/>
							</label>

							<button type="button" onclick={() => savePlugin(plugin)} disabled={plugin.saving}>
								{plugin.saving ? 'Saving…' : 'Save'}
							</button>

							{#if plugin.saved}
								<span class="saved">Saved</span>
							{/if}
						</div>

						{#if plugin.error}
							<p class="error" role="alert">{plugin.error}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.settings section {
		margin-top: 2rem;
	}

	.hint {
		opacity: 0.75;
	}

	.workspaces,
	.plugins {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.workspaces li,
	.plugin {
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
	}

	.workspaces li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.language {
		font-weight: 600;
	}

	.current {
		font-size: 0.8rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}

	.plugin-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
	}

	.plugin-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.plugin-controls .inline {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.plugin-controls input[type='number'] {
		width: 4.5rem;
	}

	.create {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.75rem;
	}

	.create label {
		display: grid;
		gap: 0.35rem;
		font-weight: 600;
	}

	.create input,
	.plugin-controls input,
	.settings button {
		font: inherit;
	}

	.create input,
	.plugin-controls input {
		padding: 0.4rem 0.55rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.settings button {
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}

	.settings button:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.error {
		margin: 0.5rem 0 0;
		color: #c62828;
		font-weight: 600;
	}

	.saved {
		color: #2e7d32;
		font-weight: 600;
	}
</style>
