# LibP2P Browser Peer

This is the browser client for the LibP2P pubsub example.

## Installation

```bash
cd peer
npm install
```

## Running

Start the development server:

```bash
npm start
```

This will start a Vite development server and open the browser peer interface.

## Building

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Usage

1. Make sure the relay server is running
2. Open the browser interface
3. Connect to peers and start messaging on topics
4. Use WebRTC for direct peer-to-peer communication

## Configuration

The relay server address is configurable in `peer.js`. By default it connects to:
- `ws://localhost:63000` (local relay)

## Features

- Circuit relay connection via WebSocket
- WebRTC direct connections (DCUTR)
- Topic-based pubsub messaging
- Peer discovery and registration
- Real-time messaging interface