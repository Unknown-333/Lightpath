// Accuracy fixtures: async/await. Every mark is hand-written; scripts/accuracy/README.md explains them.
// Each scenario's arguments are fixed in ../server.ts. Line numbers are the test: don't reformat.

// @scenario await-sequence
// @fn waitA 2
// @fn (anonymous) 2
// @fn loadCart 1
const waitA = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)); //! 2
export async function loadCart(id: string): Promise<string[]> { //! 1
  const items: string[] = []; //! 1
  await waitA(5); //! 1
  items.push(`item-${id}`); //! 1
  await waitA(5); //! 1
  items.push('item-2'); //! 1
  return items; //! 1
} //! ?

// @scenario await-reject
// @fn waitB 1
// @fn (anonymous) 1
// @fn fetchPrice 1
// @fn quote 1
const waitB = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)); //! 1
async function fetchPrice(sku: string): Promise<number> { //! 1
  await waitB(1); //! 1
  if (sku === 'gone') throw new Error('no such product'); //! 1
  return 10; //! 0
} //! ?
export async function quote(sku: string): Promise<string> { //! 1
  try { //! 1
    const price = await fetchPrice(sku); //! 1
    return `price ${price}`; //! 0
  } catch (err) { //! 1
    return `error: ${(err as Error).message}`; //! 1
  } //! ?
} //! ?

// @scenario promise-all
// @fn double 3
// @fn doubleAll 1
// @fn (anonymous) 3
async function double(n: number): Promise<number> { //! 3
  return n * 2; //! 3
} //! ?
export async function doubleAll(list: number[]): Promise<number> { //! 1
  const out = await Promise.all(list.map(double)); //! 1
  return out.reduce((a, b) => a + b, 0); //! 3
} //! ?
