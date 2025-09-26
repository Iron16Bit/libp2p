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
import data from "./nicknames.json";

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

// --------- INTERACTION WITH HTML ---------
const DOM = {
  // Topic selection section
  topicSelection: () => document.getElementById("topic-selection"),
  topicInput: () => document.getElementById("topic-input"),
  connectButton: () => document.getElementById("connect-button"),

  // Main interface section
  mainInterface: () => document.getElementById("main-interface"),
  peerDiscoverySection: () => document.getElementById("peer-discovery-section"),
  chatSection: () => document.getElementById("chat-section"),

  nickname: () => document.getElementById("nickname"),
  peerId: () => document.getElementById("peer-id"),
  currentTopic: () => document.getElementById("current-topic"),

  // Topic peers
  topicPeerList: () => document.getElementById("topic-peers"),

  // Connection request dialog
  connectionDialog: () => document.getElementById("connection-request-dialog"),
  connectionDialogText: () =>
    document.getElementById("connection-request-text"),
  connectionDialogAccept: () =>
    document.getElementById("connection-request-accept"),
  connectionDialogReject: () =>
    document.getElementById("connection-request-reject"),

  // Chat interface
  chatMessages: () => document.getElementById("chat-messages"),
  chatInput: () => document.getElementById("chat-input"),
  chatSendButton: () => document.getElementById("chat-send-button"),
  chatHeader: () => document.getElementById("chat-header"),
  endChatButton: () => document.getElementById("end-chat-button"),
};

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

let selectedTopic = null;

// Create and append the connection request dialog
function createConnectionDialog() {
  if (document.getElementById("connection-request-dialog")) return;

  const dialog = document.createElement("div");
  dialog.id = "connection-request-dialog";
  dialog.style.display = "none";
  dialog.style.position = "fixed";
  dialog.style.top = "50%";
  dialog.style.left = "50%";
  dialog.style.transform = "translate(-50%, -50%)";
  dialog.style.backgroundColor = "white";
  dialog.style.padding = "20px";
  dialog.style.borderRadius = "8px";
  dialog.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";
  dialog.style.zIndex = "1000";

  const text = document.createElement("p");
  text.id = "connection-request-text";

  const buttonContainer = document.createElement("div");
  buttonContainer.style.display = "flex";
  buttonContainer.style.justifyContent = "space-between";
  buttonContainer.style.marginTop = "15px";

  const acceptButton = document.createElement("button");
  acceptButton.id = "connection-request-accept";
  acceptButton.textContent = "Accept";
  acceptButton.style.backgroundColor = "#4CAF50";
  acceptButton.style.color = "white";
  acceptButton.style.border = "none";
  acceptButton.style.padding = "8px 16px";
  acceptButton.style.borderRadius = "4px";
  acceptButton.style.cursor = "pointer";

  const rejectButton = document.createElement("button");
  rejectButton.id = "connection-request-reject";
  rejectButton.textContent = "Reject";
  rejectButton.style.backgroundColor = "#f44336";
  rejectButton.style.color = "white";
  rejectButton.style.border = "none";
  rejectButton.style.padding = "8px 16px";
  rejectButton.style.borderRadius = "4px";
  rejectButton.style.cursor = "pointer";

  buttonContainer.appendChild(acceptButton);
  buttonContainer.appendChild(rejectButton);

  dialog.appendChild(text);
  dialog.appendChild(buttonContainer);

  document.body.appendChild(dialog);
}

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

      // Update topic peers display if element exists
      if (DOM.topicPeerList()) {
        updateTopicPeers();
      }

      // Send our nickname to the topic
      await sendNicknameAnnouncement();

      // Wait for GossipSub mesh to stabilize
      await new Promise((resolve) => setTimeout(resolve, 2000));
      log(`GossipSub mesh stabilization complete`);

      // Update topic peers display if element exists
      if (DOM.topicPeerList()) {
        updateTopicPeers();
      }
    } catch (error) {
      log(`Failed to connect to relay: ${error.message}`);
    }
  }
}

// Function to announce our nickname to all peers
async function sendNicknameAnnouncement() {
  try {
    const nicknameMessage = {
      type: "nickname",
      peerId: libp2p.peerId.toString(),
      nickname: myNickname,
    };
    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(nicknameMessage))
    );
    log(`Announced my nickname to the topic`);
  } catch (error) {
    log(`Failed to announce nickname: ${error.message}`);
  }
}

