// Generates a fresh deployer/operator wallet for the ScoutAgentIdentity
// registry. Run once; the private key is written only to .env (gitignored)
// and never printed. Only the address (safe to share - it needs Sepolia
// test ETH from a public faucet) is printed to stdout.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ENV_PATH = join(import.meta.dirname, '..', '.env');
const KEY_NAME = 'SCOUT_CHAIN_OPERATOR_PRIVATE_KEY';

function main(): void {
  let existing = '';
  if (existsSync(ENV_PATH)) {
    existing = readFileSync(ENV_PATH, 'utf-8');
    if (new RegExp(`^${KEY_NAME}=`, 'm').test(existing)) {
      const match = existing.match(new RegExp(`^${KEY_NAME}=(0x[0-9a-fA-F]+)`, 'm'));
      if (match) {
        const account = privateKeyToAccount(match[1] as `0x${string}`);
        console.log('An operator wallet already exists in .env - reusing it (delete the line to generate a new one).');
        console.log(`Address: ${account.address}`);
        return;
      }
    }
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  const newLine = `${KEY_NAME}=${privateKey}\n`;
  writeFileSync(ENV_PATH, existing + (existing.endsWith('\n') || existing === '' ? '' : '\n') + newLine);

  console.log('Generated a new Scout chain operator wallet.');
  console.log(`Address: ${account.address}`);
  console.log(`Private key written to: ${ENV_PATH} (gitignored - never share this file)`);
  console.log('');
  console.log('Fund this address with Sepolia test ETH before deploying, e.g.:');
  console.log('  https://cloud.google.com/application/web3/faucet/ethereum/sepolia');
  console.log('  https://www.alchemy.com/faucets/ethereum-sepolia');
  console.log('A deployment only needs a small fraction of 1 test ETH.');
}

main();
