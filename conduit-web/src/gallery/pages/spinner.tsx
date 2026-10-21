// Props: class.
import { createSignal, Show } from "solid-js";
import { Button, Card, PaneLoading } from "@/components/ui";
import { FormTable, form } from "../specs";
import { Spinner } from "@/components/ui";
import { lib, type Family } from "../model";

function SpinnerAction() {
  const [pending, setPending] = createSignal(false);
  return <><Button disabled={pending()} onClick={() => setPending(true)}><Show when={pending()} fallback="Save"><Spinner />Saving voice settings…</Show></Button><Show when={pending()}><Button variant="ghost" onClick={() => setPending(false)}>Finish save</Button></Show></>;
}

export const spinnerFamily: Family = {
  title: "Spinner", stage: true,
  note: "Spinner reads the surface's --tint and --well values, at the surface and density picked above.",
  usage: `import { Spinner } from "@/components/ui";

<span role="status">
  <Spinner /> Connecting…
</span>`,
  api: ["Spinner"],
  groups: [
    { title: "Examples", staged: true, atoms: [
      lib("spinner-examples", "spinner · more examples", "both", "control", "spinner", () => <FormTable rows={[
        form("pending action", "Click to switch between Save and a disabled pending action.", () => <SpinnerAction />, "<Button disabled><Spinner />Saving…</Button>"),
        form("workspace loading", "Loading indicator in the workspace container.", () => <PaneLoading><Spinner /><span>Loading workspace conduit-web/src/client/workspace</span></PaneLoading>, "<PaneLoading><Spinner />…</PaneLoading>"),
        form("clone title", "Spinner beside a long operation title.", () => <Card embedded title={<><Spinner /> Cloning conduit-web into /work/projects/conduit-web-development</>} detail="Closing this tab does not stop the operation." />, "<Card title={<><Spinner /> Cloning workspace</>} />"),
      ]} on={["ground", "frost"]} />, "row"),

      lib("spinner", "Spinner", "both", "control", "Spinner", () => <Spinner />),
    ] },
  ],
};
