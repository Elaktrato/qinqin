<script lang="ts">
	import ServerBackup from '$lib/admin/ServerBackup.svelte';
	import { t } from '$lib/i18n';
	import { page } from '$app/state';
	import EmailAdmin from '$lib/admin/EmailAdmin.svelte';
	import InvitesAdmin from '$lib/admin/InvitesAdmin.svelte';
	import SecurityAdmin from '$lib/admin/SecurityAdmin.svelte';
	import UpdatesAdmin from '$lib/admin/UpdatesAdmin.svelte';
	import UsersAdmin from '$lib/admin/UsersAdmin.svelte';
	import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS, adminSectionHref, parseAdminSection } from './tabs';
	import { Tabs } from '$lib/ui';

	// The section lives in the URL (?tab=admin&section=users) so it can be linked to.
	const section = $derived(parseAdminSection(page.url.searchParams.get('section')));
</script>

<Tabs
	label={t('settings.admin.sections')}
	tabs={ADMIN_SECTIONS.map((id) => ({ id, label: ADMIN_SECTION_LABELS[id], href: adminSectionHref(id) }))}
	selected={section}
/>

{#if section === 'users'}
	<UsersAdmin />
{:else if section === 'invites'}
	<InvitesAdmin />
{:else if section === 'email'}
	<EmailAdmin />
{:else if section === 'backup'}
	<ServerBackup />
{:else if section === 'updates'}
	<UpdatesAdmin />
{:else}
	<SecurityAdmin />
{/if}

<style>
	/* The section nav is the base Tabs route form (aria-current on the open
	   section); the page brings no second container (#106). */
</style>
