/* eslint-disable no-console */

import { config } from "dotenv";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { createLibp2p } from "libp2p";
import { createEd25519PeerId } from "@libp2p/peer-id-factory";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { PeerIdManager } from "./PeerIdManager.ts";
import http from "http";

// Load environment variables from .env file
config();

const PUBLIC_IP = process.env.PUBLIC_IP || "localhost";
const LIBP2P_PORT = process.env.LIBP2P_PORT || 4003;

// Create peer ID
const peerId = await createEd25519PeerId();
console.log(`Relay peer ID: ${peerId.toString()}`);

// Keep track of connected peers and their topics
const connectedPeers = new Map();
const topicPeers = new Map(); // topic -> Set of peer IDs
const peerLastSeen = new Map(); // peerId -> timestamp

// Track discovery messages to prevent spam
const recentDiscoveryMessages = new Map(); // peerId -> timestamp
const DISCOVERY_COOLDOWN = 5000; // 5 seconds between discovery messages

// Use static peer ID for the relay server
const privateKey = await PeerIdManager.getPrivateKey("./peer-id.key");

const server = await createLibp2p({
  privateKey,
  addresses: {
    listen: [`/ip4/0.0.0.0/tcp/${LIBP2P_PORT}/ws`],
  },
  transports: [
    webSockets({
      filter: filters.all,
    }),
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  connectionManager: {
    maxConnections: 100, // Limit total connections
    minConnections: 0,
    maxIncomingPendingConnections: 10, // Prevent flood of new connections
  },
  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: {
        maxReservations: 50, // Increased from 20
        reservationTTL: 30000, // Reduced from 60s to 30s
        reservationCompletionTimeout: 10000,
      },
      maxInboundCircuits: 50,
      maxOutboundCircuits: 50,
    }),
    pubsub: gossipsub({
      enablePeerExchange: true,
      allowPublishToZeroPeers: true,
      floodPublish: true,
      scoreParams: {
        topics: {},
        topicScoreCap: 10,
        appSpecificScore: () => 0,
        decayInterval: 12000,
        decayToZero: 0.01,
      },
      dLow: 2,
      dHigh: 8,
      dScore: 2,
      dOut: 1,
      dLazy: 4,
      heartbeatInterval: 2000, // More frequent heartbeats to detect dead peers
    }),
  },
});

// Track peer connections
server.addEventListener("peer:connect", (event) => {
  const peerId = event.detail.toString();
  const peerInfo = {
    peerId,
    connectedAt: new Date().toISOString(),
    multiaddrs: [],
  };
  connectedPeers.set(peerId, peerInfo);
  peerLastSeen.set(peerId, Date.now());
  console.log(`Peer connected: ${peerId}`);
  console.log(`Total connected peers: ${connectedPeers.size}`);
});

