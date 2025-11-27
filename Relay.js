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
import { logger } from "./logger.js";

// Load environment variables from .env file
config();

const PUBLIC_IP = process.env.PUBLIC_IP || "localhost";
const LIBP2P_PORT = process.env.LIBP2P_PORT || 4003;

// Create peer ID
const peerId = await createEd25519PeerId();
logger.info(`Relay peer ID: ${peerId.toString()}`);

// Keep track of connected peers and their topics
const connectedPeers = new Map();
const topicPeers = new Map();
const peerLastSeen = new Map();

// Track discovery messages to prevent spam
const recentDiscoveryMessages = new Map();
const DISCOVERY_COOLDOWN = 5000;

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
    maxConnections: 100,
    minConnections: 0,
    maxIncomingPendingConnections: 10,
  },
  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: {
        maxReservations: 50,
        reservationTTL: 30000,
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
      heartbeatInterval: 2000,
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
  logger.info(`Peer connected: ${peerId}`);
  logger.info(`Total connected peers: ${connectedPeers.size}`);
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
        logger.info(`Relay unsubscribed from empty topic: ${topic}`);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  logger.info(`Peer disconnected: ${peerId}`);
  logger.info(`Total connected peers: ${connectedPeers.size}`);
});

// Cleanup stale peers periodically
setInterval(() => {
  const now = Date.now();
  const STALE_TIMEOUT = 60000;
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
        logger.info(`Cleaned up empty topic: ${topic}`);
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
    logger.info(`Cleaned up ${cleaned} stale peer entries`);
  }

  logger.info(
    `Active topics: ${topicPeers.size}, Connected peers: ${connectedPeers.size}`
  );
}, 30000);

// Track topic subscriptions and facilitate peer discovery
server.services.pubsub.addEventListener(
  "subscription-change",
  async (event) => {
    const { peerId: subscribingPeer, subscriptions } = event.detail;

    logger.info(
      `[RELAY] Subscription change from ${subscribingPeer
        .toString()
        .slice(0, 8)}`
    );
    subscriptions.forEach((s) => {
      logger.info(`[RELAY]    ${s.subscribe ? "SUB" : "UNSUB"}: ${s.topic}`);
    });

    for (const { topic, subscribe } of subscriptions) {
      if (subscribe) {
        // Skip internal discovery topics
        if (topic.startsWith("__discovery__")) {
          continue;
        }

        logger.info(`[RELAY] Processing subscription to: ${topic}`);

        // Update last seen
        peerLastSeen.set(subscribingPeer.toString(), Date.now());

        // Peer subscribed to a topic
        if (!topicPeers.has(topic)) {
          topicPeers.set(topic, new Set());
        }
        topicPeers.get(topic).add(subscribingPeer.toString());

        logger.info(
          `[RELAY] Peer ${subscribingPeer
            .toString()
            .slice(0, 8)} subscribed to '${topic}'`
        );
        logger.info(
          `[RELAY] Total peers on this topic: ${topicPeers.get(topic).size}`
        );

        // Get existing peers in this topic (excluding the new subscriber)
        const existingPeers = Array.from(topicPeers.get(topic)).filter(
          (peerId) =>
            peerId !== subscribingPeer.toString() && connectedPeers.has(peerId)
        );

        logger.info(
          `[RELAY] Will notify about ${existingPeers.length} existing peers`
        );

        // Rate limit discovery messages
        const peerIdStr = subscribingPeer.toString();
        const lastDiscovery = recentDiscoveryMessages.get(peerIdStr);
        const now = Date.now();

        if (lastDiscovery && now - lastDiscovery < DISCOVERY_COOLDOWN) {
          logger.info(
            `[RELAY] Rate limiting discovery for ${peerIdStr.slice(0, 8)}`
          );
          continue;
        }

        if (existingPeers.length > 0) {
          recentDiscoveryMessages.set(peerIdStr, now);

          // Send discovery message directly on the topic the peer just subscribed to
          const discoveryMessage = {
            type: "relay-discovery",
            relayId: server.peerId.toString(),
            peers: existingPeers.map((peerId) => ({
              peerId: peerId,
              // Include circuit relay address so peers can dial each other through the relay
              multiaddrs: [
                `/ip4/${PUBLIC_IP}/tcp/${LIBP2P_PORT}/ws/p2p/${server.peerId.toString()}/p2p-circuit/p2p/${peerId}`,
              ],
            })),
          };

          try {
            // Send on the SAME topic, not a separate discovery topic
            await server.services.pubsub.publish(
              topic,
              new TextEncoder().encode(JSON.stringify(discoveryMessage))
            );
            logger.info(
              `[RELAY] Sent discovery to topic ${topic} with ${existingPeers.length} peers`
            );
          } catch (error) {
            logger.error(`[RELAY] Failed to send discovery message:`, error);
          }
        } else {
          logger.info(
            `[RELAY] No existing peers to notify about on topic ${topic}`
          );
        }
      } else {
        // Peer unsubscribed from a topic
        if (topicPeers.has(topic)) {
          topicPeers.get(topic).delete(subscribingPeer.toString());
          if (topicPeers.get(topic).size === 0) {
            topicPeers.delete(topic);
          }
          logger.info(
            `[RELAY] Peer ${subscribingPeer
              .toString()
              .slice(0, 8)} unsubscribed from '${topic}'`
          );
        }
      }
    }
  }
);

console.log(
  `Your relay is publicly accessible at: /ip4/${PUBLIC_IP}/tcp/${LIBP2P_PORT}/ws/p2p/${server.peerId.toString()}`
);
