export interface SchedulerOptions { concurrency: number; maxAttempts: number; }
export interface TaskContext { signal: AbortSignal; attempt: number; }
export type ScheduledTask<T> = (context: TaskContext) => Promise<T>;

interface Pending<T> { id: string; task: ScheduledTask<T>; resolve: (value: T) => void; reject: (error: unknown) => void; }

/**
 * Deliberately incomplete Phase 5 baseline.  It proves the API and FIFO launch
 * path, while the forbidden canonical acceptance tests define the full task.
 */
export class TaskScheduler {
  private readonly queue: Pending<unknown>[] = [];
  private active = 0;
  private readonly drained: Array<() => void> = [];

  constructor(private readonly options: SchedulerOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error("concurrency must be a positive integer");
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  }

  schedule<T>(id: string, task: ScheduledTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id, task, resolve, reject } as Pending<unknown>);
      this.pump();
    });
  }

  cancel(_id: string): boolean { return false; }

  drain(): Promise<void> { return this.active === 0 && this.queue.length === 0 ? Promise.resolve() : new Promise((resolve) => this.drained.push(resolve)); }

  private pump(): void {
    while (this.active < this.options.concurrency && this.queue.length) {
      const next = this.queue.shift()!;
      this.active++;
      Promise.resolve(next.task({ signal: new AbortController().signal, attempt: 1 })).then(next.resolve, next.reject).finally(() => {
        this.active--;
        this.pump();
        if (this.active === 0 && this.queue.length === 0) this.drained.splice(0).forEach((resolve) => resolve());
      });
    }
  }
}
