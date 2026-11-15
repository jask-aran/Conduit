// Kept apart from the paper format so a sheet (and its engine's worker) takes an id without the editor's modules.
export const blockId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
