// Standalone signaling server entry point.
// For the packaged desktop app the server is embedded inside the Electron main
// process (electron/main.js). Run this directly with `npm run server` to host a
// shared rendezvous server that multiple RüzgarDesk clients can point to.

const { createSignalingServer } = require('./signaling');

const PORT = process.env.PORT || 3000;
const { server } = createSignalingServer();

server.listen(PORT, () => {
  console.log(`RüzgarDesk signaling server running on http://localhost:${PORT}`);
});
