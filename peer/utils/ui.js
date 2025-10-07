import {
  sendConnectionRequest,
  sendConnectionAcceptance,
  sendConnectionRejection,
} from "./messages.js";

/**
 * UI utilities for managing DOM elements and UI interactions
 */

// DOM element access helpers
export const DOM = {
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

  // Collaborative editor elements
  editorSection: () => document.getElementById("editor-section"),
  editorContainer: () => document.getElementById("editor-container"),
  editorHeader: () => document.getElementById("editor-header"),
  editorPeerList: () => document.getElementById("editor-peer-list"),
  endEditorButton: () => document.getElementById("end-editor-button"),
};

// Default logger fallback
const defaultLog = (message) => {
  console.log(message);
};

/**
 * Create and append the connection request dialog to the document body
 */
export function createConnectionDialog() {
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

/**
 * Create and display the chat UI
 * @param {Object} context - App context with event handlers and state
 */
export function createChatUI(context) {
  const { sendChatMessage, endPrivateChat } = context;
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
    const mainInterface = DOM.mainInterface();
    if (mainInterface) {
      mainInterface.appendChild(section);
    }

    return section;
  }

  return chatSection;
}

/**
 * Display a message in the chat with formatting
 * @param {string} senderId - The ID of the message sender
 * @param {string} content - The message content
 * @param {boolean} isMine - Whether the message was sent by the local user
 * @param {string} nickname - The nickname to display (sender's or local)
 */
