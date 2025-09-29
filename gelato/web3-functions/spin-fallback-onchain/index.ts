import {
  Web3Function,
  type Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { polygon, polygonAmoy } from "viem/chains";

const spinAbi = parseAbi([
  "function spin(address _table, uint256 _round) external",
]);

const tableAbi = parseAbi([
  "function getCurrentRound() external view returns (uint256)",
  "function roundStatus(uint256 round) external view returns (uint256)",
  "function interval() external view returns (uint256)",
]);

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, gelatoArgs, secrets } = context;
  
  const rpc = await secrets.get("RPC_URL") || "";
  const roulette = userArgs.roulette as Address;
  const table = userArgs.table as Address;
  
  // Setup client
  const client = createPublicClient({
    chain: gelatoArgs.chainId === 137 ? polygon : polygonAmoy,
    transport: http(rpc),
  });

  try {
    // Get table info
    const [currentRound, interval] = await Promise.all([
      client.readContract({
        address: table,
        abi: tableAbi,
        functionName: "getCurrentRound",
      }) as Promise<bigint>,
      client.readContract({
        address: table,
        abi: tableAbi,
        functionName: "interval",
      }) as Promise<bigint>
    ]);

    console.log(`Current round: ${currentRound}, Interval: ${interval}`);

    // create list of rounds to check
    const dayInSeconds = 86400;
    const roundsInDay = Math.ceil(dayInSeconds / Number(interval));
    
    // range: from (current - roundsInDay + 1) to (current - 1)
    const startRound = Number(currentRound) - roundsInDay + 1;
    const endRound = Number(currentRound) - 1;
    
    console.log(`Checking rounds from ${startRound} to ${endRound}`);

    if (startRound >= endRound) {
      return {
        canExec: false,
        message: "No rounds to check in valid range",
      };
    }

    const roundsToCheck: number[] = [];
    for (let round = startRound; round <= endRound; round++) {
      roundsToCheck.push(round);
    }

    console.log(`Total rounds to check: ${roundsToCheck.length}`);

    // multicall to check round status
    const multicallContracts = roundsToCheck.map((round) => ({
      address: table,
      abi: tableAbi,
      functionName: "roundStatus" as const,
      args: [BigInt(round)],
    }));

    const multicallResults = await client.multicall({ contracts: multicallContracts });

    // process results and identify rounds that need spinning
    const spinnableRounds: number[] = [];

    for (let i = 0; i < roundsToCheck.length; i++) {
      const round = roundsToCheck[i];
      
      // get roundStatus result
      const statusResult = multicallResults[i];
      const status = statusResult.status === 'success' ? Number(statusResult.result) : 0;
      
      if (status === 1) {
        console.log(`round ${round} is spinnable`);
        spinnableRounds.push(round);
      }
    }

    console.log(`Found ${spinnableRounds.length} spinnable rounds: [${spinnableRounds.join(', ')}]`);

    if (spinnableRounds.length === 0) {
      return {
        canExec: false,
        message: "No rounds need spinning",
      };
    }

    // test if spin calls are actually executable
    const callableRounds: number[] = [];

    for (const round of spinnableRounds) {
      try {
        await client.simulateContract({
          address: roulette,
          abi: spinAbi,
          functionName: "spin",
          args: [table, BigInt(round)],
        });
        callableRounds.push(round);
        console.log(`Round ${round} simulation passed`);
      } catch (e) {
        console.log(`Round ${round} simulation failed:`, e);
      }
    }

    if (callableRounds.length === 0) {
      return {
        canExec: false,
        message: `Found ${spinnableRounds.length} potentially spinnable rounds but none passed simulation`,
      };
    }

    console.log(`Final callable rounds: [${callableRounds.join(', ')}]`);

    
    return {
      canExec: true,
      callData: callableRounds.map((round) => ({
        to: roulette,
        data: encodeFunctionData({
          abi: spinAbi,
          functionName: "spin",
          args: [table, BigInt(round)],
        }),
      })),
    };

  } catch (error) {
    console.error("Error in fallback-onchain function:", error);
    return {
      canExec: false,
      message: `Error: ${error}`,
    };
  }
});
