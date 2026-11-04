// Accuracy fixtures: engine limits (scripts/accuracy/README.md section 4). Every mark is hand-written and is
// the truth: what really ran because of the click. Where Lightpath can't see it, the trace must say so.
// Line numbers are the test: don't reformat.

// @scenario web-worker
// @limit worker
// @click Use worker
// @fn askWorker 1
// @fn (anonymous) 1
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); //! 0
export function WorkerButton() { //! 0
  const askWorker = () => { //! 1
    worker.onmessage = (event) => { //! 1
      document.getElementById('worker-out').textContent = String(event.data); //! 1
    }; //! ?
    worker.postMessage([1, 2, 3]); //! 1
  }; //! ?
  return <p><button type="button" onClick={askWorker}>Use worker</button><output id="worker-out" /></p>; //! 0
} //! ?

// @scenario websocket
// @limit websocket
// @click Use socket
// @fn ping 1
// @fn (anonymous) 1
const wsUrl = new URLSearchParams(location.search).get('ws'); //! 0
const socket = wsUrl ? new WebSocket(wsUrl) : undefined; //! 0
export function SocketButton() { //! 0
  const ping = () => { //! 1
    socket?.send('ping'); //! 1
  }; //! ?
  return <p><button type="button" onClick={ping}>Use socket</button><output id="socket-out" /></p>; //! 0
} //! ?
// @scenario press-release
// @limit release-boundary
// @click Press me
// @fn onPress 1
// @fn onRelease 1
export function PressButton() { //! 0
  const onPress = () => { //! 1
    window.__pressed = (window.__pressed ?? 0) + 1; //! 1
  }; //! ?
  const onRelease = () => { //! 1
    window.__released = (window.__released ?? 0) + 1; //! 1
  }; //! ?
  return <button type="button" onPointerDown={onPress} onClick={onRelease}>Press me</button>; //! 0
} //! ?

// The socket's reply handler, part of the websocket scenario above.
// @scenario websocket
if (socket) { //! 0
  socket.onmessage = (event) => { //! 1
    document.getElementById('socket-out').textContent = String(event.data); //! 1
  }; //! ?
} //! ?
