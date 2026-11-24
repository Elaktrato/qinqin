<script lang="ts">
	// The readings of a card's back as a small table: one row per reading kind,
	// the kind named once in a row header ("Pinyin", "On", "Kun") and its values
	// side by side, separated by " | ". Kinds keep the order they first appear in.
	// Each value carries the reading's own language; the separator is hidden from
	// screen readers, which move through the values one by one.
	import { readingLabel } from '$lib/languages/format';
	import { readingLang } from '$lib/i18n/lang';

	interface Reading {
		type: string;
		value: string;
	}

	let {
		readings,
		language,
		label,
		emphasis = false
	}: {
		readings: readonly Reading[];
		language: string;
		/** The table's accessible name ("Readings"). */
		label: string;
		/** Values in <strong> (the tone card's answer). */
		emphasis?: boolean;
	} = $props();

	const rows = $derived.by(() => {
		const byType = new Map<string, string[]>();
		for (const reading of readings) {
			const key = reading.type.trim().toLowerCase();
			const values = byType.get(key);
			if (values === undefined) byType.set(key, [reading.value]);
			else values.push(reading.value);
		}
		return [...byType].map(([type, values]) => ({
			type,
			label: readingLabel(type),
			lang: readingLang(type, language),
			values
		}));
	});
</script>

{#if rows.length > 0}
	<table class="reading-table" aria-label={label}>
		<tbody>
			{#each rows as row (row.type)}
				<tr data-type={row.type}>
					{#if row.label !== null}<th scope="row">{row.label}</th>{/if}
					<td colspan={row.label === null ? 2 : 1}>
						{#each row.values as value, index (index)}
							{#if index > 0}<span class="sep" aria-hidden="true">{' | '}</span>{/if}
							{#if emphasis}<strong class="fa-reading" lang={row.lang}>{value}</strong>
							{:else}<span class="fa-reading" lang={row.lang}>{value}</span>{/if}
						{/each}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.reading-table {
		border-collapse: collapse;
		margin: 0 auto;
	}
	th,
	td {
		padding: var(--space-1) var(--space-2);
		vertical-align: baseline;
	}
	th {
		color: var(--readable-muted);
		font-size: var(--font-size-label);
		font-weight: var(--weight-regular);
		text-align: end;
		white-space: nowrap;
	}
	td {
		text-align: start;
	}
	.sep {
		color: var(--readable-muted);
		white-space: pre;
	}
</style>
