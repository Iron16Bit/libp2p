import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";
import { identify } from "@libp2p/identify";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { multiaddr } from "@multiformats/multiaddr";
import { createLibp2p } from "libp2p";
import { fromString, toString } from "uint8arrays";

// Configuration - Update these for your deployment
const RELAY_HOST = window.location.hostname; // Use the same host as the web page
const RELAY_LIBP2P_PORT = 42869; // Must match the relay's LIBP2P_PORT
const RELAY_HTTP_PORT = 33992; // Must match the relay's HTTP_PORT

// Construct the relay multiaddr - you'll need to update this with the actual peer ID after first run
const relayAddr = `/ip4/130.110.13.183/tcp/4003/ws/p2p/12D3KooWS8Hx1gP6cy2hvLzA6x8YxA3AnZKUi9Ji61m69EcTkKis`;

// HTTP API base URL
const HTTP_API_BASE = `http://130.110.13.183:8080`;

const DOM = {
  // Topic selection section
  topicSelection: () => document.getElementById("topic-selection"),
  topicInput: () => document.getElementById("topic-input"),
  connectButton: () => document.getElementById("connect-button"),

  // Main interface section
  mainInterface: () => document.getElementById("main-interface"),

  peerId: () => document.getElementById("peer-id"),

  sendTopicMessageInput: () =>
    document.getElementById("send-topic-message-input"),
  sendTopicMessageButton: () =>
    document.getElementById("send-topic-message-button"),

  output: () => document.getElementById("output"),

  listeningAddressesList: () => document.getElementById("listening-addresses"),
  peerConnectionsList: () => document.getElementById("peer-connections"),
  topicPeerList: () => document.getElementById("topic-peers"),
};

const appendOutput = (line) => {
  DOM.output().innerText += `${line}\n`;
};
const clean = (line) => line.replaceAll("\n", "");

const libp2p = await createLibp2p({
  addresses: {
    listen: ["/p2p-circuit", "/webrtc"],
  },
  transports: [
    // the WebSocket transport lets us dial a local relay
    webSockets({
      // this allows non-secure WebSocket connections for purposes of the demo
      filter: filters.all,
    }),
    // support dialing/listening on WebRTC addresses
    webRTC(),
    // support dialing/listening on Circuit Relay addresses
    circuitRelayTransport(),
  ],
  // a connection encrypter is necessary to dial the relay
  connectionEncrypters: [noise()],
  // a stream muxer is necessary to dial the relay
  streamMuxers: [yamux()],
  connectionGater: {
    denyDialMultiaddr: () => {
      // by default we refuse to dial local addresses from browsers since they
      // are usually sent by remote peers broadcasting undialable multiaddrs and
      // cause errors to appear in the console but in this example we are
      // explicitly connecting to a local node so allow all addresses
      return false;
    },
  },
  services: {
    identify: identify(),
    pubsub: gossipsub(),
    dcutr: dcutr(),
  },
});

let discoveryActive = false;
let discoveryInterval;
let selectedTopic = null;

// Initialize the app but don't connect until topic is selected
async function initializeLibp2p() {
  if (relayAddr) {
    try {
      appendOutput(`Connecting to relay...`);
      await libp2p.dial(multiaddr(relayAddr));
      appendOutput(`Connected to relay`);

      // Register ourselves with the relay and start discovery
      setTimeout(async () => {
        await registerWithRelay();
        await startHttpDiscovery();
      }, 2000);
    } catch (error) {
      appendOutput(`Failed to connect to relay: ${error.message}`);
    }
  }
}

