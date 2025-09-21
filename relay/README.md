# Deployment Guide

This guide explains how to deploy the libp2p browser pubsub example on a public server.

## Prerequisites

1. A server with Node.js installed
2. The server's public IP address
3. Firewall configured to allow traffic on the chosen ports

## Step 1: Deploy to Your Server

1. Install dependencies: `npm install`

## Step 2: Configure the Relay

The relay is now configured to:
- Listen on all interfaces (0.0.0.0)
- Load configuration from `.env` file or environment variables: Create an `.env` with your server's details:
- 
```bash
PUBLIC_IP=YOUR_SERVER_PUBLIC_IP
LIBP2P_PORT=42869
HTTP_PORT=33992
```

## Step 3: Get the Relay Peer ID

When you first run the relay, it will output something like:
```
Created new peer ID: 12D3KooWXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Public relay multiaddr: /ip4/YOUR_IP/tcp/42869/ws/p2p/12D3KooWXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Copy the peer ID for the next step.

## Step 4: Update the Client Configuration

Edit `peer.js` and replace the placeholder:

```javascript
// Replace RELAY_PEER_ID_PLACEHOLDER with your actual peer ID
const relayAddr = `/ip4/${RELAY_HOST}/tcp/${RELAY_LIBP2P_PORT}/ws/p2p/YOUR_ACTUAL_PEER_ID`;
```