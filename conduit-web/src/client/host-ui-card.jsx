import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function HostUiCard({ request, onRespond }) {
  if (!request) return null;
  const [value, setValue] = useState(
    request.kind === "editor" || request.kind === "input" ? (request.prefill || "") : "",
  );

  const dismiss = () => onRespond({ id: request.id, cancelled: true });
  const approve = () => onRespond({ id: request.id, confirmed: true });
  const deny = () => onRespond({ id: request.id, confirmed: false });
  const submitValue = () => onRespond({ id: request.id, value });

  return <div className="host-ui-card border-border bg-background mx-auto w-full max-w-3xl rounded-xl border p-3 text-sm shadow-sm">
    <div className="font-medium">{request.title || "Request"}</div>
    {request.kind === "confirm" && <p className="text-muted-foreground mt-1">{request.message}</p>}
    {request.kind === "select" && <div className="mt-2 flex flex-wrap gap-2">
      {(request.options || []).map((option) => (
        <Button key={option} size="sm" variant="outline" onClick={() => onRespond({ id: request.id, value: option })}>
          {option}
        </Button>
      ))}
    </div>}
    {request.kind === "input" && <Input
      className="mt-2"
      value={value}
      placeholder={request.placeholder || ""}
      onChange={(event) => setValue(event.target.value)}
    />}
    {request.kind === "editor" && <Textarea
      className="mt-2 min-h-24 font-mono text-xs"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />}
    <div className="mt-3 flex justify-end gap-2">
      <Button size="sm" variant="ghost" onClick={request.kind === "confirm" ? deny : dismiss}>
        {request.kind === "confirm" ? "Deny" : "Dismiss"}
      </Button>
      {request.kind === "confirm" && <Button size="sm" onClick={approve}>Approve</Button>}
      {(request.kind === "input" || request.kind === "editor") && <Button size="sm" onClick={submitValue}>Submit</Button>}
    </div>
  </div>;
}

export function HostUiRequests({ requests = [], onRespond }) {
  const request = requests[0];
  if (!request) return null;
  return <HostUiCard key={request.id} request={request} onRespond={onRespond} />;
}
