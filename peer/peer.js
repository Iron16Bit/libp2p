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
import { fromString } from "uint8arrays";
import { createLibp2p } from "libp2p";
import data from "./nicknames.json";
import {
  MESSAGE_TYPES,
  handleMessage,
  sendPrivateMessage,
  sendNicknameAnnouncement as sendNicknameAnnouncementUtil,
} from "./utils/messages.js";
import {
  DOM,
  createConnectionDialog,
  createChatUI,
  displayChatMessage as displayChatMessageUI,
  activatePrivateChat as activatePrivateChatUI,
  endPrivateChat as endPrivateChatUI,
  updateTopicPeers as updateTopicPeersUI,
  setupTopicConnectionListeners,
  setupDOMListeners,
  initializePeerIdDisplay,
  requestPrivateConnection as requestPrivateConnectionUI,
  acceptConnectionRequest as acceptConnectionRequestUI,
  rejectConnectionRequest as rejectConnectionRequestUI,
  createEditorUI,
  updateEditorPeerList,
} from "./utils/ui.js";
import {
  createCollaborativeEditor,
  CollaborativeEditor,
} from "./editing/editing.js";

// Put here the relay peer's addresses:
const relayAddr = `/ip4/130.110.13.183/tcp/4003/ws/p2p/12D3KooWNqUJ6fU3By7ZWGDbttb41oHNPavF9yxZzpJzMC2v11L3`;

// Store for peer nicknames
const peerNicknames = new Map(); // peerId -> nickname
let myNickname = "";

// Track direct connections and private chats
const directConnections = new Map(); // peerId -> {status, privateTopic}
const CONNECTION_STATES = {
  NONE: "none",
  REQUESTED: "requested",
  PENDING: "pending",
  CONNECTED: "connected",
  REJECTED: "rejected",
};

let activePrivateTopic = null;
let activePrivatePeer = null;
let selectedTopic = null;

// Replace console logging
const log = (message) => {
  console.log(message);
};

// Small helpers for safe pubsub publish
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function publishWithRetry(topic, data, opts = {}) {
  const { retries = 5, delay = 300 } = opts;
  let attempt = 0;
  while (true) {
    try {
      await libp2p.services.pubsub.publish(topic, data);
      return true;
    } catch (e) {
      const noPeers =
        typeof e?.message === "string" &&
        e.message.includes("NoPeersSubscribedToTopic");
      if (!noPeers || attempt >= retries) {
        log(`publish(${topic}) failed: ${e?.message || e}`);
        return false;
      }
      // Wait for peers to subscribe or backoff a bit
      const peers = libp2p.services.pubsub.getSubscribers(topic);
      if (peers.length > 1) {
        // Likely fine on next attempt
      }
      await wait(delay * Math.pow(1.7, attempt));
      attempt++;
    }
  }
}

// Get nickname for a peer ID, fallback to shortened peer ID
const getNickname = (peerId) => {
  if (peerNicknames.has(peerId)) {
    return peerNicknames.get(peerId);
  }
  // Return shortened peer ID if nickname not found
  return `${peerId.toString().substring(0, 10)}...`;
};

// Generate a private topic key between two peers
const generatePrivateTopic = (peerA, peerB) => {
  // Sort peer IDs to ensure the same topic is generated regardless of order
  const sortedPeers = [peerA, peerB].sort();
  return `private-${sortedPeers[0].substring(0, 10)}-${sortedPeers[1].substring(
    0,
    10
  )}-${Date.now()}`;
};

// --------- INITIALIZATION ---------

function getFallbackIceServers() {
  console.log("Using optimized ICE servers");
  return {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "4589fdae907c33bd2c118a53",
        credential: "valgBS8UTclPlsM1",
      },
      {
        urls: "turn:global.relay.metered.ca:443?transport=tcp",
        username: "4589fdae907c33bd2c118a53",
        credential: "valgBS8UTclPlsM1",
      },
    ],
  };
}

