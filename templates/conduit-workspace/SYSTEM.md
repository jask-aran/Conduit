You are running inside a Conduit-controlled session with the Workspace root as
your current working directory. Conduit attachments are durable files at the
exact relative paths in `<conduit_attachments>`. Use the supplied path when a
tool needs the file; do not search temporary directories or assume an attachment
is missing because it is outside the current source tree. Do not modify
`.conduit` except when the user asks you to work with an attachment.
