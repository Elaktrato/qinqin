# Appearance and themes

How qinqin looks is yours to choose: a colour theme for light and one for dark, an accent colour, the corners and spacing of the interface, and the face used for hanzi and kanji. The choice belongs to your account, so every device you sign in on gets it.

## Where to change it

- **Settings → Appearance** (`/settings?tab=appearance`) holds every option.
- **Theme** in the account menu (your avatar, top right; in the phone drawer at the bottom) is a quick switch: it opens a list of the themes of the mode you see right now, each with a small swatch of its colours, plus **Appearance settings…**. Picking one saves it at once and keeps your accent when the new theme offers it. **Back** (or the left arrow key) returns to the account menu; Escape closes it.

## Mode, light theme and dark theme

- **Mode**: **System** follows your device's light or dark setting and uses the two themes below; **Light** and **Dark** stay on one of them.
- **Light theme** and **Dark theme**: one theme for each. The lists are grouped by family. Built in:

| Family | Light | Dark |
|---|---|---|
| qinqin | qinqin Day | qinqin Night, qinqin Deep |
| qinqin Neon | Neon Day | Neon Night |
| qinqin Pigments | Celadon | Indigo |
| qinqin Pop | Bubblegum | Grape |
| Catppuccin | Latte | Frappé, Macchiato, Mocha |
| Rosé Pine | Rosé Pine Dawn | Rosé Pine, Rosé Pine Moon |
| Solarized | Solarized Light | Solarized Dark |
| Nord, Gruvbox, Dracula, Tokyo Night, Everforest, Kanagawa | | Nord, Gruvbox, Dracula, Tokyo Night, Everforest Dark, Kanagawa Wave |

The first four families are qinqin's own house themes (qinqin Day, Night and Deep, and the Neon, Pigments and Pop extras); the rest follow well-known editor themes. Themes an administrator installed as a **theme pack** appear in their own family, and themes without one under **Other themes** ([installing packs](Admin-data-packs)). A list shows the themes made for its mode; a theme you chose for the other mode stays listed and selected, so you can see your choice.

- **Accent**: each theme has a few accent colours (the colour of links, the current section, primary buttons and the reader's word marks). Only accents that stand out at least 3:1 against the theme's background are offered ("Only accents that stand out enough against this theme's background are offered"). If your saved accent is not offered by a theme (after a theme change, or a choice made on another device), the theme's own default accent is used and your choice is kept.

A fresh account starts on **qinqin Day** (accent azure) and **qinqin Night** (accent cyan) with the mode on System. An account that chose a theme before keeps it.

## Corners, spacing and the hanzi and kanji font

- **Corners**: Sharp, Soft (the default) or Round.
- **Spacing**: Compact or Comfortable (the default).
- **Hanzi and kanji font**: **Sans** (the default), **Serif** or **Kai**. Every Chinese and Japanese text in the app uses it: cards, entries, search results, lessons and the reader (unless the reader has a font of its own, see [Reader](Reader#display-settings)). The face follows the text's language, so simplified Chinese, traditional Chinese and Japanese each get their own forms; for Japanese, Kai is a textbook-style face.

  The faces come from **font packs** that an administrator installs (qinqin Sans, Serif and Kai for simplified Chinese, traditional Chinese and Japanese). A page downloads only the small slices of a face that hold the characters it shows. Without a pack for your choice, your device's own fonts are used and the option says so ("Uses your device's fonts; an administrator can install a font pack."). A slice that fails to load falls back to the device's fonts without a message.
- **Interface font**: menus, buttons and other interface text, as well as pinyin and romaji, use Figtree, which is built into the app and served by your own server. It is not a setting.

## Preview, Save and Reset

Every change shows at once, across the whole app, and the **Preview** shows body text, secondary text, hanzi and kanji samples, the primary action, the four grade colours and the reader's word marks. **Save** keeps the change ("Appearance saved."); **Discard changes** goes back to your saved look; **Reset to defaults** puts back the System mode, qinqin Day and qinqin Night with their accents, soft corners, comfortable spacing and Sans (save to keep it). If you leave the tab without saving, the app returns to your saved look. Saving only writes what you changed, so a change made meanwhile on another device is not overwritten.

A theme switch you make fades the colours over briefly; with reduced motion asked for by your system it changes at once.

## What happens when...

- **The theme list cannot be loaded**: the page says so and offers only the built-in qinqin Day and qinqin Night.
- **Your saved appearance has not loaded yet**: you can try changes out, but cannot save them until it has.
- **An administrator removes a theme pack** you used: you see your mode's default theme (qinqin Day or qinqin Night) instead; your choice is kept and comes back if the pack is installed again.
- **You open the app offline or before it has loaded**: this device remembers the colours you last used, so the app starts in your theme; a device that never saw your theme starts in qinqin Day or qinqin Night. Two accounts on one browser share that memory, so the second may see the first one's colours for a moment.

## Contrast

All nine qinqin house themes pass every contrast check. Some of the editor themes have pairs below the usual minimums (often their secondary text); qinqin then shows secondary and error text in a darker or lighter shade of its own so it stays readable. When an administrator installs a theme pack, Settings → Data shows the measured contrast of each of its themes.

## Your data

The appearance setting is one row of your account: it syncs to every device and is part of [your data](Your-data) (download and restore). Credits for the built-in themes, Figtree and any installed font packs are on the Sources page.

## For client implementers

The theme file format, contrast rules, the derived colour tokens and the `appearance` row are specified in `docs/contracts/themes/`; font packs and `GET /api/fonts` in `docs/contracts/fonts/`.
