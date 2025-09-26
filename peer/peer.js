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
  sendConnectionRequest,
  sendConnectionAcceptance,
  sendConnectionRejection,
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
} from "./utils/ui.js";

// Put here the relay peer's addresses:
const relayAddr = `/ip4/130.110.13.183/tcp/4003/ws/p2p/12D3KooWNw47bgfb4udF1Rr1sGcKKJes7aADaf6wyvEy3u2hMgnN`;

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

const libp2p = await createLibp2p({
  addresses: {
    listen: ["/p2p-circuit", "/webrtc"],
  },
  transports: [
    webSockets({
      filter: filters.all,
    }),
    webRTC(),
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

// Initialize the app but don't connect until topic is selected
async function initializeLibp2p() {
  if (relayAddr) {
    try {
      log(`Connecting to relay...`);
      await libp2p.dial(multiaddr(relayAddr));
      log(`Connected to relay`);

      // Create UI elements for connection dialog
      createConnectionDialog();

      // Wait a moment for the connection to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Subscribe to our discovery topic first
      const discoveryTopic = `__discovery__${libp2p.peerId.toString()}`;
      libp2p.services.pubsub.subscribe(discoveryTopic);
      log(`Subscribed to discovery topic`);

      // Subscribe to the main topic
      libp2p.services.pubsub.subscribe(selectedTopic);
      log(`Auto-subscribed to topic '${selectedTopic}'`);

      // Wait for GossipSub mesh to form
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Send our nickname to the topic
      await sendNicknameAnnouncement();

      // Force update topic peers display
      updateTopicPeers();

      // Wait for GossipSub mesh to stabilize
      await new Promise((resolve) => setTimeout(resolve, 2000));
      log(`GossipSub mesh stabilization complete`);

      // Update topic peers display again after stabilization
      updateTopicPeers();

      // Set interval to periodically check for peers
      setInterval(() => {
        if (!activePrivatePeer) {
          updateTopicPeers();
        }
      }, 2000);
    } catch (error) {
      log(`Failed to connect to relay: ${error.message}`);
    }
  }
}

// Function to announce our nickname to all peers
async function sendNicknameAnnouncement() {
  const context = {
    libp2p,
    myNickname,
    selectedTopic,
    log,
  };

  return sendNicknameAnnouncementUtil(context);
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
  };

  await sendConnectionRequest(peerId, context);
}

// Accept a connection request
async function acceptConnectionRequest(peerId) {
  try {
    if (!directConnections.has(peerId)) {
      log(`No connection request from ${peerId}`);
      return;
    }

    // Generate a private topic name for this connection
    const privateTopic = generatePrivateTopic(libp2p.peerId.toString(), peerId);

    // Update our connection status
    directConnections.set(peerId, {
      status: CONNECTION_STATES.CONNECTED,
      privateTopic: privateTopic,
      messages: [],
    });

    // Subscribe to the private topic
    libp2p.services.pubsub.subscribe(privateTopic);
    log(`Subscribed to private topic: ${privateTopic}`);

    // Send the acceptance message
    const context = {
      libp2p,
      selectedTopic,
      log,
    };

    await sendConnectionAcceptance(peerId, context, privateTopic);

    log(`Accepted connection request from ${getNickname(peerId)}`);

    // Activate private chat UI
    activatePrivateChat(peerId);
  } catch (error) {
    log(`Failed to accept connection: ${error.message}`);
  }
}

// Reject a connection request
async function rejectConnectionRequest(peerId) {
  try {
    if (!directConnections.has(peerId)) {
      log(`No connection request from ${peerId}`);
      return;
    }

    // Update our connection status
    directConnections.set(peerId, {
      status: CONNECTION_STATES.REJECTED,
      privateTopic: null,
      messages: [],
    });

    // Send the rejection
    const context = {
      libp2p,
      selectedTopic,
      log,
    };

    await sendConnectionRejection(peerId, context);

    log(`Rejected connection request from ${getNickname(peerId)}`);

    // Update UI
    updateTopicPeers();

    // Hide dialog
    const connectionDialog = DOM.connectionDialog();
    if (connectionDialog) {
      connectionDialog.style.display = "none";
    }
  } catch (error) {
    log(`Failed to reject connection: ${error.message}`);
  }
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
    activatePrivateChat,
    acceptConnectionRequest,
    log, // Make sure this is included!
  };

  updateTopicPeersUI(context);
}

// Connect to topic and start peer discovery
async function connectToTopic() {
  const topicInput = DOM.topicInput();
  if (!topicInput) return;

  const topic = topicInput.value.trim();
  if (!topic) {
    alert("Please enter a topic");
    return;
  }

  selectedTopic = topic;
  log(`Selected topic: ${topic}`);

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
  }

  if (mainInterface) {
    mainInterface.style.display = "block";
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

  // Connect to relay and start discovery
  await initializeLibp2p();

  // Request notification permission for chat alerts
  if ("Notification" in window) {
    Notification.requestPermission();
  }
}

// ---------- MESSAGE HANDLING ---------

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
    activatePrivateChat,
    acceptConnectionRequest,
    rejectConnectionRequest,
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
        log(`Peer ${peerId.toString()} subscription to private topic detected`);
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
  } else {
    log(`✓ Connection established with ${peerNickname}`);
  }

  // Share our nickname with the newly connected peer
  await sendNicknameAnnouncement();
});

libp2p.addEventListener("connection:close", (event) => {
  const peerNickname = getNickname(event.detail.remotePeer.toString());
  log(`Connection closed with ${peerNickname}`);
});

// ---------- INITIALIZE UI ---------

// Set up the UI context
const uiContext = {
  connectToTopic,
  sendChatMessage,
  endPrivateChat,
};

// Set up DOM event listeners
document.addEventListener("DOMContentLoaded", () => {
  // Set peer ID in the UI
  initializePeerIdDisplay(libp2p.peerId.toString());

  // Setup topic connection listeners
  setupTopicConnectionListeners(uiContext);

  // Setup DOM listeners for chat UI
  setupDOMListeners(uiContext);
});

// Update topic peers periodically when not in private chat
setInterval(() => {
  if (DOM.topicPeerList() && !activePrivatePeer) {
    updateTopicPeers();
  }
}, 500);
