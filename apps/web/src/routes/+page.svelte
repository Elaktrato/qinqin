<script lang="ts">
	import { goto } from '$app/navigation';
	import { APP_NAME } from '$lib/app';

	let query = $state('');

	async function search(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		await goto(`/search?q=${encodeURIComponent(query.trim())}`);
	}
</script>

<main class="home">
	<h1>{APP_NAME}</h1>

	<form class="search" role="search" onsubmit={search}>
		<input
			name="q"
			type="search"
			bind:value={query}
			aria-label="Search entries"
			placeholder="Search entries…"
		/>
		<button type="submit">Search</button>
	</form>

	<!-- Enabled home plugins render into this slot. -->
	<section class="plugin-slot" data-plugin-slot="home" aria-label="Home widgets"></section>
</main>

<style>
	.home h1 {
		margin-bottom: 1.5rem;
	}

	.search {
		display: flex;
		gap: 0.5rem;
		max-width: 32rem;
	}

	.search input {
		flex: 1;
		font: inherit;
		padding: 0.55rem 0.7rem;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		border-radius: 0.4rem;
		background: transparent;
		color: inherit;
	}

	.search button {
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 0.4rem;
		background: #0b6bcb;
		color: #fff;
		cursor: pointer;
	}

	.plugin-slot:empty {
		display: none;
	}

	.plugin-slot {
		margin-top: 2rem;
	}
</style>
