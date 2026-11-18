export class WorkBudget {
  readonly controller = new AbortController();
  private remaining: number;
  private armedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private total: number) {
    this.remaining = total;
    this.arm();
  }
  get signal() {
    return this.controller.signal;
  }
  get minutes() {
    return Math.round(this.total / 60000);
  }
  private arm() {
    clearTimeout(this.timer);
    this.armedAt = Date.now();
    this.timer = setTimeout(
      () =>
        this.controller.abort(
          new Error(
            `Batas waktu ${this.minutes} menit kerja terlampaui (waktu menunggu owner tidak dihitung)`,
          ),
        ),
      Math.max(this.remaining, 1),
    );
    this.timer.unref?.();
  }
  hold() {
    if (this.controller.signal.aborted) return;
    clearTimeout(this.timer);
    this.remaining -= Date.now() - this.armedAt;
  }
  release() {
    if (this.controller.signal.aborted) return;
    this.remaining = Math.max(this.remaining, 1);
    this.arm();
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
