import { fromString, toString } from "uint8arrays";
import { multiaddr } from "@multiformats/multiaddr";

// Message types
export const MESSAGE_TYPES = {
  NICKNAME: "nickname",
  CONNECTION_REQUEST: "connection-request",
  CONNECTION_ACCEPTED: "connection-accepted",
  CONNECTION_REJECTED: "connection-rejected",
  PRIVATE_MESSAGE: "private-message",
  PEER_PRESENCE: "peer-presence",
};

/**
 * Handles incoming messages from pubsub topics
 * @param {Object} event - Message event from pubsub
 * @param {Object} context - App context containing references to libp2p, DOM, etc.
 */
export async function handleMessage(event, context) {
  const {
    libp2p,
    selectedTopic,
    directConnections,
    activePrivateTopic,
    peerNicknames,
    CONNECTION_STATES,
    myNickname,
    log,
    displayChatMessage,
    getNickname,
    updateTopicPeers,
    acceptConnectionRequest,
    rejectConnectionRequest,
    relayAddr,
    startCollaborativeSession,
  } = context;

  const topic = event.detail.topic;
  const messageData = toString(event.detail.data);

  // Check if this is a discovery message
  if (topic.startsWith(`__discovery__${libp2p.peerId.toString()}`)) {
    try {
      const discoveryData = JSON.parse(messageData);

      // Handle connection request specially - check if we're the target
      if (discoveryData.type === "connection-request") {
        const requestingPeerId = discoveryData.peerId;
        const requestingNickname =
          discoveryData.nickname || getNickname(requestingPeerId);
        const targetPeerId = discoveryData.targetPeerId;

        // Skip if this request isn't for us
        if (requestingPeerId === libp2p.peerId.toString()) return;

        // Make sure this request is meant for us
        if (targetPeerId === libp2p.peerId.toString()) {
          log(`Received connection request from ${requestingNickname}`);

          // Store the connection request
          directConnections.set(requestingPeerId, {
            status: CONNECTION_STATES.PENDING,
            privateTopic: null,
            messages: [],
          });

          // Show connection request dialog
          const dialog = document.getElementById("connection-request-dialog");
          const dialogText = document.getElementById("connection-request-text");

          if (dialog && dialogText) {
            dialogText.textContent = `${requestingNickname} wants to connect with you for collaborative editing. Accept?`;
            dialog.style.display = "block";

            // Set up button handlers
            const acceptButton = document.getElementById(
              "connection-request-accept"
            );
            const rejectButton = document.getElementById(
              "connection-request-reject"
            );

            if (acceptButton) {
              acceptButton.onclick = () => {
                acceptConnectionRequest(requestingPeerId);
                dialog.style.display = "none";
              };
            }

            if (rejectButton) {
              rejectButton.onclick = () => {
                rejectConnectionRequest(requestingPeerId);
                dialog.style.display = "none";
              };
            }
          }

          // Update UI
          updateTopicPeers();
          return;
        }
      } else {
        // Handle other discovery messages
        handleDiscoveryMessage(discoveryData, context);
      }
      return;
    } catch (error) {
      // Not a valid discovery message, ignore
      log(`Error parsing discovery message: ${error.message}`);
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
            if (activePrivateTopic === topic) {
              const chatMessagesEl = document.getElementById("chat-messages");
              if (chatMessagesEl) {
                displayChatMessage(
                  parsedMessage.sender,
                  parsedMessage.content,
                  false
                );
              }
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

    // Handle peer presence announcements
    if (parsedMessage.type === "peer-presence") {
      const remotePeerId = parsedMessage.peerId;
      const remoteNickname =
        parsedMessage.nickname || getNickname(remotePeerId);

      // Skip if this is our own message
      if (remotePeerId === libp2p.peerId.toString()) return;

      log(`Received presence announcement from ${remoteNickname}`);

      // Store the nickname
      if (remoteNickname) {
        peerNicknames.set(remotePeerId, remoteNickname);
      }

      // Try to connect to this peer if we're not already connected
      const connections = libp2p.getConnections(remotePeerId);
      if (connections.length === 0) {
        try {
          // Try direct connection using their provided addresses
          let connected = false;
          if (parsedMessage.addresses && parsedMessage.addresses.length > 0) {
            for (const addr of parsedMessage.addresses) {
              try {
                log(`Trying to dial peer at ${addr}`);
                await libp2p.dial(multiaddr(addr));
                log(`✓ Connected to peer ${remoteNickname} via direct address`);
                connected = true;
                break;
              } catch (err) {
                // Try next address
              }
            }
          }

          // If direct connection failed, try via relay
          if (!connected && relayAddr) {
            log(`Trying relay connection to ${remoteNickname}`);
            await libp2p.dial(
              multiaddr(`${relayAddr}/p2p-circuit/p2p/${remotePeerId}`)
            );
            log(`✓ Connected to peer ${remoteNickname} via relay`);
            connected = true;
          }

          if (connected) {
            // Send our nickname to the newly connected peer
            if (context.sendNicknameAnnouncement) {
              await context.sendNicknameAnnouncement();
            }
          }
        } catch (error) {
          log(`Failed to connect to peer ${remoteNickname}: ${error.message}`);
        }
      }

      // Update UI
      updateTopicPeers();
      return;
    }

    // Handle nickname announcements
    if (parsedMessage.type === MESSAGE_TYPES.NICKNAME) {
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
      const topicPeerList = document.getElementById("topic-peers");
      if (topicPeerList) updateTopicPeers();
      return;
    }

    // Handle connection acceptance
    if (parsedMessage.type === MESSAGE_TYPES.CONNECTION_ACCEPTED) {
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

      // Auto-start collaborative session
      if (typeof startCollaborativeSession === "function") {
        try {
          await startCollaborativeSession(acceptingPeerId);
        } catch (e) {
          log(`Failed to start editor automatically: ${e.message}`);
        }
      } else {
        updateTopicPeers();
      }

      return;
    }

    // Handle connection rejection
    if (parsedMessage.type === MESSAGE_TYPES.CONNECTION_REJECTED) {
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
}

/**
 * Handle discovery messages from the relay
 * @param {Object} discoveryData - Discovery data from relay
 * @param {Object} context - App context
 */
export async function handleDiscoveryMessage(discoveryData, context) {
  const { libp2p, log, sendNicknameAnnouncement } = context;

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
          // Convert the string to a multiaddr object
          const ma = multiaddr(addr);
          await libp2p.dial(ma);
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
        // Convert the string to a multiaddr object
        const ma = multiaddr(addr);
        await libp2p.dial(ma);
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

/**
 * Send a connection request to a peer
 * @param {string} targetPeerId - The peer ID to connect to
 * @param {Object} context - App context
 */
export async function sendConnectionRequest(targetPeerId, context) {
  const {
    libp2p,
    myNickname,
    directConnections,
    CONNECTION_STATES,
    log,
    updateTopicPeers,
  } = context;

  try {
    // Create and store the connection request
    directConnections.set(targetPeerId, {
      status: CONNECTION_STATES.REQUESTED,
      privateTopic: null,
      messages: [],
    });

    // Send a connection request directly to the specific peer using a private discovery topic
    const connectionRequest = {
      type: MESSAGE_TYPES.CONNECTION_REQUEST,
      peerId: libp2p.peerId.toString(),
      nickname: myNickname,
      timestamp: Date.now(),
      targetPeerId: targetPeerId, // Add the target to make sure only they process it
    };

    // Create a private topic for this specific peer
    const privateDiscoveryTopic = `__discovery__${targetPeerId}`;

    await libp2p.services.pubsub.publish(
      privateDiscoveryTopic,
      fromString(JSON.stringify(connectionRequest))
    );

    log(`Sent connection request to ${targetPeerId}`);
    updateTopicPeers(); // Update the UI to reflect pending status
  } catch (error) {
    log(`Failed to request private connection: ${error.message}`);
  }
}

/**
 * Send a connection acceptance message
 * @param {string} peerId - Peer ID to accept
 * @param {Object} context - App context
 * @param {string} privateTopic - The private topic to use for communication
 */
export async function sendConnectionAcceptance(peerId, context, privateTopic) {
  const { libp2p, selectedTopic, log } = context;

  try {
    // Send the acceptance with the private topic
    const acceptMessage = {
      type: MESSAGE_TYPES.CONNECTION_ACCEPTED,
      peerId: libp2p.peerId.toString(),
      privateTopic: privateTopic,
      timestamp: Date.now(),
    };

    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(acceptMessage))
    );

    log(`Sent connection acceptance to ${peerId}`);
  } catch (error) {
    log(`Failed to send connection acceptance: ${error.message}`);
  }
}

/**
 * Send a connection rejection message
 * @param {string} peerId - Peer ID to reject
 * @param {Object} context - App context
 */
export async function sendConnectionRejection(peerId, context) {
  const { libp2p, selectedTopic, log } = context;

  try {
    // Send the rejection
    const rejectMessage = {
      type: MESSAGE_TYPES.CONNECTION_REJECTED,
      peerId: libp2p.peerId.toString(),
      timestamp: Date.now(),
    };

    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(rejectMessage))
    );

    log(`Sent connection rejection to ${peerId}`);
  } catch (error) {
    log(`Failed to send connection rejection: ${error.message}`);
  }
}

/**
 * Send a private chat message
 * @param {string} content - Message content
 * @param {Object} context - App context
 */
export async function sendPrivateMessage(content, context) {
  const {
    libp2p,
    activePrivateTopic,
    activePrivatePeer,
    directConnections,
    log,
    displayChatMessage,
  } = context;

  if (!activePrivateTopic || !activePrivatePeer) {
    log("No active private chat");
    return false;
  }

  try {
    const messageObj = {
      type: MESSAGE_TYPES.PRIVATE_MESSAGE,
      sender: libp2p.peerId.toString(),
      content: content,
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

    // Display message in chat
    displayChatMessage(libp2p.peerId.toString(), content, true);

    log(`Sent private message: ${content}`);
    return true;
  } catch (error) {
    log(`Failed to send message: ${error.message}`);
    console.error("Send message error:", error);
    return false;
  }
}

/**
 * Send a nickname announcement to the topic
 * @param {Object} context - App context
 */
export async function sendNicknameAnnouncement(context) {
  const { libp2p, myNickname, selectedTopic, log } = context;

  try {
    const nicknameMessage = {
      type: MESSAGE_TYPES.NICKNAME,
      peerId: libp2p.peerId.toString(),
      nickname: myNickname,
    };

    await libp2p.services.pubsub.publish(
      selectedTopic,
      fromString(JSON.stringify(nicknameMessage))
    );

    log(`Announced nickname "${myNickname}" to topic "${selectedTopic}"`);
    return true;
  } catch (error) {
    log(`Failed to announce nickname: ${error.message}`);
    return false;
  }
}
