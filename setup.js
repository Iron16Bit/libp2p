#!/usr/bin/env node

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log("🚀 LibP2P Relay Setup Helper\n");

// Check if relay peer ID exists
const peerIdFile = join(__dirname, "relay-peer-id.json");
try {
  const peerIdData = JSON.parse(readFileSync(peerIdFile, "utf8"));
  console.log("✅ Found existing relay peer ID");
  console.log(`   Peer ID: ${peerIdData.id}`);

  // Get public IP from environment or prompt
  const publicIP = process.env.PUBLIC_IP || "localhost";
  const libp2pPort = process.env.LIBP2P_PORT || 42869;

  console.log("\n📋 Configuration:");
  console.log(`   Public IP: ${publicIP}`);
  console.log(`   LibP2P Port: ${libp2pPort}`);
  console.log(`   HTTP Port: ${process.env.HTTP_PORT || 33992}`);

  console.log("\n🔗 Relay Multiaddr:");
  console.log(`   /ip4/${publicIP}/tcp/${libp2pPort}/ws/p2p/${peerIdData.id}`);

  console.log("\n⚠️  Next Steps:");
  console.log("1. Update index.js with the relay multiaddr above");
  console.log("2. Replace RELAY_PEER_ID_PLACEHOLDER with the peer ID");
  console.log("3. Run: node relay.js");
  console.log("4. Serve the web files");
} catch (error) {
  console.log("❌ No relay peer ID found");
  console.log("   Run the relay first: node relay.js");
  console.log("   Then run this script again");
}

if (process.env.PUBLIC_IP) {
  console.log("\n✅ PUBLIC_IP environment variable is set");
} else {
  console.log("\n⚠️  Set PUBLIC_IP environment variable for production:");
  console.log('   export PUBLIC_IP="your.server.ip"');
}
