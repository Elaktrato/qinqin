<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError, api } from '$lib/api/client';
	import type { Dictionary } from '$lib/api/types';

	let dictionaries = $state<Dictionary[]>([]);
	let loading = $state(true);
	let error = $state('');

	function message(err: unknown, fallback: string): string {
		if (err instanceof ApiError && err.message) return err.message;
		if (err instanceof Error && err.message) return err.message;
		return fallback;
	}

	async function load(): Promise<void> {
		loading = true;
		error = '';
		try {
			// The list endpoint is public; a stale token must not turn a
			// credits page into a login redirect.
			dictionaries = await api<Dictionary[]>('/api/dictionaries', { auth: false });
		} catch (err) {
			dictionaries = [];
			error = message(err, 'Could not load dictionary credits.');
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<main class="sources">
	<h1>Sources</h1>
	<p class="lede">
		Meanings, character data, and stroke diagrams come from upstream open datasets. Their
		credits and licenses are listed here.
	</p>

	<section>
		<h2>Installed dictionaries</h2>

		{#if loading}
			<p>Loading dictionary credits…</p>
		{:else if error}
			<p class="error" role="alert">{error}</p>
			<button type="button" onclick={load}>Retry</button>
		{:else if dictionaries.length === 0}
			<p>No dictionaries are installed.</p>
			<p class="hint">
				Run <code>qinqin seed</code>, or install a dictionary pack, to add meanings and
				character data.
			</p>
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Version</th>
							<th scope="col">License</th>
							<th scope="col">Attribution</th>
						</tr>
					</thead>
					<tbody>
						{#each dictionaries as dictionary (dictionary.id)}
							<tr>
								<td class="name">{dictionary.name}</td>
								<td>{dictionary.version}</td>
								<td>{dictionary.license}</td>
								<td>{dictionary.attribution}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<p class="notice">
			Bundled dictionaries are redistributed as unmodified upstream files. Each pack directory
			under <code>plugins/data/</code> carries the upstream <code>LICENSE</code> and
			<code>ATTRIBUTION.md</code>; the full index is in <code>docs/sources.md</code>. The
			dictionaries' licenses are independent of the application code's license.
		</p>
	</section>

	<section>
		<h2>Stroke-order data</h2>
		<p>
			Stroke-order animations use
			<a href="https://www.npmjs.com/package/hanzi-writer-data" rel="noreferrer">hanzi-writer-data</a>,
			derived from the
			<a href="https://github.com/skishore/makemeahanzi" rel="noreferrer">Make Me a Hanzi</a>
			dataset. That data is licensed under the <strong>Arphic Public License</strong> and is used
			unmodified.
		</p>
	</section>

	<section>
		<h2>More</h2>
		<p>
			Full license texts and attribution notices live in each pack directory under
			<code>plugins/data/</code>; <code>docs/sources.md</code> indexes the bundled upstream
			sources. If this instance installs additional packs, their credits appear in the table
			above once installed.
		</p>
	</section>
</main>

<style>
	.sources section {
		margin-top: 2rem;
	}

	.lede {
		margin-top: 0;
		opacity: 0.85;
	}

	.hint {
		opacity: 0.75;
	}

	.table-wrap {
		overflow-x: auto;
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		border-radius: 0.4rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95rem;
	}

	th,
	td {
		padding: 0.5rem 0.7rem;
		text-align: left;
		vertical-align: top;
		border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	th {
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		opacity: 0.75;
		white-space: nowrap;
	}

	.name {
		font-weight: 600;
		white-space: nowrap;
	}

	.notice {
		margin: 0.9rem 0 0;
		font-size: 0.9rem;
		opacity: 0.85;
	}

	.error {
		margin: 0 0 0.6rem;
		color: #c62828;
		font-weight: 600;
	}

	button {
		font: inherit;
		font-weight: 600;
		padding: 0.45rem 0.85rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		cursor: pointer;
	}

	a {
		color: inherit;
	}
</style>
