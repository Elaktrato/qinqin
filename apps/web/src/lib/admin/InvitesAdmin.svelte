<script lang="ts">
	import { onMount } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import {
		createInvite,
		getAuthSettings,
		listInvites,
		revokeInvite,
		type InviteDto
	} from '$lib/api/adminSettings';
	import {
		closedNote,
		DEFAULT_EXPIRY_DAYS,
		EXPIRY_CHOICES,
		inviteLink,
		invitePayload,
		inviteRows
	} from './invitesView';

	let invites = $state<InviteDto[]>([]);
	let closed = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let busy = $state(false);

	let maxUses = $state(1);
	let expiry = $state<string>(String(DEFAULT_EXPIRY_DAYS));
	let note = $state('');
	// The link is shown once, in full; closing it forgets it.
	let created = $state<string | null>(null);
	let copied = $state(false);

	const rows = $derived(inviteRows(invites));

	const message = errorText;

	async function load(): Promise<void> {
		try {
			const [list, settings] = await Promise.all([listInvites(), getAuthSettings()]);
			invites = list;
			closed = settings.registration === 'closed';
			error = '';
		} catch (err) {
			error = message(err, t('admin.invites.error.load'));
		} finally {
			loaded = true;
		}
	}
	onMount(() => void load());

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const days = expiry === 'none' ? null : Number(expiry);
			const out = await createInvite(invitePayload(Number(maxUses), days, note));
			created = inviteLink(location.origin, out.path);
			copied = false;
			note = '';
			await load();
		} catch (err) {
			error = message(err, t('admin.invites.error.create'));
		} finally {
			busy = false;
		}
	}

	async function revoke(id: number): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeInvite(id);
			await load();
		} catch (err) {
			error = message(err, t('admin.invites.error.revoke'));
		} finally {
			busy = false;
		}
	}

	async function copy(): Promise<void> {
		if (!created) return;
		try {
			await navigator.clipboard.writeText(created);
			copied = true;
		} catch {
			error = t('admin.invites.error.copy');
		}
	}
</script>

<section aria-labelledby="admin-invites-heading">
	<h2 id="admin-invites-heading">{t('admin.invites.title')}</h2>
	{#if closed}<p class="note" role="note">{closedNote()}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<form onsubmit={create} class="stack">
		<label>
			{t('admin.invites.uses.label')}
			<input type="number" min="1" max="100" bind:value={maxUses} required />
		</label>
		<label>
			{t('admin.invites.expires')}
			<select bind:value={expiry}>
				{#each EXPIRY_CHOICES as c (c.label)}
					<option value={c.days === null ? 'none' : String(c.days)}>{c.label}</option>
				{/each}
			</select>
		</label>
		<label>
			{t('admin.invites.note')}
			<input bind:value={note} maxlength="100" autocomplete="off" />
		</label>
		<button type="submit" disabled={busy}>{t('admin.invites.create')}</button>
	</form>

	{#if created}
		<div class="link" role="group" aria-label={t('admin.invites.newLink')}>
			<p>{t('admin.invites.shownOnce')}</p>
			<input readonly value={created} aria-label={t('admin.invites.link')} onfocus={(e) => e.currentTarget.select()} />
			<button type="button" onclick={copy}>{copied ? t('common.action.copied') : t('common.action.copy')}</button>
			<button type="button" onclick={() => (created = null)}>{t('admin.invites.close')}</button>
		</div>
	{/if}

	{#if loaded && rows.length > 0}
		<table aria-label={t('admin.invites.title')}>
			<thead>
				<tr>
					<th scope="col">{t('admin.invites.colNote')}</th>
					<th scope="col">{t('admin.invites.colState')}</th>
					<th scope="col">{t('admin.invites.colUses')}</th>
					<th scope="col">{t('admin.invites.colExpires')}</th>
					<th scope="col"><span class="visually-hidden">{t('admin.invites.colActions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row">{row.note}</th>
						<td><span class="badge">{row.state}</span></td>
						<td>{row.uses}</td>
						<td>{row.expires}</td>
						<td>
							{#if row.canRevoke}
								<button type="button" disabled={busy} aria-label={t('admin.invites.revokeNamed', { note: row.note })}
									onclick={() => revoke(row.id)}>{t('admin.invites.revoke')}</button
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if loaded}
		<p class="hint">{t('admin.invites.none')}</p>
	{/if}
</section>

<style>
	.stack {
		display: grid;
		gap: 0.8rem;
		max-width: 22rem;
		margin-bottom: 1rem;
	}
	label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}
	input,
	select {
		font: inherit;
		padding: 0.45rem 0.6rem;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}
	.badge {
		padding: 0.1rem 0.45rem;
		border: 1px solid currentColor;
		border-radius: 0.8rem;
		font-size: 0.8em;
	}
	.link {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.8rem;
		margin-bottom: 1rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.5rem;
	}
	.link p {
		flex-basis: 100%;
		margin: 0;
	}
	.link input {
		flex: 1;
		min-width: 12rem;
	}
	.hint,
	.note {
		color: var(--readable-muted);
	}
	.error {
		color: var(--readable-bad);
		font-weight: 600;
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
