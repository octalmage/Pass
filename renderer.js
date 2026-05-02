/*
 ____
|  _ \ __ _ ___ ___
| |_) / _` / __/ __|
|  __/ (_| \__ \__ \
|_|   \__,_|___/___/
By: Jason Stallings
URL: http://github.com/octalmage/pass
*/

const { ipcRenderer } = require("electron");
const os = require("os");
const http = require("http");
const SimplePeer = require("simple-peer");
const { Server: IOServer } = require("socket.io");
const ioClient = require("socket.io-client");
const { Bonjour } = require("bonjour-service");

const SIGNAL_PORT = 8890;
const SERVICE_TYPE = "pass";

const bonjour = new Bonjour();
let advertisedService = null;
let browser = null;

let signalServer = null;
let signalIO = null;
let activePeer = null;
let activeSocket = null;
let activeReceiverPeer = null;
let hiddenSourceState = null;

const els = {
  video: document.querySelector("video"),
  pickModal: document.getElementById("pickModal"),
  pickList: document.getElementById("pickList"),
  pickSend: document.getElementById("pickSend"),
  pickCancel: document.getElementById("pickCancel"),
  requestModal: document.getElementById("requestModal"),
  requestHost: document.getElementById("requestHost"),
  requestAccept: document.getElementById("requestAccept"),
  requestDecline: document.getElementById("requestDecline"),
};

console.log("[Pass] renderer booting on", os.hostname());
startReceiver();
advertisePresence();

ipcRenderer.on("hotkey-send", () => sendWindow());

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.video.srcObject && activeReceiverPeer) {
    try {
      activeReceiverPeer.destroy();
    } catch (_) {}
  }
});

/* ---------------- Discovery ---------------- */

function advertisePresence() {
  advertisedService = bonjour.publish({
    name: os.hostname(),
    type: SERVICE_TYPE,
    port: SIGNAL_PORT,
  });
}

function findPeers(timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      if (browser) browser.stop();
    } catch (_) {}
    try {
      browser = bonjour.find({ type: SERVICE_TYPE });
    } catch (err) {
      console.error("bonjour.find failed:", err);
      resolve([]);
      return;
    }
    setTimeout(() => {
      const myHost = os.hostname();
      const services = (browser && browser.services) || [];
      const peers = services
        .filter((s) => s && s.name && s.name !== myHost)
        .map((s) => ({
          name: s.name,
          host: s.host,
          addresses: s.addresses,
          port: s.port,
        }));
      console.log("[Pass] discovered peers:", peers);
      resolve(peers);
    }, timeoutMs);
  });
}

/* ---------------- Receiver ---------------- */

function startReceiver() {
  signalServer = http.createServer();
  signalIO = new IOServer(signalServer, {
    cors: { origin: "*" },
  });
  signalServer.listen(SIGNAL_PORT);

  signalIO.on("connection", (rsocket) => {
    console.log("[Pass] receiver: incoming socket connection");
    let incomingHost = "unknown";
    const peer = new SimplePeer({ trickle: true });

    rsocket.on("request", (data) => {
      incomingHost = data;
    });

    rsocket.on("signal", (data) => {
      peer.signal(data);
    });

    peer.on("signal", (data) => {
      rsocket.emit("signal", data);
    });

    peer.on("stream", (stream) => {
      console.log("[Pass] receiver: stream arrived from", incomingHost);
      requestDialog(incomingHost, stream, peer);
    });

    peer.on("error", (err) => {
      console.error("Receiver peer error:", err);
    });

    peer.on("close", () => {
      teardownReceiver(peer);
    });

    rsocket.on("disconnect", () => {
      try {
        peer.destroy();
      } catch (_) {}
    });
  });
}

function teardownReceiver(peer) {
  try {
    peer.destroy();
  } catch (_) {}
  if (activeReceiverPeer === peer) activeReceiverPeer = null;
  if (els.video.srcObject) {
    els.video.srcObject.getTracks().forEach((t) => t.stop());
    els.video.srcObject = null;
  }
  els.video.removeEventListener("loadedmetadata", resizeWindowToVideo);
  els.video.removeEventListener("resize", resizeWindowToVideo);
  ipcRenderer.send("set-window-size", { width: 1, height: 1 });
  ipcRenderer.send("hide-window");
}

function requestDialog(host, stream, peer) {
  els.requestHost.textContent = host;
  showModal(els.requestModal);

  const accept = () => {
    cleanup();
    hideModal(els.requestModal);
    activeReceiverPeer = peer;
    ipcRenderer.send("show-window");
    els.video.srcObject = stream;
    els.video.play();
    els.video.addEventListener("loadedmetadata", resizeWindowToVideo);
    els.video.addEventListener("resize", resizeWindowToVideo);
    resizeWindowToVideo();
  };

  const decline = () => {
    cleanup();
    hideModal(els.requestModal);
    try {
      peer.destroy();
    } catch (_) {}
  };

  function cleanup() {
    els.requestAccept.removeEventListener("click", accept);
    els.requestDecline.removeEventListener("click", decline);
  }

  els.requestAccept.addEventListener("click", accept);
  els.requestDecline.addEventListener("click", decline);
}

