/* Content-free: excludes message text, tool arguments, action inputs, reasons, titles and file paths. */
import { usageReport } from "../diagnostics/usage-report.js";

export function registerDiagnosticsRoutes(app, { dataRoot }) {
  app.get("/v0/diagnostics/usage", async (request, response) => {
    response.json(await usageReport({ dataRoot, hours: request.query.hours }));
  });
}
