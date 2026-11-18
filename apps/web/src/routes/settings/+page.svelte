<script lang="ts">
	import { pageTitle } from '$lib/pageTitle';
	import { t } from '$lib/i18n';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, api } from '$lib/api/client';
	import { getSchemes } from '$lib/api/schemes';
	import type { Dictionary, PluginInfo, Scheme, Workspace } from '$lib/api/types';
	import { pluginName as manifestPluginName } from '$lib/plugins/manifestText';
	import { coverage, dictionaryHint, levelsHint } from '$lib/coverage';
	import DeleteWorkspaceDialog from '$lib/components/DeleteWorkspaceDialog.svelte';
	import WorkspaceCreateForm from '$lib/components/WorkspaceCreateForm.svelte';
	import WorkspaceLabel from '$lib/components/WorkspaceLabel.svelte';
	import { languageLabel } from '$lib/languages';
	import { webPlugins } from '$lib/plugins';
	import { listedPlugins, pluginRowInfo, validOrder } from '$lib/settings/pluginRows';
	import { loadPluginStates } from '$lib/plugins/states';
	import WorkspaceDictionaries from '$lib/settings/WorkspaceDictionaries.svelte';
	import AccountSettings from '$lib/settings/AccountSettings.svelte';
	import AdminSettings from '$lib/settings/AdminSettings.svelte';
	import AiSettings from '$lib/settings/AiSettings.svelte';
	import AudioSettings from '$lib/settings/AudioSettings.svelte';
	import AppearanceSettings from '$lib/settings/AppearanceSettings.svelte';
	import HomeLayoutEditor from '$lib/settings/HomeLayoutEditor.svelte';
	import StudyDaySettings from '$lib/settings/StudyDaySettings.svelte';
	import StudySettings from '$lib/settings/StudySettings.svelte';
	import LanguageManager from '$lib/settings/LanguageManager.svelte';
	import PackManager from '$lib/settings/PackManager.svelte';
	import FeatureSettings from '$lib/settings/FeatureSettings.svelte';
	import { isDataPackPlugin } from '$lib/plugins/dataPacks';
	import { user } from '$lib/auth';
	import {
		SETTINGS_TAB_LABELS,
		parseSettingsTab,
		settingsTabHref,
		settingsTitleParts,
		visibleSettingsTabs,
		type SettingsTab
	} from '$lib/settings/tabs';
	import { load as loadWorkspaces, rename, setSettings as setWorkspaceSettings, workspaces, workspacesLoadError, workspacesLoaded } from '$lib/workspaces';
	import { Button, Chip, Field, Section, Tabs } from '$lib/ui';

	interface PluginRow {
		id: string;
		name: string;
		version: string;
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
	let root = $state<HTMLElement | undefined>(undefined);

	async function selectTab(tab: SettingsTab): Promise<void> {
		if (tab !== activeTab) {
			await goto(settingsTabHref(tab), { replaceState: true, keepFocus: true, noScroll: true });
		}
	}

	// The row scrolls sideways on a phone (as it did before); keep the open
	// tab visible, also when a deep link opens one that sits off-screen.
	$effect(() => {
		void activeTab;
		void tick().then(() => {
			root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView?.({
				block: 'nearest',
				inline: 'nearest'
			});
		});
	});

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
		return manifestPluginName({ id: plugin.id, name: typeof name === 'string' && name.trim() ? name : plugin.id });
	}

	async function loadPlugins(): Promise<void> {
		pluginsLoading = true;
		pluginsError = '';
		try {
			const list = (await api<PluginInfo[]>('/api/plugins')).filter((p) => !isDataPackPlugin(p));
			// Plugins only: never the core row or the core features (lib/features).
			plugins = listedPlugins(list).map((plugin) => ({
				id: plugin.id,
				name: pluginName(plugin),
				version: typeof plugin.manifest?.version === 'string' ? plugin.manifest.version : '',
				enabled: plugin.enabled,
				order: plugin.order,
				...pluginRowInfo(plugin, webPlugins),
				saving: false,
				saved: false,
				error: ''
			}));
		} catch (err) {
			pluginsError = message(err, t('settings.plugins.loadFailed'));
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

	/** "中文 (Novels)", or the language alone for an unnamed workspace. */
	function workspaceName(workspace: { language: string; name?: string | null }): string {
		const language = languageLabel(workspace.language);
		return workspace.name ? t('settings.workspaces.labelNamed', { language, name: workspace.name }) : language;
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
					? t('settings.workspaces.nameTaken')
					: message(err, t('settings.workspaces.renameFailed'));
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
			row.error = message(err, t('settings.plugins.saveFailed'));
		} finally {
			row.saving = false;
		}
	}
</script>

<svelte:head>
	<title>{pageTitle(...settingsTitleParts(activeTab, page.url.searchParams.get('section')))}</title>
</svelte:head>

<div class="page-body settings" bind:this={root}>
	<h1>{t('settings.title')}</h1>

	<Tabs
		label={t('settings.tabsLabel')}
		tabs={tabs.map((tab) => ({ id: tab, label: SETTINGS_TAB_LABELS[tab] }))}
		selected={activeTab}
		onselect={(id) => selectTab(id as SettingsTab)}
	>
		{#snippet panel()}
			<div class="group" hidden={activeTab !== 'workspaces'}>
		<h2 bind:this={workspacesHeading} tabindex="-1">{t('settings.workspaces.title')}</h2>
		<p class="hint">{t('settings.workspaces.hint')}</p>

		{#if $workspaces.list.length === 0 && !$workspacesLoaded && $workspacesLoadError}
			<p class="error" role="alert">{$workspacesLoadError}</p>
			<button
				type="button"
				onclick={() => {
					workspacesLoadError.set('');
					loadWorkspaces().catch((err) =>
						workspacesLoadError.set(message(err, t('app.workspaces.loadFailed')))
					);
				}}>{t('common.action.retry')}</button
			>
		{:else if $workspaces.list.length === 0 && !$workspacesLoaded}
			<p class="hint" aria-live="polite">{t('settings.workspaces.loading')}</p>
		{:else if $workspaces.list.length === 0}
			<p>{t('settings.workspaces.none')}</p>
		{:else}
			<ul class="workspaces">
				{#each $workspaces.list as workspace (workspace.id)}
					<li>
						{#if renamingId === workspace.id}
							<form class="rename" onsubmit={(event) => saveRename(event, workspace)}>
								<WorkspaceLabel {workspace} list={$workspaces.list} withLanguage size={18} />
								<label class="sr-only" for="rename-{workspace.id}">{t('settings.workspaces.name')}</label>
								<input
									id="rename-{workspace.id}"
									bind:value={renameDraft}
									maxlength="40"
									autocomplete="off"
									placeholder={t('settings.workspaces.noName')}
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
									{renameSaving ? t('common.state.saving') : t('common.action.save')}
								</button>
								<button type="button" class="secondary" onclick={cancelRename}>{t('common.action.cancel')}</button>
							</form>
							{#if renameError}
								<p class="error" role="alert">{renameError}</p>
							{/if}
						{:else}
							<div class="row">
								<WorkspaceLabel {workspace} list={$workspaces.list} withLanguage size={18} />
								{#if $workspaces.current?.id === workspace.id}
									<span class="current">{t('settings.workspaces.current')}</span>
								{/if}
								{#if allDictionaries !== null && coverageOf(workspace).dictionaries.length === 0}
									<span class="chip" title={dictionaryHint(languageLabel(workspace.language), admin)}>{t('settings.workspaces.noDictionary')}</span>
								{/if}
								{#if allSchemes !== null && coverageOf(workspace).levels === 0}
									<span class="chip" title={levelsHint(languageLabel(workspace.language))}>{t('settings.workspaces.noLevels')}</span>
								{/if}
								<button
									type="button"
									class="secondary dictionaries-button"
									bind:this={dictionaryButtons[workspace.id]}
									onclick={() => (dictionariesOpenId = dictionariesOpenId === workspace.id ? null : workspace.id)}
									aria-expanded={dictionariesOpenId === workspace.id}
									aria-label={t('settings.workspaces.dictionariesOf', { workspace: workspaceName(workspace) })}
								>
									{t('settings.workspaces.dictionaries')}
								</button>
								<button
									type="button"
									class="secondary rename-button"
									onclick={() => startRename(workspace)}
									aria-label={t('settings.workspaces.renameOf', { workspace: workspaceName(workspace) })}
								>
									{t('settings.workspaces.rename')}
								</button>
								{#if $workspaces.list.length > 1}
									<button
										type="button"
										class="secondary delete-button"
										bind:this={deleteButtons[workspace.id]}
										onclick={() => (deleting = workspace)}
										aria-label={t('settings.workspaces.deleteOf', { workspace: workspaceName(workspace) })}
									>
										{t('common.action.delete')}
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
				<p class="hint">{t('settings.workspaces.onlyOne')}</p>
			{/if}
		{/if}

		{#if deleting}
			<DeleteWorkspaceDialog workspace={deleting} list={$workspaces.list} onclose={closeDelete} />
		{/if}

		{#if $workspaces.current}
			{@const active = $workspaces.current}
			<Section title={t('settings.workspaces.audioTitle')} level={3}>
				<p class="hint">{t('settings.workspaces.audioHint')}</p>
				<AudioSettings
					settings={active.settings}
					onChange={async (patch) => {
						await setWorkspaceSettings(active.id, patch);
					}}
				/>
			</Section>
		{/if}

		<!-- The phone drawer's + lands here (#99). -->
		<h3 id="new-workspace" tabindex="-1">{t('settings.workspaces.new')}</h3>
		<WorkspaceCreateForm idPrefix="settings-new" />
			</div>

			<div class="group" hidden={activeTab !== 'home'}>
				<HomeLayoutEditor />
			</div>

			<div class="group" hidden={activeTab !== 'study'}>
				<StudyDaySettings />
				<StudySettings />
			</div>

			<div class="group" hidden={activeTab !== 'features'}>
				<FeatureSettings />
			</div>

			<div class="group" hidden={activeTab !== 'plugins'}>
		<h2>{t('settings.plugins.title')}</h2>
		<p class="hint">{t('settings.plugins.hint')}</p>

		{#if pluginsLoading}
			<p>{t('settings.plugins.loading')}</p>
		{:else if pluginsError}
			<p class="error" role="alert">{pluginsError}</p>
		{:else if plugins.length === 0}
			<p>{t('settings.plugins.none')}</p>
		{:else}
			<ul class="plugins">
				{#each plugins as plugin (plugin.id)}
					<li class="plugin">
						<div class="plugin-head">
							<strong>{plugin.name}</strong>
							{#if plugin.version}<Chip>{plugin.version}</Chip>{/if}
							<code>{plugin.id}</code>
							{#if plugin.notice === 'app-update'}
								<Chip>{t('settings.plugins.needsUpdate')}</Chip>
							{:else if plugin.notice === 'legacy'}
								<Chip>{t('settings.plugins.legacy')}</Chip>
							{/if}
						</div>
						{#if plugin.permissions}
							<p class="plugin-permissions"><span class="plugin-permissions-label">{t('settings.plugins.permissions')}</span> {plugin.permissions}</p>
						{/if}

						<div class="plugin-controls">
							<label class="inline">
								<input
									type="checkbox"
									bind:checked={plugin.enabled}
									onchange={() => (plugin.saved = false)}
								/>
								{t('settings.plugins.enabled')}
							</label>

							<div class="order">
								<Field
									label={t('settings.plugins.order')}
									type="number"
									min="0"
									step="1"
									value={String(plugin.order)}
									oninput={(event) => {
										const raw = (event.currentTarget as HTMLInputElement).value;
										plugin.order = raw === '' ? Number.NaN : Number(raw);
										plugin.saved = false;
									}}
								/>
							</div>

							<Button
								onclick={() => savePlugin(plugin)}
								disabled={plugin.saving || !validOrder(plugin.order)}
								busy={plugin.saving}
							>
								{plugin.saving ? t('common.state.saving') : t('common.action.save')}
							</Button>
							{#if !validOrder(plugin.order)}
								<span class="error" role="alert">{t('settings.plugins.orderInvalid')}</span>
							{/if}

							{#if plugin.saved}
								<span class="saved">{t('settings.plugins.saved')}</span>
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

			<div class="group" hidden={activeTab !== 'appearance'}>
				<!-- Mounted only while open: leaving the tab unsaved ends the live preview. -->
				{#if activeTab === 'appearance'}<AppearanceSettings />{/if}
			</div>

			<div class="group" hidden={activeTab !== 'ai'}>
				<AiSettings />
			</div>

			<div class="group" hidden={activeTab !== 'account'}>
				<AccountSettings />
			</div>

			{#if admin}
				<div class="group" hidden={activeTab !== 'data'}>
					<h2>{t('settings.data.title')}</h2>
					<PackManager
						onchange={() => {
							languagesKey += 1;
							loadCoverage();
						}}
					/>
					<LanguageManager refreshKey={languagesKey} />
				</div>
				<div class="group" hidden={activeTab !== 'admin'}>
					<h2>{t('settings.adminPanel.title')}</h2>
					{#if activeTab === 'admin'}<AdminSettings />{/if}
				</div>
			{/if}
		{/snippet}
	</Tabs>
</div>

<style>
	/* The tab row is the base Tabs (in-page form); it scrolls sideways on a
	   phone instead of wrapping, as it did before (#106). */
	.settings :global([role='tablist']) {
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.settings :global([role='tablist'] [role='tab']) {
		white-space: nowrap;
	}

	.settings :global([role='tabpanel']) {
		margin-top: var(--space-6);
	}

	.settings .group[hidden] {
		display: none;
	}

	/* A panel's heading (the components inside bring their own Section
	   headings, level 3 and below). */
	.settings h2 {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-l);
		font-weight: var(--weight-strong);
		line-height: var(--line-tight);
	}

	.hint {
		color: var(--readable-muted);
	}

	.workspaces {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.workspaces li {
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
		padding: 0.6rem 0.75rem;
	}

	/* Plugin rows are hairline rows, not a box per plugin (#106). */
	.plugins {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.plugin {
		padding-block: var(--space-3);
	}

	.plugin + .plugin {
		border-top: 1px solid var(--hair);
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
		color: var(--readable-bad);
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

	.settings button.secondary:not(.button):not([role='tab']) {
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
		font-weight: var(--weight-strong);
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

	.order {
		width: 5rem;
	}

	.plugin-controls input,
	.settings button:not(.button):not([role='tab']) {
		font: inherit;
	}

	.settings button:not(.button):not([role='tab']) {
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: 0.4rem;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
		cursor: pointer;
	}

	.settings button:not(.button):not([role='tab']):disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.error {
		margin: 0.5rem 0 0;
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}

	/* Success: the text in --text, a --good dot as the shape cue (design §5). */
	.saved {
		color: var(--text);
		font-weight: 600;
	}
	.saved::before {
		content: '';
		display: inline-block;
		width: 0.5em;
		height: 0.5em;
		margin-inline-end: 0.35em;
		border-radius: 50%;
		background: var(--good);
		vertical-align: 0.1em;
	}
</style>