async function fetchTURNCredentials() {
  try {
    console.log("Fetching TURN credentials from Metered API");
    const response = await fetch(
      "https://icp_turn.metered.live/api/v1/turn/credentials?apiKey=babf119b8f1a317bbe88e33eedc8ca8cd20a"
    );

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();
    console.log("Retrieved TURN credentials from Metered API");

    if (!Array.isArray(data) || data.length === 0) {
      console.warn("API returned unexpected format or empty array");
      return getFallbackIceServers();
    }

    // Filter to only use the most reliable servers (limit to 3-4 servers)
    const filteredServers = data.filter((server, index) => {
      // Keep STUN servers and limit TURN servers
      if (server.urls.startsWith("stun:")) return true;
      if (server.urls.startsWith("turn:") && index < 4) return true;
      return false;
    });

    console.log(`Using ${filteredServers.length} ICE servers from API`);
    return { iceServers: filteredServers };
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    return getFallbackIceServers();
  }
}

// Create libp2p with a function
async function createNode() {
  console.log("Creating libp2p node");
  try {
    // Fetch TURN credentials
    const iceServersConfig = await fetchTURNCredentials();
    console.log("TURN credentials for libp2p:", iceServersConfig);

    return await createLibp2p({
      addresses: {
        listen: ["/p2p-circuit", "/webrtc"],
      },
      transports: [
        webSockets({
          filter: filters.all,
        }),
        webRTC({
          rtcConfiguration: {
            ...iceServersConfig,
            iceCandidatePoolSize: 4, // Reduce pool size for faster connection
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",
          },
        }),
        circuitRelayTransport(),
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: () => {
          return false;
        },
      },
      services: {
        identify: identify(),
        pubsub: gossipsub({
          enablePeerExchange: true,
          heartbeatInterval: 1000,
          floodPublish: true,
          scoreParams: {
            topics: {},
            topicScoreCap: 10,
            appSpecificScore: () => 0,
            decayInterval: 12000,
            decayToZero: 0.01,
          },
          dLow: 4,
          dHigh: 12,
          dScore: 4,
          dOut: 2,
          dLazy: 6,
          allowPublishToZeroPeers: true,
        }),
        dcutr: dcutr(),
      },
    });
  } catch (error) {
    console.error("Error creating libp2p node:", error);
    throw error;
  }
}

// Initialize libp2p on page load rather than at module level
let libp2p;

// Set up the UI context
const uiContext = {
  connectToTopic,
  sendChatMessage,
  endPrivateChat,
};

// Replace the existing document.addEventListener with this:
document.addEventListener("DOMContentLoaded", async () => {
  try {
    console.log("DOM loaded, initializing libp2p");
    libp2p = await createNode();
    console.log("libp2p node created successfully");

    // Set peer ID in the UI
    initializePeerIdDisplay(libp2p.peerId.toString());

    // Setup topic connection listeners
    setupTopicConnectionListeners(uiContext);

    // Setup DOM listeners for chat UI
    setupDOMListeners(uiContext);

    // Setup event listeners for libp2p events
    setupLibp2pEventListeners();

    console.log("Setup complete, ready for user interaction");
  } catch (error) {
    console.error("Failed to initialize application:", error);
    alert(
      "Failed to initialize the application. Please check the console for details."
    );
  }
});

