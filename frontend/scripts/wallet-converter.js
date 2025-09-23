import { Keypair } from '@solana/web3.js'

// Example secret key array (replace with your actual array)
const myWalletArray = [
  157, 24, 81, 22, 157, 22, 36, 90, 164, 113, 100, 113, 192, 229, 67, 171, 170, 206, 229, 237, 76,
  172, 146, 28, 129, 181, 60, 173, 156, 77, 77, 143, 50, 209, 115, 237, 79, 63, 112, 201, 188, 23,
  134, 56, 131, 52, 206, 230, 17, 57, 219, 113, 49, 159, 217, 49, 19, 205, 247, 223, 252, 11, 68,
  193,
]

// Convert to keypair
const keypair = Keypair.fromSecretKey(new Uint8Array(myWalletArray))

// Print wallet information
console.log('Wallet Address:', keypair.publicKey.toString())
console.log('Private Key (Base58):', Buffer.from(keypair.secretKey).toString('base64'))
console.log('Private Key (Array):', Array.from(keypair.secretKey))
console.log('Private Key (Hex):', Buffer.from(keypair.secretKey).toString('hex'))
