import hardhatToolboxViemPlugin from '@nomicfoundation/hardhat-toolbox-viem';
import { defineConfig } from 'hardhat/config';
import 'dotenv/config';

const SEPOLIA_RPC_URL =
  process.env.SCOUT_CHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
const DEPLOYER_PRIVATE_KEY = process.env.SCOUT_CHAIN_OPERATOR_PRIVATE_KEY || '';

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: { version: '0.8.24' },
      production: {
        version: '0.8.24',
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    sepolia: {
      type: 'http',
      chainType: 'l1',
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
});
