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
import { request } from "graphql-request";
const abi = parseAbi([
  "function spin(address _table, uint256 _round) external",
]);

const query = `
{
    rounds(where: {status: 1}, orderBy: started, orderDirection: asc, first: 5) {
      round
      table
      started
    }
}
`;

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, gelatoArgs, secrets } = context;

  const url = await secrets.get("ROULETTE_URL") || "";
  const rpc = await secrets.get("RPC_URL") || "";
  const roulette = userArgs.roulette as Address;
  const client = createPublicClient({
    chain: gelatoArgs.chainId === 137 ? polygon : polygonAmoy,
    transport: http(rpc),
  });
  const response = await request<{ rounds: { round: bigint, table: Address, started: bigint }[] }>(url, query);
  const data = response.rounds;
  const callableRounds: { round: bigint, table: Address }[] = [];

  // check if spin is callable
  for (const round of data) {
    try {
      const currentRound = await client.readContract({
        address: round.table,
        abi: parseAbi([
          "function getCurrentRound() external view returns (uint256)",
        ]),
        functionName: "getCurrentRound",
      })
      if (Number(round.round) === Number(currentRound)) {
        console.log(`Round ${round.round} on table ${round.table} is current round, Skipping... `)
        continue;
      }
      await client.simulateContract({
        address: roulette,
        abi: abi,
        functionName: "spin",
        args: [round.table, round.round],
      })

      console.log(`${round.round} on ${round.table} will be spinned`)
      callableRounds.push(round);
    } catch (e) {
      console.log(`Round ${round.round} on table ${round.table} is not callable`);
    }
  }

  if (callableRounds.length === 0) {
    return {
      canExec: false,
      message: "All rounds are closed",
    };
  }

  return {
    canExec: true,
    callData: callableRounds.map((round) => ({
      to: roulette,
      data: encodeFunctionData({
        abi: abi,
        functionName: "spin",
        args: [round.table, round.round],
      }),
    })),
  };
});
