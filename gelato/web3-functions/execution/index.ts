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

const abi = parseAbi([
  "function getCurrentRound() external view returns(uint256)",
  "function getRoundBank(uint256 round) external view returns(uint256)",
  "function spin(address _table, uint256 _round) external",
]);

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, gelatoArgs, secrets } = context;
  const delay = Number(await secrets.get("DELAY"));
  const url = await secrets.get("RPC_URL");
  // initialize client
  const client = createPublicClient({
    chain: gelatoArgs.chainId === 80002 ? polygonAmoy : polygon,
    transport: http(url),
  });
  await new Promise((resolve) => setTimeout(resolve, delay));

  // get stones address
  const rouletteAddress = userArgs.roulette as Address;
  const tableAddress = userArgs.table as Address;

  // get previous round
  const round =
    (await client.readContract({
      address: tableAddress,
      abi: abi,
      functionName: "getCurrentRound",
      args: [],
    })) - BigInt(1);
  // get players count
  const roundBank = await client.readContract({
    address: tableAddress,
    abi: abi,
    functionName: "getRoundBank",
    args: [round],
  });
  // check if there are players
  if (Number(roundBank) > 0) {
    try {
      await client.simulateContract({
        abi: abi,
        address: rouletteAddress,
        functionName: "spin",
        args: [tableAddress, round],
      });
    } catch (e) {
      return {
        canExec: false,
        message: `Round ${round} failed simulation run: ${JSON.stringify(e)}`,
      };
    }
    return {
      canExec: true,
      callData: [
        {
          to: rouletteAddress,
          data: encodeFunctionData({
            abi: abi,
            functionName: "spin",
            args: [tableAddress, round],
          }),
        },
      ],
    };
  }

  return {
    canExec: false,
    message: `Round ${round} has ${roundBank} bets`,
  };
});
