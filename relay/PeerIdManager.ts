import { readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { generateKeyPair, privateKeyToProtobuf, privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import type { PrivateKey } from '@libp2p/interface'
import type { PeerId } from '@libp2p/interface'

/**
 * Utility class for managing persistent libp2p peer IDs
 * 
 * This class handles the persistence of private keys to ensure
 * consistent peer IDs across application restarts.
 * 
 * From: https://gist.github.com/Realman78/028b99a46de60ad4a169ae4107939237
 */
export class PeerIdManager {
    /**
     * Loads peer ID from file or creates a new one
     * 
     * @param filePath - Path to the private key file
     * @returns The peer ID and private key
     */
    static async loadOrCreate(filePath: string): Promise<{ peerId: PeerId; privateKey: PrivateKey }> {
        let privateKey: PrivateKey
        let peerId: PeerId

        if (existsSync(filePath)) {
        console.log(`Loading existing private key from ${filePath}`)
        try {
            // Read the protobuf private key bytes from file
            const keyBytes = await readFile(filePath)
            
            // Reconstruct the private key from the protobuf bytes
            privateKey = await privateKeyFromProtobuf(keyBytes)
            
            // Create peer ID from the private key
            peerId = peerIdFromPrivateKey(privateKey)
            
            console.log(`Loaded peer ID: ${peerId.toString()}`)
        } catch (err: any) {
            console.log('Error loading private key:', err)
            console.log(`Failed to load private key, creating new one: ${err.message}`)
            
            // Fall back to creating a new key
            privateKey = await generateKeyPair('Ed25519')
            peerId = peerIdFromPrivateKey(privateKey)
            
            console.log(`Generated new peer ID: ${peerId.toString()}`)
        }
        } else {
        console.log(`Creating new private key and saving to ${filePath}`)
        
        // Generate new private key
        privateKey = await generateKeyPair('Ed25519')
        peerId = peerIdFromPrivateKey(privateKey)
        
        console.log(`Generated new peer ID: ${peerId.toString()}`)
        }

        try {
        // Save the protobuf private key bytes to file
        const keyBytes = privateKeyToProtobuf(privateKey)
        await writeFile(filePath, keyBytes)
        console.log(`Private key saved to ${filePath}`)
        } catch (err: any) {
        console.log(`Failed to save private key: ${err.message}`)
        }

        return { peerId, privateKey }
    }

    /**
     * Alternative method that returns just the private key for use with createLibp2p
     * 
     * @param filePath - Path to the private key file
     * @returns The private key
     */
    static async getPrivateKey(filePath: string): Promise<PrivateKey> {
        const { privateKey } = await this.loadOrCreate(filePath)
        return privateKey
    }
}