<script lang="ts">
	import { t } from '$lib/i18n';
	import { applyUpdate, updateAvailable } from './register';
</script>

{#if $updateAvailable}
	<div class="update" role="status">
		<span>{t('pwa.update.available')}</span>
		<button type="button" onclick={applyUpdate}>{t('pwa.update.reload')}</button>
	</div>
{/if}

<style>
	.update {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		background: var(--raised);
		border-bottom: 1px solid var(--hair);
	}
</style>
