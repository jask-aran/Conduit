/* A cell's link edited over the cell (Ctrl+K): the text it shows and the address it goes to. */
import { createEffect, createSignal, on, Show } from "solid-js";
import { Actions } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input } from "@/components/ui/controls";
import { Popover, PopoverContent } from "@/components/ui/menus";
import type { SheetBox } from "./host";

/** `at`: the cell's box and what it holds now (null: shut). `onSave` with the text and the address (empty: no link). */
export function LinkPrompt(props: { at: { box: SheetBox; text: string; address: string; own: boolean } | null; frame: () => HTMLElement | undefined; onSave(text: string, address: string): void; onClose(): void }) {
  const [text, setText] = createSignal(""), [address, setAddress] = createSignal("");
  createEffect(on(() => props.at, (at) => { if (at) { setText(at.text); setAddress(at.address); } }));
  const save = (event: SubmitEvent) => { event.preventDefault(); props.onSave(text().trim() || address().trim(), address().trim()); };
  return <Popover open={props.at !== null} onOpenChange={(open) => { if (!open) props.onClose(); }} anchorRef={props.frame} placement="bottom-start"
    anchorRect={() => { const box = props.at?.box; return box ? new DOMRect(box.left, box.top, box.width, box.height) : undefined; }}>
    <PopoverContent aria-label="Link" width="md">
      <CardForm onSubmit={save}>
        <Field label="Text"><Input value={text()} onInput={(event) => setText(event.currentTarget.value)} /></Field>
        <Field label="Address"><Input value={address()} placeholder="https://… or #Sheet1!A1" autofocus onInput={(event) => setAddress(event.currentTarget.value)} /></Field>
        <Actions>
          <Show when={props.at?.own}><Button type="button" variant="ghost" outline onClick={() => props.onSave(text(), "")}>Remove link</Button></Show>
          <Button type="submit" disabled={!address().trim()}>Save</Button>
        </Actions>
      </CardForm>
    </PopoverContent>
  </Popover>;
}
