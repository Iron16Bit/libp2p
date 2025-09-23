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

// Put here the relay peer's addresses:
const relayAddr = `/ip4/130.110.13.183/tcp/4003/ws/p2p/12D3KooWGUrXaPW4iCSUbqYb9NBusrRsYombqpMskxeTy5BjZJ7Z`;

// --------- INTERACTION WITH HTML ---------
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
            // Enable peer exchange for better discovery
            enablePeerExchange: true,
            // Reduce heartbeat interval for faster discovery
            heartbeatInterval: 1000,
            // Enable flood publishing to ensure message delivery
            floodPublish: true,
            // Allow publishing even with minimal mesh
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
            // Ensure messages are published even with few peers
            allowPublishToZeroPeers: true,
            }),
        dcutr: dcutr(),
    },
});

let selectedTopic = null;

// Initialize the app but don't connect until topic is selected
async function initializeLibp2p() {
    if (relayAddr) {
        try {
        appendOutput(`Connecting to relay...`);
        await libp2p.dial(multiaddr(relayAddr));
        appendOutput(`Connected to relay`);

        // Wait a moment for the connection to stabilize
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Subscribe to our discovery topic first
        const discoveryTopic = `__discovery__${libp2p.peerId.toString()}`;
        libp2p.services.pubsub.subscribe(discoveryTopic);
        appendOutput(`Subscribed to discovery topic`);

        // Subscribe to the main topic
        libp2p.services.pubsub.subscribe(selectedTopic);
        appendOutput(`Auto-subscribed to topic '${selectedTopic}'`);

        // Wait for GossipSub mesh to stabilize
        await new Promise((resolve) => setTimeout(resolve, 2000));
        appendOutput(`GossipSub mesh stabilization complete`);

        // Enable message sending
        DOM.sendTopicMessageInput().disabled = false;
        DOM.sendTopicMessageButton().disabled = false;
        } catch (error) {
        appendOutput(`Failed to connect to relay: ${error.message}`);
        }
    }
}

// ---------- MESSAGE HANDLING ---------

libp2p.services.pubsub.addEventListener("message", (event) => {
    const topic = event.detail.topic;
    const message = toString(event.detail.data);

    // Check if this is a discovery message
    if (topic.startsWith(`__discovery__${libp2p.peerId.toString()}`)) {
        try {
        const discoveryData = JSON.parse(message);
        handleDiscoveryMessage(discoveryData);
        return;
        } catch (error) {
        // Not a valid discovery message, ignore
        }
    }

    // Regular topic message
    appendOutput(`Message received on topic '${topic}'`);
    appendOutput(message);
});

// Handle discovery messages from the relay
async function handleDiscoveryMessage(discoveryData) {
    if (discoveryData.type === "peer-discovery") {
        appendOutput(
        `🔍 Discovery: Found ${discoveryData.peers.length} peers for topic '${discoveryData.topic}'`
        );

        for (const peerInfo of discoveryData.peers) {
        const peerId = peerInfo.peerId;

        // Skip if we're already connected
        const connections = libp2p.getConnections(peerId);
        if (connections.length > 0) continue;

        appendOutput(`Attempting to connect to discovered peer: ${peerId}`);

        // Try connecting to each multiaddr
        let connected = false;
        for (const addr of peerInfo.multiaddrs) {
            try {
            await libp2p.dial(multiaddr(addr));
            appendOutput(`✓ Connected to peer: ${peerId}`);
            connected = true;
            break;
            } catch (error) {
            // Try next address
            }
        }

        if (!connected) {
            appendOutput(`Failed to connect to peer: ${peerId}`);
        }
        }
    } else if (discoveryData.type === "new-peer") {
        const peerInfo = discoveryData.peer;
        appendOutput(
        `🆕 New peer joined topic '${discoveryData.topic}': ${peerInfo.peerId}`
        );

        // Try to connect to the new peer
        const connections = libp2p.getConnections(peerInfo.peerId);
        if (connections.length === 0) {
        try {
            await libp2p.dial(multiaddr(peerInfo.multiaddrs[0]));
            appendOutput(`✓ Connected to new peer: ${peerInfo.peerId}`);
        } catch (error) {
            appendOutput(`Failed to connect to new peer: ${peerInfo.peerId}`);
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
        appendOutput(`Discovered peer: ${peerId}, attempting connection...`);

        // Try to connect directly first
        await libp2p.dial(peerId);
        appendOutput(`✓ Connected to discovered peer: ${peerId}`);
    } catch (error) {
        // Try via circuit relay as fallback
        try {
        const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${peerId}`;
        await libp2p.dial(multiaddr(circuitAddr));
        appendOutput(`✓ Connected to peer via relay: ${peerId}`);
        } catch (relayError) {
        appendOutput(`Failed to connect to ${peerId}: ${relayError.message}`);
        }
    }
});

// Listen for pubsub peer joins
libp2p.services.pubsub.addEventListener("subscription-change", (event) => {
    const { peerId, subscriptions } = event.detail;

    // Check if this peer subscribed to our topic
    const topicSubscriptions = subscriptions.filter(
        (sub) => sub.topic === selectedTopic && sub.subscribe
    );

    if (topicSubscriptions.length > 0) {
        appendOutput(`Peer ${peerId} joined topic '${selectedTopic}'`);

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
    }
});

DOM.peerId().innerText = libp2p.peerId.toString();

function updatePeerList() {
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

// Update peer connections
libp2p.addEventListener("connection:open", async (event) => {
    const connection = event.detail;

    // Check if this is a WebRTC connection
    if (connection.remoteAddr.toString().includes("/webrtc")) {
        appendOutput(
        `✓ WebRTC connection established with ${connection.remotePeer}`
        );
    } else {
        appendOutput(`✓ Connection established with ${connection.remotePeer}`);
    }

    updatePeerList();
});

libp2p.addEventListener("connection:close", (event) => {
    appendOutput(`Connection closed with ${event.detail.remotePeer}`);
    updatePeerList();
});

// Update listening addresses
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

    // Connect to relay and start discovery
    await initializeLibp2p();
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

// Send message to topic
DOM.sendTopicMessageButton().onclick = async () => {
    const topic = selectedTopic;
    const message = DOM.sendTopicMessageInput().value;

    // Debug: Check current subscriptions
    const subscribers = libp2p.services.pubsub.getSubscribers(topic);
    const connectedPeers = libp2p.getPeers();

    appendOutput(`Sending message '${clean(message)}'`);
    appendOutput(`Connected peers: ${connectedPeers.length}`);
    appendOutput(`Topic subscribers: ${subscribers.length}`);

    try {
        // Force publish the message even if no subscribers are detected
        await libp2p.services.pubsub.publish(topic, fromString(message));
        DOM.sendTopicMessageInput().value = "";
        appendOutput(`Message sent successfully!`);
    } catch (error) {
        appendOutput(`Failed to publish message: ${error.message}`);

        // Try alternative approach: wait a moment and retry
        try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await libp2p.services.pubsub.publish(topic, fromString(message));
        DOM.sendTopicMessageInput().value = "";
        appendOutput(`Message sent on retry!`);
        } catch (retryError) {
        appendOutput(`Retry also failed: ${retryError.message}`);
        }
    }
};

// Update topic peers
setInterval(() => {
    if (!selectedTopic) return;

    const peerList = libp2p.services.pubsub
        .getSubscribers(selectedTopic)
        .map((peerId) => {
        const el = document.createElement("li");
        el.textContent = peerId.toString();
        return el;
        });
    DOM.topicPeerList().replaceChildren(...peerList);
}, 500);
