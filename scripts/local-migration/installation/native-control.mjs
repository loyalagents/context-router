// P1-N bounded experiment control, not an installed lifecycle implementation.
export class NativeProbeControl {
  #clock; #end; #controller = new AbortController(); #owner;
  constructor({ now = () => performance.now() } = {}) { this.#clock = now; this.#end = now() + 360_000; }
  get signal() { return this.#controller.signal; }
  check() {
    if (this.#clock() >= this.#end - 20_000) this.stop('active-deadline');
    if (this.signal.aborted) throw new Error('native probe stopped');
  }
  admitGeneration() {
    this.check();
    if (this.#end - this.#clock() < 170_000) throw new Error('insufficient remaining generation budget');
  }
  attach(owner) {
    this.#owner = owner;
    owner.stdin.on('error', () => this.stop('control-lost'));
    if (this.signal.aborted) this.endOwner();
  }
  detach(owner) { if (this.#owner === owner) this.#owner = undefined; }
  endOwner() {
    const input = this.#owner?.stdin;
    if (input && !input.writableEnded && !input.destroyed) input.end();
  }
  stop(reason) { this.#controller.abort(reason); this.endOwner(); }
  sendRelease() {
    this.check();
    const input = this.#owner?.stdin;
    if (!input || input.writableEnded || input.destroyed) { this.stop('control-lost'); throw new Error('native probe stopped'); }
    input.write('release-lock\n');
  }
  activeBudget(maximum) { this.check(); return Math.max(1, Math.min(maximum, this.#end - 20_000 - this.#clock())); }
  cleanupBudget(maximum) { return Math.max(0, Math.min(maximum, this.#end - this.#clock())); }
}
