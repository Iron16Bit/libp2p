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
import dgram from "dgram";

// Load environment variables from .env file
config();

const LIBP2P_PORT = process.env.LIBP2P_PORT || 4003;

// STUN server configuration
const STUN_SERVERS = [
  "stun.l.google.com:19302",
  "stun1.l.google.com:19302",
  "stun2.l.google.com:19302",
  "stun.cloudflare.com:3478",
];

function parseSTUNResponse(data) {
  if (data.length < 20) return null;

  // Check if it's a STUN success response
  if (data[0] !== 0x01 || data[1] !== 0x01) return null;

  let offset = 20;
  while (offset < data.length) {
    const type = data.readUInt16BE(offset);
    const length = data.readUInt16BE(offset + 2);

    // XOR-MAPPED-ADDRESS attribute (0x0020)
    if (type === 0x0020 && length >= 8) {
      const family = data.readUInt16BE(offset + 5);
      const port = data.readUInt16BE(offset + 6) ^ 0x2112;

      if (family === 0x01) {
        // IPv4
        const ip = [
          data[offset + 8] ^ 0x21,
          data[offset + 9] ^ 0x12,
          data[offset + 10] ^ 0xa4,
          data[offset + 11] ^ 0x42,
        ].join(".");
        return ip;
      }
    }

    // MAPPED-ADDRESS attribute (0x0001) - fallback
    if (type === 0x0001 && length >= 8) {
      const family = data.readUInt16BE(offset + 5);
      if (family === 0x01) {
        // IPv4
        const ip = [
          data[offset + 8],
          data[offset + 9],
          data[offset + 10],
          data[offset + 11],
        ].join(".");
        return ip;
      }
    }

    offset += 4 + length;
  }

  return null;
}

async function getPublicIP() {
  for (const stunServer of STUN_SERVERS) {
    try {
      console.log(`Trying STUN server: ${stunServer}`);

      const [host, portStr] = stunServer.split(":");
      const port = parseInt(portStr);

      const publicIP = await new Promise((resolve, reject) => {
        const client = dgram.createSocket("udp4");

        // STUN Binding Request
        const request = Buffer.alloc(20);
        request.writeUInt16BE(0x0001, 0); // Message Type: Binding Request
        request.writeUInt16BE(0x0000, 2); // Message Length
        request.writeUInt32BE(0x2112a442, 4); // Magic Cookie

        // Transaction ID (96 bits)
        for (let i = 8; i < 20; i++) {
          request[i] = Math.floor(Math.random() * 256);
        }

        const timeout = setTimeout(() => {
          client.close();
          reject(new Error("STUN request timeout"));
        }, 5000);

        client.on("message", (data) => {
          clearTimeout(timeout);
          client.close();

          const ip = parseSTUNResponse(data);
          if (ip) {
            resolve(ip);
          } else {
            reject(new Error("Could not parse STUN response"));
          }
        });

        client.on("error", (err) => {
          clearTimeout(timeout);
          client.close();
          reject(err);
        });

        client.send(request, port, host);
      });

      console.log(`✓ Public IP detected: ${publicIP}`);
      return publicIP;
    } catch (error) {
      console.log(`Failed with ${stunServer}: ${error.message}`);
      continue;
    }
  }

  console.log("All STUN servers failed, using localhost");
  return "localhost";
}

// Get public IP before starting the server
console.log("Detecting public IP address...");
const PUBLIC_IP = await getPublicIP();

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
  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: {
        maxReservations: Infinity,
      },
    }),
    pubsub: gossipsub({
      // Enable peer exchange
      enablePeerExchange: true,
      // Allow publishing to topics we're not subscribed to
      allowPublishToZeroPeers: true,
      // Enable flood publishing for better message delivery
      floodPublish: true,
      // Act as a relay node for messages
      scoreParams: {
        topics: {},
        topicScoreCap: 10,
        appSpecificScore: () => 0,
        decayInterval: 12000,
        decayToZero: 0.01,
      },
      // More permissive mesh parameters for relaying
      dLow: 2,
      dHigh: 8,
      dScore: 2,
      dOut: 1,
      dLazy: 4,
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
          topicPeers.set(topic, new Set());
          // Relay subscribes to the topic to help with message routing
          try {
            server.services.pubsub.subscribe(topic);
            console.log(
              `Relay subscribed to topic '${topic}' for message routing`
            );
          } catch (error) {
            console.log(
              `Failed to subscribe relay to topic '${topic}': ${error.message}`
            );
          }
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
            // Create a special discovery topic for this peer
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