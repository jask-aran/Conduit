---
name: managed-python
description: Before reading, writing or editing a spreadsheet, Word or PowerPoint file, PDF or data file (csv, parquet, xlsx, docx, pptx, pdf), or any data crunching in Python. Which libraries are there and how to edit files safely.
nudge:
  - bash: python
---

# Managed Python

Run `python` from Bash. Conduit puts its shared uv-managed environment on
`PATH` and keeps the working directory as it is: do not activate an
environment or install packages. Write task-specific scripts as needed, and keep
them and the files they touch inside the working directory.

## Libraries

- Data: pandas, PyArrow.
- Spreadsheets: `openpyxl` (xlsx), xlrd (xls), pyxlsb (xlsb), odfpy (ods).
- Documents: `docx` (Word), `pptx` (PowerPoint).
- PDF: pypdf, PyMuPDF (`fitz`).

`openpyxl`, `docx` and `pptx` are Paper's agent-safe forks, imported under the
usual names.

## Editing an existing file

The forks keep what they do not model when they edit a file, and refuse an
edit they cannot save safely. Report a refusal to the person instead of working
around it (never rebuild the file from scratch to get past one). Save with
`receipt=True` where it is offered, and read the receipt to confirm what
changed.

## Working well

- Look before changing: print the sheet names, the shape, the first rows, or
  the document's headings first.
- One script that does the whole job beats many small calls; print only what
  you need to read.
- Write to a new file when the person did not ask for theirs to change.
