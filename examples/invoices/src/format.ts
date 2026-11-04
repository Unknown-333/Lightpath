const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function money(cents: number): string {
  return usd.format(cents / 100);
}

export function shortDate(iso: string): string {
  return day.format(new Date(`${iso}T00:00:00Z`));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
