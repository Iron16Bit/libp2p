# Deployment Guide

This guide explains how to deploy the libp2p browser pubsub example on a public server.

## Prerequisites

1. A server with Node.js installed
2. The server's public IP address
3. Firewall configured to allow traffic on the chosen ports

## Step 1: Deploy to Your Server

1. Copy all files to your server
2. Install dependencies: `npm install`

## Step 2: Configure the Relay

The relay is now configured to:
- Use a persistent peer ID (saved in `relay-peer-id.json`)
- Listen on all interfaces (0.0.0.0)
- Accept environment variable configuration

### Option A: Environment Variables

```bash
# Set your public IP
export PUBLIC_IP="YOUR_SERVER_PUBLIC_IP"
export LIBP2P_PORT=42869
export HTTP_PORT=33992

# Run the relay
node relay.js
```

### Option B: Direct Edit

Edit `relay.js` and change:
```javascript
const PUBLIC_IP = process.env.PUBLIC_IP || "YOUR_SERVER_PUBLIC_IP";
```

## Step 3: Get the Relay Peer ID

When you first run the relay, it will output something like:
```
Created new peer ID: 12D3KooWXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Public relay multiaddr: /ip4/YOUR_IP/tcp/42869/ws/p2p/12D3KooWXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Copy the peer ID for the next step.

## Step 4: Update the Client Configuration

Edit `index.js` and replace the placeholder:

```javascript
// Replace RELAY_PEER_ID_PLACEHOLDER with your actual peer ID
const relayAddr = `/ip4/${RELAY_HOST}/tcp/${RELAY_LIBP2P_PORT}/ws/p2p/YOUR_ACTUAL_PEER_ID`;
```

## Step 5: Serve the Web Files

Use any web server to serve the files. For example:

```bash
# Using Python
python -m http.server 8080

# Using Node.js http-server
npx http-server -p 8080

# Using Vite (included in package.json)
npm run dev
```

## Step 6: Configure Firewall

Make sure these ports are open on your server:
- `42869` (libp2p WebSocket port)
- `33992` (HTTP API port)
- `8080` (or whatever port you use for the web server)

## Example Full Deployment

```bash
# On your server
export PUBLIC_IP="203.0.113.50"  # Your actual public IP
node relay.js

# The relay will output its peer ID, for example:
# 12D3KooW9yuwAHHzC9ce1vw6gXikGSgSpqEnNn8TF7WBZaqbmsvY

# Edit index.js to use this peer ID:
# const relayAddr = "/ip4/203.0.113.50/tcp/42869/ws/p2p/12D3KooW9yuwAHHzC9ce1vw6gXikGSgSpqEnNn8TF7WBZaqbmsvY";

# Start web server
npm run dev
```

## Testing

1. Open `http://YOUR_IP:8080` in multiple browsers/devices
2. Each browser should select a topic and connect
3. Browsers with the same topic should be able to chat with each other

## Notes

- The peer ID is saved in `relay-peer-id.json` and will be consistent across reboots
- Clients automatically detect the hostname and use it for the relay connection
- The HTTP API is used for peer discovery and registration
- WebRTC connections are established between peers for optimal pubsub performance

## Troubleshooting

1. **Can't connect to relay**: Check firewall settings and ensure ports are open
2. **Peer ID mismatch**: Make sure you copied the correct peer ID from the relay logs
3. **CORS issues**: The client automatically uses the same hostname as the web page
4. **WebRTC fails**: Some networks block WebRTC; connections will fall back to relay