function resizeWindowToVideo() {
  if (!els.video.videoWidth || !els.video.videoHeight) return;
  const dpr = window.devicePixelRatio || 1;
  ipcRenderer.send("set-window-size", {
    width: els.video.videoWidth / dpr,
    height: els.video.videoHeight / dpr,
  });
}

/* ---------------- Sender ---------------- */

async function sendWindow() {
  console.log("[Pass] sendWindow: requesting display media");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
  } catch (err) {
    console.error("[Pass] getDisplayMedia failed:", err.name, err.message);
    return;
  }

  console.log("[Pass] got stream, tracks:", stream.getTracks().length);

  const pendingHide = await ipcRenderer.invoke("capture-source-window");
  console.log("[Pass] captured source window:", pendingHide);

  const peers = await findPeers();
  console.log("[Pass] showing peer picker with", peers.length, "peers");
  const target = await pickPeer(peers);
  if (!target) {
    console.log("[Pass] no peer selected, stopping stream");
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  console.log("[Pass] selected target:", target.name);
  stream.getVideoTracks().forEach((t) => {
    t.addEventListener("ended", () => {
      console.log("[Pass] source track ended");
      teardownSender(stream);
    });
  });

  if (pendingHide) {
    hiddenSourceState = await ipcRenderer.invoke(
      "hide-source-window",
      pendingHide,
    );
    console.log("[Pass] source hidden:", hiddenSourceState);
  }

  connectAndSend(target, stream);
}

function pickPeer(peers) {
  return new Promise((resolve) => {
    els.pickList.innerHTML = "";
    if (peers.length === 0) {
      els.pickList.innerHTML = "<p>No peers found on the network.</p>";
    } else {
      peers.forEach((p, i) => {
        const item = document.createElement("label");
        item.className = "row";
        const addr = p.addresses && p.addresses[0] ? p.addresses[0] : p.host;
        item.innerHTML = `<input type="radio" name="peer" value="${i}"> ${escapeHtml(p.name)} <span class="muted">(${escapeHtml(addr)})</span>`;
        els.pickList.appendChild(item);
      });
    }
    showModal(els.pickModal);

    let selected = null;
    const onSelect = (e) => {
      if (e.target.name !== "peer") return;
      selected = peers[parseInt(e.target.value, 10)];
    };

    const cancel = () => {
      cleanup();
      hideModal(els.pickModal);
      resolve(null);
    };

    const send = () => {
      if (!selected) return;
      cleanup();
      hideModal(els.pickModal);
      resolve(selected);
    };

    function cleanup() {
      els.pickList.removeEventListener("change", onSelect);
      els.pickCancel.removeEventListener("click", cancel);
      els.pickSend.removeEventListener("click", send);
    }

    els.pickList.addEventListener("change", onSelect);
    els.pickCancel.addEventListener("click", cancel);
    els.pickSend.addEventListener("click", send);
  });
}

function connectAndSend(target, stream) {
  const addr =
    target.addresses && target.addresses[0] ? target.addresses[0] : target.host;
  const url = `http://${addr}:${target.port}`;

  if (activeSocket) {
    try {
      activeSocket.close();
    } catch (_) {}
  }
  if (activePeer) {
    try {
      activePeer.destroy();
    } catch (_) {}
  }

  activeSocket = ioClient(url, { transports: ["websocket"] });

  activeSocket.on("connect", () => {
    activeSocket.emit("request", os.hostname());

    activePeer = new SimplePeer({
      initiator: true,
      stream,
      trickle: true,
    });

    activePeer.on("signal", (data) => {
      activeSocket.emit("signal", data);
    });

    activePeer.on("error", (err) => {
      console.error("Sender peer error:", err);
    });

    activePeer.on("close", () => {
      teardownSender(stream);
    });
  });

  activeSocket.on("signal", (data) => {
    if (activePeer) activePeer.signal(data);
  });

  activeSocket.on("disconnect", () => {
    teardownSender(stream);
  });
}

function teardownSender(stream) {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }
  if (activePeer) {
    try {
      activePeer.destroy();
    } catch (_) {}
    activePeer = null;
  }
  if (activeSocket) {
    try {
      activeSocket.close();
    } catch (_) {}
    activeSocket = null;
  }
  if (hiddenSourceState) {
    const state = hiddenSourceState;
    hiddenSourceState = null;
    ipcRenderer.invoke("restore-source-window", state).catch(() => {});
  }
}

/* ---------------- DOM helpers ---------------- */

function showModal(el) {
  el.classList.add("visible");
  ipcRenderer.send("set-window-size", { width: 480, height: 320 });
  ipcRenderer.send("show-window", { center: true, alwaysOnTop: true });
}

function hideModal(el) {
  el.classList.remove("visible");
  const anyVisible = document.querySelector(".modal.visible");
  if (!anyVisible && !els.video.srcObject) {
    ipcRenderer.send("hide-window");
  } else if (els.video.srcObject) {
    ipcRenderer.send("show-window", { alwaysOnTop: false });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

window.addEventListener("beforeunload", () => {
  try {
    if (advertisedService) advertisedService.stop();
  } catch (_) {}
  try {
    bonjour.destroy();
  } catch (_) {}
  try {
    if (signalIO) signalIO.close();
  } catch (_) {}
  try {
    if (signalServer) signalServer.close();
  } catch (_) {}
});