// Move libp2p event listeners to a separate function
function setupLibp2pEventListeners() {
  // Create a single event listener for all pubsub messages
  libp2p.services.pubsub.addEventListener("message", (event) => {
    // Pass the message to our handler with all the context it needs
    const context = {
      libp2p,
      selectedTopic,
      directConnections,
      activePrivateTopic,
      activePrivatePeer,
      peerNicknames,
      CONNECTION_STATES,
      myNickname,
      log,
      displayChatMessage,
      getNickname,
      updateTopicPeers,
      acceptConnectionRequest,
      rejectConnectionRequest,
      sendNicknameAnnouncement,
      relayAddr,
      startCollaborativeSession,
    };

    handleMessage(event, context);
  });

  // Handle peer discovery through GossipSub
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
      log(`Discovered peer: ${peerId}, attempting direct connection...`);

      // Try to connect directly first
      await libp2p.dial(peerId);
      log(`✓ Connected directly to discovered peer: ${peerId}`);

      // After connection, send our nickname
      await sendNicknameAnnouncement();
    } catch (error) {
      // Try via circuit relay as fallback
      try {
        const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${peerId}`;
        log(`Trying relay connection via ${circuitAddr}`);
        await libp2p.dial(multiaddr(circuitAddr));
        log(`✓ Connected to peer via relay: ${peerId}`);

        // After connection, send our nickname
        await sendNicknameAnnouncement();
      } catch (relayError) {
        log(`Failed to connect to ${peerId}: ${relayError.message}`);
      }
    }
  });

  // When a peer subscribes to our topic
  libp2p.services.pubsub.addEventListener("subscription-change", (event) => {
    const { peerId, subscriptions } = event.detail;

    // Check if this peer subscribed to our topic
    const topicSubscriptions = subscriptions.filter(
      (sub) => sub.topic === selectedTopic && sub.subscribe
    );

    if (topicSubscriptions.length > 0) {
      const peerNickname = getNickname(peerId.toString());
      log(`Peer ${peerNickname} joined topic '${selectedTopic}'`);

      // Always update topic peers when there's a subscription change
      updateTopicPeers();

      // Try to establish direct connection if not already connected
      const connections = libp2p.getConnections(peerId);
      if (connections.length === 0) {
        // Try direct connection first
        libp2p.dial(peerId).catch(() => {
          // Fallback to relay connection
          if (relayAddr) {
            try {
              const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${peerId}`;
              libp2p.dial(multiaddr(circuitAddr)).catch((e) => {
                log(`Failed to connect via relay: ${e.message}`);
              });
            } catch (e) {
              log(`Error creating multiaddr: ${e.message}`);
            }
          }
        });
      }
    } else {
      // Check if this peer unsubscribed from our topic
      const topicUnsubscriptions = subscriptions.filter(
        (sub) => sub.topic === selectedTopic && !sub.subscribe
      );

      if (topicUnsubscriptions.length > 0) {
        const peerNickname = getNickname(peerId.toString());
        log(`Peer ${peerNickname} left topic '${selectedTopic}'`);

        // Always update topic peers when there's a subscription change
        updateTopicPeers();
      }
    }

    // Also check for subscription to private topics
    for (const [privatePeerId, connection] of directConnections.entries()) {
      if (connection.privateTopic) {
        const privateSubscriptions = subscriptions.filter(
          (sub) => sub.topic === connection.privateTopic
        );

        if (privateSubscriptions.length > 0) {
          log(
            `Peer ${peerId.toString()} subscription to private topic detected`
          );
        }
      }
    }
  });

  // Update peer connections
  libp2p.addEventListener("connection:open", async (event) => {
    const connection = event.detail;
    const peerNickname = getNickname(connection.remotePeer.toString());

    // Log detailed connection information
    if (connection.remoteAddr.toString().includes("/webrtc")) {
      log(`✓ WebRTC connection established with ${peerNickname}`);

      // Add connection quality monitoring
      setTimeout(() => {
        if (connection._stat) {
          const stats = connection._stat;
          console.log("WebRTC connection stats:", stats);
          log(`Connection type: ${stats.candidateType || "unknown"}`);
          log(`Local candidate: ${stats.localCandidateType || "unknown"}`);
          log(`Remote candidate: ${stats.remoteCandidateType || "unknown"}`);

          if (stats.candidateType === "relay") {
            log(`✓ Using TURN server for this connection`);
          } else {
            log(`Direct WebRTC connection (no TURN needed)`);
          }
        }
      }, 2000); // Wait longer for stats to stabilize
    } else {
      log(`✓ Connection established with ${peerNickname}`);
    }

    // Share our nickname with the newly connected peer
    await sendNicknameAnnouncement();
  });

  // Add more detailed connection close logging
  libp2p.addEventListener("connection:close", (event) => {
    const connection = event.detail;
    const peerNickname = getNickname(connection.remotePeer.toString());

    // Log the reason for connection closure if available
    const closeReason = connection.closeReason || "Unknown reason";
    log(`Connection closed with ${peerNickname}: ${closeReason}`);

    // If this was a WebRTC connection, log additional details
    if (connection.remoteAddr.toString().includes("/webrtc")) {
      console.log("WebRTC connection closed details:", {
        remoteAddr: connection.remoteAddr.toString(),
        direction: connection.direction,
        timeline: connection.timeline,
      });
    }
  });
}

