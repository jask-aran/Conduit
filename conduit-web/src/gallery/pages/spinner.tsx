// Props: class.
import { createSignal, Show } from "solid-js";
import { Button, Card, PaneLoading } from "@/components/ui";
import { Spinner } from "@/components/ui";
import { row, token, type Page } from "../model";

function SpinnerAction() {
  const [pending, setPending] = createSignal(false);
  return <><Button disabled={pending()} onClick={() => setPending(true)}><Show when={pending()} fallback="Save"><Spinner />Saving voice settings…</Show></Button><Show when={pending()}><Button variant="ghost" onClick={() => setPending(false)}>Finish save</Button></Show></>;
}

export const spinnerPage: Page = {
  title: "Spinner",
  summary: "Spinner reads the surface's --tint and --well values.",
  preview: () => <Spinner />,
  usage: `import { Spinner } from "@/components/ui";

<span role="status">
  <Spinner /> Connecting…
</span>`,
  examples: [
    row("pending action", "Click to switch between Save and a disabled pending action.", () => <SpinnerAction />, { code: "<Button disabled><Spinner />Saving…</Button>" }),
    row("workspace loading", "Loading indicator in the workspace container.", () => <PaneLoading><Spinner /><span>Loading workspace conduit-web/src/client/workspace</span></PaneLoading>, { code: "<PaneLoading><Spinner />…</PaneLoading>", surfaces: ["ground"] }),
    row("clone title", "Spinner beside a long operation title.", () => <Card embedded title={<><Spinner /> Cloning conduit-web into /work/projects/conduit-web-development</>} detail="Closing this tab does not stop the operation." />, { code: "<Card title={<><Spinner /> Cloning workspace</>} />", surfaces: ["ground"] }),
  ],
  motion: [
    row("Spinner", "A ring turns while an operation is pending.", () => <Spinner />),
  ],
  tokens: [{ title: "Spinner", tokens: [
    token("--icon", "Icon or thumb size"),
    token("--stroke-thin", "Ring stroke"),
    token("--tint", "Surface tint"),
    token("--foreground", "Text or filled track colour"),
    token("--duration-spin", "Rotation duration"),
  ] }],
  api: ["Spinner"],
};
