<script lang="ts">
	// The workspace flag of the frame (design §9): the current workspace's
	// flag alone (no pill, no border) opens a menu of the workspaces — flag,
	// language and name, a check on the current one (radio items) — and
	// "Manage workspaces" (Settings → Workspaces, where new ones are made).
	// The menu behaviour is lib/ui Menu's.
	import { t } from '$lib/i18n';
	import Flag from '$lib/components/Flag.svelte';
	import WorkspaceLabel from '$lib/workspace/WorkspaceLabel.svelte';
	import { workspaceDisplay } from '$lib/languages';
	import Icon from '$lib/ui/Icon.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import MenuItem from '$lib/ui/MenuItem.svelte';
	import { useSession } from '$lib/context/context';
	const session = useSession();

	let { align = 'end', direction = 'down' }: { align?: 'start' | 'end'; direction?: 'down' | 'up' } = $props();

	const list = $derived(session.workspaces.list);
	const current = $derived(session.workspaces.current);
	const display = $derived(current ? workspaceDisplay(list, current) : null);
	const label = $derived(
		display
			? display.showName && display.name !== display.label
				? t('app.workspaces.picker.currentNamed', { label: display.label, name: display.name })
				: t('app.workspaces.picker.current', { label: display.label })
			: t('app.workspaces.picker.none')
	);
</script>

<Menu {label} menuLabel={t('app.workspaces.picker.list')} {align} {direction} tooltipPlacement={direction === 'up' ? 'above' : align === 'end' ? 'below-end' : 'below'} triggerClass="workspace-flag">
	{#snippet trigger()}
		{#if current}<Flag code={current.language} size={20} decorative />{:else}<Icon name="flag" />{/if}
	{/snippet}
	{#each list as workspace (workspace.id)}
		<MenuItem checked={workspace.id === current?.id} onselect={() => session.workspaces.select(workspace.id)}
			><WorkspaceLabel {workspace} {list} withLanguage /></MenuItem
		>
	{/each}
	{#if list.length > 0}<MenuItem separator />{/if}
	<MenuItem href="/settings?tab=workspaces" icon="settings">{t('nav.workspaces.manage')}</MenuItem>
</Menu>
