<script lang="ts">
	import { onMount } from 'svelte';
	import { errorText } from '$lib/api/apiErrors';
	import { t } from '$lib/i18n';
	import { listTokens, revokeAllTokens, revokeToken } from '$lib/api/tokens';
	import { tokenRows, type TokenDto } from '$lib/account/tokensView';
	import { workspaces } from '$lib/workspaces';
	import CreateTokenDialog from './CreateTokenDialog.svelte';

	// Settings → Account → Access tokens: the list, revoke (one or all, each
	// confirmed) and "New token". oncount tells the page how many exist, for
	// the "your access tokens are revoked too" notes.
	let { oncount }: { oncount?: (n: number) => void } = $props();

	let tokens = $state<TokenDto[]>([]);
	let loaded = $state(false);
	let error = $state('');
	let busy = $state(false);
	let creating = $state(false);
	let confirmOne = $state<number | null>(null);
	let confirmAll = $state(false);

	const wsList = $derived($workspaces.list.map((w) => ({ id: w.id, name: w.name ?? '' })));
	const rows = $derived(tokenRows(tokens, wsList, new Date()));

	function set(list: TokenDto[]): void {
		tokens = list;
		oncount?.(list.length);
	}

	async function load(): Promise<void> {
		try {
			set(await listTokens());
			error = '';
		} catch (err) {
			error = errorText(err, t('settings.tokens.error.load'));
		} finally {
			loaded = true;
		}
	}

	async function revokeOne(id: number): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeToken(id);
			confirmOne = null;
			await load();
		} catch (err) {
			error = errorText(err, t('settings.tokens.error.revoke'));
		} finally {
			busy = false;
		}
	}

	async function revokeEvery(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await revokeAllTokens();
			confirmAll = false;
			await load();
		} catch (err) {
			error = errorText(err, t('settings.tokens.error.revokeAll'));
		} finally {
			busy = false;
		}
	}

	onMount(() => void load());
</script>

<section aria-labelledby="account-tokens-heading" class="block">
	<h2 id="account-tokens-heading">{t('settings.tokens.title')}</h2>
	<p class="hint">{t('settings.tokens.intro')}</p>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if loaded && rows.length === 0 && !error}
		<p>{t('settings.tokens.none')}</p>
	{:else if rows.length > 0}
		<table aria-label={t('settings.tokens.title')}>
			<thead>
				<tr>
					<th scope="col">{t('settings.tokens.colName')}</th>
					<th scope="col">{t('settings.tokens.colAccess')}</th>
					<th scope="col">{t('settings.tokens.colExpiry')}</th>
					<th scope="col">{t('settings.tokens.colLastUsed')}</th>
					<th scope="col"><span class="visually-hidden">{t('settings.tokens.colActions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<th scope="row">{row.name}<br /><code>{row.masked}</code></th>
						<td>{row.scopeLabel}<br />{row.workspaceLabel}</td>
						<td>{row.expiryText}</td>
						<td>{row.lastUsedText}</td>
						<td>
							<button type="button" disabled={busy} aria-label={t('settings.tokens.revokeNamed', { name: row.name })} onclick={() => (confirmOne = row.id)}
								>{t('settings.tokens.revoke')}</button
							>
							{#if confirmOne === row.id}
								<div class="confirm" role="group" aria-label={t('settings.tokens.confirmRevokeNamed', { name: row.name })}>
									<p>{t('settings.tokens.confirmRevokeText', { name: row.name })}</p>
									<button type="button" disabled={busy} onclick={() => revokeOne(row.id)}>{t('settings.tokens.confirmRevokeYes')}</button>
									<button type="button" disabled={busy} onclick={() => (confirmOne = null)}>{t('common.action.cancel')}</button>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<div class="actions">
		<button type="button" disabled={busy} onclick={() => (creating = true)}>{t('settings.tokens.new')}</button>
		{#if rows.length > 0}
			<button type="button" disabled={busy} onclick={() => (confirmAll = true)}>{t('settings.tokens.revokeAll')}</button>
		{/if}
	</div>
	{#if confirmAll}
		<div class="confirm" role="group" aria-label={t('settings.tokens.confirmRevokeAll')}>
			<p>{t('settings.tokens.confirmRevokeAllText')}</p>
			<button type="button" disabled={busy} onclick={revokeEvery}>{t('settings.tokens.confirmRevokeAllYes')}</button>
			<button type="button" disabled={busy} onclick={() => (confirmAll = false)}>{t('common.action.cancel')}</button>
		</div>
	{/if}
</section>

{#if creating}
	<CreateTokenDialog
		workspaces={wsList}
		oncreated={(tok) => set([tok, ...tokens])}
		onclose={() => {
			creating = false;
			void load();
		}}
	/>
{/if}

<style>
	.block {
		margin-bottom: 2rem;
	}
	.hint {
		margin: 0;
		opacity: 0.75;
	}
	.error {
		margin: 0;
		color: #c62828;
		font-weight: 600;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		margin: 0.75rem 0;
	}
	th,
	td {
		text-align: left;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		vertical-align: top;
	}
	tbody th {
		font-weight: 600;
	}
	code {
		font-weight: 400;
		font-size: 0.85em;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	button {
		font: inherit;
		padding: 0.45rem 0.9rem;
		border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.confirm {
		margin-top: 0.6rem;
		padding: 0.6rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.confirm p {
		flex-basis: 100%;
		margin: 0;
	}
</style>
