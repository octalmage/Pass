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

const els = {
  video: document.querySelector("video"),
  pickModal: document.getElementById("pickModal"),
  pickList: document.getElementById("pickList"),
  pickSend: document.getElementById("pickSend"),
  pickCancel: document.getElementById("pickCancel"),
  pickSourceModal: document.getElementById("pickSourceModal"),
  pickSourceList: document.getElementById("pickSourceList"),
  pickSourceCancel: document.getElementById("pickSourceCancel"),
  requestModal: document.getElementById("requestModal"),
  requestHost: document.getElementById("requestHost"),
  requestAccept: document.getElementById("requestAccept"),
  requestDecline: document.getElementById("requestDecline"),
};

startReceiver();
advertisePresence();

ipcRenderer.on("hotkey-send", () => sendWindow());

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
    if (browser) browser.stop();
    browser = bonjour.find({ type: SERVICE_TYPE });
    setTimeout(() => {
      const myHost = os.hostname();
      const peers = browser.services
        .filter((s) => s.name !== myHost)
        .map((s) => ({
          name: s.name,
          host: s.host,
          addresses: s.addresses,
          port: s.port,
        }));
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
  ipcRenderer.send("hide-window");
  els.video.srcObject = null;
}

function requestDialog(host, stream, peer) {
  els.requestHost.textContent = host;
  showModal(els.requestModal);

  const accept = () => {
    cleanup();
    hideModal(els.requestModal);
    ipcRenderer.send("show-window");
    els.video.srcObject = stream;
    els.video.play();
    els.video.addEventListener("playing", resizeWindowToVideo, { once: true });
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
  const tick = () => {
    if (els.video.videoWidth && els.video.videoHeight) {
      ipcRenderer.send("set-window-size", {
        width: els.video.videoWidth,
        height: els.video.videoHeight,
      });
    }
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- Sender ---------------- */

async function sendWindow() {
  let sources;
  try {
    sources = await ipcRenderer.invoke("get-sources");
  } catch (err) {
    console.error("Failed to get sources:", err);
    return;
  }

  const source = await pickSource(sources);
  if (!source) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: source.id,
          maxWidth: 1920,
          maxHeight: 1080,
        },
      },
    });
  } catch (err) {
    console.error("getUserMedia failed:", err);
    return;
  }

  const peers = await findPeers();
  const target = await pickPeer(peers);
  if (!target) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

  connectAndSend(target, stream);
}

function pickSource(sources) {
  return new Promise((resolve) => {
    els.pickSourceList.innerHTML = "";
    sources.forEach((s, i) => {
      const item = document.createElement("label");
      item.className = "row";
      item.innerHTML = `<input type="radio" name="source" value="${i}"> ${escapeHtml(s.name)}`;
      els.pickSourceList.appendChild(item);
    });
    showModal(els.pickSourceModal);

    const cancel = () => {
      cleanup();
      hideModal(els.pickSourceModal);
      resolve(null);
    };

    const onSelect = (e) => {
      if (e.target.name !== "source") return;
      cleanup();
      hideModal(els.pickSourceModal);
      resolve(sources[parseInt(e.target.value, 10)]);
    };

    function cleanup() {
      els.pickSourceCancel.removeEventListener("click", cancel);
      els.pickSourceList.removeEventListener("change", onSelect);
    }

    els.pickSourceCancel.addEventListener("click", cancel);
    els.pickSourceList.addEventListener("change", onSelect);
  });
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
}

/* ---------------- DOM helpers ---------------- */

function showModal(el) {
  el.classList.add("visible");
  ipcRenderer.send("show-window");
  ipcRenderer.send("set-window-size", { width: 480, height: 320 });
}

function hideModal(el) {
  el.classList.remove("visible");
  const anyVisible = document.querySelector(".modal.visible");
  if (!anyVisible && !els.video.srcObject) {
    ipcRenderer.send("hide-window");
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
