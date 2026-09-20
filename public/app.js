// RüzgarDesk front-end — PeerJS transport (AnyDesk-style: just enter the code).
document.addEventListener('DOMContentLoaded', () => {
  const RD = window.rdesk || null;
  const isElectron = !!RD;
  const $ = (id) => document.getElementById(id);

  // ---- Elements -----------------------------------------------------------
  const dashboardView = $('dashboard-view');
  const sessionView = $('session-view');
  const serverStatusDot = document.querySelector('#server-status .status-dot');
  const serverStatusLabel = document.querySelector('#server-status .status-label');
  const myDeskIdDisplay = $('my-desk-id');
  const targetDeskIdInput = $('target-desk-id');
  const targetPasscodeInput = $('target-passcode');
  const connectBtn = $('connect-btn');
  const copyIdBtn = $('copy-id-btn');
  const recentConnectionsList = $('recent-connections-list');
  const myPasscodeInput = $('my-passcode');
  const togglePasscodeBtn = $('toggle-passcode-view');
  const unattendedToggle = $('unattended-toggle');
  const adminBadge = $('admin-badge');
  const adminBadgeText = $('admin-badge-text');
  const appVersionBadge = $('app-version-badge');

  const openSettingsBtn = $('open-settings-btn');
  const settingsModal = $('settings-modal');
  const peerHostInput = $('peer-host-input');
  const peerStatus = $('peer-status');
  const closeSettingsBtn = $('close-settings-btn');
  const saveSettingsBtn = $('save-settings-btn');
  const settingsVersion = $('settings-version');
  const updateStatusLabel = $('update-status');
  const checkUpdateBtn = $('check-update-btn');

  const macPermissionsModal = $('mac-permissions-modal');
  const macReqScreenBtn = $('mac-req-screen-btn');
  const macReqAccBtn = $('mac-req-acc-btn');
  const macPermScreenStatus = $('mac-perm-screen-status');
  const macPermAccStatus = $('mac-perm-acc-status');
  const closeMacPermsBtn = $('close-mac-perms-btn');
  const recheckMacPermsBtn = $('recheck-mac-perms-btn');

  const incomingModal = $('incoming-modal');
  const requesterIdDisplay = $('requester-id-display');
  const acceptRequestBtn = $('accept-request-btn');
  const declineRequestBtn = $('decline-request-btn');
  const connectingModal = $('connecting-modal');
  const connectingTitle = $('connecting-title');
  const connectingSubtitle = $('connecting-subtitle');
  const cancelConnectBtn = $('cancel-connect-btn');

  const peerIdDisplay = $('peer-id-display');
  const sessionTimeLabel = $('session-time');
  const toggleAudioBtn = $('toggle-audio-btn');
  const fullscreenBtn = $('fullscreen-btn');
  const switchScreenBtn = $('switch-screen-btn');
  const screenIndicator = $('screen-indicator');
  const disconnectSessionBtn = $('disconnect-btn');
  const remoteDisplayContainer = $('remote-display-container');
  const remoteVideo = $('remote-video');
  const waitingScreenShare = $('waiting-screen-share');
  const waitingText = $('waiting-text');
  const requestStreamBtn = $('request-stream-btn');

  const chatMessagesContainer = $('chat-messages-container');
  const chatInput = $('chat-input');
  const chatSendBtn = $('chat-send-btn');
  const fileDropZone = $('file-drop-zone');
  const fileSelectInput = $('file-select-input');
  const transfersContainer = $('transfers-container');
  const openDownloadsBtn = $('open-downloads-btn');

  // ---- State --------------------------------------------------------------
  let peer = null;
  let conn = null;           // control DataConnection
  let mediaCall = null;      // MediaConnection (screen)
  let localStream = null;
  let myDeskId = null;       // formatted "123 456 789"
  let myDeskDigits = null;   // "123456789"
  let connectedPeerId = null;
  let connectedPeerDigits = null;
  let isHost = false;
  let pendingConn = null;
  let pendingRequester = null;
  let hostScreenCount = 1, hostScreenIndex = 0;      // host: available/current screens
  let viewerScreenCount = 1, viewerScreenIndex = 0;  // viewer: mirror for the switch UI
  let connectionTimeout = null;
  let sessionTimerInterval = null;
  let sessionStartTime = 0;
  let heartbeatInterval = null;   // send periodic pings
  let watchdogInterval = null;    // auto-close a dead/silent session
  let lastActivity = 0;           // timestamp of last data received from peer
  let sessionAuthorizedByPasscode = false; // true if this session used passcode / unattended

  let boot = { config: {}, isAdmin: false };
  let cfg = { deskId: '', passcode: '', unattended: false, peerHost: '' };

  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const digitsOnly = (s) => String(s || '').replace(/\D/g, '');
  const fmtId = (d) => { d = digitsOnly(d); return d.length === 9 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)}` : d; };
  const makeId = () => String(Math.floor(100000000 + Math.random() * 900000000));

  // ========================================================================
  // BOOTSTRAP
  // ========================================================================
  async function bootstrap() {
    if (isElectron) {
      try { boot = await RD.bootstrap(); cfg = Object.assign(cfg, boot.config || {}); }
      catch (e) { console.error('bootstrap failed', e); }
    } else {
      cfg.deskId = localStorage.getItem('ruzgardesk-id') || '';
    }

    if (myPasscodeInput) myPasscodeInput.value = cfg.passcode || '';
    if (unattendedToggle) unattendedToggle.checked = !!cfg.unattended;
    if (peerHostInput) peerHostInput.value = cfg.peerHost || '';

    const versionText = isElectron ? `v${boot.version || '---'}` : 'Web';
    const installationType = isElectron ? (boot.installationType || 'Kurulum') : 'Tarayıcı';
    if (appVersionBadge) appVersionBadge.innerHTML = `${versionText} <span>•</span> ${installationType}`;
    if (settingsVersion) settingsVersion.textContent = `${versionText} (${installationType})`;
    renderUpdateStatus(boot.updaterStatus);

    if (adminBadge && adminBadgeText) {
      if (!isElectron) {
        adminBadgeText.textContent = 'Web Sürümü';
        adminBadge.style.background = 'rgba(59,130,246,0.15)';
        adminBadge.style.borderColor = '#3b82f6';
        adminBadge.style.color = '#3b82f6';
        adminBadge.title = 'Tarayıcıdan: uzaktaki masaüstü uygulamasını tam kontrol edebilirsiniz.';
      } else if (boot.platform === 'darwin') {
        const p = boot.permissions || {};
        const missing = p.screen !== 'granted' || !p.accessibility;
        if (missing) {
          adminBadgeText.textContent = 'macOS İzin Gerekli';
          adminBadge.style.background = 'rgba(245,158,11,0.15)';
          adminBadge.style.borderColor = '#f59e0b';
          adminBadge.style.color = '#f59e0b';
          adminBadge.style.cursor = 'pointer';
          adminBadge.title = 'Ekran Kaydı ve Erişilebilirlik izinlerini yapılandırmak için tıklayın.';
          adminBadge.onclick = () => showMacPermissionsModal();
        } else {
          adminBadgeText.textContent = 'macOS İzinleri Aktif';
          adminBadge.style.background = 'rgba(16,185,129,0.15)';
          adminBadge.style.borderColor = '#10b981';
          adminBadge.style.color = '#10b981';
          adminBadge.title = 'Tüm macOS uzaktan kontrol izinleri aktif.';
          adminBadge.onclick = () => showMacPermissionsModal();
        }
      } else if (!boot.isAdmin) {
        adminBadgeText.textContent = 'Yönetici Değil';
        adminBadge.style.background = 'rgba(239,68,68,0.15)';
        adminBadge.style.borderColor = '#ef4444';
        adminBadge.style.color = '#ef4444';
        adminBadge.title = 'Yönetici izni yok. Yönetici olarak yeniden başlatmak için tıklayın.';
        adminBadge.onclick = () => promptRelaunchElevated();
      } else {
        adminBadgeText.textContent = 'Yönetici İzni Aktif';
        adminBadge.title = 'RüzgarDesk yönetici yetkisiyle çalışıyor.';
        adminBadge.onclick = null;
      }
    }

    if (cfg.unattended && !boot.isAdmin && isElectron && RD.relaunchElevated) {
      RD.relaunchElevated();
      return;
    }

    initPeer();
    updateRecentList();
  }

  function promptRelaunchElevated() {
    if (!isElectron || RD.platform !== 'win32') return;
    if (confirm("RüzgarDesk'i Yönetici (Administrator) olarak yeniden başlatmak istiyor musunuz?\n\nBu sayede UAC onay pencereleri ve yönetici programları uzaktan sorunsuz kontrol edilebilir.")) {
      RD.relaunchElevated();
    }
  }

  function persistConfig(partial) {
    cfg = Object.assign(cfg, partial);
    if (isElectron) RD.saveConfig(partial);
    if (partial.deskId) localStorage.setItem('ruzgardesk-id', partial.deskId);
  }

  function renderUpdateStatus(status) {
    if (!updateStatusLabel) return;
    updateStatusLabel.textContent = status && status.message
      ? status.message
      : (isElectron ? 'Güncelleme denetimi bekleniyor.' : 'Web sürümünde otomatik güncelleme gerekmez.');
    const state = status && status.state;
    updateStatusLabel.style.color = state === 'error'
      ? '#f87171'
      : (state === 'current' ? '#34d399' : (state === 'downloading' || state === 'available' ? '#60a5fa' : ''));
  }

  // ========================================================================
  // PEER (signaling via public PeerJS cloud — no server address needed)
  // ========================================================================
  function initPeer() {
    createPeer(digitsOnly(cfg.deskId) || makeId());
  }

  let peerReconnectTimer = null;
  function schedulePeerReconnect(delay = 3000) {
    clearTimeout(peerReconnectTimer);
    peerReconnectTimer = setTimeout(() => {
      if (sessionAlive()) return;
      if (!peer || peer.destroyed) {
        createPeer(digitsOnly(cfg.deskId) || makeId());
        return;
      }
      if (peer.disconnected) {
        try {
          peer.reconnect();
        } catch (e) {
          try { peer.destroy(); } catch (e2) {}
          createPeer(digitsOnly(cfg.deskId) || makeId());
        }
      }
    }, delay);
  }

  function createPeer(id) {
    const opts = { debug: 1, config: { iceServers: ICE } };
    const host = (cfg.peerHost || '').trim();
    if (host) {
      const [h, p] = host.split(':');
      opts.host = h;
      if (p) opts.port = Number(p);
      opts.secure = p ? Number(p) === 443 : true;
      opts.path = '/';
    }
    setStatus('pinging', 'Sunucuya bağlanılıyor...');
    try { peer = new Peer(id, opts); }
    catch (e) { console.error('peer create failed', e); setStatus('pinging', 'Başlatılamadı'); schedulePeerReconnect(5000); return; }

    peer.on('open', (openId) => {
      clearTimeout(peerReconnectTimer);
      myDeskDigits = openId;
      myDeskId = fmtId(openId);
      persistConfig({ deskId: openId });
      myDeskIdDisplay.textContent = myDeskId;
      setStatus('online', 'Hazır — bağlantı için ID paylaşın');
      if (peerStatus) peerStatus.textContent = 'Bağlı (' + myDeskId + ')';
    });

    peer.on('connection', onIncomingConn);
    peer.on('call', onIncomingCall);
    peer.on('disconnected', () => {
      setStatus('pinging', 'Yeniden bağlanıyor...');
      schedulePeerReconnect(2000);
    });
    peer.on('error', onPeerError);
  }

  function onPeerError(err) {
    const type = err && err.type;
    console.warn('peer error:', type, err && err.message);
    if (type === 'unavailable-id') {
      const nid = makeId();
      persistConfig({ deskId: nid });
      try { peer.destroy(); } catch (e) {}
      createPeer(nid);
      return;
    }
    if (type === 'peer-unavailable') {
      clearTimeout(connectionTimeout);
      connectingModal.classList.remove('active');
      toast('Cihaz çevrimdışı veya kod yanlış.');
      resetConnectionState();
      return;
    }
    if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
      setStatus('pinging', 'Sunucuya ulaşılamıyor, yeniden deneniyor...');
      schedulePeerReconnect(4000);
      return;
    }
    if (type === 'browser-incompatible') toast('Tarayıcı/motor WebRTC desteklemiyor.');
  }

  function setStatus(cls, label) {
    if (serverStatusDot) serverStatusDot.className = 'status-dot ' + cls;
    if (serverStatusLabel) serverStatusLabel.textContent = label;
  }

  // ---- Incoming control connection (host side) ----------------------------
  // Always attach handlers; the busy/takeover decision is made when the
  // 'request' arrives (so we can see the passcode and whether the current
  // session is actually still alive). This prevents a crashed viewer from
  // leaving the host permanently "busy".
  function onIncomingConn(c) {
    attachConnHandlers(c);
  }

  // A session is only "alive" if the data connection is open AND the underlying
  // WebRTC peer connection has not failed/closed/disconnected.
  function sessionAlive() {
    if (!conn || !conn.open) return false;
    const pc = conn.peerConnection;
    if (pc) {
      const cs = pc.connectionState, ics = pc.iceConnectionState;
      if (cs === 'failed' || cs === 'closed' || cs === 'disconnected') return false;
      if (ics === 'failed' || ics === 'closed' || ics === 'disconnected') return false;
    }
    return true;
  }

  function attachConnHandlers(c) {
    c.on('data', (d) => handleData(d, c));
    c.on('close', () => { if (c === conn) endSessionLocally(); });
    c.on('error', (e) => console.warn('conn error', e));
  }

  // Tear down the current session immediately (used before taking over a session).
  function forceEndCurrentSession() {
    const wasHost = isHost;
    stopSessionTimers();
    stopScreenSharing();
    try { if (mediaCall) mediaCall.close(); } catch (e) {}
    try { if (conn) conn.close(); } catch (e) {}
    mediaCall = null; conn = null;
    clearInterval(sessionTimerInterval);
    sessionView.classList.remove('active');
    dashboardView.classList.add('active');
    connectedPeerId = null; connectedPeerDigits = null; isHost = false;
    if (wasHost && isElectron) RD.setRemoteSessionActive(false).catch(() => {});
  }

  // Watch the underlying WebRTC connection and drop the session the moment it dies.
  function monitorPeerConn(c) {
    setTimeout(() => {
      const pc = c && c.peerConnection;
      if (!pc || c !== conn) return;
      const check = () => {
        if (c !== conn) return;
        const cs = pc.connectionState, ics = pc.iceConnectionState;
        if (cs === 'failed' || cs === 'closed' || ics === 'failed' || ics === 'closed') endSessionLocally();
      };
      pc.addEventListener('connectionstatechange', check);
      pc.addEventListener('iceconnectionstatechange', check);
    }, 800);
  }

  function startSessionTimers() {
    lastActivity = Date.now();
    stopSessionTimers();
    heartbeatInterval = setInterval(() => { if (conn && conn.open) { try { conn.send({ t: 'ping' }); } catch (e) {} } }, 5000);
    // If no data (not even a ping) arrives for 15s, the peer is gone — reset so
    // the host frees up and the viewer can reconnect.
    watchdogInterval = setInterval(() => {
      if (!conn || !conn.open || Date.now() - lastActivity > 15000) {
        console.warn('watchdog: session silent/dead, resetting');
        endSessionLocally();
      }
    }, 3000);
  }
  function stopSessionTimers() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  }

  // ---- Incoming media call (viewer side) ----------------------------------
  function onIncomingCall(call) {
    mediaCall = call;
    call.answer(); // we only receive
    call.on('stream', (stream) => {
      remoteVideo.srcObject = stream;
      remoteVideo.style.objectFit = 'contain';
      remoteVideo.play().catch(() => {});
      waitingScreenShare.style.display = 'none';
      clearTimeout(connectionTimeout);
      connectingModal.classList.remove('active');
      if (!connectedPeerId) { connectedPeerId = fmtId(call.peer); connectedPeerDigits = call.peer; }
      launchSessionView();
    });
    call.on('close', () => endSessionLocally());
  }

  // ========================================================================
  // DATA ROUTER
  // ========================================================================
  function handleData(payload, c) {
    if (!payload || typeof payload !== 'object') return;
    lastActivity = Date.now();
    switch (payload.t) {
      case 'ping':
        break; // liveness only
      case 'request': {
        const requester = digitsOnly(payload.from);
        // A correct passcode alone authorizes auto-accept AND takeover (AnyDesk-style),
        // independent of the "unattended" toggle — so an emergency reconnect always works.
        const passOk = !!(cfg.passcode && payload.passcode && payload.passcode === cfg.passcode);
        const sameAsCurrent = connectedPeerId && connectedPeerDigits === requester;

        if (connectedPeerId && !sameAsCurrent && sessionAlive() && !passOk) {
          // Genuinely busy with a live session and no valid override → reject.
          try { c.send({ t: 'busy' }); } catch (e) {}
          setTimeout(() => { try { c.close(); } catch (e) {} }, 600);
          break;
        }
        // Stale session, same-peer reconnect, or valid passcode override → take over.
        if (connectedPeerId) forceEndCurrentSession();

        if (passOk) {
          sessionAuthorizedByPasscode = true;
          if (!boot.isAdmin && isElectron && RD.relaunchElevated) {
            try { c.send({ t: 'elevation-relaunching' }); } catch (e) {}
            setTimeout(() => RD.relaunchElevated(), 400);
            break;
          }
          acceptIncoming(c, requester);
        } else {
          sessionAuthorizedByPasscode = false;
          pendingConn = c; pendingRequester = requester;
          requesterIdDisplay.textContent = fmtId(requester);
          incomingModal.classList.add('active');
        }
        break;
      }
      case 'accepted':
        clearTimeout(connectionTimeout);
        connectingTitle.textContent = 'Ekran alınıyor...';
        connectingSubtitle.textContent = 'Karşı tarafın ekranı bekleniyor.';
        launchSessionView();
        break;
      case 'declined':
        clearTimeout(connectionTimeout);
        connectingModal.classList.remove('active');
        toast('Bağlantı isteği reddedildi.');
        cleanupConn();
        resetConnectionState();
        break;
      case 'busy':
        clearTimeout(connectionTimeout);
        connectingModal.classList.remove('active');
        toast('Cihaz meşgul görünüyor. Parola girip tekrar deneyin (gözetimsiz erişim açıksa oturumu devralır).');
        cleanupConn();
        resetConnectionState();
        break;
      case 'end':
        toast('Oturum karşı tarafça sonlandırıldı.');
        endSessionLocally();
        break;
      case 'stream-started':
        waitingScreenShare.style.display = 'none';
        break;
      case 'host-restarting':
        toast(`Karşı cihaz ${payload.version || 'yeni sürüme'} güncelleniyor. Aynı ID ve erişim parolasıyla birazdan yeniden bağlanabilirsiniz.`);
        break;
      case 'screens':
        viewerScreenCount = payload.count || 1;
        viewerScreenIndex = payload.index || 0;
        updateScreenSwitchUI();
        break;
      case 'switch-screen':
        if (isHost) hostSwitchScreen();
        break;
      case 'screen-changed':
        viewerScreenCount = payload.count || viewerScreenCount;
        viewerScreenIndex = payload.index || 0;
        updateScreenSwitchUI();
        break;
      case 'elevation-relaunching':
        toast('Karşı bilgisayar yönetici yetkisiyle yeniden başlatılıyor. Lütfen birkaç saniye sonra tekrar bağlanın...', 8000);
        break;
      case 'input':
        handleRemoteInput(payload.e);
        break;
      case 'clipboard-paste':
        if (isHost) pasteTextOnHost(payload.text);
        break;
      case 'clipboard-copy-request':
        if (isHost) copyTextFromHost();
        break;
      case 'clipboard-data':
        if (!isHost && isElectron && typeof payload.text === 'string') {
          RD.writeClipboardText(payload.text).then(() => toast('Uzak bilgisayardaki metin panoya kopyalandı.')).catch(() => {});
        }
        break;
      case 'chat':
        appendChatMessage(connectedPeerId, payload.message, false);
        break;
      case 'file-meta':
        initIncomingFileTransfer(payload);
        break;
      case 'chunk':
        handleIncomingFileChunk(payload.d);
        break;
      case 'file-end':
        finishIncomingFileTransfer();
        break;
      default:
        break;
    }
  }

  function send(obj) { if (conn && conn.open) { try { conn.send(obj); } catch (e) {} } }

  // ========================================================================
  // CONNECT / ACCEPT / DECLINE
  // ========================================================================
  connectBtn.addEventListener('click', () => {
    const target = digitsOnly(targetDeskIdInput.value);
    if (target.length !== 9) return toast('Geçersiz ID. 9 rakam girin (örn. 123 456 789).');
    if (target === myDeskDigits) return toast('Kendi ID\'nize bağlanamazsınız.');
    if (!peer || peer.disconnected) return toast('Sunucuya bağlı değil, birazdan tekrar deneyin.');

    // Drop any lingering connection from a previous attempt before starting fresh.
    stopSessionTimers();
    cleanupConn();

    isHost = false;
    connectedPeerDigits = target;
    connectedPeerId = fmtId(target);
    connectingTitle.textContent = 'Bağlanıyor...';
    connectingSubtitle.textContent = `${connectedPeerId} için istek gönderiliyor. Karşı tarafın onayı bekleniyor.`;
    connectingModal.classList.add('active');

    conn = peer.connect(target, { reliable: true, metadata: { from: myDeskDigits } });
    attachConnHandlers(conn);
    conn.on('open', () => {
      conn.send({ t: 'request', from: myDeskDigits, passcode: targetPasscodeInput ? targetPasscodeInput.value : '' });
    });

    connectionTimeout = setTimeout(() => {
      connectingModal.classList.remove('active');
      toast('Zaman aşımı. Karşı taraf yanıt vermedi veya çevrimdışı.');
      cleanupConn();
      resetConnectionState();
    }, 30000);
  });

  cancelConnectBtn.addEventListener('click', () => {
    clearTimeout(connectionTimeout);
    connectingModal.classList.remove('active');
    send({ t: 'end' });
    cleanupConn();
    resetConnectionState();
  });

  async function acceptIncoming(c, requesterDigits) {
    incomingModal.classList.remove('active');
    conn = c;
    connectedPeerDigits = requesterDigits;
    connectedPeerId = fmtId(requesterDigits);
    isHost = true;
    try { c.send({ t: 'accepted' }); } catch (e) {}

    try {
      if (isElectron) {
        const uacResult = await RD.setRemoteSessionActive(true);
        if (!uacResult || !uacResult.ok) console.warn('UAC compatibility could not be enabled', uacResult);
      }
      const stream = await initScreenSharing();
      mediaCall = peer.call(requesterDigits, stream);
      if (mediaCall) {
        mediaCall.on('close', () => endSessionLocally());
        if (mediaCall.peerConnection) optimizePeerConnection(mediaCall.peerConnection);
      }
      send({ t: 'stream-started' });
      // Multi-monitor: report available screens to the viewer.
      if (isElectron) {
        try {
          const info = await RD.getScreens();
          hostScreenCount = (info && info.count) || 1;
          hostScreenIndex = (info && info.current) || 0;
          await RD.selectScreen(hostScreenIndex);
        } catch (e) { hostScreenCount = 1; hostScreenIndex = 0; }
      }
      send({ t: 'screens', count: hostScreenCount, index: hostScreenIndex });
    } catch (e) {
      console.warn('screen share failed', e);
      if (isElectron) RD.setRemoteSessionActive(false).catch(() => {});
    }
    launchSessionView();
  }

  function optimizePeerConnection(pc) {
    if (!pc) return;
    try {
      const senders = pc.getSenders ? pc.getSenders() : [];
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video') {
          const params = sender.getParameters();
          if (params && params.encodings && params.encodings.length) {
            params.encodings[0].maxBitrate = 8_000_000; // 8 Mbps max for crisp 60fps
            params.encodings[0].networkPriority = 'high';
            params.degradationPreference = 'maintain-framerate';
            sender.setParameters(params).catch(() => {});
          }
        }
      }
    } catch (err) {}
  }

  acceptRequestBtn.addEventListener('click', () => {
    if (pendingConn) acceptIncoming(pendingConn, pendingRequester);
    pendingConn = null; pendingRequester = null;
  });

  declineRequestBtn.addEventListener('click', () => {
    incomingModal.classList.remove('active');
    if (pendingConn) { try { pendingConn.send({ t: 'declined' }); } catch (e) {} setTimeout(() => { try { pendingConn.close(); } catch (e) {} }, 300); }
    pendingConn = null; pendingRequester = null;
    resetConnectionState();
  });

  disconnectSessionBtn.addEventListener('click', () => {
    send({ t: 'end' });
    endSessionLocally();
  });

  if (isElectron && RD.onUpdateInstalling) {
    RD.onUpdateInstalling((info) => {
      if (isHost && conn && conn.open) {
        try { conn.send({ t: 'host-restarting', version: info && info.version }); } catch (e) {}
      }
      toast(`RüzgarDesk ${info && info.version ? info.version : ''} güncellemesini kurmak için yeniden başlatılıyor.`);
    });
  }

  if (isElectron && RD.onUpdateStatus) RD.onUpdateStatus(renderUpdateStatus);
  if (checkUpdateBtn) {
    if (!isElectron) checkUpdateBtn.style.display = 'none';
    else checkUpdateBtn.addEventListener('click', async () => {
      checkUpdateBtn.disabled = true;
      renderUpdateStatus({ state: 'checking', message: 'Yeni sürüm denetleniyor...' });
      try {
        const result = await RD.checkForUpdates();
        if (!result || !result.ok) renderUpdateStatus({ state: 'error', message: 'Güncelleme denetlenemedi: ' + ((result && result.error) || 'Bilinmeyen hata') });
      } catch (e) {
        renderUpdateStatus({ state: 'error', message: 'Güncelleme denetlenemedi: ' + e.message });
      } finally {
        setTimeout(() => { checkUpdateBtn.disabled = false; }, 1200);
      }
    });
  }

  // ========================================================================
  // SCREEN CAPTURE (host) — silent, Electron auto-selects the primary screen
  // ========================================================================
  async function initScreenSharing() {
    try {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, cursor: 'always' },
        audio: true
      });
    } catch (e) {
      localStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, cursor: 'always' },
        audio: false
      });
    }
    const vt = localStream.getVideoTracks()[0];
    if (vt) {
      // Hint to WebRTC encoder: maintain full 60fps framerate over resolution dropping
      if ('contentHint' in vt) vt.contentHint = 'motion';
      vt.onended = () => stopScreenSharing();
    }
    return localStream;
  }
  function stopScreenSharing() {
    if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  }
  if (requestStreamBtn) requestStreamBtn.style.display = 'none';

  // ========================================================================
  // VIEW TRANSITIONS
  // ========================================================================
  function launchSessionView() {
    connectingModal.classList.remove('active');
    if (sessionView.classList.contains('active')) { peerIdDisplay.textContent = connectedPeerId; return; }
    dashboardView.classList.remove('active');
    sessionView.classList.add('active');
    peerIdDisplay.textContent = connectedPeerId;
    chatMessagesContainer.innerHTML = `<div class="system-message"><span>${connectedPeerId} ile bağlantı kuruldu.</span></div>`;

    if (isHost) {
      waitingScreenShare.style.display = 'flex';
      if (waitingText) waitingText.textContent = isElectron
        ? 'Bu bilgisayar şu anda uzaktan kontrol ediliyor.'
        : 'Ekranınız paylaşılıyor (tarayıcı modu — uzaktan fare/klavye yalnızca masaüstü .exe sürümünde çalışır).';
      const spinner = waitingScreenShare.querySelector('.loader-spinner');
      if (spinner) spinner.style.display = 'none';
      remoteDisplayContainer.style.cursor = 'default';
    } else {
      remoteDisplayContainer.style.cursor = 'crosshair';
    }

    sessionStartTime = Date.now();
    sessionTimeLabel.textContent = '00:00';
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = setInterval(() => {
      const d = Math.floor((Date.now() - sessionStartTime) / 1000);
      sessionTimeLabel.textContent = `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
    }, 1000);
    saveRecentConnection(connectedPeerDigits);
    startSessionTimers();
    monitorPeerConn(conn);
  }

  function cleanupConn() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (mediaCall) { try { mediaCall.close(); } catch (e) {} mediaCall = null; }
  }

  function endSessionLocally() {
    const wasHost = isHost;
    sessionAuthorizedByPasscode = false;
    if (!isHost && conn && conn.open) { releaseAllModifiers(); releaseHeldMouseButtons(); } // clear anything held on the host
    stopSessionTimers();
    stopScreenSharing();
    cleanupConn();
    clearInterval(sessionTimerInterval);
    resetConnectionState();
    remoteVideo.srcObject = null;
    sessionView.classList.remove('active');
    dashboardView.classList.add('active');
    connectingModal.classList.remove('active');
    if (wasHost && isElectron) RD.setRemoteSessionActive(false).catch(() => {});
  }

  function resetConnectionState() {
    connectedPeerId = null;
    connectedPeerDigits = null;
    isHost = false;
    incoming = null;
    hostScreenCount = 1; hostScreenIndex = 0;
    viewerScreenCount = 1; viewerScreenIndex = 0;
    if (switchScreenBtn) switchScreenBtn.style.display = 'none';
  }

  // ========================================================================
  // REMOTE INPUT — viewer capture -> host OS injection
  // ========================================================================
  const BTN = { 0: 'L', 1: 'M', 2: 'R' };
  let lastMoveSent = 0;

  // Buttons currently held down on the remote host (as far as we know), so we
  // can force-release them if we ever lose track of the real mouseup (window
  // minimized/hidden, focus lost mid-drag, pointer capture lost, etc.) — a
  // button left "down" on the host is what causes the remote mouse to act
  // stuck/uncontrollable.
  const mouseButtonsDown = new Set();
  function releaseHeldMouseButtons() {
    if (!mouseButtonsDown.size) return;
    mouseButtonsDown.forEach((b) => sendInputEv({ k: 'u', b, x: 0.5, y: 0.5 }));
    mouseButtonsDown.clear();
  }

  // The window can be minimized/hidden while a session is active; at that
  // point remoteVideo's bounding rect collapses to 0x0, which used to produce
  // NaN/garbage coordinates sent straight to the host's native input (a NaN
  // cast to a Win32 int becomes a huge out-of-range value, which snaps the
  // real cursor to a corner and makes it look "frozen"). Returns null instead
  // of a bogus point so callers can safely skip sending anything.
  function toRemoteFraction(clientX, clientY) {
    const v = remoteVideo;
    const rect = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    if (vw && vh && rect.width && rect.height) {
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const dispW = vw * scale, dispH = vh * scale;
      const offX = rect.left + (rect.width - dispW) / 2;
      const offY = rect.top + (rect.height - dispH) / 2;
      if (!dispW || !dispH) return null;
      const x = clamp01((clientX - offX) / dispW), y = clamp01((clientY - offY) / dispH);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    const cc = remoteDisplayContainer.getBoundingClientRect();
    if (!cc.width || !cc.height) return null;
    const x = clamp01((clientX - cc.left) / cc.width), y = clamp01((clientY - cc.top) / cc.height);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  // Never send remote input while our own window is minimized/hidden — there's
  // nothing useful to click on anyway, and it's the source of the bogus-rect
  // bug above.
  const viewerActive = () => connectedPeerId && !isHost && !document.hidden;
  function sendInputEv(ev) { send({ t: 'input', e: ev }); }

  remoteDisplayContainer.addEventListener('mousemove', (e) => {
    if (!viewerActive()) return;
    const now = performance.now();
    if (now - lastMoveSent < 16) return; // ~60 FPS responsive cursor movement
    lastMoveSent = now;
    if (conn && conn.dataChannel && conn.dataChannel.bufferedAmount > 32768) return;
    const p = toRemoteFraction(e.clientX, e.clientY);
    if (!p) return;
    sendInputEv({ k: 'm', x: p.x, y: p.y });
  });
  remoteDisplayContainer.addEventListener('mousedown', (e) => {
    if (!viewerActive()) return;
    e.preventDefault();
    const p = toRemoteFraction(e.clientX, e.clientY);
    if (!p) return;
    const b = BTN[e.button] || 'L';
    try { remoteDisplayContainer.setPointerCapture(e.pointerId); } catch (err) {}
    mouseButtonsDown.add(b);
    sendInputEv({ k: 'd', b, x: p.x, y: p.y });
  });
  // Listen on window (not just the container) so a release that lands outside
  // the video area — very common while dragging — still reaches the host.
  // Without this, the host is left thinking the button is permanently held.
  window.addEventListener('mouseup', (e) => {
    if (!connectedPeerId || isHost) return; // check even if window just went hidden
    const b = BTN[e.button] || 'L';
    if (!mouseButtonsDown.has(b)) return;
    mouseButtonsDown.delete(b);
    const p = toRemoteFraction(e.clientX, e.clientY) || { x: 0.5, y: 0.5 };
    sendInputEv({ k: 'u', b, x: p.x, y: p.y });
  });
  remoteDisplayContainer.addEventListener('contextmenu', (e) => { if (viewerActive()) e.preventDefault(); });
  remoteDisplayContainer.addEventListener('wheel', (e) => {
    if (!viewerActive()) return;
    e.preventDefault();
    const p = toRemoteFraction(e.clientX, e.clientY);
    if (!p) return;
    sendInputEv({ k: 'w', d: (e.deltaY > 0 ? -1 : 1) * 120, x: p.x, y: p.y });
  }, { passive: false });

  // Window minimized/restored or tab hidden mid-drag/mid-shortcut: release
  // anything we might be holding on the remote host so it never gets stuck.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isHost) { releaseHeldMouseButtons(); releaseAllModifiers(); heldKeys.clear(); }
  });

  const typingInField = () => {
    const el = document.activeElement;
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };

  // VKs that must never be sent on their own. Forwarding a lone Shift/Ctrl/Alt/Win
  // lets Windows fire its "switch keyboard layout" hotkeys (Ctrl+Shift, Alt+Shift)
  // and leaves modifiers stuck on the remote machine — which is exactly what
  // "messes up" the remote keyboard/mouse. We only ever send modifiers as part of
  // a self-contained chord that presses and releases them around a real key.
  const MODIFIER_VKS = new Set([16, 17, 18, 91, 92]);

  function sendChord(vk, mods) {
    const down = [];
    if (mods.ctrl) down.push(17);
    if (mods.alt) down.push(18);
    if (mods.shift) down.push(16);
    if (mods.meta) down.push(91);
    down.forEach((v) => sendInputEv({ k: 'kd', vk: v }));
    sendInputEv({ k: 'kd', vk });
    sendInputEv({ k: 'ku', vk });
    for (let i = down.length - 1; i >= 0; i--) sendInputEv({ k: 'ku', vk: down[i] });
  }

  function releaseAllModifiers() {
    [17, 18, 16, 91, 92].forEach((v) => sendInputEv({ k: 'ku', vk: v }));
  }

  // Track which non-modifier VKs are currently held so we don't re-send the
  // chord on auto-repeat keydown events (prevents modifier "sticking" on remote).
  const heldKeys = new Set();

  async function pasteTextOnHost(text) {
    if (!isHost || !isElectron || typeof text !== 'string') return;
    try {
      await RD.writeClipboardText(text.slice(0, 1024 * 1024));
      RD.injectInput('K 17 1');
      RD.injectInput('K 86 1');
      RD.injectInput('K 86 0');
      RD.injectInput('K 17 0');
    } catch (e) { console.warn('remote clipboard paste failed', e); }
  }

  function copyTextFromHost() {
    if (!isHost || !isElectron) return;
    RD.injectInput('K 17 1');
    RD.injectInput('K 67 1');
    RD.injectInput('K 67 0');
    RD.injectInput('K 17 0');
    setTimeout(async () => {
      try {
        const text = await RD.readClipboardText();
        send({ t: 'clipboard-data', text: String(text || '').slice(0, 1024 * 1024) });
      } catch (e) { console.warn('remote clipboard copy failed', e); }
    }, 250);
  }

  window.addEventListener('keydown', async (e) => {
    if (!viewerActive() || typingInField()) return;
    const clipboardShortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (clipboardShortcut && (e.code === 'KeyC' || e.code === 'KeyV')) {
      const vk = e.code === 'KeyC' ? 67 : 86;
      e.preventDefault();
      if (heldKeys.has(vk)) return;
      heldKeys.add(vk);
      if (e.code === 'KeyC') {
        send({ t: 'clipboard-copy-request' });
      } else if (isElectron) {
        try {
          const text = await RD.readClipboardText();
          send({ t: 'clipboard-paste', text: String(text || '').slice(0, 1024 * 1024) });
        } catch (err) {
          sendChord(86, { ctrl: true, alt: false, shift: false, meta: false });
        }
      } else {
        sendChord(vk, { ctrl: true, alt: false, shift: false, meta: false });
      }
      return;
    }
    const printable = e.key.length === 1;
    const altGr = e.ctrlKey && e.altKey; // AltGr reports as Ctrl+Alt (e.g. Turkish @, €)
    // Plain text and AltGr characters → Unicode injection (layout-independent,
    // handles Turkish characters and capitals without sending modifier keys).
    if (printable && !e.metaKey && (!e.ctrlKey && !e.altKey || altGr)) {
      // Don't suppress repeat for printable chars — let them type naturally.
      sendInputEv({ k: 't', cp: e.key.codePointAt(0) });
      e.preventDefault();
      return;
    }
    const vk = mapVK(e);
    if (!vk) return;
    e.preventDefault();
    if (MODIFIER_VKS.has(vk)) return; // never send a lone modifier
    // Skip auto-repeat: if this key is already held, don't re-send the full chord
    // (which would press and release modifiers again, causing layout switches).
    if (heldKeys.has(vk)) return;
    heldKeys.add(vk);
    sendChord(vk, { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
  });

  window.addEventListener('keyup', (e) => {
    if (!viewerActive()) return;
    const vk = mapVK(e);
    if (vk) heldKeys.delete(vk);
  });

  // Safety net: if the viewer window loses focus mid-press, clear held key tracking
  // and release any stuck modifiers on the remote machine.
  window.addEventListener('blur', () => {
    heldKeys.clear();
    if (viewerActive()) releaseAllModifiers();
  });

  function mapVK(e) {
    const key = e.key, code = e.code;
    if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
    if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
    if (/^Numpad[0-9]$/.test(code)) return 0x60 + Number(code.slice(6));
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return 0x70 + (Number(key.slice(1)) - 1);
    const map = {
      // code-based (physical key, layout-independent)
      Enter: 13, NumpadEnter: 13, Backspace: 8, Tab: 9, Escape: 27,
      Space: 32,                          // ← explicit Space code mapping
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
      Delete: 46, Insert: 45, Home: 36, End: 35, PageUp: 33, PageDown: 34,
      CapsLock: 20, ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17,
      AltLeft: 18, AltRight: 18, MetaLeft: 91, MetaRight: 92, ContextMenu: 93,
      NumLock: 0x90, ScrollLock: 0x91, PrintScreen: 0x2C, Pause: 0x13,
      Minus: 0xBD, Equal: 0xBB, BracketLeft: 0xDB, BracketRight: 0xDD, Backslash: 0xDC,
      Semicolon: 0xBA, Quote: 0xDE, Backquote: 0xC0, Comma: 0xBC, Period: 0xBE, Slash: 0xBF,
      NumpadAdd: 0x6B, NumpadSubtract: 0x6D, NumpadMultiply: 0x6A, NumpadDivide: 0x6F, NumpadDecimal: 0x6E
    };
    if (map[code] != null) return map[code];
    // key-based fallback (for keyboards that don't report a standard code)
    const km = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ' ': 32, Control: 17, Shift: 16, Alt: 18, Meta: 91 };
    return km[key] != null ? km[key] : null;
  }

  function handleRemoteInput(ev) {
    if (!isHost || !ev || !isElectron) return;
    switch (ev.k) {
      case 'm': RD.injectInput(`M ${ev.x.toFixed(5)} ${ev.y.toFixed(5)}`); break;
      case 'd': RD.injectInput(`D ${ev.b} ${ev.x.toFixed(5)} ${ev.y.toFixed(5)}`); break;
      case 'u': RD.injectInput(`U ${ev.b} ${ev.x.toFixed(5)} ${ev.y.toFixed(5)}`); break;
      case 'w': RD.injectInput(`W ${ev.d} ${ev.x.toFixed(5)} ${ev.y.toFixed(5)}`); break;
      case 'kd': RD.injectInput(`K ${ev.vk} 1`); break;
      case 'ku': RD.injectInput(`K ${ev.vk} 0`); break;
      case 't': RD.injectInput(`T ${ev.cp}`); break;
      default: break;
    }
  }

  // ========================================================================
  // CHAT
  // ========================================================================
  function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    appendChatMessage(myDeskId || 'Siz', text, true);
    chatInput.value = '';
    send({ t: 'chat', message: text });
  }
  chatSendBtn.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatMessage(); });

  function appendChatMessage(sender, text, isMe) {
    const b = document.createElement('div');
    b.className = `chat-bubble ${isMe ? 'sent' : 'received'}`;
    b.innerHTML = `<div style="font-size:11px;font-weight:700;opacity:.75;margin-bottom:4px;">${escapeHtml(sender)}</div><div>${escapeHtml(text)}</div>`;
    chatMessagesContainer.appendChild(b);
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  }
  function escapeHtml(t) { const d = document.createElement('div'); d.innerText = t; return d.innerHTML; }

  // ========================================================================
  // FILE TRANSFER
  // ========================================================================
  const CHUNK = 64 * 1024;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  fileDropZone.addEventListener('click', () => fileSelectInput.click());
  fileSelectInput.addEventListener('change', () => { if (fileSelectInput.files.length) sendFiles(fileSelectInput.files); fileSelectInput.value = ''; });
  fileDropZone.addEventListener('dragover', (e) => { e.preventDefault(); fileDropZone.classList.add('dragover'); });
  fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
  fileDropZone.addEventListener('drop', (e) => { e.preventDefault(); fileDropZone.classList.remove('dragover'); if (e.dataTransfer.files.length) sendFiles(e.dataTransfer.files); });
  if (openDownloadsBtn) openDownloadsBtn.addEventListener('click', () => { if (isElectron) RD.openDownloads(); });

  async function sendFiles(files) {
    if (!conn || !conn.open) return toast('Dosya aktarımı için bağlı değilsiniz.');
    for (const file of files) {
      const id = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      appendTransferCard(id, file.name, file.size, true);
      conn.send({ t: 'file-meta', name: file.name, size: file.size });
      let offset = 0, n = 0;
      while (offset < file.size) {
        const buf = await file.slice(offset, offset + CHUNK).arrayBuffer();
        conn.send({ t: 'chunk', d: buf });
        offset += buf.byteLength;
        updateTransferProgress(id, Math.floor((offset / file.size) * 100));
        if (++n % 16 === 0) await sleep(4); // pacing to avoid buffer overflow
      }
      conn.send({ t: 'file-end' });
      finalizeTransferCard(id);
    }
  }

  let incoming = null;
  async function initIncomingFileTransfer(meta) {
    const id = `rx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    incoming = { id, name: meta.name, size: meta.size, received: 0, parts: [] };
    appendTransferCard(id, meta.name, meta.size, false);
    if (isElectron) { const res = await RD.fileBegin(id, meta.name); incoming.diskPath = res && res.ok ? res.path : null; }
  }
  function handleIncomingFileChunk(buf) {
    if (!incoming) return;
    const len = buf.byteLength != null ? buf.byteLength : (buf.length || 0);
    incoming.received += len;
    if (isElectron && incoming.diskPath) RD.fileChunk(incoming.id, buf);
    else incoming.parts.push(buf);
    updateTransferProgress(incoming.id, Math.floor((incoming.received / incoming.size) * 100));
    if (incoming.received >= incoming.size) finishIncomingFileTransfer();
  }
  async function finishIncomingFileTransfer() {
    if (!incoming) return;
    const done = incoming; incoming = null;
    if (isElectron && done.diskPath) { const res = await RD.fileEnd(done.id); finalizeTransferCard(done.id, null, res && res.path ? res.path : done.diskPath); }
    else { const url = URL.createObjectURL(new Blob(done.parts)); finalizeTransferCard(done.id, url); }
  }

  function appendTransferCard(id, name, size, sending) {
    const empty = document.querySelector('#transfers-container .empty-transfers-label');
    if (empty) empty.remove();
    const card = document.createElement('div');
    card.className = 'transfer-card'; card.id = id;
    card.innerHTML = `<div class="transfer-meta"><span class="file-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
      `<span class="file-size">${sending ? 'Gönderiliyor' : 'Alınıyor'} (${formatBytes(size)})</span></div>` +
      `<div class="progress-bar-wrapper"><div class="progress-fill" style="width:0%"></div></div>`;
    transfersContainer.appendChild(card);
    transfersContainer.scrollTop = transfersContainer.scrollHeight;
  }
  function updateTransferProgress(id, pct) {
    const card = document.getElementById(id);
    if (card) { const f = card.querySelector('.progress-fill'); if (f) f.style.width = `${pct}%`; }
  }
  function finalizeTransferCard(id, downloadUrl, diskPath) {
    const card = document.getElementById(id);
    if (!card) return;
    const size = card.querySelector('.file-size');
    size.textContent = 'Tamamlandı'; size.style.color = 'var(--success)';
    const fill = card.querySelector('.progress-fill'); if (fill) fill.style.width = '100%';
    if (downloadUrl) {
      const a = document.createElement('a');
      a.href = downloadUrl; a.download = card.querySelector('.file-name').textContent;
      a.className = 'download-link'; a.textContent = 'İndir'; card.appendChild(a);
    } else if (diskPath && isElectron) {
      const a = document.createElement('a');
      a.href = '#'; a.className = 'download-link'; a.textContent = 'Klasörde göster';
      a.addEventListener('click', (e) => { e.preventDefault(); RD.showInFolder(diskPath); });
      card.appendChild(a);
    }
  }
  function formatBytes(bytes, d = 2) {
    if (!bytes) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(d)) + ' ' + sizes[i];
  }

  // ========================================================================
  // RECENT CONNECTIONS
  // ========================================================================
  function saveRecentConnection(deskDigits) {
    const id = fmtId(deskDigits);
    let list = JSON.parse(localStorage.getItem('ruzgardesk-recents') || '[]');
    if (!list.includes(id)) { list.unshift(id); list = list.slice(0, 6); localStorage.setItem('ruzgardesk-recents', JSON.stringify(list)); }
  }
  function updateRecentList() {
    const recents = JSON.parse(localStorage.getItem('ruzgardesk-recents') || '[]');
    recentConnectionsList.innerHTML = '';
    if (!recents.length) { recentConnectionsList.innerHTML = '<li class="recent-item empty-state">Henüz bağlantı yok</li>'; return; }
    recents.forEach((id) => {
      const li = document.createElement('li');
      li.className = 'recent-item';
      li.innerHTML = `<div class="recent-desk-info"><div class="recent-avatar">${id.slice(0, 2)}</div>` +
        `<div class="recent-meta"><span style="font-weight:600;">${id}</span></div></div>` +
        `<button class="recent-action-connect" data-id="${id}">Bağlan</button>`;
      recentConnectionsList.appendChild(li);
    });
    recentConnectionsList.querySelectorAll('.recent-action-connect').forEach((btn) => {
      btn.addEventListener('click', (e) => { targetDeskIdInput.value = e.target.getAttribute('data-id'); connectBtn.click(); });
    });
  }

  // ========================================================================
  // MISC UI
  // ========================================================================
  copyIdBtn.addEventListener('click', () => { if (myDeskId) navigator.clipboard.writeText(myDeskId).then(() => toast('Masa ID kopyalandı')); });

  togglePasscodeBtn.addEventListener('click', () => {
    const show = myPasscodeInput.type === 'password';
    myPasscodeInput.type = show ? 'text' : 'password';
    togglePasscodeBtn.textContent = show ? 'Gizle' : 'Göster';
  });
  myPasscodeInput.addEventListener('change', () => persistConfig({ passcode: myPasscodeInput.value }));
  if (unattendedToggle) unattendedToggle.addEventListener('change', () => {
    if (unattendedToggle.checked && !myPasscodeInput.value) { toast('Gözetimsiz erişim için önce bir parola belirleyin.'); unattendedToggle.checked = false; return; }
    persistConfig({ unattended: unattendedToggle.checked, passcode: myPasscodeInput.value });
    if (unattendedToggle.checked && !boot.isAdmin && isElectron && RD.relaunchElevated) {
      toast('Gözetimsiz erişim yetkisi için RüzgarDesk yönetici yetkisiyle başlatılıyor...');
      setTimeout(() => RD.relaunchElevated(), 400);
    }
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + btn.getAttribute('data-tab'));
      if (panel) panel.classList.add('active');
    });
  });

  if (fullscreenBtn) fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) remoteDisplayContainer.requestFullscreen && remoteDisplayContainer.requestFullscreen();
    else document.exitFullscreen();
  });

  // Screen switching (viewer asks; host swaps the shared monitor)
  function updateScreenSwitchUI() {
    if (!switchScreenBtn) return;
    if (!isHost && viewerScreenCount > 1) {
      switchScreenBtn.style.display = 'inline-flex';
      if (screenIndicator) screenIndicator.textContent = `${viewerScreenIndex + 1}/${viewerScreenCount}`;
    } else {
      switchScreenBtn.style.display = 'none';
    }
  }

  if (switchScreenBtn) switchScreenBtn.addEventListener('click', () => {
    if (!isHost && viewerScreenCount > 1) send({ t: 'switch-screen' });
  });

  async function hostSwitchScreen() {
    if (!isElectron || !isHost || hostScreenCount <= 1) return;
    const next = (hostScreenIndex + 1) % hostScreenCount;
    try {
      // 1. Update Electron's internal screen selection for both capture and input injection
      const res = await RD.selectScreen(next);
      hostScreenIndex = (res && typeof res.current === 'number') ? res.current : next;

      // 2. Trigger a new silent screen capture via Electron's handler (no dialog).
      //    Calling getDisplayMedia again would show the picker dialog — instead,
      //    we stop the current track, then request a fresh one. The Electron handler
      //    in main.js (setDisplayMediaRequestHandler) will auto-pick the new screen.
      const pc = mediaCall && mediaCall.peerConnection;
      const sender = pc && pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (!sender) { console.warn('No video sender in peer connection'); return; }

      const oldTrack = sender.track;
      if (oldTrack) oldTrack.stop();

      // Request a new stream — Electron's handler now picks the updated screen index
      const newStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const newTrack = newStream.getVideoTracks()[0];

      if (newTrack) {
        await sender.replaceTrack(newTrack);
        if (localStream) {
          if (oldTrack) { try { localStream.removeTrack(oldTrack); } catch (e) {} }
          try { localStream.addTrack(newTrack); } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('screen switch failed', e);
    }
    send({ t: 'screen-changed', index: hostScreenIndex, count: hostScreenCount });
  }
  if (toggleAudioBtn) toggleAudioBtn.addEventListener('click', () => {
    remoteVideo.muted = !remoteVideo.muted;
    toggleAudioBtn.style.opacity = remoteVideo.muted ? '0.5' : '1';
  });

  if (openSettingsBtn) openSettingsBtn.addEventListener('click', () => {
    if (peerHostInput) peerHostInput.value = cfg.peerHost || '';
    if (peerStatus) peerStatus.textContent = (peer && !peer.disconnected && myDeskId) ? ('Bağlı (' + myDeskId + ')') : 'Bağlanıyor...';
    settingsModal.classList.add('active');
  });
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => settingsModal.classList.remove('active'));
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => {
    persistConfig({ peerHost: (peerHostInput.value || '').trim() });
    settingsModal.classList.remove('active');
    toast('Ayarlar kaydedildi, yeniden başlatılıyor...');
    setTimeout(() => location.reload(), 600);
  });

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('rd-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rd-toast';
      el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(20,20,32,.95);color:#fff;padding:12px 20px;border-radius:10px;border:1px solid rgba(168,85,247,.5);z-index:9999;font-size:14px;max-width:80%;box-shadow:0 10px 40px rgba(0,0,0,.5);transition:opacity .4s;';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 3500);
  }

  // macOS Permissions helper
  async function showMacPermissionsModal() {
    if (!macPermissionsModal || !isElectron || RD.platform !== 'darwin') return;
    macPermissionsModal.classList.add('active');
    try {
      const perms = await RD.checkPermissions();
      updateMacPermsUI(perms);
    } catch (e) {}
  }

  function updateMacPermsUI(perms) {
    if (!perms) return;
    if (macPermScreenStatus) {
      const isOk = perms.screen === 'granted';
      macPermScreenStatus.textContent = isOk ? '● İzin Verildi' : '● İzin Gerekli (Sistem Ayarlarından Açın)';
      macPermScreenStatus.style.color = isOk ? '#10b981' : '#f59e0b';
    }
    if (macPermAccStatus) {
      const isOk = !!perms.accessibility;
      macPermAccStatus.textContent = isOk ? '● İzin Verildi' : '● İzin Gerekli (Sistem Ayarlarından Onaylayın)';
      macPermAccStatus.style.color = isOk ? '#10b981' : '#f59e0b';
    }
  }

  if (closeMacPermsBtn) closeMacPermsBtn.addEventListener('click', () => macPermissionsModal.classList.remove('active'));
  if (recheckMacPermsBtn) {
    recheckMacPermsBtn.addEventListener('click', async () => {
      if (isElectron && RD.checkPermissions) {
        const p = await RD.checkPermissions();
        updateMacPermsUI(p);
        toast('İzin durumu güncellendi.');
      }
    });
  }
  if (macReqScreenBtn) {
    macReqScreenBtn.addEventListener('click', async () => {
      if (isElectron && RD.requestPermissions) {
        await RD.requestPermissions('screen');
      }
    });
  }
  if (macReqAccBtn) {
    macReqAccBtn.addEventListener('click', async () => {
      if (isElectron && RD.requestPermissions) {
        const res = await RD.requestPermissions('accessibility');
        if (res && res.active) toast('Erişilebilirlik izni aktif!');
      }
    });
  }

  bootstrap();
});
