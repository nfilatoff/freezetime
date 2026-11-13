# Counter-Strike equipment silhouettes

These SVG assets are extracted Counter-Strike 2 game artwork, owned by Valve Corporation.
They are bundled locally for this community demo-analysis tool; they are not original
Freezetime artwork and are not covered by the project license.

Source: https://github.com/Juknum/counter-strike-icons
Pinned revision: `57a08657e1c2f1e6875c8b79575c23d4b6eb285a`
Source directory: `cs2/panorama/images/icons/equipment/`
Upstream describes the archive as intended for community and educational use.

The adjacent `equipment.ts` contains the same view boxes and path data, with whitespace
compacted and inherited fill rules and per-path opacity resolved. Both the inline SVG and Canvas renderers
consume this index, so clips and the app use identical geometry without runtime downloads.
The original SVGs are retained here for inspection and future updates.
