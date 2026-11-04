// Accuracy fixtures: branches. Every mark is hand-written; scripts/accuracy/README.md explains them.
// Each scenario's arguments are fixed in ../server.ts. Line numbers are the test: don't reformat.

// @scenario if-then
// @fn ifThen 1
export function ifThen(n: number): string { //! 1
  let out = 'start'; //! 1
  if (n > 0) { //! 1
    out = 'positive'; //! 1
  } else { //! ?
    out = 'not positive'; //! 0
  } //! ?
  return out; //! 1
} //! ?

// @scenario if-else
// @fn ifElse 1
export function ifElse(n: number): string { //! 1
  let out = 'start'; //! 1
  if (n > 0) { //! 1
    out = 'positive'; //! 0
  } else { //! ?
    out = 'not positive'; //! 1
  } //! ?
  return out; //! 1
} //! ?

// @scenario else-if-chain
// @fn grade 1
export function grade(kind: string): number { //! 1
  if (kind === 'a') { //! 1
    return 1; //! 0
  } else if (kind === 'b') { //! 1
    return 2; //! 1
  } else if (kind === 'c') { //! 0
    return 3; //! 0
  } //! ?
  return 0; //! 0
} //! ?

// @scenario single-line-if
// @fn clamp 1
export function clamp(n: number): number { //! 1
  if (n > 10) return 10; //! 1 span:return 10
  if (n < 0) return 0; //! 1
  return n; //! 0
} //! ?

// @scenario switch-case
// @fn price 1
export function price(fruit: string): number { //! 1
  let cents = 0; //! 1
  switch (fruit) { //! 1
    case 'apple': //! 0
      cents = 50; //! 0
      break; //! 0
    case 'pear': //! 1
      cents = 75; //! 1
      break; //! 1
    default: //! 0
      cents = 99; //! 0
  } //! ?
  return cents; //! 1
} //! ?

// @scenario switch-fallthrough
// @fn fall 1
export function fall(x: string): string[] { //! 1
  const seen: string[] = []; //! 1
  switch (x) { //! 1
    case 'a': //! 1
      seen.push('a'); //! 1
    case 'b': //! 1
      seen.push('b'); //! 1
      break; //! 1
    case 'c': //! 0
      seen.push('c'); //! 0
  } //! ?
  return seen; //! 1
} //! ?

// @scenario ternary-multiline
// @fn label 1
export function label(vip: boolean): string { //! 1
  const text = vip //! 1
    ? 'gold member' //! 1
    : 'guest'; //! 0
  return text; //! 1
} //! ?

// @scenario ternary-inline
// @fn badge 1
export function badge(vip: boolean): string { //! 1
  return vip ? 'gold' : 'none'; //! 1 span:'gold'
} //! ?

// @scenario logical-multiline
// @fn displayName 1
export function displayName(user: { name: string } | null): string { //! 1
  const name = (user //! 1
    && user.name) //! 0
    || 'guest'; //! 1
  return name; //! 1
} //! ?
