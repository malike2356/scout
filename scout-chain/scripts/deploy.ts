// Deploys ScoutAgentIdentity to the network named on argv (default: sepolia)
// and writes the resulting address + tx hash to deployments/<network>.json.
// Run via `pnpm deploy:sepolia` (which is `hardhat run` under the hood is
// avoided on purpose - we want plain viem control over the wallet client so
// the private key handling matches scout-engine's own blockchain module).
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ARTIFACT_PATH = join(
  import.meta.dirname,
  '..',
  'artifacts',
  'contracts',
  'ScoutAgentIdentity.sol',
  'ScoutAgentIdentity.json',
);
const DEPLOYMENTS_DIR = join(import.meta.dirname, '..', 'deployments');

async function main(): Promise<void> {
  const network = process.argv[2] || 'sepolia';
  if (network !== 'sepolia') {
    throw new Error(`Only 'sepolia' is wired up today; got '${network}'.`);
  }

  const privateKey = process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('SCOUT_CHAIN_OPERATOR_PRIVATE_KEY is not set. Run `pnpm generate-wallet` first.');
  }
  const rpcUrl = process.env.SCOUT_CHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

  if (!existsSync(ARTIFACT_PATH)) {
    throw new Error('Contract artifact not found. Run `pnpm compile` first.');
  }
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8')) as {
    abi: unknown[];
    bytecode: `0x${string}`;
  };

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer: ${account.address}`);
  console.log(`Balance: ${formatEther(balance)} ETH (Sepolia)`);
  if (balance === 0n) {
    throw new Error(
      `Deployer wallet has 0 test ETH. Fund ${account.address} from a Sepolia faucet, then retry.`,
    );
  }

  console.log('Deploying ScoutAgentIdentity...');
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [],
  });
  console.log(`Tx sent: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('Deployment receipt has no contractAddress.');
  }

  console.log(`Deployed at: ${receipt.contractAddress}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Explorer: https://sepolia.etherscan.io/address/${receipt.contractAddress}`);

  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  writeFileSync(
    join(DEPLOYMENTS_DIR, `${network}.json`),
    JSON.stringify(
      {
        network,
        chainId: sepolia.id,
        address: receipt.contractAddress,
        deployTxHash: hash,
        deployBlock: receipt.blockNumber.toString(),
        deployer: account.address,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  console.log('');
  console.log(`Wrote deployments/${network}.json`);
  console.log(
    `Set SCOUT_CHAIN_CONTRACT_ADDRESS=${receipt.contractAddress} in scout-engine/.env to use it.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
