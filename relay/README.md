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

That is the address of your Relay Server!