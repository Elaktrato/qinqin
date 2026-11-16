<script lang="ts">
	import { onMount } from 'svelte';
	import { apiErrorBody } from '$lib/api/client';
	import {
		createInvite,
		getAuthSettings,
		listInvites,
		revokeInvite,
		type InviteDto
	} from '$lib/api/adminSettings';
	import {
		CLOSED_NOTE,
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

	function message(err: unknown, fallback: string): string {
		return apiErrorBody(err)?.message || (err instanceof Error ? err.message : '') || fallback;
	}

	async function load(): Promise<void> {
		try {
			const [list, settings] = await Promise.all([listInvites(), getAuthSettings()]);
			invites = list;
			closed = settings.registration === 'closed';
			error = '';
		} catch (err) {
			error = message(err, 'Could not load the invites.');
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
			error = message(err, 'Could not create the invite.');
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
			error = message(err, 'Could not revoke the invite.');
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
			error = 'Could not copy. Select the link and copy it by hand.';
		}
	}
</script>

<section aria-labelledby="admin-invites-heading">
	<h2 id="admin-invites-heading">Invites</h2>
	{#if closed}<p class="note" role="note">{CLOSED_NOTE}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<form onsubmit={create} class="stack">
		<label>
			Uses (1 to 100)
			<input type="number" min="1" max="100" bind:value={maxUses} required />
		</label>
		<label>
			Expires
			<select bind:value={expiry}>
				{#each EXPIRY_CHOICES as c (c.label)}
					<option value={c.days === null ? 'none' : String(c.days)}>{c.label}</option>
				{/each}
			</select>
		</label>
		<label>
			Note (optional)
			<input bind:value={note} maxlength="100" autocomplete="off" />
		</label>
		<button type="submit" disabled={busy}>Create invite link</button>
	</form>

	{#if created}
		<div class="link" role="group" aria-label="New invite link">
			<p>This link is shown once. Copy it now and hand it over.</p>
			<input readonly value={created} aria-label="Invite link" onfocus={(e) => e.currentTarget.select()} />
			<button type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
			<button type="button" onclick={() => (created = null)}>Close</button>
		</div>
	{/if}

	{#if loaded && rows.length > 0}
		<table aria-label="Invites">
			<thead>
				<tr>
					<th scope="col">Note</th>
					<th scope="col">State</th>
					<th scope="col">Uses</th>
					<th scope="col">Expires</th>
					<th scope="col"><span class="visually-hidden">Actions</span></th>
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
								<button type="button" disabled={busy} aria-label={`Revoke invite ${row.note}`} onclick={() => revoke(row.id)}>Revoke</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if loaded}
		<p class="hint">No invites yet.</p>
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
		opacity: 0.8;
	}
	.error {
		color: #c62828;
		font-weight: 600;
	}
</style>
