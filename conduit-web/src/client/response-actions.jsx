import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, PencilIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function Action({ label, onClick, children }) {
  return <Tooltip><TooltipTrigger asChild>
    <Button variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>{children}</Button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

export function ResponseActions({ message, precedingUserId, partialContinue, onCopy, onEdit, onRegenerate, onContinue }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return undefined; const timer = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(timer); }, [copied]);
  if (message.role === "user" && !String(message.id || "").startsWith("user_")) return <div className="response-actions response-actions-user">
    <Action label="Edit from here" onClick={() => onEdit(message)}><PencilIcon /></Action>
  </div>;
  if (message.role === "user") return null;
  return <div className="response-actions">
    <Action label={copied ? "Copied" : "Copy Markdown"} onClick={async () => { await onCopy(message); setCopied(true); }}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Action>
    {precedingUserId && <Action label="Regenerate response" onClick={() => onRegenerate(precedingUserId)}><RefreshCwIcon /></Action>}
    {partialContinue && message.stopped && <Action label="Continue stopped response" onClick={() => onContinue(message)}><PlayIcon /></Action>}
  </div>;
}
