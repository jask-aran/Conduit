export interface ComposerSlashCommand {
  id: string;
  command: string;
  description: string;
  source: "conduit" | "harness";
}

export function composerSlashCommands(
  value: string,
  options: {
    attachments: boolean;
    compaction: boolean;
    harnessCommands?: Array<{ name: string; description?: string }>;
  },
): ComposerSlashCommand[] {
  const conduit = [
    ...(options.attachments ? [{ id: "attach", command: "/attach", description: "Choose files to attach", source: "conduit" as const }] : []),
    ...(options.compaction ? [{ id: "compact", command: "/compact", description: "Summarize older context", source: "conduit" as const }] : []),
  ];
  const owned = new Set(conduit.map((item) => item.command));
  return [
    ...conduit,
    ...(options.harnessCommands || []).filter((item) => !owned.has(`/${item.name}`)).map((item) => ({
      id: `harness:${item.name}`,
      command: `/${item.name}`,
      description: item.description || "Harness command",
      source: "harness" as const,
    })),
  ].filter((item) => /^\/[^\s]*$/.test(value) && item.command.startsWith(value));
}
