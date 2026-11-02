# Keybindings as a file

Status: built 2026-11-02. The hub keeps the overrides in `keybindings.json` beside `preferences.json`
(`conduit-web/src/keybindings.js` has the syntax; `PreferencesStore` reads, writes and watches it). Overrides saved
before move into it on the first load. The API still serves them in `shortcutOverrides`, in the stored shape, so
clients are unchanged: each keeps a copy in browser storage for the first paint, takes the hub's on load and when
the file changes (`keybindings_changed` on the runtime stream), and uploads its own only to a hub with no file.
Settings › Shortcuts shows the file's path and any entry it could not read.

Make Conduit's keyboard overrides a readable JSON file on the server that a
person — or an agent — can edit directly, instead of the opaque
`{ code, key, modifiers[] }` shape currently buried in `shortcutOverrides`
inside `preferences.json`. The format people expect is `"mod+shift+g"`, and a
file is a thing an agent can be pointed at; a preference blob is not.

Everything underneath already exists: `ShortcutManager` owns the commands,
contexts and two-stroke sequences, conflicts are already detected, and the
overrides already persist and already travel between devices. What is missing
is a human-readable syntax, a file to hold it, and a migration off the stored
shape.
