// The accuracy audit's WebSocket server (the websocket limit, scripts/accuracy/README.md section 4):
// it answers each message on ws://127.0.0.1:<ACCURACY_WS_PORT>/. Marks are the truth for one "ping".
// Line numbers are the test: don't reformat.
import { WebSocketServer } from 'ws';

const server = new WebSocketServer({ host: '127.0.0.1', port: Number(process.env.ACCURACY_WS_PORT ?? 0) });

// @scenario websocket
// @fn onSocketMessage 1
function onSocketMessage(socket, data) { //! 1
  const text = String(data); //! 1
  socket.send(text === 'ping' ? 'pong' : 'unknown'); //! 1 span:'unknown'
} //! ?
// @end

server.on('connection', (socket) => {
  socket.on('message', (data) => onSocketMessage(socket, data));
});
server.on('listening', () => console.log(`accuracy socket listening on port ${server.address().port}`));
