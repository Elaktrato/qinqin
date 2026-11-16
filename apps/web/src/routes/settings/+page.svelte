<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, api } from '$lib/api/client';
	import { getSchemes } from '$lib/api/schemes';
	import type { Dictionary, PluginInfo, Scheme, Workspace } from '$lib/api/types';
	import { coverage, dictionaryHint, levelsHint } from '$lib/coverage';
	import DeleteWorkspaceDialog from '$lib/components/DeleteWorkspaceDialog.svelte';
	import WorkspaceCreateForm from '$lib/components/WorkspaceCreateForm.svelte';
	import WorkspaceLabel from '$lib/components/WorkspaceLabel.svelte';
	import { languageLabel } from '$lib/languages';
	import { isCorePlugin, webPlugins } from '$lib/plugins';
	import { pluginRowInfo, validOrder } from '$lib/settings/pluginRows';
	import { loadPluginStates } from '$lib/plugins/states';
	import WorkspaceDictionaries from '$lib/settings/WorkspaceDictionaries.svelte';
	import AccountSettings from '$lib/settings/AccountSettings.svelte';
	import AdminSettings from '$lib/settings/AdminSettings.svelte';
	import AiSettings from '$lib/settings/AiSettings.svelte';
	import AudioSettings from '$lib/settings/AudioSettings.svelte';
	import HomeLayoutEditor from '$lib/settings/HomeLayoutEditor.svelte';
	import StudyDaySettings from '$lib/settings/StudyDaySettings.svelte';
	import StudySettings from '$lib/settings/StudySettings.svelte';
	import LanguageManager from '$lib/settings/LanguageManager.svelte';
	import PackManager from '$lib/settings/PackManager.svelte';
	import { isDataPackPlugin } from '$lib/plugins/dataPacks';
	import { user } from '$lib/auth';
	import {
		SETTINGS_TAB_LABELS,
		parseSettingsTab,
		settingsTabHref,
		settingsTitleParts,
		tabKeyTarget,
		visibleSettingsTabs,
		type SettingsTab
	} from '$lib/settings/tabs';
	import { load as loadWorkspaces, rename, setSettings as setWorkspaceSettings, workspaces, workspacesLoadError, workspacesLoaded } from '$lib/workspaces';

	interface PluginRow {
		id: string;
		name: string;
		enabled: boolean;
		order: number;
		permissions: string;
		notice: 'app-update' | 'legacy' | null;
		saving: boolean;
		saved: boolean;
		error: string;
	}

	// The open tab lives in the URL (`?tab=`), so it can be linked to;
	// switching replaces the history entry instead of adding one. The
	// panels stay mounted (only hidden), so drafts survive a tab switch.
	const admin = $derived($user?.admin === true);
	const tabs = $derived(visibleSettingsTabs(admin));
	const activeTab = $derived(parseSettingsTab(page.url.searchParams.get('tab'), admin));
	const tabButtons: Partial<Record<SettingsTab, HTMLButtonElement>> = {};

	async function selectTab(tab: SettingsTab, focus = false): Promise<void> {
		if (tab !== activeTab) {
			await goto(settingsTabHref(tab), { replaceState: true, keepFocus: true, noScroll: true });
		}
		if (focus) {
			await tick();
			tabButtons[tab]?.focus();
		}
	}

	function tabKey(event: KeyboardEvent, index: number): void {
		const next = tabKeyTarget(event.key, index, tabs.length);
		if (next === null) return;
		event.preventDefault();
		void selectTab(tabs[next], true);
	}

	// The workspace being renamed (one at a time) and its draft name.
	let renamingId = $state<number | null>(null);
	let renameDraft = $state('');
	let renameSaving = $state(false);
	let renameError = $state('');

	// The workspace whose delete confirmation is open, and where focus
	// goes when it closes: back to its Delete button, or to the section
	// heading once the row is gone.
	let deleting = $state<Workspace | null>(null);
	const deleteButtons: Record<number, HTMLButtonElement> = {};
	let workspacesHeading = $state<HTMLHeadingElement | null>(null);

	async function closeDelete(deleted: boolean): Promise<void> {
		const id = deleting?.id;
		deleting = null;
		await tick();
		if (!deleted && id !== undefined && deleteButtons[id]) deleteButtons[id].focus();
		else workspacesHeading?.focus();
	}

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
			const list = (await api<PluginInfo[]>('/api/plugins')).filter((p) => !isDataPackPlugin(p));
			// The server flags the app's own surface-less built-ins (the core
			// registry row); the id check keeps an older server working.
			plugins = list.filter((plugin) => !plugin.hidden && !isCorePlugin(plugin.id)).map((plugin) => ({
				id: plugin.id,
				name: pluginName(plugin),
				enabled: plugin.enabled,
				order: plugin.order,
				...pluginRowInfo(plugin, webPlugins),
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

	// Bumped when the Packs section changes, so Languages reloads.
	let languagesKey = $state(0);

	// Coverage hints and the Dictionaries panel read the installed
	// dictionaries and level schemes once; a failure only drops the hints.
	let allDictionaries = $state<Dictionary[] | null>(null);
	let allSchemes = $state<Scheme[] | null>(null);
	function loadCoverage(): void {
		api<Dictionary[]>('/api/dictionaries', { auth: false }).then(
			(list) => (allDictionaries = list),
			() => {}
		);
		getSchemes().then(
			(list) => (allSchemes = list),
			() => {}
		);
	}
	onMount(loadCoverage);
	// The workspace whose Dictionaries panel is open, and its button.
	let dictionariesOpenId = $state<number | null>(null);
	const dictionaryButtons: Record<number, HTMLButtonElement | undefined> = {};

	function coverageOf(workspace: Workspace) {
		return coverage(workspace.language, allDictionaries ?? [], allSchemes ?? []);
	}

	async function closeDictionaries(id: number): Promise<void> {
		dictionariesOpenId = null;
		await tick();
		dictionaryButtons[id]?.focus();
	}

	function startRename(workspace: Workspace): void {
		renamingId = workspace.id;
		renameDraft = workspace.name;
		renameError = '';
	}

	function cancelRename(): void {
		renamingId = null;
		renameError = '';
	}

	async function saveRename(event: SubmitEvent, workspace: Workspace): Promise<void> {
		event.preventDefault();
		if (renameSaving) return;
		renameSaving = true;
		renameError = '';
		try {
			await rename(workspace.id, renameDraft);
			renamingId = null;
		} catch (err) {
			renameError =
				err instanceof ApiError && err.status === 409
					? 'Another workspace of this language already has that name.'
					: message(err, 'Could not rename the workspace.');
		} finally {
			renameSaving = false;
		}
	}

	function focusOnMount(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}

	async function savePlugin(row: PluginRow): Promise<void> {
		if (row.saving || !validOrder(row.order)) return;

		row.saving = true;
		row.saved = false;
		row.error = '';
		try {
			await api(`/api/plugins/${encodeURIComponent(row.id)}/state`, {
				method: 'PUT',
				body: { enabled: row.enabled, order: row.order }
			});
			row.saved = true;
			// The shell nav and /p/<plugin> read the shared store.
			void loadPluginStates();
		} catch (err) {
			row.error = message(err, 'Could not save plugin state.');
		} finally {
			row.saving = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(...settingsTitleParts(activeTab, page.url.searchParams.get('section')))}</title>
</svelte:head>

<main class="settings">
	<h1>Settings</h1>

	<div class="tabs" role="tablist" aria-label="Settings">
		{#each tabs as tab, index (tab)}
			<button
				type="button"
				role="tab"
				id="settings-tab-{tab}"
				aria-selected={tab === activeTab}
				aria-controls="settings-panel-{tab}"
				tabindex={tab === activeTab ? 0 : -1}
				bind:this={tabButtons[tab]}
				onclick={() => selectTab(tab)}
				onkeydown={(event) => tabKey(event, index)}
			>
				{SETTINGS_TAB_LABELS[tab]}
			</button>
		{/each}
	</div>

	<div
		role="tabpanel"
		id="settings-panel-workspaces"
		aria-labelledby="settings-tab-workspaces"
		hidden={activeTab !== 'workspaces'}
	>
		<h2 bind:this={workspacesHeading} tabindex="-1">Workspaces</h2>
		<p class="hint">
			Each workspace keeps its own cards, library and progress. You can have several of the same
			language; give them names to tell them apart. The switcher in the header changes the active
			one.
		</p>

		{#if $workspaces.list.length === 0 && !$workspacesLoaded && $workspacesLoadError}
			<p class="error" role="alert">{$workspacesLoadError}</p>
			<button
				type="button"
				onclick={() => {
					workspacesLoadError.set('');
					loadWorkspaces().catch((err) =>
						workspacesLoadError.set(message(err, 'Could not load workspaces.'))
					);
				}}>Try again</button
			>
		{:else if $workspaces.list.length === 0 && !$workspacesLoaded}
			<p class="hint" aria-live="polite">Loading workspaces…</p>
		{:else if $workspaces.list.length === 0}
			<p>No workspaces yet.</p>
		{:else}
			<ul class="workspaces">
				{#each $workspaces.list as workspace (workspace.id)}
					<li>
						{#if renamingId === workspace.id}
							<form class="rename" onsubmit={(event) => saveRename(event, workspace)}>
								<WorkspaceLabel {workspace} list={$workspaces.list} withLanguage size={18} />
								<label class="sr-only" for="rename-{workspace.id}">Workspace name</label>
								<input
									id="rename-{workspace.id}"
									bind:value={renameDraft}
									maxlength="40"
									autocomplete="off"
									placeholder="No name"
									use:focusOnMount
									onkeydown={(event) => {
										if (event.key === 'Escape') {
											event.preventDefault();
											cancelRename();
										}
									}}
								/>
								<!-- Not disabled while saving, so keyboard focus stays put. -->
								<button type="submit" aria-busy={renameSaving}>
									{renameSaving ? 'Saving…' : 'Save'}
								</button>
								<button type="button" class="secondary" onclick={cancelRename}>Cancel</button>
							</form>
							{#if renameError}
								<p class="error" role="alert">{renameError}</p>
							{/if}
						{:else}
							<div class="row">
								<WorkspaceLabel {workspace} list={$workspaces.list} withLanguage size={18} />
								{#if $workspaces.current?.id === workspace.id}
									<span class="current">current</span>
								{/if}
								{#if allDictionaries !== null && coverageOf(workspace).dictionaries.length === 0}
									<span class="chip" title={dictionaryHint(languageLabel(workspace.language), admin)}>No dictionary</span>
								{/if}
								{#if allSchemes !== null && coverageOf(workspace).levels === 0}
									<span class="chip" title={levelsHint(languageLabel(workspace.language))}>No level lists</span>
								{/if}
								<button
									type="button"
									class="secondary dictionaries-button"
									bind:this={dictionaryButtons[workspace.id]}
									onclick={() => (dictionariesOpenId = dictionariesOpenId === workspace.id ? null : workspace.id)}
									aria-expanded={dictionariesOpenId === workspace.id}
									aria-label="Dictionaries of {languageLabel(workspace.language)}{workspace.name
										? ` (${workspace.name})`
										: ''} workspace"
								>
									Dictionaries
								</button>
								<button
									type="button"
									class="secondary rename-button"
									onclick={() => startRename(workspace)}
									aria-label="Rename {languageLabel(workspace.language)}{workspace.name
										? ` (${workspace.name})`
										: ''} workspace"
								>
									Rename
								</button>
								{#if $workspaces.list.length > 1}
									<button
										type="button"
										class="secondary delete-button"
										bind:this={deleteButtons[workspace.id]}
										onclick={() => (deleting = workspace)}
										aria-label="Delete {languageLabel(workspace.language)}{workspace.name
											? ` (${workspace.name})`
											: ''} workspace"
									>
										Delete
									</button>
								{/if}
							</div>
							{#if dictionariesOpenId === workspace.id}
								<WorkspaceDictionaries
									{workspace}
									dictionaries={coverageOf(workspace).dictionaries}
									{admin}
									onclose={() => closeDictionaries(workspace.id)}
								/>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			{#if $workspaces.list.length === 1}
				<p class="hint">Your only workspace cannot be deleted; create another one first.</p>
			{/if}
		{/if}

		{#if deleting}
			<DeleteWorkspaceDialog workspace={deleting} list={$workspaces.list} onclose={closeDelete} />
		{/if}

		{#if $workspaces.current}
			{@const active = $workspaces.current}
			<h3>Audio for this workspace</h3>
			<p class="hint">
				Pronunciation buttons appear on entries and, after the answer, on study cards. These two
				options belong to the current workspace.
			</p>
			<AudioSettings
				settings={active.settings}
				onChange={async (patch) => {
					await setWorkspaceSettings(active.id, patch);
				}}
			/>
		{/if}

		<h3>New workspace</h3>
		<WorkspaceCreateForm idPrefix="settings-new" />
	</div>

	<div
		role="tabpanel"
		id="settings-panel-home"
		aria-labelledby="settings-tab-home"
		hidden={activeTab !== 'home'}
	>
		<HomeLayoutEditor />
	</div>

	<div
		role="tabpanel"
		id="settings-panel-study"
		aria-labelledby="settings-tab-study"
		hidden={activeTab !== 'study'}
	>
		<StudyDaySettings />
		<StudySettings />
	</div>

	<div
		role="tabpanel"
		id="settings-panel-plugins"
		aria-labelledby="settings-tab-plugins"
		hidden={activeTab !== 'plugins'}
	>
		<h2>Plugins</h2>
		<p class="hint">
			The server registers built-in plugins at startup. A disabled plugin's pages and widgets are
			hidden everywhere. The order sets the plugins' place in the navigation; the home page
			follows your widget layout instead.
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
							{#if plugin.notice === 'app-update'}
								<span class="needs-update">Needs an app update</span>
							{:else if plugin.notice === 'legacy'}
								<span class="needs-update">Plugin has no SDK declaration (legacy)</span>
							{/if}
						</div>
						{#if plugin.permissions}
							<p class="plugin-permissions"><span class="plugin-permissions-label">Permissions:</span> {plugin.permissions}</p>
						{/if}

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

							<button
								type="button"
								onclick={() => savePlugin(plugin)}
								disabled={plugin.saving || !validOrder(plugin.order)}
							>
								{plugin.saving ? 'Saving…' : 'Save'}
							</button>
							{#if !validOrder(plugin.order)}
								<span class="error" role="alert">Enter a whole number of 0 or more.</span>
							{/if}

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
	</div>

	<div
		role="tabpanel"
		id="settings-panel-ai"
		aria-labelledby="settings-tab-ai"
		hidden={activeTab !== 'ai'}
	>
		<AiSettings />
	</div>

	<div
		role="tabpanel"
		id="settings-panel-account"
		aria-labelledby="settings-tab-account"
		hidden={activeTab !== 'account'}
	>
		<AccountSettings />
	</div>

	{#if admin}
		<div
			role="tabpanel"
			id="settings-panel-data"
			aria-labelledby="settings-tab-data"
			hidden={activeTab !== 'data'}
		>
			<h2>Data</h2>
			<PackManager
				onchange={() => {
					languagesKey += 1;
					loadCoverage();
				}}
			/>
			<LanguageManager refreshKey={languagesKey} />
		</div>
		<div
			role="tabpanel"
			id="settings-panel-admin"
			aria-labelledby="settings-tab-admin"
			hidden={activeTab !== 'admin'}
		>
			<h2>Admin</h2>
			{#if activeTab === 'admin'}<AdminSettings />{/if}
		</div>
	{/if}
</main>

<style>
	.settings [role='tabpanel'] {
		margin-top: 1.5rem;
	}

	.settings [role='tabpanel'][hidden] {
		display: none;
	}

	/* The tab strip: plain text tabs with an underline for the open one;
	   it scrolls sideways rather than wrapping on a narrow phone. */
	.tabs {
		display: flex;
		gap: 0.25rem;
		overflow-x: auto;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}

	.settings .tabs [role='tab'] {
		min-height: 2.75rem;
		padding: 0.5rem 1rem;
		border: 0;
		border-bottom: 3px solid transparent;
		border-radius: 0;
		margin-bottom: -1px;
		background: transparent;
		color: inherit;
		font-weight: 500;
		opacity: 0.8;
		white-space: nowrap;
	}

	.settings .tabs [role='tab'][aria-selected='true'] {
		opacity: 1;
		font-weight: 600;
		color: #0b6bcb;
		border-bottom-color: currentColor;
	}

	@media (prefers-color-scheme: dark) {
		.settings .tabs [role='tab'][aria-selected='true'] {
			color: #6cb4ff;
		}
	}

	.settings .tabs [role='tab']:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: -4px;
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

	.workspaces .row,
	.rename {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	.rename-button {
		margin-left: auto;
	}

	/* .secondary.delete-button: beats `.settings button.secondary`
	   (color: inherit), which comes later and used to win. */
	.settings button.secondary.delete-button {
		color: #c62828;
	}

	/* #c62828 is about 3.3:1 on the dark Canvas; this red is 8.2:1. */
	@media (prefers-color-scheme: dark) {
		.settings button.secondary.delete-button {
			color: #ff8a80;
		}
	}

	h2[tabindex='-1']:focus {
		outline: none;
	}

	.rename input {
		flex: 1 1 10rem;
		min-width: 0;
		font: inherit;
		padding: 0.35rem 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.settings button.secondary {
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: transparent;
		color: inherit;
		font-weight: 500;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	.chip {
		font-size: 0.8rem;
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
		background: color-mix(in srgb, currentColor 12%, transparent);
	}

	.dictionaries-button {
		min-height: 44px;
	}

	.current {
		font-size: 0.8rem;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}

	.plugin-permissions {
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
	}

	.plugin-permissions-label {
		font-weight: 600;
	}

	.needs-update {
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

	.plugin-controls input,
	.settings button {
		font: inherit;
	}

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