async function registerWithRelay() {
  try {
    const publicWebRTCAddr = await discoverPublicWebRTCAddress();

    const allMultiaddrs = libp2p.getMultiaddrs().map((ma) => ma.toString());
    if (publicWebRTCAddr) {
      allMultiaddrs.push(publicWebRTCAddr);
    }

    const peerData = {
      multiaddrs: allMultiaddrs,
      publicWebRTCAddr: publicWebRTCAddr,
      topic: selectedTopic,
      timestamp: Date.now(),
    };

    const response = await fetch(`${HTTP_API_BASE}/register/${libp2p.peerId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(peerData),
    });

    if (response.ok) {
      appendOutput(`Registered with relay for topic '${selectedTopic}'`);
    } else {
      appendOutput(`Failed to register with relay: ${response.status}`);
    }
  } catch (error) {
    appendOutput(`Registration error: ${error.message}`);
  }
}

async function discoverPublicWebRTCAddress() {
  try {
    const webrtcViaCircuitAddr = `${relayAddr}/p2p-circuit/webrtc/p2p/${libp2p.peerId}`;
    return webrtcViaCircuitAddr;
  } catch (error) {
    return null;
  }
}

async function startHttpDiscovery() {
  if (discoveryActive) return;
  discoveryActive = true;

  appendOutput(`Starting peer discovery...`);

  const discoverPeers = async () => {
    try {
      const response = await fetch(`${HTTP_API_BASE}/peers`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();

      // Filter peers by topic and try to connect to each one we're not already connected to
      for (const peerInfo of data.peers) {
        const remotePeerId = peerInfo.peerId;

        // Skip ourselves
        if (remotePeerId === libp2p.peerId.toString()) continue;

        // Skip peers with different topics
        if (peerInfo.topic !== selectedTopic) continue;

        // Check existing connections to this peer
        const connections = libp2p.getConnections();
        const peerConnections = connections.filter(
          (conn) => conn.remotePeer.toString() === remotePeerId
        );

        // Check if we already have a WebRTC connection
        const hasWebRTC = peerConnections.some((conn) =>
          conn.remoteAddr.toString().includes("/webrtc")
        );

        if (hasWebRTC) {
          continue;
        }

        try {
          // Try public WebRTC address first if available
          if (peerInfo.publicWebRTCAddr) {
            try {
              await libp2p.dial(multiaddr(peerInfo.publicWebRTCAddr));
              appendOutput(
                `✓ Connected to peer via WebRTC (topic: ${selectedTopic})`
              );
              continue; // Skip circuit relay attempt since we got WebRTC working
            } catch (webrtcError) {
              // Silent fallback to circuit relay
            }
          }

          // If no WebRTC connection exists and no publicWebRTCAddr, try circuit relay
          if (peerConnections.length === 0) {
            const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${remotePeerId}`;
            await libp2p.dial(multiaddr(circuitAddr));
            appendOutput(
              `Connected to peer via relay (topic: ${selectedTopic})`
            );
          }
        } catch (error) {
          // Silent error handling
        }
      }
    } catch (error) {
      // Silent error handling
    }
  };

  // Initial discovery
  await discoverPeers();

  // Periodic discovery every 10 seconds
  discoveryInterval = setInterval(discoverPeers, 10000);
}

// Handle pubsub messages
libp2p.services.pubsub.addEventListener("message", (event) => {
  const topic = event.detail.topic;
  const message = toString(event.detail.data);

  appendOutput(`Message received on topic '${topic}'`);
  appendOutput(message);
});

// Auto-discover and connect to peers
libp2p.addEventListener("peer:discovery", async (event) => {
  const peerId = event.detail.id;

  // Skip if this is the relay itself
  if (relayAddr && relayAddr.includes(peerId.toString())) {
    return;
  }

  // Skip if we're already connected
  const connections = libp2p.getConnections(peerId);
  if (connections.length > 0) return;

  try {
    appendOutput(`Discovered peer: ${peerId}, attempting connection...`);

    // Try multiple connection strategies
    const strategies = [
      peerId, // Direct connection
      multiaddr(`/p2p-circuit/p2p/${peerId}`), // Via circuit relay
    ];

    let connected = false;
    for (const strategy of strategies) {
      try {
        await libp2p.dial(strategy);
        appendOutput(`Successfully connected to peer: ${peerId}`);
        connected = true;
        break;
      } catch (error) {
        appendOutput(
          `Connection strategy failed for ${peerId}: ${error.message}`
        );
      }
    }

    if (!connected) {
      appendOutput(`All connection strategies failed for peer: ${peerId}`);
    }
  } catch (error) {
    appendOutput(`Failed to connect to ${peerId}: ${error.message}`);
  }
});