// Request a private connection with a peer
async function requestPrivateConnection(peerId) {
  // Check if there's already a connection request
  if (directConnections.has(peerId)) {
    const conn = directConnections.get(peerId);
    if (conn.status === CONNECTION_STATES.CONNECTED) {
      // Already connected, open the chat
      activatePrivateChat(peerId);
      return;
    } else if (conn.status === CONNECTION_STATES.REQUESTED) {
      alert(
        "You've already sent a connection request to this peer. Please wait for their response."
      );
      return;
    } else if (conn.status === CONNECTION_STATES.REJECTED) {
      alert("This peer has rejected your connection request.");
      return;
    }
  }

  // Create context and send request
  const context = {
    libp2p,
    myNickname,
    directConnections,
    CONNECTION_STATES,
    log,
    updateTopicPeers,
    activatePrivateChat,
    getNickname,
  };

  await requestPrivateConnectionUI(peerId, context);
}

// Accept a connection request
async function acceptConnectionRequest(peerId) {
  const context = {
    libp2p,
    directConnections,
    CONNECTION_STATES,
    log,
    getNickname,
    generatePrivateTopic,
    updateTopicPeers,
    selectedTopic,
  };

  await acceptConnectionRequestUI(peerId, context);

  // Auto-start the collaborative editor after acceptance
  try {
    await startCollaborativeSession(peerId);
  } catch (e) {
    console.error("Failed to auto-start collaborative session:", e);
  }
}

// Reject a connection request
async function rejectConnectionRequest(peerId) {
  const context = {
    libp2p,
    directConnections,
    CONNECTION_STATES,
    log,
    getNickname,
    updateTopicPeers,
    selectedTopic,
  };

  await rejectConnectionRequestUI(peerId, context);
}

// Activate private chat with a peer - wrapper for UI function
function activatePrivateChat(peerId) {
  const uiContext = {
    directConnections,
    CONNECTION_STATES,
    log,
    getNickname,
    libp2p,
    myNickname,
    createChatUI: () => createChatUI({ sendChatMessage, endPrivateChat }),
    displayChatMessage,
    activePrivateTopic,
    activePrivatePeer,
  };

  if (activatePrivateChatUI(peerId, uiContext)) {
    // Update our local state with what the UI function set
    activePrivateTopic = uiContext.activePrivateTopic;
    activePrivatePeer = uiContext.activePrivatePeer;
  }
}

// Display a message in the chat with formatting - wrapper for UI function
function displayChatMessage(senderId, content, isMine) {
  const nickname = isMine ? myNickname : getNickname(senderId);
  displayChatMessageUI(senderId, content, isMine, nickname);
}

// Send a message in the active chat
async function sendChatMessage() {
  const inputEl = DOM.chatInput();
  if (!inputEl) return;

  const message = inputEl.value.trim();
  if (message.length === 0) return;

  const context = {
    libp2p,
    activePrivateTopic,
    activePrivatePeer,
    directConnections,
    log,
    displayChatMessage,
  };

  if (await sendPrivateMessage(message, context)) {
    // Clear input only if message was sent successfully
    inputEl.value = "";
  }
}

