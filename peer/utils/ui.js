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
    activatePrivateChat,
    acceptConnectionRequest,
    log = defaultLog,
  } = context;

  // Check if the element exists before trying to update it
  const topicPeerList = DOM.topicPeerList();
  if (!topicPeerList || !selectedTopic) return;

  try {
    const peers = libp2p.services.pubsub.getSubscribers(selectedTopic);

    // Use optional chaining in case log is undefined
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

      // Use optional chaining in case log is undefined
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
            connectButton.textContent = "Chat";
            connectButton.style.backgroundColor = "#4CAF50";
            connectButton.style.color = "white";
            connectButton.onclick = () =>
              activatePrivateChat(peerIdStr, context);
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
    // Use optional chaining in case log is undefined
    log?.(`Error updating topic peers: ${error.message}`);
    console.error("Error updating topic peers:", error);
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
