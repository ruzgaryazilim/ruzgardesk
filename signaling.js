// RüzgarDesk signaling server (embeddable).
// Pure WebRTC signaling + Desk ID rendezvous. No OS control here — the Electron
// host process performs native input injection locally via Win32 SendInput.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

function createSignalingServer(options = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 1e8 // 100 MB, allows large signaling / fallback payloads
  });

  // Serve the front-end UI
  app.use(express.static(path.join(__dirname, 'public')));

  // deskId -> socketId
  const desks = new Map();
  // socketId -> deskId
  const socketToDesk = new Map();
  // deskId -> peerDeskId (active session pairing)
  const activeConnections = new Map();

  function generateDeskId() {
    let deskId;
    do {
      const n = Math.floor(100000000 + Math.random() * 900000000).toString();
      deskId = `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 9)}`;
    } while (desks.has(deskId));
    return deskId;
  }

  io.on('connection', (socket) => {
    console.log(`[signaling] socket connected: ${socket.id}`);

    socket.on('register-desk', (requestedId) => {
      let deskId = requestedId;
      const isValidFormat = /^\d{3} \d{3} \d{3}$/.test(deskId || '');
      if (!deskId || !isValidFormat || desks.has(deskId)) {
        deskId = generateDeskId();
      }
      desks.set(deskId, socket.id);
      socketToDesk.set(socket.id, deskId);
      socket.emit('desk-registered', { deskId, status: 'online' });
      console.log(`[signaling] desk registered: ${deskId}`);
      broadcastActiveDesks();
    });

    // Viewer requests connection to a target host. `passcode` allows the host to
    // auto-accept (unattended access, like AnyDesk).
    socket.on('connect-request', ({ targetDeskId, passcode }) => {
      const senderDeskId = socketToDesk.get(socket.id);
      if (!senderDeskId) {
        socket.emit('connect-failed', { message: 'Önce masanızı kaydedin.' });
        return;
      }
      if (senderDeskId === targetDeskId) {
        socket.emit('connect-failed', { message: 'Kendi masanıza bağlanamazsınız.' });
        return;
      }
      const targetSocketId = desks.get(targetDeskId);
      if (!targetSocketId) {
        socket.emit('connect-failed', { message: 'Masa çevrimdışı veya mevcut değil.' });
        return;
      }
      if (activeConnections.has(targetDeskId)) {
        socket.emit('connect-failed', { message: 'Masa şu anda başka bir oturumda meşgul.' });
        return;
      }
      io.to(targetSocketId).emit('incoming-connect-request', {
        senderDeskId,
        passcode: passcode || null
      });
    });

    socket.on('connect-response', ({ requesterDeskId, accepted }) => {
      const responderDeskId = socketToDesk.get(socket.id);
      const requesterSocketId = desks.get(requesterDeskId);
      if (!requesterSocketId) return;

      if (accepted) {
        activeConnections.set(requesterDeskId, responderDeskId);
        activeConnections.set(responderDeskId, requesterDeskId);
        io.to(requesterSocketId).emit('connect-accepted', { peerDeskId: responderDeskId });
        socket.emit('connect-accepted', { peerDeskId: requesterDeskId });
        console.log(`[signaling] session started ${requesterDeskId} <-> ${responderDeskId}`);
      } else {
        io.to(requesterSocketId).emit('connect-rejected', { peerDeskId: responderDeskId });
      }
    });

    socket.on('webrtc-signal', ({ targetDeskId, signal }) => {
      const senderDeskId = socketToDesk.get(socket.id);
      const targetSocketId = desks.get(targetDeskId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('webrtc-signal', { senderDeskId, signal });
      }
    });

    // WebSocket fallback for remote input if the data channel is not ready
    socket.on('remote-input', ({ targetDeskId, event }) => {
      const targetSocketId = desks.get(targetDeskId);
      if (targetSocketId) io.to(targetSocketId).emit('remote-input', { event });
    });

    socket.on('chat-message', ({ targetDeskId, message }) => {
      const senderDeskId = socketToDesk.get(socket.id);
      const targetSocketId = desks.get(targetDeskId);
      if (targetSocketId) io.to(targetSocketId).emit('chat-message', { senderDeskId, message });
    });

    socket.on('end-session', ({ targetDeskId }) => {
      const senderDeskId = socketToDesk.get(socket.id);
      cleanupSession(senderDeskId, targetDeskId);
    });

    socket.on('disconnect', () => {
      const deskId = socketToDesk.get(socket.id);
      if (deskId) {
        const peerDeskId = activeConnections.get(deskId);
        if (peerDeskId) cleanupSession(deskId, peerDeskId);
        desks.delete(deskId);
        socketToDesk.delete(socket.id);
        broadcastActiveDesks();
        console.log(`[signaling] desk disconnected: ${deskId}`);
      }
    });
  });

  function cleanupSession(deskA, deskB) {
    activeConnections.delete(deskA);
    activeConnections.delete(deskB);
    const socketAId = desks.get(deskA);
    const socketBId = desks.get(deskB);
    if (socketAId) io.to(socketAId).emit('session-ended', { peerDeskId: deskB });
    if (socketBId) io.to(socketBId).emit('session-ended', { peerDeskId: deskA });
  }

  function broadcastActiveDesks() {
    const onlineDesks = Array.from(desks.keys()).map((id) => ({
      deskId: id,
      isBusy: activeConnections.has(id)
    }));
    io.emit('online-desks-list', onlineDesks);
  }

  return { app, server, io };
}

// Start listening; returns a promise resolving to the chosen port.
function startSignalingServer(port = 0) {
  const { server } = createSignalingServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`[signaling] RüzgarDesk signaling running on http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });
  });
}

module.exports = { createSignalingServer, startSignalingServer };