DOM.peerId().innerText = libp2p.peerId.toString();

function updatePeerList() {
  // Update connections list
  const peerList = libp2p.getPeers().map((peerId) => {
    const el = document.createElement("li");
    el.textContent = peerId.toString();

    const addrList = document.createElement("ul");

    for (const conn of libp2p.getConnections(peerId)) {
      const addr = document.createElement("li");
      addr.textContent = conn.remoteAddr.toString();

      addrList.appendChild(addr);
    }

    el.appendChild(addrList);

    return el;
  });
  DOM.peerConnectionsList().replaceChildren(...peerList);
}

// update peer connections
libp2p.addEventListener("connection:open", async (event) => {
  const connection = event.detail;

  // Check if this is a WebRTC connection
  if (connection.remoteAddr.toString().includes("/webrtc")) {
    appendOutput(`✓ WebRTC connection established`);
  }

  updatePeerList();
});

libp2p.addEventListener("connection:close", (event) => {
  updatePeerList();
});

// update listening addresses
libp2p.addEventListener("self:peer:update", () => {
  const multiaddrs = libp2p.getMultiaddrs().map((ma) => {
    const el = document.createElement("li");
    el.textContent = ma.toString();
    return el;
  });
  DOM.listeningAddressesList().replaceChildren(...multiaddrs);
});

// Connect with selected topic
DOM.connectButton().onclick = async () => {
  const topic = DOM.topicInput().value.trim();
  if (!topic) {
    alert("Please enter a topic");
    return;
  }

  selectedTopic = topic;
  appendOutput(`Selected topic: ${topic}`);

  // Update the current topic display
  const currentTopicElement = document.getElementById("current-topic");
  if (currentTopicElement) {
    currentTopicElement.textContent = topic;
  }

  // Hide topic selection and show main interface
  DOM.topicSelection().style.display = "none";
  DOM.mainInterface().style.display = "block";

  // Auto-fill the subscribe topic input with selected topic (if it exists)
  const subscribeInput = document.getElementById("subscribe-topic-input");
  if (subscribeInput) {
    subscribeInput.value = topic;
  }

  // Connect to relay and start discovery
  await initializeLibp2p();

  // Auto-subscribe to the selected topic after a short delay
  setTimeout(() => {
    libp2p.services.pubsub.subscribe(topic);
    appendOutput(`Auto-subscribed to topic '${topic}'`);

    // Enable message sending
    DOM.sendTopicMessageInput().disabled = undefined;
    DOM.sendTopicMessageButton().disabled = undefined;
  }, 3000);
};

// Allow Enter key to connect
DOM.topicInput().addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    DOM.connectButton().click();
  }
});

// Allow Enter key to send message
DOM.sendTopicMessageInput().addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    DOM.sendTopicMessageButton().click();
  }
});

// send message to topic
DOM.sendTopicMessageButton().onclick = async () => {
  const topic = selectedTopic; // Use the selected topic instead of reading from input
  const message = DOM.sendTopicMessageInput().value;
  appendOutput(`Sending message '${clean(message)}'`);

  try {
    await libp2p.services.pubsub.publish(topic, fromString(message));
    DOM.sendTopicMessageInput().value = ""; // Clear the input after sending
  } catch (error) {
    appendOutput(`Failed to publish message: ${error.message}`);
  }
};

// update topic peers
setInterval(() => {
  if (!selectedTopic) return; // Don't update if no topic selected yet

  const peerList = libp2p.services.pubsub
    .getSubscribers(selectedTopic)
    .map((peerId) => {
      const el = document.createElement("li");
      el.textContent = peerId.toString();
      return el;
    });
  DOM.topicPeerList().replaceChildren(...peerList);
}, 500);

// Note: Discovery message handling is now above in the auto-discovery section
