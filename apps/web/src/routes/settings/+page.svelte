<script lang="ts">
	import { isImeKey } from '$lib/ui/ime';
	import { errorText } from '$lib/api/apiErrors';
	import { pageTitle } from '$lib/routing/pageTitle';
	import { t } from '$lib/i18n';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ApiError, api } from '$lib/api/client';
	import { getSchemes } from '$lib/api/schemes';
	import type { Dictionary, Scheme, Workspace } from '$lib/api/types';
	import { coverage, dictionaryHint, levelsHint } from '$lib/languages/coverage';
	import DeleteWorkspaceDialog from '$lib/workspace/DeleteWorkspaceDialog.svelte';
	import WorkspaceCreateForm from '$lib/workspace/WorkspaceCreateForm.svelte';
	import WorkspaceLabel from '$lib/workspace/WorkspaceLabel.svelte';
	import { languageLabel } from '$lib/languages';
	import WorkspaceDictionaries from '$lib/settings/WorkspaceDictionaries.svelte';
	import AccountSettings from '$lib/settings/AccountSettings.svelte';
	import AdminSettings from '$lib/settings/AdminSettings.svelte';
	import AiSettings from '$lib/settings/AiSettings.svelte';
	import AudioSettings from '$lib/settings/AudioSettings.svelte';
	import FeedbackSettings from '$lib/settings/FeedbackSettings.svelte';
	import HintSettings from '$lib/settings/HintSettings.svelte';
	import StarterSettings from '$lib/starter/StarterSettings.svelte';
	import AppearanceSettings from '$lib/settings/AppearanceSettings.svelte';
	import HomeLayoutEditor from '$lib/settings/HomeLayoutEditor.svelte';
	import NavLayoutSettings from '$lib/settings/NavLayoutSettings.svelte';
	import StudyDaySettings from '$lib/settings/StudyDaySettings.svelte';
	import KnownSettings from '$lib/placement/KnownSettings.svelte';
	import LevelCheck from '$lib/placement/LevelCheck.svelte';
	import NotificationSettings from '$lib/settings/NotificationSettings.svelte';
	import StudySettings from '$lib/settings/StudySettings.svelte';
	import LanguageManager from '$lib/settings/LanguageManager.svelte';
	import PackManager from '$lib/settings/PackManager.svelte';
	import FeatureSettings from '$lib/settings/FeatureSettings.svelte';
	import {
		RENAMED_TABS,
		SETTINGS_TAB_LABELS,
		parseSettingsTab,
		settingsTabHref,
		settingsTitleParts,
		visibleSettingsTabs,
		type SettingsTab
	} from '$lib/settings/tabs';
	import { Button, Chip, Field, Section, Tabs } from '$lib/ui';
	import { useApp } from '$lib/context/context';
	import { useSession } from '$lib/context/context';

	const session = useSession();
	const app = useApp();


	// The open tab lives in the URL (`?tab=`), so it can be linked to;
	// switching replaces the history entry instead of adding one. The
	// panels stay mounted (only hidden), so drafts survive a tab switch.
	const admin = $derived(app.auth.user?.admin === true);
	const tabs = $derived(visibleSettingsTabs(admin));
	const activeTab = $derived(parseSettingsTab(page.url.searchParams.get('tab'), admin));
	// A renamed tab's old link (`?tab=home`) lands on the new tab, and the
	// URL follows (the fragment kept).
	$effect(() => {
		const raw = page.url.searchParams.get('tab');
		if (raw !== null && Object.hasOwn(RENAMED_TABS, raw)) {
			void goto(`${settingsTabHref(RENAMED_TABS[raw])}${page.url.hash}`, { replaceState: true, keepFocus: true, noScroll: true });
		}
	});
	async function selectTab(tab: SettingsTab): Promise<void> {
		if (tab !== activeTab) {
			await goto(settingsTabHref(tab), { replaceState: true, keepFocus: true, noScroll: true });
		}
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
	let renameInput = $state<HTMLInputElement | undefined>(undefined);
	const deleteButtons: Record<number, HTMLElement | undefined> = {};
	const renameButtons: Record<number, HTMLElement | undefined> = {};
	let workspacesHeading = $state<HTMLHeadingElement | null>(null);

	async function closeDelete(deleted: boolean): Promise<void> {
		const id = deleting?.id;
		deleting = null;
		await tick();
		if (!deleted && id !== undefined && deleteButtons[id]) deleteButtons[id].focus();
		else workspacesHeading?.focus();
	}

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
	const dictionaryButtons: Record<number, HTMLElement | undefined> = {};

	function coverageOf(workspace: Workspace) {
		return coverage(workspace.language, allDictionaries ?? [], allSchemes ?? []);
	}

	async function closeDictionaries(id: number): Promise<void> {
		dictionariesOpenId = null;
		await tick();
		dictionaryButtons[id]?.focus();
	}

	async function startRename(workspace: Workspace): Promise<void> {
		renamingId = workspace.id;
		renameDraft = workspace.name;
		renameError = '';
		await tick();
		renameInput?.focus();
		renameInput?.select();
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
			await session.workspaces.rename(workspace.id, renameDraft);
			renamingId = null;
		} catch (err) {
			renameError =
				err instanceof ApiError && err.status === 409
					? t('settings.workspaces.nameTaken')
					: errorText(err, t('settings.workspaces.renameFailed'));
		} finally {
			renameSaving = false;
		}
	}