// Request a private connection with a peer
async function requestPrivateConnection(peerId) {
  try {
    const targetPeerId = peerId;

    // Check if there's already a connection request
    if (directConnections.has(targetPeerId)) {
      const conn = directConnections.get(targetPeerId);
      if (conn.status === CONNECTION_STATES.CONNECTED) {
        // Already connected, open the chat
        activatePrivateChat(targetPeerId);
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

    // Create and store the connection request
    directConnections.set(targetPeerId, {
      status: CONNECTION_STATES.REQUESTED,
      privateTopic: null,
      messages: [],
    });

    // Send a connection request
    const connectionRequest = {
      type: "connection-request",
      peerId: libp2p.peerId.toString(),
      nickname: myNickname,
      timestamp: Date.now(),
    };

    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(connectionRequest))
    );

    log(`Sent connection request to ${getNickname(targetPeerId)}`);
    updateTopicPeers(); // Update the UI to reflect pending status
  } catch (error) {
    log(`Failed to request private connection: ${error.message}`);
  }
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

    // Send the acceptance with the private topic
    const acceptMessage = {
      type: "connection-accepted",
      peerId: libp2p.peerId.toString(),
      privateTopic: privateTopic,
      timestamp: Date.now(),
    };

    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(acceptMessage))
    );

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
    const rejectMessage = {
      type: "connection-rejected",
      peerId: libp2p.peerId.toString(),
      timestamp: Date.now(),
    };

    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(rejectMessage))
    );

    log(`Rejected connection request from ${getNickname(peerId)}`);

    // Update UI
    updateTopicPeers();

    // Hide dialog
    if (DOM.connectionDialog()) {
      DOM.connectionDialog().style.display = "none";
    }
  } catch (error) {
    log(`Failed to reject connection: ${error.message}`);
  }
}

// Activate private chat with a peer
function activatePrivateChat(peerId) {
  if (
    !directConnections.has(peerId) ||
    directConnections.get(peerId).status !== CONNECTION_STATES.CONNECTED
  ) {
    log(`No active connection with ${peerId}`);
    return;
  }

  const connection = directConnections.get(peerId);
  activePrivateTopic = connection.privateTopic;
  activePrivatePeer = peerId;

  // Hide peer discovery section and show chat section
  if (DOM.peerDiscoverySection()) {
    DOM.peerDiscoverySection().style.display = "none";
  }

  // Create and display chat UI if it doesn't exist
  createChatUI();

  // Update chat header with peer nickname
  if (DOM.chatHeader()) {
    DOM.chatHeader().textContent = `Chat with ${getNickname(peerId)}`;
  }

  // Display previous messages
  if (DOM.chatMessages()) {
    DOM.chatMessages().innerHTML = "";

    if (connection.messages && connection.messages.length > 0) {
      connection.messages.forEach((msg) => {
        displayChatMessage(
          msg.sender,
          msg.content,
          msg.sender === libp2p.peerId.toString()
        );
      });

      // Scroll to bottom
      DOM.chatMessages().scrollTop = DOM.chatMessages().scrollHeight;
    }
  }

  // Show the chat section
  if (DOM.chatSection()) {
    DOM.chatSection().style.display = "block";
  }

  // Update topic display
  if (DOM.currentTopic()) {
    DOM.currentTopic().textContent = `Private chat with ${getNickname(peerId)}`;
  }
}

// Create and display the chat UI
function createChatUI() {
  const chatSection = DOM.chatSection();

  if (!chatSection) {
    // Create chat section if it doesn't exist
    const section = document.createElement("div");
    section.id = "chat-section";
    section.style.display = "none";

    // Chat header
    const header = document.createElement("h2");
    header.id = "chat-header";
    header.textContent = "Private Chat";
    section.appendChild(header);

    // Chat messages container
    const messagesContainer = document.createElement("div");
    messagesContainer.id = "chat-messages";
    messagesContainer.style.height = "300px";
    messagesContainer.style.overflowY = "auto";
    messagesContainer.style.border = "1px solid #ccc";
    messagesContainer.style.padding = "10px";
    messagesContainer.style.marginBottom = "10px";
    messagesContainer.style.display = "flex";
    messagesContainer.style.flexDirection = "column";
    section.appendChild(messagesContainer);

    // Chat input area
    const inputContainer = document.createElement("div");
    inputContainer.style.display = "flex";
    inputContainer.style.marginBottom = "10px";

    const input = document.createElement("input");
    input.id = "chat-input";
    input.type = "text";
    input.placeholder = "Type your message...";
    input.style.flex = "1";
    input.style.marginRight = "10px";
    input.style.padding = "8px";

    const sendButton = document.createElement("button");
    sendButton.id = "chat-send-button";
    sendButton.textContent = "Send";
    sendButton.style.padding = "8px 16px";

    inputContainer.appendChild(input);
    inputContainer.appendChild(sendButton);
    section.appendChild(inputContainer);

    // End chat button
    const endChatButton = document.createElement("button");
    endChatButton.id = "end-chat-button";
    endChatButton.textContent = "End Chat";
    endChatButton.style.backgroundColor = "#f44336";
    endChatButton.style.color = "white";
    endChatButton.style.border = "none";
    endChatButton.style.padding = "8px 16px";
    endChatButton.style.borderRadius = "4px";
    endChatButton.style.cursor = "pointer";
    section.appendChild(endChatButton);

    // Add event listeners
    sendButton.addEventListener("click", sendChatMessage);
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendChatMessage();
      }
    });
    endChatButton.addEventListener("click", endPrivateChat);

    // Add to main interface
    if (DOM.mainInterface()) {
      DOM.mainInterface().appendChild(section);
    }
  }
}