export function displayChatMessage(senderId, content, isMine, nickname) {
  const messagesEl = DOM.chatMessages();
  if (!messagesEl) return;

  const messageEl = document.createElement("div");
  messageEl.className = isMine ? "sent-message" : "received-message";

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

/**
 * Activate the private chat interface
 * @param {string} peerId - The peer ID to chat with
 * @param {Object} context - App context with state and helper functions
 */
export function activatePrivateChat(peerId, context) {
  const {
    directConnections,
    CONNECTION_STATES,
    log = defaultLog,
    getNickname,
    createChatUI,
    displayChatMessage,
  } = context;

  if (
    !directConnections.has(peerId) ||
    directConnections.get(peerId).status !== CONNECTION_STATES.CONNECTED
  ) {
    log(`No active connection with ${peerId}`);
    return false;
  }

  // Set active connection
  const connection = directConnections.get(peerId);
  context.activePrivateTopic = connection.privateTopic;
  context.activePrivatePeer = peerId;

  // Hide peer discovery section and show chat section
  const peerDiscoverySection = DOM.peerDiscoverySection();
  if (peerDiscoverySection) {
    peerDiscoverySection.style.display = "none";
  }

  // Create and display chat UI if it doesn't exist
  createChatUI(context);

  // Update chat header with peer nickname
  const chatHeader = DOM.chatHeader();
  if (chatHeader) {
    chatHeader.textContent = `Chat with ${getNickname(peerId)}`;
  }

  // Display previous messages
  const chatMessages = DOM.chatMessages();
  if (chatMessages) {
    chatMessages.innerHTML = "";

    if (connection.messages && connection.messages.length > 0) {
      connection.messages.forEach((msg) => {
        const isMine = msg.sender === context.libp2p.peerId.toString();
        const nickname = isMine ? context.myNickname : getNickname(msg.sender);
        displayChatMessage(msg.sender, msg.content, isMine, nickname);
      });

      // Scroll to bottom
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  // Show the chat section
  const chatSection = DOM.chatSection();
  if (chatSection) {
    chatSection.style.display = "block";
  }

  // Update topic display
  const currentTopic = DOM.currentTopic();
  if (currentTopic) {
    currentTopic.textContent = `Private chat with ${getNickname(peerId)}`;
  }

  return true;
}

/**
 * End the private chat and return to peer discovery
 * @param {Object} context - App context
 */
export function endPrivateChat(context) {
  context.activePrivateTopic = null;
  context.activePrivatePeer = null;

  // Show peer discovery section and hide chat section
  const peerDiscoverySection = DOM.peerDiscoverySection();
  if (peerDiscoverySection) {
    peerDiscoverySection.style.display = "block";
  }

  const chatSection = DOM.chatSection();
  if (chatSection) {
    chatSection.style.display = "none";
  }

  // Reset topic display
  const currentTopic = DOM.currentTopic();
  if (currentTopic) {
    currentTopic.textContent = context.selectedTopic;
  }

  // Update peer list
  if (typeof context.updateTopicPeers === "function") {
    context.updateTopicPeers();
  }
}

/**
 * Update the topic peers list with connect buttons
 * @param {Object} context - App context
 */
export function updateTopicPeers(context) {
  const {
    libp2p,
    selectedTopic,
    myNickname,
    directConnections,
    CONNECTION_STATES,
    relayAddr,
    getNickname,
    requestPrivateConnection,
    startCollaborativeSession, // Make sure this is destructured
    acceptConnectionRequest,
    log = defaultLog,
  } = context;

  // Check if the element exists before trying to update it
  const topicPeerList = DOM.topicPeerList();
  if (!topicPeerList || !selectedTopic) return;

  try {
    const peers = libp2p.services.pubsub.getSubscribers(selectedTopic);

    log?.(`Found ${peers.length} subscribers to topic '${selectedTopic}'`);

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
      el.style.alignItems = "center";
      el.style.padding = "5px 0";

      const nickname = getNickname(peerIdStr);

      log?.(
        `Adding peer to list: ${nickname} (${peerIdStr.substring(0, 10)}...)`
      );

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
            connectButton.textContent = "Edit Together";
            connectButton.style.backgroundColor = "#4CAF50";
            connectButton.style.color = "white";
            connectButton.onclick = () => {
              // THIS IS THE KEY FIX - call startCollaborativeSession
              if (startCollaborativeSession) {
                log?.(`Starting collaborative session with ${nickname}`);
                startCollaborativeSession(peerIdStr);
              } else {
                console.error("startCollaborativeSession not found in context");
              }
            };
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
  } catch (error) {
    log?.(`Error updating topic peers: ${error.message}`);
    console.error("Error updating topic peers:", error);
  }
}

/**
 * Request a private connection with a peer
 * @param {string} peerId - Peer ID to connect to
 * @param {Object} context - App context
 */
export async function requestPrivateConnection(peerId, context) {
  const { directConnections, CONNECTION_STATES, activatePrivateChat } = context;

  // Check if there's already a connection request
  if (directConnections.has(peerId)) {
    const conn = directConnections.get(peerId);
    if (conn.status === CONNECTION_STATES.CONNECTED) {
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

  // Import from messages.js
  await sendConnectionRequest(peerId, context);
}

/**
 * Accept a connection request
 * @param {string} peerId - Peer ID to accept
 * @param {Object} context - App context
 */
export async function acceptConnectionRequest(peerId, context) {
  const {
    libp2p,
    directConnections,
    CONNECTION_STATES,
    log,
    getNickname,
    generatePrivateTopic,
    // Remove activatePrivateChat from here
  } = context;

  try {
    if (!directConnections.has(peerId)) {
      log(`No connection request from ${peerId}`);
      return;
    }

    const privateTopic = generatePrivateTopic(libp2p.peerId.toString(), peerId);

    directConnections.set(peerId, {
      status: CONNECTION_STATES.CONNECTED,
      privateTopic: privateTopic,
      messages: [],
    });

    libp2p.services.pubsub.subscribe(privateTopic);
    log(`Subscribed to private topic: ${privateTopic}`);

    await sendConnectionAcceptance(peerId, context, privateTopic);
    log(`Accepted connection request from ${getNickname(peerId)}`);

    // Remove this line:
    // activatePrivateChat(peerId);

    // Just update the UI to show the "Edit Together" button
    if (context.updateTopicPeers) {
      context.updateTopicPeers();
    }
  } catch (error) {
    log(`Failed to accept connection: ${error.message}`);
  }
}

/**
 * Reject a connection request
 * @param {string} peerId - Peer ID to reject
 * @param {Object} context - App context
 */
export async function rejectConnectionRequest(peerId, context) {
  const {
    directConnections,
    CONNECTION_STATES,
    log,
    getNickname,
    updateTopicPeers,
  } = context;

  try {
    if (!directConnections.has(peerId)) {
      log(`No connection request from ${peerId}`);
      return;
    }

    directConnections.set(peerId, {
      status: CONNECTION_STATES.REJECTED,
      privateTopic: null,
      messages: [],
    });

    await sendConnectionRejection(peerId, context);
    log(`Rejected connection request from ${getNickname(peerId)}`);

    updateTopicPeers();

    const connectionDialog = DOM.connectionDialog();
    if (connectionDialog) {
      connectionDialog.style.display = "none";
    }
  } catch (error) {
    log(`Failed to reject connection: ${error.message}`);
  }
}

/**
 * Setup event listeners for the topic connection UI
 * @param {Object} context - App context with handlers
 */
export function setupTopicConnectionListeners(context) {
  const { connectToTopic } = context;

  // Connect with selected topic
  const connectButton = DOM.connectButton();
  if (connectButton) {
    connectButton.onclick = connectToTopic;
  }

  // Allow Enter key to connect
  const topicInput = DOM.topicInput();
  if (topicInput) {
    topicInput.addEventListener("keypress", (event) => {
      if (event.key === "Enter" && connectButton) {
        connectButton.click();
      }
    });
  }
}

/**
 * Setup DOM event listeners once the document is loaded
 * @param {Object} context - App context with handlers
 */
export function setupDOMListeners(context) {
  const { sendChatMessage, endPrivateChat } = context;

  // Check if the chat section already exists
  const chatSendButton = DOM.chatSendButton();
  if (chatSendButton) {
    chatSendButton.addEventListener("click", sendChatMessage);
  }

  const chatInput = DOM.chatInput();
  if (chatInput) {
    chatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendChatMessage();
      }
    });
  }

  const endChatBtn = DOM.endChatButton();
  if (endChatBtn) {
    endChatBtn.addEventListener("click", endPrivateChat);
  }
}

/**
 * Initialize UI with peer ID
 * @param {string} peerId - The local peer ID to display
 */
export function initializePeerIdDisplay(peerId) {
  const peerIdEl = DOM.peerId();
  if (peerIdEl) {
    peerIdEl.innerText = peerId;
  }
}

/**
 * Create and display the collaborative editor UI
 * @param {Object} context - App context with event handlers
 */
export function createEditorUI(context) {
  const { endCollaborativeSession } = context;
  const editorSection = DOM.editorSection();

  if (!editorSection) {
    // Create editor section if it doesn't exist
    const section = document.createElement("div");
    section.id = "editor-section";
    section.style.display = "none";
    section.style.height = "600px";
    section.style.display = "flex";
    section.style.flexDirection = "column";

    // Editor header
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "10px";

    const headerTitle = document.createElement("h2");
    headerTitle.id = "editor-header";
    headerTitle.textContent = "Collaborative Editor";
    header.appendChild(headerTitle);

    // Peer list
    const peerList = document.createElement("div");
    peerList.id = "editor-peer-list";
    peerList.style.fontSize = "12px";
    peerList.style.color = "#666";
    header.appendChild(peerList);

    section.appendChild(header);

    // Editor container
    const editorContainer = document.createElement("div");
    editorContainer.id = "editor-container";
    editorContainer.style.flex = "1";
    editorContainer.style.border = "1px solid #ccc";
    editorContainer.style.borderRadius = "4px";
    editorContainer.style.overflow = "hidden";
    section.appendChild(editorContainer);

    // End session button
    const endButton = document.createElement("button");
    endButton.id = "end-editor-button";
    endButton.textContent = "End Collaborative Session";
    endButton.style.marginTop = "10px";
    endButton.style.backgroundColor = "#f44336";
    endButton.style.color = "white";
    endButton.style.border = "none";
    endButton.style.padding = "8px 16px";
    endButton.style.borderRadius = "4px";
    endButton.style.cursor = "pointer";
    endButton.addEventListener("click", endCollaborativeSession);
    section.appendChild(endButton);

    // Add to main interface
    const mainInterface = DOM.mainInterface();
    if (mainInterface) {
      mainInterface.appendChild(section);
    }

    return section;
  }

  return editorSection;
}

/**
 * Update the collaborative editor peer list
 * @param {Array} peers - Array of connected peers
 */
export function updateEditorPeerList(peers) {
  const peerListEl = DOM.editorPeerList();
  if (!peerListEl) return;

  if (peers.length === 0) {
    peerListEl.textContent = "No other collaborators";
  } else {
    const peerNames = peers.map((p) => p.user.name).join(", ");
    peerListEl.textContent = `Collaborating with: ${peerNames}`;
  }
}
