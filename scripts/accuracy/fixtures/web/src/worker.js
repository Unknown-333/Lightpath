// Accuracy fixtures: the Web Worker of the web-worker scenario (src/limits.jsx). Marks are the truth.
// Line numbers are the test: don't reformat.

// @scenario web-worker
// @fn (anonymous) 1
// @fn (anonymous) 3
self.onmessage = (event) => { //! 1
  const sum = event.data.reduce((a, b) => a + b, 0); //! 3
  self.postMessage(sum); //! 1
}; //! ?
