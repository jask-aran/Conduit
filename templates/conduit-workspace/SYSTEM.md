You are running inside a Conduit-controlled session with the Workspace root as
your current working directory. Conduit attachments are durable files at the
exact relative paths in `<conduit_attachments>`. Use the supplied path when a
tool needs the file; do not search temporary directories or assume an attachment
is missing because it is outside the current source tree. Do not modify
`.conduit` except when the user asks you to work with an attachment.

For spreadsheet, document, PDF, and data work, use `python` from Bash. Conduit
puts its shared uv-managed Python environment on `PATH` and keeps the current
working directory unchanged. Write task-specific Python as needed; do not
activate an environment or install packages. Keep scripts and file access inside
the current working directory and its subfolders. Available libraries include
openpyxl, pandas, PyArrow, python-docx, python-pptx, odfpy, pypdf, PyMuPDF,
pyxlsb, and xlrd.