// End the private chat and return to peer discovery
function endPrivateChat() {
  const context = {
    activePrivateTopic,
    activePrivatePeer,
    selectedTopic,
    updateTopicPeers,
  };

  endPrivateChatUI(context);

  // Update our local state
  activePrivateTopic = null;
  activePrivatePeer = null;
}

// Update the topic peers list
function updateTopicPeers() {
  const context = {
    libp2p,
    selectedTopic,
    myNickname,
    directConnections,
    CONNECTION_STATES,
    relayAddr,
    getNickname,
    requestPrivateConnection,
    acceptConnectionRequest,
    log,
    startCollaborativeSession, // Add this for the Edit Together button
  };

  updateTopicPeersUI(context);
}

// Connect to topic and start peer discovery
async function connectToTopic() {
  console.log("connectToTopic called");
  const topicInput = DOM.topicInput();
  if (!topicInput) {
    console.error("Topic input element not found");
    return;
  }

  const topic = topicInput.value.trim();
  if (!topic) {
    console.log("No topic entered");
    alert("Please enter a topic");
    return;
  }

  selectedTopic = topic;
  console.log(`Selected topic: ${topic}`);

  // Update the current topic display if element exists
  const currentTopic = DOM.currentTopic();
  if (currentTopic) {
    currentTopic.textContent = topic;
  }

  // Hide topic selection and show main interface
  const topicSelection = DOM.topicSelection();
  const mainInterface = DOM.mainInterface();

  if (topicSelection) {
    topicSelection.style.display = "none";
  } else {
    console.error("Topic selection element not found");
  }

  if (mainInterface) {
    mainInterface.style.display = "block";
  } else {
    console.error("Main interface element not found");
  }

  // Generate a random username
  const randomAdjective =
    data.adjectives[Math.floor(Math.random() * data.adjectives.length)];
  const randomAnimal =
    data.animals[Math.floor(Math.random() * data.animals.length)];
  myNickname = `${randomAdjective} ${randomAnimal}`;

  // Show nickname on UI if element exists
  const nicknameEl = DOM.nickname();
  if (nicknameEl) {
    nicknameEl.textContent = myNickname;
  }
  log(`Your nickname: ${myNickname}`);

  console.log("About to call initializeLibp2p()");
  try {
    // Connect to relay and start discovery
    await initializeLibp2p();
    console.log("initializeLibp2p completed");
  } catch (error) {
    console.error("Error in initializeLibp2p:", error);
  }

  // Request notification permission for chat alerts
  if ("Notification" in window) {
    Notification.requestPermission();
  }
}

// ---------- INITIALIZE UI ---------

// Update topic peers periodically when not in private chat
setInterval(() => {
  if (DOM.topicPeerList() && !activePrivatePeer && selectedTopic) {
    updateTopicPeers();
  }
}, 2000);

