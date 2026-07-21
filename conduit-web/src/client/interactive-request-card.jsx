import { useEffect, useId, useState } from "react";
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABELS = {
  pending: "Waiting",
  submitting: "Submitting",
  resolved: "Answered",
  error: "Send failed",
};

function responseLabel(response) {
  if (!response) return null;
  if (response.cancelled) return "Dismissed";
  if (typeof response.confirmed === "boolean") return response.confirmed ? "Approved" : "Denied";
  if (response.value != null) return String(response.value);
  return null;
}

function statusVariant(status) {
  if (status === "error") return "destructive";
  if (status === "resolved" || status === "submitting") return "secondary";
  return "outline";
}

export function InteractiveRequestCard({ request, onSubmit }) {
  const inputId = useId();
  const requestId = request?.id || "";
  const initialValue = request?.kind === "input" || request?.kind === "editor"
    ? (request.prefill || "")
    : "";
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [requestId]);

  if (!request) return null;

  const status = request.status || "pending";
  const pending = status === "pending";
  const submitting = status === "submitting";
  const resolved = status === "resolved";
  const failed = status === "error";
  const answer = responseLabel(request.response);
  const submit = (response) => {
    if (!pending || typeof onSubmit !== "function") return;
    onSubmit(response);
  };
  const retry = () => {
    if (!failed || !request.response || typeof onSubmit !== "function") return;
    onSubmit(request.response);
  };

  return <Card
    size="sm"
    className="interactive-request-card"
    data-request-id={request.id}
    data-state={status}
  >
    <CardHeader>
      <CardTitle>{request.title || "Request"}</CardTitle>
      {request.message && <CardDescription>{request.message}</CardDescription>}
      <CardAction>
        <Badge variant={statusVariant(status)} aria-live="polite">
          {submitting && <Spinner data-icon="inline-start" />}
          {STATUS_LABELS[status] || STATUS_LABELS.pending}
        </Badge>
      </CardAction>
    </CardHeader>

    <CardContent className="flex flex-col gap-3">
      {request.kind === "select" && !resolved && <div className="flex flex-wrap gap-2" role="group" aria-label={request.title || "Options"}>
        {(request.options || []).map((option) => <Button
          key={option}
          type="button"
          size="sm"
          variant="outline"
          disabled={!pending}
          onClick={() => submit({ value: option })}
        >
          {option}
        </Button>)}
      </div>}

      {(request.kind === "input" || request.kind === "editor") && !resolved && <FieldGroup>
        <Field data-disabled={!pending || undefined}>
          <FieldLabel htmlFor={inputId}>Response</FieldLabel>
          {request.kind === "editor" ? <Textarea
            id={inputId}
            className="min-h-24 font-mono text-xs"
            value={value}
            disabled={!pending}
            onChange={(event) => setValue(event.target.value)}
          /> : <Input
            id={inputId}
            value={value}
            placeholder={request.placeholder || ""}
            disabled={!pending}
            onChange={(event) => setValue(event.target.value)}
          />}
        </Field>
      </FieldGroup>}

      {resolved && <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Response recorded</AlertTitle>
        {answer != null && <AlertDescription className="whitespace-pre-wrap break-words">{answer}</AlertDescription>}
      </Alert>}

      {failed && <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Response not sent</AlertTitle>
        <AlertDescription>{request.error || "Try sending the response again."}</AlertDescription>
      </Alert>}
    </CardContent>

    {!resolved && <CardFooter className="justify-end gap-2">
      {failed ? <Button
        type="button"
        size="sm"
        disabled={!request.response || typeof onSubmit !== "function"}
        onClick={retry}
      >
        Retry
      </Button> : <>
        {request.kind === "confirm" && <>
          <Button type="button" size="sm" variant="ghost" disabled={!pending} onClick={() => submit({ confirmed: false })}>
            Deny
          </Button>
          <Button type="button" size="sm" disabled={!pending} onClick={() => submit({ confirmed: true })}>
            Approve
          </Button>
        </>}
        {request.kind !== "confirm" && <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!pending}
          onClick={() => submit({ cancelled: true })}
        >
          Dismiss
        </Button>}
        {(request.kind === "input" || request.kind === "editor") && <Button
          type="button"
          size="sm"
          disabled={!pending}
          onClick={() => submit({ value })}
        >
          Submit
        </Button>}
      </>}
    </CardFooter>}
  </Card>;
}
