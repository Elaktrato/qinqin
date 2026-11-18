<script lang="ts">
	import { onMount } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { Button, Chip, Field, IconButton, Panel, Section, Select } from '$lib/ui';
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

<Section title={t('admin.invites.title')}>
	{#if closed}<p class="note" role="note">{closedNote()}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<form onsubmit={create} class="stack">
		<Field
			label={t('admin.invites.uses.label')}
			type="number"
			min={1}
			max={100}
			value={String(maxUses)}
			oninput={(event) => (maxUses = Number(event.currentTarget.value))}
			required
		/>
		<Select
			label={t('admin.invites.expires')}
			bind:value={expiry}
			options={EXPIRY_CHOICES.map((c) => ({
				value: c.days === null ? 'none' : String(c.days),
				label: c.label
			}))}
		/>
		<Field label={t('admin.invites.note')} bind:value={note} maxlength={100} autocomplete="off" />
		<Button type="submit" variant="primary" disabled={busy}>{t('admin.invites.create')}</Button>
	</form>

	{#if created}
		<div class="link" role="group" aria-label={t('admin.invites.newLink')}>
			<Panel raised>
				<p>{t('admin.invites.shownOnce')}</p>
				<Field
					label={t('admin.invites.link')}
					readonly
					value={created}
					onfocus={(e) => e.currentTarget.select()}
				/>
				<div class="actions">
					<IconButton icon="copy" label={t('common.action.copy')} onclick={copy} />
					<Button onclick={() => (created = null)}>{t('admin.invites.close')}</Button>
					<span role="status">{copied ? t('common.action.copied') : ''}</span>
				</div>
			</Panel>
		</div>
	{/if}

	{#if loaded && rows.length > 0}
		<table class="ui-table" aria-label={t('admin.invites.title')}>
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
						<td><Chip>{row.state}</Chip></td>
						<td>{row.uses}</td>
						<td>{row.expires}</td>
						<td>
							{#if row.canRevoke}
								<Button disabled={busy} aria-label={t('admin.invites.revokeNamed', { note: row.note })}
									onclick={() => revoke(row.id)}>{t('admin.invites.revoke')}</Button
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
</Section>

<style>
	.stack {
		display: grid;
		gap: var(--space-3);
		max-width: 22rem;
		margin-bottom: var(--space-4);
	}

	.link {
		margin-bottom: var(--space-4);
	}

	.link :global(.panel) {
		display: grid;
		gap: var(--space-2);
	}

	.link p {
		margin: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.hint,
	.note {
		color: var(--readable-muted);
	}

	.error {
		color: var(--readable-bad);
		padding-inline-start: var(--space-2);
		border-inline-start: 3px solid var(--bad);
	}
</style>
