import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

function ValueRow({ label, children, path = false }) {
  return <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className={path ? "break-all font-mono text-xs" : "break-words"}>{children || "—"}</dd>
  </div>;
}

function InstallationCard({ installation, detecting, onDetectHost }) {
  const isHost = installation.id === "host-pi";
  const outcome = installation.available
    ? "Detected and ready"
    : installation.error || "Not detected";
  return <Card size="sm">
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{installation.label || installation.id || "Pi installation"}</CardTitle>
          <CardDescription>{outcome}</CardDescription>
        </div>
        <Badge variant={installation.available ? "secondary" : "outline"}>
          {installation.available ? "Available" : "Unavailable"}
        </Badge>
      </div>
    </CardHeader>
    <CardContent>
      <dl className="space-y-2 text-sm">
        <ValueRow label="Installation ID">{installation.id}</ValueRow>
        <ValueRow label="Version">{installation.version ? `Pi ${installation.version}` : null}</ValueRow>
        <ValueRow label="Source">{installation.source}</ValueRow>
        <ValueRow label="Executable" path>{installation.executablePath}</ValueRow>
        <ValueRow label="Agent home" path>{installation.agentHome?.path}</ValueRow>
        <ValueRow label="Agent home source">{installation.agentHome?.source}</ValueRow>
        <ValueRow label="RPC compatibility">{installation.compatible ? "Compatible" : "Unavailable"}</ValueRow>
        <ValueRow label="Last detection">{installation.checkedAt}</ValueRow>
      </dl>
    </CardContent>
    {isHost && <CardFooter>
      <Button type="button" variant="outline" disabled={detecting} onClick={onDetectHost}>
        {detecting && <Spinner data-icon="inline-start" />}
        {detecting ? "Detecting…" : "Re-detect Host Pi"}
      </Button>
    </CardFooter>}
  </Card>;
}

function ProcessCard({ process }) {
  const generation = process.generation;
  const generationStatus = !generation
    ? "None"
    : generation.settled ? "Settled" : generation.closed ? "Closed" : generation.active ? "Active" : "Open";
  return <Card size="sm">
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{process.chatId || process.id || "Live process"}</CardTitle>
          <CardDescription>{process.projectId || "No project identity"}</CardDescription>
        </div>
        <Badge variant={process.activity === "failed" ? "destructive" : "secondary"}>
          {process.activity || process.status || "Unknown"}
        </Badge>
      </div>
    </CardHeader>
    <CardContent>
      <dl className="space-y-2 text-sm">
        <ValueRow label="Process ID">{process.id}</ValueRow>
        <ValueRow label="State">{process.status}</ValueRow>
        <ValueRow label="Installation">{process.installationId}</ValueRow>
        <ValueRow label="Connected clients">{String(process.clientCount ?? 0)}</ValueRow>
        <ValueRow label="Generation">{generationStatus}</ValueRow>
        {generation?.id && <ValueRow label="Generation ID">{generation.id}</ValueRow>}
      </dl>
    </CardContent>
  </Card>;
}

function PathList({ paths = [], empty }) {
  if (!paths.length) return <span className="text-muted-foreground">{empty}</span>;
  return <div className="space-y-1">
    {paths.map((value) => <div key={value} className="break-all font-mono text-xs">{value}</div>)}
  </div>;
}

export function DiagnosticsSettings({ onInstallationsChange, onHostUnavailable }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/v0/diagnostics");
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not load diagnostics");
      setDiagnostics({
        installations: Array.isArray(body.installations) ? body.installations : [],
        processes: Array.isArray(body.processes) ? body.processes : [],
        storage: body.storage && typeof body.storage === "object" ? body.storage : {},
      });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function detectHostPi() {
    setDetecting(true);
    setError("");
    try {
      const response = await fetch("/v0/pi-installations/host/detect", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || body.error || "Could not detect host Pi");
      onInstallationsChange?.((current) => [...current.filter((item) => item.id !== body.id), body]);
      if (!body.available) onHostUnavailable?.();
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setDetecting(false);
    }
  }

  if (loading && !diagnostics) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Loading diagnostics…</div>;
  }

  if (!diagnostics) {
    return <Empty>
      <EmptyHeader>
        <EmptyTitle>Diagnostics unavailable</EmptyTitle>
        <EmptyDescription>{error || "Conduit could not load runtime diagnostics."}</EmptyDescription>
      </EmptyHeader>
      <Button type="button" variant="outline" onClick={load}>Retry</Button>
    </Empty>;
  }

  const installations = diagnostics.installations;
  const processes = diagnostics.processes;
  const storage = diagnostics.storage;

  return <>
    <div className="settings-section-heading">
      <h2>Diagnostics</h2>
      <p>Inspect detected Pi installations, resident processes, and Conduit-owned storage roots. These values are read-only.</p>
    </div>
    {error && <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-destructive">
      <span>{error}</span>
      <Button type="button" size="sm" variant="outline" onClick={load}>Retry</Button>
    </div>}
    <section className="space-y-3" aria-labelledby="diagnostics-installations">
      <div>
        <h3 id="diagnostics-installations" className="font-medium">Pi installations</h3>
        <p className="text-sm text-muted-foreground">Executable and agent-home detection reported by the server.</p>
      </div>
      {installations.length ? <div className="grid gap-3 xl:grid-cols-2">
        {installations.map((installation) => <InstallationCard
          key={installation.id}
          installation={installation}
          detecting={detecting}
          onDetectHost={detectHostPi}
        />)}
      </div> : <Empty>
        <EmptyHeader><EmptyTitle>No installations reported</EmptyTitle><EmptyDescription>The server returned no Pi installation diagnostics.</EmptyDescription></EmptyHeader>
      </Empty>}
    </section>
    <section className="mt-6 space-y-3" aria-labelledby="diagnostics-processes">
      <div>
        <h3 id="diagnostics-processes" className="font-medium">Live processes</h3>
        <p className="text-sm text-muted-foreground">Resident Pi processes and their safe operational state.</p>
      </div>
      {processes.length ? <div className="grid gap-3 xl:grid-cols-2">
        {processes.map((process) => <ProcessCard key={process.id || process.chatId} process={process} />)}
      </div> : <Empty>
        <EmptyHeader><EmptyTitle>No live processes</EmptyTitle><EmptyDescription>Pi processes appear here while chats are resident.</EmptyDescription></EmptyHeader>
      </Empty>}
    </section>
    <section className="mt-6 space-y-3" aria-labelledby="diagnostics-storage">
      <div>
        <h3 id="diagnostics-storage" className="font-medium">Storage locations</h3>
        <p className="text-sm text-muted-foreground">Conduit reports roots only, never transcript filenames or directory listings.</p>
      </div>
      <Card size="sm">
        <CardContent>
          <dl className="space-y-4 text-sm">
            <ValueRow label="Conduit data" path>{storage.dataRoot}</ValueRow>
            <ValueRow label="Transcripts"><PathList paths={storage.transcriptRoots} empty="No transcript roots reported" /></ValueRow>
            <ValueRow label="Uploads"><PathList paths={storage.uploadRoots} empty="No upload roots reported" /></ValueRow>
          </dl>
        </CardContent>
      </Card>
    </section>
  </>;
}
