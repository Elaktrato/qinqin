// The heatmap plugin's manifest: the identity the web build ships
// with. Feature plugins are admin-installed server-side; this manifest
// lets the home slot render the plugin's component without asking the
// server for it.
export const heatmapManifest = {
	id: 'heatmap',
	name: 'Study heatmap',
	surfaces: ['home-widget']
};