// Display a message in the chat with formatting
function displayChatMessage(senderId, content, isMine) {
  const messagesEl = DOM.chatMessages();
  if (!messagesEl) return;

  const messageEl = document.createElement("div");
  messageEl.className = isMine ? "sent-message" : "received-message";

  // Add nickname to message
  const nickname = isMine ? myNickname : getNickname(senderId);

  // Create nickname element
  const nicknameEl = document.createElement("div");
  nicknameEl.style.fontWeight = "bold";
  nicknameEl.style.marginBottom = "3px";
  nicknameEl.textContent = nickname;

  // Create content element
  const contentEl = document.createElement("div");
  contentEl.textContent = content;

  // Add to message
  messageEl.appendChild(nicknameEl);
  messageEl.appendChild(contentEl);

  // Add to chat
  messagesEl.appendChild(messageEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Send a message in the active chat
async function sendChatMessage() {
  if (!activePrivateTopic || !activePrivatePeer) {
    log("No active private chat");
    return;
  }

  const inputEl = DOM.chatInput();
  if (!inputEl) return;

  const message = inputEl.value.trim();
  if (message.length === 0) return;

  try {
    const messageObj = {
      type: "private-message",
      sender: libp2p.peerId.toString(),
      content: message,
      timestamp: Date.now(),
    };

    // Store message locally
    const connection = directConnections.get(activePrivatePeer);
    if (connection) {
      if (!connection.messages) connection.messages = [];
      connection.messages.push(messageObj);
    }

    // Send message
    await libp2p.services.pubsub.publish(
      activePrivateTopic,
      fromString(JSON.stringify(messageObj))
    );

    // Clear input
    inputEl.value = "";

    // Display message in chat
    displayChatMessage(libp2p.peerId.toString(), message, true);

    console.log("Message sent:", message);
  } catch (error) {
    log(`Failed to send message: ${error.message}`);
    console.error("Send message error:", error);
  }
}

// End the private chat and return to peer discovery
function endPrivateChat() {
  activePrivateTopic = null;
  activePrivatePeer = null;

  // Show peer discovery section and hide chat section
  if (DOM.peerDiscoverySection()) {
    DOM.peerDiscoverySection().style.display = "block";
  }

  if (DOM.chatSection()) {
    DOM.chatSection().style.display = "none";
  }

  // Reset topic display
  if (DOM.currentTopic()) {
    DOM.currentTopic().textContent = selectedTopic;
  }

  // Update peer list
  updateTopicPeers();
}

// ---------- MESSAGE HANDLING ---------

libp2p.services.pubsub.addEventListener("message", (event) => {
  const topic = event.detail.topic;
  const messageData = toString(event.detail.data);

  // Check if this is a discovery message
  if (topic.startsWith(`__discovery__${libp2p.peerId.toString()}`)) {
    try {
      const discoveryData = JSON.parse(messageData);
      handleDiscoveryMessage(discoveryData);
      return;
    } catch (error) {
      // Not a valid discovery message, ignore
    }
  }

  // Check if this is a private chat message
  if (directConnections.size > 0) {
    // Check if this is from one of our private topics
    for (const [peerId, connection] of directConnections.entries()) {
      if (connection.privateTopic && connection.privateTopic === topic) {
        try {
          const parsedMessage = JSON.parse(messageData);

          if (parsedMessage.type === "private-message") {
            // Store message
            if (!connection.messages) connection.messages = [];
            connection.messages.push(parsedMessage);

            log(
              `Received private message from ${getNickname(
                parsedMessage.sender
              )}`
            );

            // If this chat is active, update the display
            if (activePrivateTopic === topic && DOM.chatMessages()) {
              displayChatMessage(
                parsedMessage.sender,
                parsedMessage.content,
                false
              );
            } else {
              // Show notification that a message was received
              const peerNickname = getNickname(peerId);

              // Create a notification if supported
              if (
                "Notification" in window &&
                Notification.permission === "granted"
              ) {
                new Notification(`Message from ${peerNickname}`, {
                  body: parsedMessage.content,
                });
              } else {
                // Simple alert if notifications aren't available
                log(
                  `New message from ${peerNickname}: ${parsedMessage.content}`
                );
              }
            }
          }

          return;
        } catch (error) {
          log(`Error processing private message: ${error.message}`);
        }
      }
    }
  }

  // Try to parse as JSON first to check for special messages
  try {
    const parsedMessage = JSON.parse(messageData);

    // Handle nickname announcements
    if (parsedMessage.type === "nickname") {
      const remotePeerId = parsedMessage.peerId;
      const remoteNickname = parsedMessage.nickname;

      // Store the nickname
      peerNicknames.set(remotePeerId, remoteNickname);
      log(
        `Received nickname: ${remoteNickname} for peer ${remotePeerId.substring(
          0,
          10
        )}...`
      );

      // Update UI if elements exist
      if (DOM.topicPeerList()) updateTopicPeers();
      return;
    }

    // Handle connection requests
    if (parsedMessage.type === "connection-request") {
      const requestingPeerId = parsedMessage.peerId;
      const requestingNickname =
        parsedMessage.nickname || getNickname(requestingPeerId);

      // Skip if this request isn't for us
      if (requestingPeerId === libp2p.peerId.toString()) return;

      log(`Received connection request from ${requestingNickname}`);

      // Store the connection request
      directConnections.set(requestingPeerId, {
        status: CONNECTION_STATES.PENDING,
        privateTopic: null,
        messages: [],
      });

      // Show connection request dialog
      if (DOM.connectionDialog() && DOM.connectionDialogText()) {
        DOM.connectionDialogText().textContent = `${requestingNickname} wants to start a private chat with you. Accept?`;
        DOM.connectionDialog().style.display = "block";

        // Set up button handlers
        if (DOM.connectionDialogAccept()) {
          DOM.connectionDialogAccept().onclick = () => {
            acceptConnectionRequest(requestingPeerId);
            DOM.connectionDialog().style.display = "none";
          };
        }

        if (DOM.connectionDialogReject()) {
          DOM.connectionDialogReject().onclick = () => {
            rejectConnectionRequest(requestingPeerId);
            DOM.connectionDialog().style.display = "none";
          };
        }
      }

      // Update UI
      updateTopicPeers();
      return;
    }

    // Handle connection acceptance
    if (parsedMessage.type === "connection-accepted") {
      const acceptingPeerId = parsedMessage.peerId;
      const privateTopic = parsedMessage.privateTopic;

      // Skip if we don't have a pending request
      if (
        !directConnections.has(acceptingPeerId) ||
        directConnections.get(acceptingPeerId).status !==
          CONNECTION_STATES.REQUESTED
      ) {
        return;
      }

      log(`Connection request accepted by ${getNickname(acceptingPeerId)}`);

      // Update connection status
      directConnections.set(acceptingPeerId, {
        status: CONNECTION_STATES.CONNECTED,
        privateTopic: privateTopic,
        messages: [],
      });

      // Subscribe to the private topic
      libp2p.services.pubsub.subscribe(privateTopic);

      // Activate private chat
      activatePrivateChat(acceptingPeerId);

      return;
    }

    // Handle connection rejection
    if (parsedMessage.type === "connection-rejected") {
      const rejectingPeerId = parsedMessage.peerId;

      // Skip if we don't have a pending request
      if (
        !directConnections.has(rejectingPeerId) ||
        directConnections.get(rejectingPeerId).status !==
          CONNECTION_STATES.REQUESTED
      ) {
        return;
      }

      log(`Connection request rejected by ${getNickname(rejectingPeerId)}`);

      // Update connection status
      directConnections.set(rejectingPeerId, {
        status: CONNECTION_STATES.REJECTED,
        privateTopic: null,
        messages: [],
      });

      // Alert the user
      alert(
        `${getNickname(rejectingPeerId)} rejected your connection request.`
      );

      // Update UI
      updateTopicPeers();
      return;
    }

    // Other message types (logging only)
    log(`Received message of type ${parsedMessage.type} on topic '${topic}'`);
  } catch (error) {
    // Not a special message, just log it
    log(`Received raw message on topic '${topic}'`);
  }
});

// Handle discovery messages from the relay
async function handleDiscoveryMessage(discoveryData) {
  if (discoveryData.type === "peer-discovery") {
    log(
      `🔍 Discovery: Found ${discoveryData.peers.length} peers for topic '${discoveryData.topic}'`
    );

    for (const peerInfo of discoveryData.peers) {
      const peerId = peerInfo.peerId;

      // Skip if we're already connected
      const connections = libp2p.getConnections(peerId);
      if (connections.length > 0) continue;

      log(`Attempting to connect to discovered peer: ${peerId}`);

      // Try connecting to each multiaddr
      let connected = false;
      for (const addr of peerInfo.multiaddrs) {
        try {
          log(`Trying to dial ${addr}`);
          await libp2p.dial(multiaddr(addr));
          log(`✓ Connected to peer: ${peerId} via ${addr}`);
          connected = true;

          // After connection, send our nickname
          await sendNicknameAnnouncement();
          break;
        } catch (error) {
          log(`Failed to connect to ${peerId} via ${addr}: ${error.message}`);
          // Try next address
        }
      }

      if (!connected) {
        log(`Failed to connect to peer: ${peerId}`);
      }
    }
  } else if (discoveryData.type === "new-peer") {
    const peerInfo = discoveryData.peer;
    log(
      `🆕 New peer joined topic '${discoveryData.topic}': ${peerInfo.peerId}`
    );

    // Try to connect to the new peer
    const connections = libp2p.getConnections(peerInfo.peerId);
    if (connections.length === 0) {
      try {
        const addr = peerInfo.multiaddrs[0];
        log(`Trying to dial new peer at ${addr}`);
        await libp2p.dial(multiaddr(addr));
        log(`✓ Connected to new peer: ${peerInfo.peerId} via ${addr}`);

        // After connection, send our nickname
        await sendNicknameAnnouncement();
      } catch (error) {
        log(
          `Failed to connect to new peer: ${peerInfo.peerId}: ${error.message}`
        );
      }
    }
  }
}

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

    // Update topic peers display if element exists and we're not in a private chat
    if (DOM.topicPeerList() && !activePrivatePeer) {
      updateTopicPeers();
    }

    // Try to establish direct connection if not already connected
    const connections = libp2p.getConnections(peerId);
    if (connections.length === 0) {
      // Try direct connection first
      libp2p.dial(peerId).catch(() => {
        // Fallback to relay connection
        const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${peerId}`;
        libp2p.dial(multiaddr(circuitAddr)).catch(() => {
          // Silent fail
        });
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

      // Update topic peers display if element exists and we're not in a private chat
      if (DOM.topicPeerList() && !activePrivatePeer) {
        updateTopicPeers();
      }
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

// Set peer ID in the UI if element exists
if (DOM.peerId()) {
  DOM.peerId().innerText = libp2p.peerId.toString();
}

// Update the topic peers list with connect buttons
function updateTopicPeers() {
  // Check if the element exists before trying to update it
  const topicPeerList = DOM.topicPeerList();
  if (!topicPeerList || !selectedTopic) return;

  const peers = libp2p.services.pubsub.getSubscribers(selectedTopic);

  const peerList = [];

  // Include ourselves in the list if we're subscribed
  const ourPeerId = libp2p.peerId.toString();
  if (libp2p.services.pubsub.getTopics().includes(selectedTopic)) {
    const el = document.createElement("li");
    el.className = "peer-item";

    const nicknameSpan = document.createElement("span");
    nicknameSpan.className = "peer-nickname";
    nicknameSpan.textContent = `${myNickname} (you)`;
    el.appendChild(nicknameSpan);

    peerList.push(el);
  }

  // Add other peers
  for (const peerId of peers) {
    const peerIdStr = peerId.toString();

    // Skip ourselves as we already added it
    if (peerIdStr === ourPeerId) continue;

    // Skip the relay node
    if (relayAddr && relayAddr.includes(peerIdStr)) continue;

    const el = document.createElement("li");
    el.className = "peer-item";
    el.style.display = "flex";
    el.style.justifyContent = "space-between";
    el.style.alignItems = "center";
    el.style.padding = "5px 0";

    const nickname = getNickname(peerIdStr);

    // Create a span for the nickname
    const nicknameSpan = document.createElement("span");
    nicknameSpan.className = "peer-nickname";
    nicknameSpan.textContent = nickname;
    el.appendChild(nicknameSpan);

    // Create a connect button
    const connectButton = document.createElement("button");
    connectButton.style.marginLeft = "10px";
    connectButton.style.padding = "3px 8px";
    connectButton.style.borderRadius = "4px";
    connectButton.style.border = "none";
    connectButton.style.cursor = "pointer";

    // Set button state based on connection status
    if (directConnections.has(peerIdStr)) {
      const connectionStatus = directConnections.get(peerIdStr).status;

      switch (connectionStatus) {
        case CONNECTION_STATES.CONNECTED:
          connectButton.textContent = "Chat";
          connectButton.style.backgroundColor = "#4CAF50";
          connectButton.style.color = "white";
          connectButton.onclick = () => activatePrivateChat(peerIdStr);
          break;
        case CONNECTION_STATES.REQUESTED:
          connectButton.textContent = "Pending";
          connectButton.style.backgroundColor = "#FFA500";
          connectButton.style.color = "white";
          connectButton.disabled = true;
          break;
        case CONNECTION_STATES.PENDING:
          connectButton.textContent = "Accept";
          connectButton.style.backgroundColor = "#4CAF50";
          connectButton.style.color = "white";
          connectButton.onclick = () => acceptConnectionRequest(peerIdStr);
          break;
        case CONNECTION_STATES.REJECTED:
          connectButton.textContent = "Rejected";
          connectButton.style.backgroundColor = "#d3d3d3";
          connectButton.disabled = true;
          break;
        default:
          connectButton.textContent = "Connect";
          connectButton.style.backgroundColor = "#2196F3";
          connectButton.style.color = "white";
          connectButton.onclick = () => requestPrivateConnection(peerIdStr);
      }
    } else {
      // No connection yet
      connectButton.textContent = "Connect";
      connectButton.style.backgroundColor = "#2196F3";
      connectButton.style.color = "white";
      connectButton.onclick = () => requestPrivateConnection(peerIdStr);
    }

    el.appendChild(connectButton);
    peerList.push(el);
  }

  if (peerList.length === 0) {
    const el = document.createElement("li");
    el.textContent = "None";
    topicPeerList.replaceChildren(el);
  } else {
    topicPeerList.replaceChildren(...peerList);
  }
}

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

// ---------- UI INTERACTIONS ---------

// Connect with selected topic
DOM.connectButton().onclick = async () => {
  const topic = DOM.topicInput().value.trim();
  if (!topic) {
    alert("Please enter a topic");
    return;
  }

  selectedTopic = topic;
  log(`Selected topic: ${topic}`);

  // Update the current topic display if element exists
  if (DOM.currentTopic()) {
    DOM.currentTopic().textContent = topic;
  }

  // Hide topic selection and show main interface
  DOM.topicSelection().style.display = "none";
  DOM.mainInterface().style.display = "block";

  // Generate a random username
  const randomAdjective =
    data.adjectives[Math.floor(Math.random() * data.adjectives.length)];
  const randomAnimal =
    data.animals[Math.floor(Math.random() * data.animals.length)];
  myNickname = `${randomAdjective} ${randomAnimal}`;

  // Show nickname on UI if element exists
  if (DOM.nickname()) {
    DOM.nickname().textContent = myNickname;
  }
  log(`Your nickname: ${myNickname}`);

  // Connect to relay and start discovery
  await initializeLibp2p();

  // Request notification permission for chat alerts
  if ("Notification" in window) {
    Notification.requestPermission();
  }
};

// Allow Enter key to connect
DOM.topicInput().addEventListener("keypress", (event) => {
  if (event.key === "Enter") {
    DOM.connectButton().click();
  }
});

// Update topic peers only if the element exists and we're not in a private chat
setInterval(() => {
  if (DOM.topicPeerList() && !activePrivatePeer) {
    updateTopicPeers();
  }
}, 500);

// Make sure event listeners are attached to the chat UI
document.addEventListener("DOMContentLoaded", () => {
  // Check if the chat section already exists
  if (DOM.chatSendButton()) {
    DOM.chatSendButton().addEventListener("click", sendChatMessage);
  }

  if (DOM.chatInput()) {
    DOM.chatInput().addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendChatMessage();
      }
    });
  }

  if (DOM.endChatButton()) {
    DOM.endChatButton().addEventListener("click", endPrivateChat);
  }
});
