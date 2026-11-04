// Accuracy fixtures: loops and counts. Every mark is hand-written; scripts/accuracy/README.md explains them.
// Each scenario's arguments are fixed in ../server.ts. Line numbers are the test: don't reformat.

// @scenario for-loop
// @fn sumTo 1
export function sumTo(n: number): number { //! 1
  let total = 0; //! 1
  for (let i = 1; i <= n; i++) { //! +
    total += i; //! 3
  } //! ?
  return total; //! 1
} //! ?

// @scenario while-break
// @fn firstNegative 1
export function firstNegative(list: number[]): number { //! 1
  let i = 0; //! 1
  while (i < list.length) { //! +
    if ((list[i] ?? 0) < 0) { //! 3
      break; //! 1
    } //! ?
    i++; //! 2
  } //! ?
  return i; //! 1
} //! ?

// @scenario for-of-continue
// @fn nonEmpty 1
export function nonEmpty(items: string[]): number { //! 1
  let kept = 0; //! 1
  for (const item of items) { //! +
    if (item === '') continue; //! 4
    kept++; //! 2
  } //! ?
  return kept; //! 1
} //! ?

// @scenario loop-zero-times
// @fn total 1
export function total(prices: number[]): number { //! 1
  let sum = 0; //! 1
  for (const p of prices) { //! +
    sum += p; //! 0
  } //! ?
  return sum; //! 1
} //! ?

// @scenario callback-count
// @fn shout 1
// @fn (anonymous) 4
export function shout(words: string[]): string[] { //! 1
  return words.map((w) => w.toUpperCase()); //! 4
} //! ?

// @scenario nested-calls
// @fn tax 5
// @fn invoice 1
function tax(cents: number): number { //! 5
  return Math.round(cents * 0.2); //! 5
} //! ?
export function invoice(lines: number[]): number { //! 1
  let sum = 0; //! 1
  for (const cents of lines) { //! +
    sum += cents + tax(cents); //! 5
  } //! ?
  return sum; //! 1
} //! ?

// @scenario recursion
// @fn fact 4
export function fact(n: number): number { //! 4
  if (n <= 1) return 1; //! 4
  return n * fact(n - 1); //! 3
} //! ?