server.addEventListener("peer:disconnect", (event) => {
  const peerId = event.detail.toString();
  connectedPeers.delete(peerId);
  peerLastSeen.delete(peerId);
  recentDiscoveryMessages.delete(peerId);

  // Remove from all topics
  for (const [topic, peers] of topicPeers.entries()) {
    peers.delete(peerId);
    if (peers.size === 0) {
      topicPeers.delete(topic);
      // Unsubscribe relay from empty topics to save resources
      try {
        server.services.pubsub.unsubscribe(topic);
        console.log(`Relay unsubscribed from empty topic: ${topic}`);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  console.log(`Peer disconnected: ${peerId}`);
  console.log(`Total connected peers: ${connectedPeers.size}`);
});

// Cleanup stale peers periodically
setInterval(() => {
  const now = Date.now();
  const STALE_TIMEOUT = 60000; // 60 seconds
  let cleaned = 0;

  // Check for stale peers in topicPeers
  for (const [topic, peers] of topicPeers.entries()) {
    const stalePeers = [];

    for (const peerId of peers) {
      const lastSeen = peerLastSeen.get(peerId);
      const isConnected = connectedPeers.has(peerId);

      // Remove if peer is not connected and hasn't been seen recently
      if (!isConnected && (!lastSeen || now - lastSeen > STALE_TIMEOUT)) {
        stalePeers.push(peerId);
      }
    }

    stalePeers.forEach((peerId) => {
      peers.delete(peerId);
      cleaned++;
    });

    // Remove empty topics
    if (peers.size === 0) {
      topicPeers.delete(topic);
      try {
        server.services.pubsub.unsubscribe(topic);
        console.log(`Cleaned up empty topic: ${topic}`);
      } catch (e) {
        // Ignore
      }
    }
  }

  // Clean up discovery cooldown map
  for (const [peerId, timestamp] of recentDiscoveryMessages.entries()) {
    if (now - timestamp > DISCOVERY_COOLDOWN * 2) {
      recentDiscoveryMessages.delete(peerId);
    }
  }

  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} stale peer entries`);
  }

  // Log memory usage
  const memUsage = process.memoryUsage();
  console.log(
    `Memory: RSS ${(memUsage.rss / 1024 / 1024).toFixed(2)}MB, Heap ${(
      memUsage.heapUsed /
      1024 /
      1024
    ).toFixed(2)}MB`
  );
  console.log(
    `Active topics: ${topicPeers.size}, Connected peers: ${connectedPeers.size}`
  );
}, 30000); // Run every 30 seconds

// Track topic subscriptions and facilitate peer discovery
server.services.pubsub.addEventListener(
  "subscription-change",
  async (event) => {
    const { peerId: subscribingPeer, subscriptions } = event.detail;

    for (const { topic, subscribe } of subscriptions) {
      if (subscribe) {
        // Skip discovery topics AND session topics - relay should not subscribe
        if (
          topic.startsWith("__discovery__") ||
          topic.startsWith("icp.session.")
        ) {
          console.log(`Relay ignoring topic: ${topic}`);
          continue;
        }

        // Update last seen
        peerLastSeen.set(subscribingPeer.toString(), Date.now());

        // Peer subscribed to a topic
        if (!topicPeers.has(topic)) {
          topicPeers.set(topic, new Set());
        }
        topicPeers.get(topic).add(subscribingPeer.toString());

        console.log(`Peer ${subscribingPeer} subscribed to topic '${topic}'`);

        // Get existing peers in this topic (excluding the new subscriber)
        const existingPeers = Array.from(topicPeers.get(topic)).filter(
          (peerId) =>
            peerId !== subscribingPeer.toString() && connectedPeers.has(peerId)
        );

        // Rate limit discovery messages
        const peerIdStr = subscribingPeer.toString();
        const lastDiscovery = recentDiscoveryMessages.get(peerIdStr);
        const now = Date.now();

        if (lastDiscovery && now - lastDiscovery < DISCOVERY_COOLDOWN) {
          console.log(`Rate limiting discovery for ${peerIdStr}`);
          continue;
        }

        if (existingPeers.length > 0) {
          recentDiscoveryMessages.set(peerIdStr, now);

          // Send discovery message to the new subscriber about existing peers
          const discoveryMessage = {
            type: "peer-discovery",
            topic: topic,
            peers: existingPeers.map((peerId) => {
              return {
                peerId: peerId,
                multiaddrs: [], // Browser will get multiaddrs from libp2p peer store
              };
            }),
          };

          try {
            // Create a special discovery topic for this peer
            const discoveryTopic = `__discovery__${subscribingPeer.toString()}`;
            await server.services.pubsub.publish(
              discoveryTopic,
              new TextEncoder().encode(JSON.stringify(discoveryMessage))
            );
            console.log(
              `Sent discovery message to ${subscribingPeer} with ${existingPeers.length} peer IDs`
            );
          } catch (error) {
            console.error(`Failed to send discovery message:`, error);
          }

          // Also notify existing peers about the new peer
          const newPeerMessage = {
            type: "new-peer",
            topic: topic,
            peer: {
              peerId: subscribingPeer.toString(),
              multiaddrs: [], // Browser will get multiaddrs from libp2p peer store
            },
          };

          for (const existingPeerId of existingPeers) {
            const lastNotified = recentDiscoveryMessages.get(
              `notify_${existingPeerId}`
            );
            if (lastNotified && now - lastNotified < DISCOVERY_COOLDOWN) {
              continue;
            }

            try {
              const notifyTopic = `__discovery__${existingPeerId}`;
              await server.services.pubsub.publish(
                notifyTopic,
                new TextEncoder().encode(JSON.stringify(newPeerMessage))
              );
              recentDiscoveryMessages.set(`notify_${existingPeerId}`, now);
            } catch (error) {
              // Nothing
            }
          }
        }
      } else {
        // Peer unsubscribed from a topic
        if (topicPeers.has(topic)) {
          topicPeers.get(topic).delete(subscribingPeer.toString());
          if (topicPeers.get(topic).size === 0) {
            topicPeers.delete(topic);
          }
          console.log(
            `Peer ${subscribingPeer} unsubscribed from topic '${topic}'`
          );
        }
      }
    }
  }
);

// // Create a health check server
// const healthServer = http.createServer((req, res) => {
//   if (req.url === "/health") {
//     const memoryUsage = process.memoryUsage();
//     const connectedPeersCount = connectedPeers.size;

//     res.writeHead(200, { "Content-Type": "application/json" });
//     res.end(
//       JSON.stringify({
//         status: "ok",
//         connectedPeers: connectedPeersCount,
//         activeTopics: topicPeers.size,
//         memoryUsage: {
//           rss: memoryUsage.rss / 1024 / 1024,
//           heapUsed: memoryUsage.heapUsed / 1024 / 1024,
//           heapTotal: memoryUsage.heapTotal / 1024 / 1024,
//         },
//       })
//     );
//   } else {
//     res.writeHead(404);
//     res.end();
//   }
// });

// // Start the health check server
// const HEALTH_PORT = process.env.HEALTH_PORT || 8080;
// healthServer.listen(HEALTH_PORT, () => {
//   console.log(
//     `Health check server running at http://localhost:${HEALTH_PORT}/health`
//   );
// });

console.log(
  `Your relay is publicly accessible at: /ip4/${PUBLIC_IP}/tcp/${LIBP2P_PORT}/ws/p2p/${server.peerId.toString()}`
);
