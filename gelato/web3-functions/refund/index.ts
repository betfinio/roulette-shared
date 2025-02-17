import {
  Web3Function,
  type Web3FunctionResultCallData,
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
  "function refundSingleBet(address _bet) external",
  "function refund(address _table, uint256 _round) external",
]);

const query = `
{
  bets(where: {status: 1, table_: {interval: 0}}) {
    id
  }
  
  rounds(where: {status: 2, started_lt: $yesterday}, orderBy: started, orderDirection: asc, first: 1) {
    table 
    round
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
  const response = await request<{ rounds: { round: bigint, table: Address, started: bigint }[], bets: { id: Address }[] }>(url, query.replace("$yesterday", Math.floor(new Date(Date.now() - 24 * 60 * 60 * 1000).getTime() / 1000).toString()));

  const data: Web3FunctionResultCallData[] = []
  let tries = 0;
  while (true) {
    if (tries > response.bets.length) {
      break;
    }
    // get one random bet from bets
    const randomBet = response.bets[Math.floor(Math.random() * response.bets.length)];
    if (randomBet === undefined) break;
    try {
      // check if bet is refundable(by calling simulateContract)
      await client.simulateContract({
        address: roulette,
        abi: abi,
        functionName: "refundSingleBet",
        args: [randomBet.id],
      });
      data.push({
        to: roulette,
        data: encodeFunctionData({
          abi: abi,
          functionName: "refundSingleBet",
          args: [randomBet.id],
        })
      })
      break;
    } catch (e) {
      console.log(`Bet ${randomBet.id} is not refundable`);
      tries++;
    }
  }
  // push each round from rounds
  for (const round of response.rounds) {
    data.push({
      to: roulette,
      data: encodeFunctionData({
        abi: abi,
        functionName: "refund",
        args: [round.table, round.round],
      })
    })
  }


  return {
    canExec: true,
    callData: data
  };
});
