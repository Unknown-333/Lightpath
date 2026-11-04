// Accuracy fixtures: flow interrupts. Every mark is hand-written; scripts/accuracy/README.md explains them.
// Each scenario's arguments are fixed in ../server.ts. Line numbers are the test: don't reformat.

// @scenario early-return
// @fn nameOf 1
export function nameOf(user: { name: string } | null): string { //! 1
  if (!user) { //! 1
    return 'anonymous'; //! 1
  } //! ?
  const trimmed = user.name.trim(); //! 0
  return trimmed; //! 0
} //! ?

// @scenario throw-catch-finally
// @fn parseAge 1
export function parseAge(text: string): number { //! 1
  let age = -1; //! 1
  try { //! 1
    if (text === '') { //! 1
      throw new Error('empty'); //! 1
    } //! ?
    age = Number(text); //! 0
  } catch { //! 1
    age = 0; //! 1
  } finally { //! 1
    age += 1; //! 1
  } //! ?
  return age; //! 1
} //! ?

// @scenario try-no-throw
// @fn parseCount 1
export function parseCount(text: string): number { //! 1
  let count = -1; //! 1
  try { //! 1
    count = Number.parseInt(text, 10); //! 1
  } catch { //! ?
    count = 0; //! 0
  } finally { //! 1
    count += 1; //! 1
  } //! ?
  return count; //! 1
} //! ?

// @scenario call-throws
// @fn mustBePositive 1
// @fn checkQty 1
function mustBePositive(n: number): number { //! 1
  if (n <= 0) throw new RangeError('not positive'); //! 1
  return n; //! 0
} //! ?
export function checkQty(n: number): string { //! 1
  try { //! 1
    const qty = mustBePositive(n); //! 1
    const doubled = qty * 2; //! 0
    return `ok ${doubled}`; //! 0
  } catch { //! 1
    return 'bad quantity'; //! 1
  } //! ?
} //! ?

// @scenario throw-escapes
// @fn requireId 1
// @fn lookup 1
function requireId(id: string): string { //! 1
  if (id === '') { //! 1
    throw new TypeError('id is required'); //! 1
  } //! ?
  return id; //! 0
} //! ?
export function lookup(id: string): string { //! 1
  const clean = requireId(id); //! 1
  const upper = clean.toUpperCase(); //! 0
  return `user ${upper}`; //! 0
} //! ?