// Initialize libp2p function
async function initializeLibp2p() {
  console.log("initializeLibp2p started");
  if (relayAddr) {
    try {
      log(`Connecting to relay...`);
      console.log(`Attempting to dial relay at: ${relayAddr}`);

      try {
        await libp2p.dial(multiaddr(relayAddr));
        console.log("Relay dial completed");
        log(`Connected to relay`);
      } catch (dialError) {
        console.error("Failed to dial relay:", dialError);
        log(`Failed to connect to relay: ${dialError.message}`);
        alert(
          "Could not connect to relay server. Please check your network connection."
        );
        return;
      }

      // Create UI elements for connection dialog
      createConnectionDialog();

      // Wait a moment for the connection to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Subscribe to the topic
      try {
        libp2p.services.pubsub.subscribe(selectedTopic);
        log(`✓ Subscribed to topic: ${selectedTopic}`);

        // Create a special discovery topic unique to this peer
        const discoveryTopic = `__discovery__${libp2p.peerId.toString()}`;
        libp2p.services.pubsub.subscribe(discoveryTopic);
        log(`✓ Listening for discovery events on ${discoveryTopic}`);

        // Announce our presence in the main topic - First try
        await sendNicknameAnnouncement();

        // More aggressive discovery approach
        // 1. Request peer list from relay immediately
        await requestPeerListFromRelay();

        // 2. Broadcast presence immediately
        await broadcastPresence();

        // 3. Try a second round of discovery after a short delay
        setTimeout(async () => {
          log("Starting second round of peer discovery...");
          await broadcastPresence();
          await requestPeerListFromRelay();

          // Check if we found any peers
          const currentPeers =
            libp2p.services.pubsub.getSubscribers(selectedTopic);
          if (currentPeers.length <= 1) {
            log("Still no peers found, trying one more round...");

            // Try a third time with relay resubscription
            setTimeout(async () => {
              // Re-subscribe to the topic as a last resort
              try {
                libp2p.services.pubsub.unsubscribe(selectedTopic);
                await new Promise((resolve) => setTimeout(resolve, 500));
                libp2p.services.pubsub.subscribe(selectedTopic);
                log("Re-subscribed to topic, trying final discovery attempt");
                await broadcastPresence();

                // Update the UI
                updateTopicPeers();
              } catch (e) {
                log(`Error during re-subscription: ${e.message}`);
              }
            }, 2000);
          }
        }, 3000);

        // 4. Set up periodic presence broadcasts (every 5 seconds)
        const discoveryInterval = setInterval(() => {
          const peers = libp2p.services.pubsub.getSubscribers(selectedTopic);
          log(`Periodic discovery check: ${peers.length} subscribers found`);

          if (peers.length <= 1) {
            // Only broadcast if we haven't found other peers yet
            broadcastPresence();
          } else {
            // If we have peers, we can slow down the interval
            clearInterval(discoveryInterval);
            // Switch to a slower refresh rate
            setInterval(broadcastPresence, 30000);
          }
        }, 5000);

        // Start updating the peers list
        updateTopicPeers();
      } catch (error) {
        console.error("Failed to subscribe:", error);
        log(`Failed to subscribe to topic: ${error.message}`);
      }
    } catch (error) {
      console.error("Error in initializeLibp2p:", error);
      log(`Error: ${error.message}`);
      alert(`Connection error: ${error.message}`);
    }
  } else {
    log("No relay address configured");
  }
}

// Add this sendNicknameAnnouncement function if it doesn't exist
async function sendNicknameAnnouncement() {
  if (!libp2p || !selectedTopic) return;

  try {
    const nicknameMessage = {
      type: MESSAGE_TYPES.NICKNAME,
      peerId: libp2p.peerId.toString(),
      nickname: myNickname,
    };

    await publishWithRetry(
      selectedTopic,
      fromString(JSON.stringify(nicknameMessage)),
      { retries: 5, delay: 400 }
    );

    log(`Announced nickname "${myNickname}" to topic "${selectedTopic}"`);
    return true;
  } catch (error) {
    log(`Failed to announce nickname: ${error.message}`);
    return false;
  }
}

// Add collaborative editor state
let collaborativeEditor = null;

/**
 * Start collaborative editing session with a peer
 * @param {string} peerId - Peer to collaborate with
 */
async function startCollaborativeSession(peerId) {
  if (
    !directConnections.has(peerId) ||
    directConnections.get(peerId).status !== CONNECTION_STATES.CONNECTED
  ) {
    log(`No active connection with ${peerId}`);
    return;
  }

  try {
    // Hide peer discovery, show editor
    const peerDiscoverySection = DOM.peerDiscoverySection();
    if (peerDiscoverySection) {
      peerDiscoverySection.style.display = "none";
    }

    // Create editor UI
    const context = { endCollaborativeSession };
    createEditorUI(context);

    const editorSection = DOM.editorSection();
    if (editorSection) {
      editorSection.style.display = "flex";
    }

    // Create collaborative editor with unique topic for this session
    const connection = directConnections.get(peerId);
    const editorTopic =
      connection.privateTopic || `editor-${selectedTopic}-${Date.now()}`;

    const editorContainer = DOM.editorContainer();
    if (!editorContainer) {
      throw new Error("Editor container not found");
    }

    collaborativeEditor = await createCollaborativeEditor({
      libp2pNode: libp2p,
      topic: editorTopic,
      container: editorContainer,
      userInfo: {
        name: myNickname,
        color: generateRandomColor(),
      },
    });
  } catch (error) {
    log(`Failed to start collaborative session: ${error.message}`);
    console.error(error);
  }
}

