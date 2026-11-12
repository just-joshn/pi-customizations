// Names what a whole-suite run is waiting on: every minute, the test files still running, the test each is inside, and for how long.
const MINUTE = 60_000;

export default class ProgressReporter {
  files = new Map();
  started = Date.now();

  onInit() {
    this.timer = setInterval(() => this.print('in flight'), MINUTE);
    this.timer.unref();
  }
  onTestModuleStart(module) {
    this.files.set(module.moduleId, { name: module.relativeModuleId, at: Date.now(), test: null });
  }
  onTestModuleEnd(module) {
    this.files.delete(module.moduleId);
  }
  onTestCaseReady(test) {
    const file = this.files.get(test.module.moduleId);
    if (file) file.test = { name: test.fullName, at: Date.now() };
  }
  onTestCaseResult(test) {
    const file = this.files.get(test.module.moduleId);
    if (file) file.test = null;
  }
  onTestRunEnd() {
    clearInterval(this.timer);
  }
  print(label) {
    const now = Date.now();
    const rows = [...this.files.values()].map((f) => `  ${Math.round((now - f.at) / 1000)}s ${f.name}${f.test ? `  > ${Math.round((now - f.test.at) / 1000)}s in "${f.test.name}"` : ''}`);
    process.stderr.write(`[progress +${Math.round((now - this.started) / 1000)}s] ${label}: ${rows.length} file(s)\n${rows.join('\n')}\n`);
  }
}
