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

// Load environment variables from .env file
config();

const PUBLIC_IP = process.env.PUBLIC_IP || "localhost";
const LIBP2P_PORT = process.env.LIBP2P_PORT || 4003;

// New: tuning knobs with sane defaults for small VMs
const HEARTBEAT_INTERVAL = Number(process.env.GOSSIP_HEARTBEAT_MS ?? 5000);
const RELAY_MAX_RESERVATIONS = Number(process.env.RELAY_MAX_RESERVATIONS ?? 64);
const RELAY_MAX_CONNECTIONS = Number(process.env.RELAY_MAX_CONNECTIONS ?? 100);

// Create peer ID
const peerId = await createEd25519PeerId();
console.log(`Relay peer ID: ${peerId.toString()}`);

// Keep track of connected peers and their topics
const connectedPeers = new Map();
const topicPeers = new Map(); // topic -> Set of peer IDs

const server = await createLibp2p({
  peerId: peerId,
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

  // New: keep connection count bounded and don't dial from the relay
  connectionManager: {
    minConnections: 0,
    maxConnections: RELAY_MAX_CONNECTIONS,
    autoDial: false,
  },

  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: {
        // Cap how many peers can reserve the relay
        maxReservations: RELAY_MAX_RESERVATIONS,
      },
      // Optional: if you want to completely avoid relaying data through the relay,
      // enable hop.disable below. This keeps signaling but prevents data proxying.
      // hop: { enabled: false },
    }),
    pubsub: gossipsub({
      // Reduce background churn
      enablePeerExchange: false,
      allowPublishToZeroPeers: true,
      floodPublish: false,
      heartbeatInterval: HEARTBEAT_INTERVAL,

      // Smaller mesh for a server role
      scoreParams: {
        topics: {},
        topicScoreCap: 10,
        appSpecificScore: () => 0,
        decayInterval: 12000,
        decayToZero: 0.01,
      },
      dLow: 1,
      dHigh: 5,
      dScore: 1,
      dOut: 1,
      dLazy: 3,
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
  console.log(`Peer connected: ${peerId}`);
  console.log(`Total connected peers: ${connectedPeers.size}`);
});

server.addEventListener("peer:disconnect", (event) => {
  const peerId = event.detail.toString();
  connectedPeers.delete(peerId);

  // Remove from all topics
  for (const [topic, peers] of topicPeers.entries()) {
    peers.delete(peerId);
    if (peers.size === 0) {
      topicPeers.delete(topic);
    }
  }

  console.log(`Peer disconnected: ${peerId}`);
  console.log(`Total connected peers: ${connectedPeers.size}`);
});

// Track topic subscriptions and facilitate peer discovery
server.services.pubsub.addEventListener(
  "subscription-change",
  async (event) => {
    const { peerId: subscribingPeer, subscriptions } = event.detail;

    for (const { topic, subscribe } of subscriptions) {
      if (subscribe) {
        // Skip discovery topics - relay doesn't need to subscribe to these
        if (topic.startsWith("__discovery__")) {
          continue;
        }

        // Peer subscribed to a topic
        if (!topicPeers.has(topic)) {
          // New: don't subscribe the relay to client topics (keeps it out of the mesh)
          topicPeers.set(topic, new Set());
        }
        topicPeers.get(topic).add(subscribingPeer.toString());

        console.log(`Peer ${subscribingPeer} subscribed to topic '${topic}'`);
        console.log(
          `Topic '${topic}' now has ${topicPeers.get(topic).size} peers`
        );

        // Get existing peers in this topic (excluding the new subscriber)
        const existingPeers = Array.from(topicPeers.get(topic)).filter(
          (peerId) => peerId !== subscribingPeer.toString()
        );

        if (existingPeers.length > 0) {
          console.log(
            `Facilitating discovery for topic '${topic}' - sharing ${existingPeers.length} existing peers`
          );

          // Send discovery message to the new subscriber about existing peers
          const discoveryMessage = {
            type: "peer-discovery",
            topic: topic,
            peers: existingPeers.map((peerId) => {
              const connections = server.getConnections(peerId);
              return {
                peerId: peerId,
                multiaddrs:
                  connections.length > 0
                    ? connections.map((conn) => conn.remoteAddr.toString())
                    : [
                        `${
                          server.getMultiaddrs()[0]
                        }/p2p-circuit/p2p/${peerId}`,
                      ],
              };
            }),
          };

          try {
            const discoveryTopic = `__discovery__${subscribingPeer.toString()}`;
            await server.services.pubsub.publish(
              discoveryTopic,
              new TextEncoder().encode(JSON.stringify(discoveryMessage))
            );
            console.log(
              `Sent discovery info to ${subscribingPeer} about ${existingPeers.length} peers`
            );
          } catch (error) {
            console.log(`Failed to send discovery message: ${error.message}`);
          }

          // Also notify existing peers about the new peer
          const newPeerMessage = {
            type: "new-peer",
            topic: topic,
            peer: {
              peerId: subscribingPeer.toString(),
              multiaddrs: [
                `${
                  server.getMultiaddrs()[0]
                }/p2p-circuit/p2p/${subscribingPeer.toString()}`,
              ],
            },
          };

          for (const existingPeerId of existingPeers) {
            try {
              const notifyTopic = `__discovery__${existingPeerId}`;
              await server.services.pubsub.publish(
                notifyTopic,
                new TextEncoder().encode(JSON.stringify(newPeerMessage))
              );
            } catch (error) {
              console.log(
                `Failed to notify ${existingPeerId}: ${error.message}`
              );
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

console.log(`Relay peer ID: ${server.peerId.toString()}`);
console.log(
  "Relay listening on multiaddr(s): ",
  server.getMultiaddrs().map((ma) => ma.toString())
);
console.log(
  `Public relay multiaddr: /ip4/${PUBLIC_IP}/tcp/${LIBP2P_PORT}/ws/p2p/${server.peerId.toString()}`
);
console.log("Relay server with GossipSub discovery hub is now active");
console.log(
  `Your relay is publicly accessible at: ${PUBLIC_IP}:${LIBP2P_PORT}`
);
