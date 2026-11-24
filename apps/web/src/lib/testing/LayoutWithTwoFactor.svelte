<script lang="ts">
	// The root layout around the two-factor settings (a test harness): what
	// the settings page holds must survive a reload of `me`.
	import Layout from '../../routes/+layout.svelte';
	import TwoFactorManage from '$lib/account/TwoFactorManage.svelte';
</script>

<Layout>
	<TwoFactorManage options={null} />
</Layout>
