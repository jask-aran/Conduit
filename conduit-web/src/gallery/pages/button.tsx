import { createSignal } from "solid-js";
import { Button, Card, Icons } from "@/components/ui";
import { CopyIcon, PlusIcon, ShareIcon } from "lucide-solid";
import { row, token, type Page } from "../model";

function SaveExample() {
  const [saved, setSaved] = createSignal(false);
  return <Card title="Workspace identity" actions={<Button onClick={() => setSaved((value) => !value)}><Icons.Folder />{saved() ? "Saved" : "Save workspace"}</Button>} />;
}

export const buttonPage: Page = {
  title: "Button",
  summary: "A press that acts. Four forms (primary, secondary, ghost, destructive), each filled or as an outline, in five sizes; which form an action takes is its place's choice, not the button's. It reads the surface's --tint and --well, so the same button sits on the ground or over frost.",
  preview: () => <div class="g-row"><Button variant="ghost" outline>Cancel</Button><Button>Save</Button></div>,
  usage: `import { Button } from "@/components/ui";

<Button variant="ghost" outline size="sm" onClick={() => save()}>
  Save
</Button>`,
  examples: [
    row("primary", "filled in the text colour", () => <Button>Start</Button>, { code: "<Button>" }),
    row("primary · outline", "a line in the text colour", () => <Button outline>Save</Button>, { code: "<Button outline>" }),
    row("secondary", "the surface's well inside a --tint line; over frost there is no well, so it reads as ghost · outline", () => <Button variant="secondary">Browse…</Button>, { code: '<Button variant="secondary">' }),
    row("ghost", "text until washed", () => <Button variant="ghost">Skip</Button>, { code: '<Button variant="ghost">' }),
    row("ghost · outline", "a --tint hairline, nothing inside", () => <Button variant="ghost" outline>Cancel</Button>, { code: '<Button variant="ghost" outline>' }),
    row("destructive", "filled red", () => <Button variant="destructive">Delete</Button>, { code: '<Button variant="destructive">' }),
    row("destructive · outline", "a line in red", () => <Button variant="destructive" outline>Delete chat</Button>, { code: '<Button variant="destructive" outline>' }),
    row("sizes", "sm at a bar's end, the default, lg where one action is the page's", () => <div class="g-row"><Button size="sm">Small</Button><Button>Default</Button><Button size="lg">Large</Button></div>, { code: 'size="sm" | "lg"' }),
    row("icon", "an icon alone, in any form", () => <div class="g-row"><Button variant="ghost" size="icon-sm" aria-label="Copy"><CopyIcon /></Button><Button variant="ghost" size="icon-sm" aria-label="Share"><ShareIcon /></Button><Button variant="secondary" size="icon" aria-label="Add"><PlusIcon /></Button></div>, { code: 'size="icon" | "icon-sm"' }),
    row("icon-xs", "a small action beside a search result", () => <Button variant="ghost" size="icon-xs" aria-label="Search workspace"><Icons.Search /></Button>, { code: 'size="icon-xs"' }),
    row("with an icon", "an icon before the label", () => <Button><Icons.Folder />Use folder</Button>),
    row("disabled", "waits for a valid folder", () => <Button disabled><Icons.Folder />Use folder</Button>, { code: "<Button disabled>" }),
    row("long label", "a long workspace name in the action", () => <Button variant="secondary">Open conduit-web / gallery / component examples</Button>),
    row("in a card's actions", "press it: the label changes", () => <SaveExample />, { surfaces: ["ground"] }),
  ],
  tokens: [
    { title: "Every form", tokens: [
      token("--control", "its height (sm: --control-sm, lg: --control-lg)"),
      token("--radius-control", "its corner"),
      token("--text-row", "its text size; lg takes --text-body"),
      token("--weight-strong", "its text weight"),
    ] },
    { title: "From the surface", tokens: [
      token("--tint", "secondary's and ghost · outline's line; every form's wash under the pointer"),
      token("--well", "secondary's fill"),
    ] },
    { title: "Its colours", tokens: [
      token("--foreground", "primary's fill and outline's line and text"),
      token("--background", "primary's text"),
      token("--destructive", "destructive's fill, or its line and text as an outline"),
    ] },
  ],
  api: ["Button"],
};
