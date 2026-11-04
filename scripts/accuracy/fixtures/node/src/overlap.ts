// Accuracy fixtures: two requests at once (the overlap limit, scripts/accuracy/README.md section 4).
// GET /s/overlap-a and GET /s/overlap-b are sent together; both wait, so they overlap. The marks are
// the truth for each request's own trace: a request runs only its own function.
// Line numbers are the test: don't reformat.

// @scenario overlap-a
// @limit overlap
// @fn slowA 1
// @fn (anonymous) 1
export async function slowA(): Promise<string> { //! 1
  await new Promise<void>((done) => setTimeout(done, 150)); //! 1
  return 'a'; //! 1
} //! ?

// @scenario overlap-b
// @limit overlap
// @fn slowB 1
// @fn (anonymous) 1
export async function slowB(): Promise<string> { //! 1
  await new Promise<void>((done) => setTimeout(done, 100)); //! 1
  return 'b'; //! 1
} //! ?
