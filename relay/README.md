# Deployment Guide

This guide explains how to deploy the libp2p browser pubsub example on a public server.

## Prerequisites

1. A server with Node.js installed
2. The server's public IP address
3. Firewall configured to allow traffic on the chosen ports

## Step 1: Deploy to Your Server

1. Install dependencies: `npm install`

## Step 2: Configure the Relay

The relay loads its configuration from `.env` file or environment variables: Create an `.env` with your server's details:
  
```bash
PUBLIC_IP=YOUR_SERVER_PUBLIC_IP
LIBP2P_PORT=PORT
```

## Step 3: Get the Relay Peer ID

When you first run the relay, it will output something like:
```
Your relay is publicly accessible at: /ip4/YOUR_IP/tcp/PORT/ws/p2p/12D3KooWXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Copy the whole address for the next step.

## Step 4: Update the Client Configuration

Edit `peer.js` and paste the relay's multiaddress:

```javascript
const relayAddr = ``;
```

## Notes

The hosting has been tested on a simple, always-free, Oracle VM with:
- Canonical-Ubuntu-20.04-Minimal-2025.07.23-0
- 1 CPU core of an AMD EPYC 7742 64-Core Processor
Such environment was prone to crashes, which have been handled through the `watchdog.sh`. To use it to automatically restart the server in case of crash, you need to install `screen` and `cron`. Once they've been installed, set the path variables at the top of the watchdog and then use:

`crontab -e`

And add at the bottom:

`*/1 * * * * PATH_TO/watchdog.sh`

In this case all outputs will be found in the path specified as `LOG_FILE`