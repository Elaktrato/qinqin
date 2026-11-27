<script lang="ts">
	import { errorText } from '$lib/api/apiErrors';
	import { getLanguage, t } from '$lib/i18n';
	import { languageName } from '$lib/i18n/format';
	import { mirrorWorkspaceLanguage, resolveInterfaceLanguage } from '$lib/i18n/interfaceLanguage';
	import { SUPPORTED_LANGUAGES } from '$lib/i18n/negotiate';
	import { resolveWorkspaceLanguage, workspaceLanguagePatch, workspaceSetting } from '$lib/i18n/workspaceLanguage';
	import { useApp, useSession } from '$lib/context/context';
	import { Button, Section, Select } from '$lib/ui';

	// Settings → Workspaces → Interface language (#297): the current workspace's own interface language, or "Use my
	// account setting" (the default). One choice per catalogue in lib/i18n/messages (a new catalogue file is a new
	// choice). Stored in the workspace's settings (synced, part of a backup). Saving changes the workspace; the root
	// layout then reloads the page into the new language (lib/i18n/interfaceLanguage.ts followInterfaceLanguage).
	let { label }: { label: string } = $props();

	const app = useApp();
	const session = useSession();
	const workspace = $derived(session.workspaces.current);
	const browser = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
	const account = $derived(app.auth.user?.interfaceLanguage ?? '');
	const accountLanguage = $derived(resolveInterfaceLanguage(account, browser));
	const choices = SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: languageName(code, code) }));

	let draft = $state('');
	let draftFor = $state<number | null>(null);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	// The draft starts from the stored setting, and again when another workspace becomes the current one.
	$effect.pre(() => {
		if (workspace && workspace.id !== draftFor) {
			draftFor = workspace.id;
			draft = workspaceSetting(workspace.settings);
			error = notice = '';
		}
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const target = workspace;
		if (!target || busy) return;
		busy = true;
		error = notice = '';
		try {
			const saved = await session.workspaces.setSettings(target.id, workspaceLanguagePatch(draft));
			// The layout follows the change (and reloads); a language the next start would not show means the browser
			// blocks site storage, so this page keeps its language.
			const shown = mirrorWorkspaceLanguage(app.deps.local(), saved, account, browser);
			if (!shown && resolveWorkspaceLanguage(saved, account, browser) !== getLanguage()) {
				notice = t('settings.workspaces.interfaceLanguage.storageBlocked');
			}
		} catch (err) {
			error = errorText(err, t('settings.saveFailed'));
		} finally {
			busy = false;
		}
	}
</script>

{#if workspace}
	<Section title={t('settings.workspaces.interfaceLanguage.title')} level={3}>
		<form onsubmit={save} class="stack">
			<Select
				label={t('settings.workspaces.interfaceLanguage.label')}
				bind:value={draft}
				aria-describedby="workspace-language-hint"
				options={[
					{ value: '', label: t('settings.workspaces.interfaceLanguage.account', { language: languageName(accountLanguage, accountLanguage) }) },
					...choices
				]}
			/>
			<p class="hint" id="workspace-language-hint">{t('settings.workspaces.interfaceLanguage.hint', { workspace: label })}</p>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			{#if notice}<p class="hint" role="status">{notice}</p>{/if}
			<div>
				<Button type="submit" busy={busy}>
					{busy ? t('common.state.saving') : t('settings.workspaces.interfaceLanguage.save')}
				</Button>
			</div>
		</form>
	</Section>
{/if}

<style>
	.stack {
		display: grid;
		gap: var(--space-2);
	}

	.hint {
		margin: 0;
		color: var(--readable-muted);
	}

	.error {
		margin: 0;
		color: var(--readable-bad);
		font-weight: 600;
	}
</style>
