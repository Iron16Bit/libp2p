# LibP2P Testing Bundle

The basic structure is based on [this repo](https://github.com/libp2p/js-libp2p-example-browser-pubsub) which has then been adapted to the needs of this project.

## Relay

Contained in the `relay/` folder, it has 2 main functionalities:
1. Take the *multiaddr* and the *topic* of interest of peers that connect to it and
2. Work as a Signaling Server for the WebRTC handshake, allowing those peers interested in the same topic.

### Peer Discovery

Peer discovery is based on libp2p's GossipSub. When a peer subscribes to a topic, the Relay takes its multiaddr and forwards it to the other peers subscribed to the same topic, allowing them to discover eachother. When a peer receives a discovery message from the relay, it dials all peers contained in the message, directly connecting to them.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Peer A    │    │    Relay    │    │   Peer B    │
│ (Browser)   │    │ (Discovery  │    │ (Browser)   │
│             │    │    Hub)     │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       │ 1. Subscribe to   │                   │
       │   "test_icp"      │                   │
       ├──────────────────▶│                   │
       │                   │ 2. Subscribe to   │
       │                   │   "test_icp"      │
       │                   │◀──────────────────┤
       │                   │                   │
       │ 3. Discovery msg  │ 4. Discovery msg  │
       │   about Peer B    │   about Peer A    │
       │◀──────────────────┤──────────────────▶│
       │                   │                   │
       │ 5. Direct WebRTC connection           │
       │◀─────────────────────────────────────▶│
       │                   │                   │
       │ 6. P2P Messages (no relay needed)     │
       │◀═════════════════════════════════════▶│

Legend: ──▶ Control Messages    ◀─▶ WebRTC    ◀═▶ GossipSub
```

## Peer

A browser peer connects to the relay and asks for other peers that are interested in the same topic as him. Once it receives their addresses by the server, it directly connects to them. Once this connection has been established, GossipSub automatically forms a mesh network for the topic and messages are routed through this mesh without needing the relay.