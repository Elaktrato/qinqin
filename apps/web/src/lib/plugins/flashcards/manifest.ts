// The flashcards plugin's manifest: the identity the web build ships
// with. Feature plugins are admin-installed server-side; this manifest
// lets the home slot render the plugin's component without asking the
// server for it.
export const flashcardsManifest = {
	id: 'qinqin-flashcards',
	name: 'Flashcards',
	version: '1.0',
	surfaces: ['home-widget']
};
