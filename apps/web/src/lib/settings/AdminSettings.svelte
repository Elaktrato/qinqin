<script lang="ts">
	import ServerBackup from '$lib/admin/ServerBackup.svelte';
	import { t } from '$lib/i18n';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import EmailAdmin from '$lib/admin/EmailAdmin.svelte';
	import InvitesAdmin from '$lib/admin/InvitesAdmin.svelte';
	import SecurityAdmin from '$lib/admin/SecurityAdmin.svelte';
	import UsersAdmin from '$lib/admin/UsersAdmin.svelte';
	import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS, adminSectionHref, parseAdminSection } from './tabs';

	// The section lives in the URL (?tab=admin&section=users) so it can be linked to.
	const section = $derived(parseAdminSection(page.url.searchParams.get('section')));
</script>

<nav class="sections" aria-label={t('settings.admin.sections')}>
	{#each ADMIN_SECTIONS as id (id)}
		<a
			href={adminSectionHref(id)}
			aria-current={section === id ? 'page' : undefined}
			onclick={(event) => {
				event.preventDefault();
				void goto(adminSectionHref(id), { replaceState: true, keepFocus: true, noScroll: true });
			}}>{ADMIN_SECTION_LABELS[id]}</a
		>
	{/each}
</nav>

{#if section === 'users'}
	<UsersAdmin />
{:else if section === 'invites'}
	<InvitesAdmin />
{:else if section === 'email'}
	<EmailAdmin />
{:else if section === 'backup'}
	<ServerBackup />
{:else}
	<SecurityAdmin />
{/if}

<style>
	.sections {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.2rem;
	}
	.sections a {
		padding: 0.25rem 0;
		color: inherit;
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.sections a[aria-current='page'] {
		font-weight: 600;
		border-bottom-color: currentColor;
	}
</style>