/**
 * End collaborative editing session
 */
function endCollaborativeSession() {
  if (collaborativeEditor) {
    collaborativeEditor.destroy();
    collaborativeEditor = null;
  }

  // Hide editor, show peer discovery
  const editorSection = DOM.editorSection();
  if (editorSection) {
    editorSection.style.display = "none";
  }

  const peerDiscoverySection = DOM.peerDiscoverySection();
  if (peerDiscoverySection) {
    peerDiscoverySection.style.display = "block";
  }

  log("Ended collaborative session");
  updateTopicPeers();
}

/**
 * Generate random color for user
 */
function generateRandomColor() {
  const colors = [
    "#ff6b6b",
    "#4ecdc4",
    "#45b7d1",
    "#f9ca24",
    "#6c5ce7",
    "#fd79a8",
    "#00b894",
    "#fdcb6e",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Add this function after initializeLibp2p()
async function requestPeerListFromRelay() {
  if (!libp2p || !selectedTopic) return;

  try {
    log("Requesting peer list from relay (on main topic)...");
    const discoveryRequest = {
      type: "peer-list-request",
      requestingPeer: libp2p.peerId.toString(),
      topic: selectedTopic,
      timestamp: Date.now(),
    };
    await publishWithRetry(
      selectedTopic,
      fromString(JSON.stringify(discoveryRequest)),
      { retries: 5, delay: 400 }
    );
    log("Peer list request sent to relay (main topic)");
    // After a delay, check if we have connected to any peers
    setTimeout(() => {
      const peers = libp2p.services.pubsub.getSubscribers(selectedTopic);
      log(
        `After discovery request: found ${peers.length} subscribers to '${selectedTopic}'`
      );
      if (peers.length <= 1) {
        // If still no peers, try to broadcast our presence directly
        broadcastPresence();
      }
    }, 2000);
  } catch (error) {
    log(`Failed to request peer list: ${error.message}`);
  }
}

// Add this function as a fallback mechanism
async function broadcastPresence() {
  if (!libp2p || !selectedTopic) return;

  try {
    log("Broadcasting presence to topic directly...");

    // Get all addresses including relay circuit addresses for better discovery
    const addresses = libp2p.getMultiaddrs().map((ma) => ma.toString());

    // Add relay circuit address explicitly (helps with WebRTC connections)
    if (relayAddr) {
      const myPeerId = libp2p.peerId.toString();
      const relayCircuitAddr = `${relayAddr}/p2p-circuit/p2p/${myPeerId}`;
      if (!addresses.includes(relayCircuitAddr)) {
        addresses.push(relayCircuitAddr);
      }
    }

    // Create a presence announcement with more metadata
    const presenceMessage = {
      type: "peer-presence",
      peerId: libp2p.peerId.toString(),
      nickname: myNickname,
      timestamp: Date.now(),
      addresses: addresses,
      topic: selectedTopic,
    };

    // Broadcast to the main topic (retry if mesh not ready yet)
    await publishWithRetry(
      selectedTopic,
      fromString(JSON.stringify(presenceMessage)),
      { retries: 5, delay: 400 }
    );

    log("Presence broadcast sent");
    // Explicitly try to get subscribers again to force refresh
    setTimeout(() => {
      const peers = libp2p.services.pubsub.getSubscribers(selectedTopic);
      log(`After presence broadcast: ${peers.length} subscribers found`);
      updateTopicPeers();
    }, 500);
  } catch (error) {
    log(`Failed to broadcast presence: ${error.message}`);
  }
}
