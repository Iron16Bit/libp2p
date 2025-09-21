/* eslint-disable no-console */

import { config } from "dotenv";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { createLibp2p } from "libp2p";
import { createServer } from "http";
import { createEd25519PeerId } from "@libp2p/peer-id-factory";

// Load environment variables from .env file
config();

const PUBLIC_IP = process.env.PUBLIC_IP || null;
const LIBP2P_PORT = process.env.LIBP2P_PORT || null;
const HTTP_PORT = process.env.HTTP_PORT || null;

// Create peer ID
const peerId = await createEd25519PeerId();
console.log(`Relay peer ID: ${peerId.toString()}`);

// Keep track of connected peers
const connectedPeers = new Map();

const server = await createLibp2p({
    peerId: peerId, 
    addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${LIBP2P_PORT}/ws`], // Listen on all interfaces
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
    console.log(`Peer disconnected: ${peerId}`);
    console.log(`Total connected peers: ${connectedPeers.size}`);
});

// HTTP server for peer discovery API
const httpServer = createServer((req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.url === "/peers" && req.method === "GET") {
        // Return list of connected peers
        const peers = Array.from(connectedPeers.values());
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ peers, count: peers.length }));
    } else if (req.url.startsWith("/register/") && req.method === "POST") {
        // Register peer with additional info
        const peerId = req.url.split("/register/")[1];

        let body = "";
        req.on("data", (chunk) => {
        body += chunk.toString();
        });

        req.on("end", () => {
        try {
            const peerData = JSON.parse(body);
            if (connectedPeers.has(peerId)) {
            const existing = connectedPeers.get(peerId);
            connectedPeers.set(peerId, { ...existing, ...peerData });
            console.log(`Updated peer info for: ${peerId}`);
            }
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));
        } catch (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
        });
    } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not found" }));
    }
});

// Start HTTP server on a different port
httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
    console.log(`HTTP API server listening on http://0.0.0.0:${HTTP_PORT}`);
    console.log(`Public HTTP API: http://${PUBLIC_IP}:${HTTP_PORT}`);
    console.log(`Available endpoints:`);
    console.log(`  GET  /peers - List connected peers`);
    console.log(`  POST /register/{peerId} - Register peer info`);
});

console.log(`Relay peer ID: ${server.peerId.toString()}`);
console.log(
    "Relay listening on multiaddr(s): ",
    server.getMultiaddrs().map((ma) => ma.toString())
);
console.log(
    `Public relay multiaddr: /ip4/${PUBLIC_IP}/tcp/${LIBP2P_PORT}/ws/p2p/${server.peerId.toString()}`
);
