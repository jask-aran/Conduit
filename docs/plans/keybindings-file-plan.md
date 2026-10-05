# Keybindings as a file

Status: idea, not started. Nothing in the tree is named `keybindings`.

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
