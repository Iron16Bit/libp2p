# LibP2P Browser Peer

This is the browser client for the LibP2P pubsub example.

## Installation

```bash
npm i
```

## Running

1. Make sure the relay server is running
2. Paste the relay's multiaddr in: 

```javascript
const relayAddr = ``;
```

3. Start the peer:

```bash
npm run dev
```

4. Open the browser interface
5. Choose a topic and connect to the relay
6. Directly communicate with peers interested to the same topic