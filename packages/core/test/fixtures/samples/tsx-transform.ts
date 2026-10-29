// TypeScript that needs a real transform (an enum and parameter properties), loaded with tsx.
// esbuild rewrites this file, so lines map back through tsx's inline source map.
export enum Status {
  Pending = 'pending',
  Paid = 'paid',
  Failed = 'failed',
}

export class Order {
  constructor(
    public readonly id: number,
    private status: Status = Status.Pending,
  ) {}

  pay(ok: boolean): string {
    if (ok) {
      this.status = Status.Paid;
      return `注文 ${this.id} ✅`;
    }
    this.status = Status.Failed;
    return `order ${this.id} failed`;
  }

  get label(): string {
    switch (this.status) {
      case Status.Paid:
        return 'paid';
      case Status.Failed:
        return 'failed';
      default:
        return 'pending';
    }
  }
}

export async function run(): Promise<string[]> {
  const order = new Order(7);
  const message = order.pay(true);
  return [message, order.label];
}
