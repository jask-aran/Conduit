export default class HarnessJsonReporter {
  onTestEnd(_test, result) {
    const report = result.attachments.find((attachment) => attachment.name === "harness-report");
    if (report?.body) process.stdout.write(`${report.body.toString("utf8")}\n`);
    else if (result.error) process.stderr.write(`${result.error.message}\n`);
  }

  onError(error) {
    process.stderr.write(`${error.message || error}\n`);
  }
}