</script>

<svelte:head>
	<title>{pageTitle(...settingsTitleParts(activeTab, page.url.searchParams.get('section')))}</title>
</svelte:head>

<div class="page-body settings">
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

		{#if session.workspaces.list.length === 0 && !session.workspaces.loaded && session.workspaces.loadError}
			<p class="error" role="alert">{session.workspaces.loadError}</p>
			<Button
				onclick={() => {
					session.workspaces.loadError = '';
					session.workspaces.load().catch((err) =>
						(session.workspaces.loadError = errorText(err, t('app.workspaces.loadFailed')))
					);
				}}>{t('common.action.retry')}</Button
			>
		{:else if session.workspaces.list.length === 0 && !session.workspaces.loaded}
			<p class="hint" aria-live="polite">{t('settings.workspaces.loading')}</p>
		{:else if session.workspaces.list.length === 0}
			<p>{t('settings.workspaces.none')}</p>
		{:else}
			<ul class="workspaces">
				{#each session.workspaces.list as workspace (workspace.id)}
					<li>
						{#if renamingId === workspace.id}
							<form class="rename" onsubmit={(event) => saveRename(event, workspace)}>
								<WorkspaceLabel {workspace} list={session.workspaces.list} withLanguage size={18} />
								<Field
									class="rename-field"
									label={t('settings.workspaces.name')}
									id="rename-{workspace.id}"
									bind:element={renameInput}
									bind:value={renameDraft}
									maxlength={40}
									autocomplete="off"
									placeholder={t('settings.workspaces.noName')}
									onkeydown={(event) => {
										if (event.key === 'Escape' && !isImeKey(event)) {
											event.preventDefault();
											cancelRename();
										}
									}}
								/>
								<!-- Not disabled while saving, so keyboard focus stays put. -->
								<Button type="submit" busy={renameSaving}>
									{renameSaving ? t('common.state.saving') : t('common.action.save')}
								</Button>
								<Button type="button" onclick={cancelRename}>{t('common.action.cancel')}</Button>
							</form>
							{#if renameError}
								<p class="error" role="alert">{renameError}</p>
							{/if}
						{:else}
							<div class="row">
								<WorkspaceLabel {workspace} list={session.workspaces.list} withLanguage size={18} />
								{#if session.workspaces.current?.id === workspace.id}
									<Chip>{t('settings.workspaces.current')}</Chip>
								{/if}
								{#if allDictionaries !== null && coverageOf(workspace).dictionaries.length === 0}
									<span title={dictionaryHint(languageLabel(workspace.language), admin)}
										><Chip>{t('settings.workspaces.noDictionary')}</Chip></span
									>
								{/if}
								{#if allSchemes !== null && coverageOf(workspace).levels === 0}
									<span title={levelsHint(languageLabel(workspace.language))}
										><Chip>{t('settings.workspaces.noLevels')}</Chip></span
									>
								{/if}
								<Button
									element={dictionaryButtons[workspace.id]}
									onclick={() => (dictionariesOpenId = dictionariesOpenId === workspace.id ? null : workspace.id)}
									aria-expanded={dictionariesOpenId === workspace.id}
									aria-label={t('settings.workspaces.dictionariesOf', { workspace: workspaceName(workspace) })}
								>
									{t('settings.workspaces.dictionaries')}
								</Button>
								<Button
									element={renameButtons[workspace.id]}
									onclick={() => startRename(workspace)}
									aria-label={t('settings.workspaces.renameOf', { workspace: workspaceName(workspace) })}
								>
									{t('settings.workspaces.rename')}
								</Button>
								{#if session.workspaces.list.length > 1}
									<Button
										tone="danger"
										element={deleteButtons[workspace.id]}
										onclick={() => (deleting = workspace)}
										aria-label={t('settings.workspaces.deleteOf', { workspace: workspaceName(workspace) })}
									>
										{t('common.action.delete')}
									</Button>
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
			{#if session.workspaces.list.length === 1}
				<p class="hint">{t('settings.workspaces.onlyOne')}</p>
			{/if}
		{/if}

		{#if deleting}
			<DeleteWorkspaceDialog workspace={deleting} list={session.workspaces.list} onclose={closeDelete} />
		{/if}

		{#if session.workspaces.current}
			{@const active = session.workspaces.current}
			<Section title={t('settings.workspaces.audioTitle')} level={3}>
				<p class="hint">{t('settings.workspaces.audioHint')}</p>
				<AudioSettings
					settings={active.settings}
					onChange={async (patch) => {
						await session.workspaces.setSettings(active.id, patch);
					}}
				/>
			</Section>
		{/if}

		<!-- The phone drawer's + lands here (#99). -->
		<h3 id="new-workspace" tabindex="-1">{t('settings.workspaces.new')}</h3>
		<WorkspaceCreateForm idPrefix="settings-new" />
			</div>

			<div class="group" hidden={activeTab !== 'layout'}>
				<HomeLayoutEditor />
				<NavLayoutSettings />
			</div>

			<div class="group" hidden={activeTab !== 'study'}>
				<StudyDaySettings />
				<StudySettings />
				<HintSettings />
				<StarterSettings />
				<KnownSettings />
				<LevelCheck />
				<FeedbackSettings />
			</div>

			<div class="group" hidden={activeTab !== 'features'}>
				<FeatureSettings />
			</div>

			<div class="group" hidden={activeTab !== 'notifications'}>
				<!-- Mounted only while open: it reads the plan and the devices when shown. -->
				{#if activeTab === 'notifications'}<NotificationSettings />{/if}
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
	/* The tab row is the base Tabs (in-page form); it wraps onto as many
	   rows as the width needs, so no tab is ever off-screen and no scrollbar
	   appears (#106 owner request, 2026-11-18). A single tab's label still
	   never breaks mid-word. */
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
		margin: 0 0 var(--space-4);
		padding: 0;
	}

	.workspaces li {
		padding-block: var(--space-3);
	}

	.workspaces li + li {
		border-top: 1px solid var(--hair);
	}

	.workspaces .row,
	.rename {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	.rename :global(.rename-field) {
		flex: 1 1 10rem;
	}

	h2[tabindex='-1']:focus {
		outline: none;
	}

	.error {
		margin: 0.5rem 0 0;
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
