export function splitQuoted(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].trim();
    const next = (lines[index + 1] || "").trim();
    // "On Mon, 2 Nov 2026 at 16:48, jbot <…> wrote:", which may wrap before "wrote:"; Outlook's header block.
    const attribution = (/^On\s/.test(line) && (/wrote:$/i.test(line) || /wrote:$/i.test(next)))
      || /^-{2,}\s*Original Message/i.test(line) || (/^From:\s/i.test(line) && /^(Sent|Date):\s/i.test(next));
    const quoting = line.startsWith(">") && lines.slice(index).every((rest) => !rest.trim() || rest.trim().startsWith(">"));
    if (attribution || quoting) return { own: lines.slice(0, index).join("\n").trim(), quoted: lines.slice(index).join("\n").trim() };
  }
  return { own: String(text || "").trim(), quoted: "" };
}
