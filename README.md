# LibP2P Testing Bundle

The basic structure is based on [this repo](https://github.com/libp2p/js-libp2p-example-browser-pubsub) which has then been adapted to the needs of this project.

## Relay

The `relay/` folder contains a libp2p relay server that also works as rendezvous point.

**NOTE:** The rendezvous functionality is provided by libp2p, but at the moment it is implemented thorugh an API. This will be fixed in the future.

## Peer

A browser peer connects to the relay and asks for other peers that are interested in the same topic as him. Once it receives their addresses by the server, it directly connects to them.

**TODO:** Do not make a peer keep checking for new peers. When a new peer joins the topic, it announces himself and all other peers interested in the same topic will connect to him (or viceversa).