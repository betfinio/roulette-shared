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

const tableAbi = parseAbi([
  "function roundSpinned(uint256) external view returns (uint256)",
]);

const makeQuery = (yesterdayTimestamp: number, limit: number) => `
{
  bets(where: {status: 1, table_: {interval: 0}}) {
    id
  }
  
  roundsStatus1: rounds(where: {status: 1, started_lt: ${yesterdayTimestamp}}, orderBy: started, orderDirection: asc, first: ${limit}) {
    table 
    round
    started
  }
  roundsStatus2: rounds(where: {status: 2, started_lt: ${yesterdayTimestamp}}, orderBy: started, orderDirection: asc, first: ${limit}) {
    table 
    round
    started
  }
}
`;

type Response = {
  roundsStatus1: { round: bigint, table: Address, started: bigint }[],
  roundsStatus2: { round: bigint, table: Address, started: bigint }[],
  bets: { id: Address }[]
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, gelatoArgs, secrets } = context;

  const url = await secrets.get("ROULETTE_URL") || "";
  const rpc = await secrets.get("RPC_URL") || "";
  const limit = Number(await secrets.get("LIMIT")) || 100;
  const roulette = userArgs.roulette as Address;
  const client = createPublicClient({
    chain: gelatoArgs.chainId === 137 ? polygon : polygonAmoy,
    transport: http(rpc),
  });
  
  const yesterdayTimestamp = Math.floor(new Date(Date.now() - 24 * 60 * 60 * 1000).getTime() / 1000);
  const response = await request<Response>(url, makeQuery(yesterdayTimestamp, limit));
  const roundsStatus1 = response.roundsStatus1;
  const roundsStatus2 = response.roundsStatus2;
  const bets = response.bets;

  const data: Web3FunctionResultCallData[] = []
  let tries = 0;
  while (true) {
    if (tries > bets.length) {
      break;
    }
    // get one random bet from bets
    const randomBet = bets[Math.floor(Math.random() * bets.length)];
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
  
  // since requested rounds (status=2) can be refunded 1 day after VRF REQEUST, we need to filter others
  const roundsStatus2RoundSpinnedsMulticall = roundsStatus2.map((round) => ({
    address: round.table,
    abi: tableAbi,
    functionName: "roundSpinned",
    args: [round.round],
  }));
  const roundsStatus2RoundSpinnedsMulticallResults = await client.multicall({ contracts: roundsStatus2RoundSpinnedsMulticall });
  for(let i = 0; i < roundsStatus2.length; i++) {
    const round = roundsStatus2[i];
    const roundSpinned = roundsStatus2RoundSpinnedsMulticallResults[i].status === 'success' ? Number(roundsStatus2RoundSpinnedsMulticallResults[i].result) : 0;
    if (roundSpinned < BigInt(yesterdayTimestamp)) {
      try {
        await client.simulateContract({
          address: roulette,
          abi: abi,
          functionName: "refund",
          args: [round.table, round.round],
        });
        data.push({
          to: roulette,
          data: encodeFunctionData({
            abi: abi,
            functionName: "refund",
            args: [round.table, round.round],
          })
        });
        console.log(`Round ${round.round} on table ${round.table} (status 2) passed refund simulation`);
      } catch (e) {
        console.log(`Round ${round.round} on table ${round.table} (status 2) failed refund simulation:`, e);
      }
    }
  }

  // push each round that were not spinned (status=1)
  for (const round of roundsStatus1) {
    try {
      await client.simulateContract({
        address: roulette,
        abi: abi,
        functionName: "refund",
        args: [round.table, round.round],
      });
      data.push({
        to: roulette,
        data: encodeFunctionData({
          abi: abi,
          functionName: "refund",
          args: [round.table, round.round],
        })
      });
      console.log(`Round ${round.round} on table ${round.table} (status 1) passed refund simulation`);
    } catch (e) {
      console.log(`Round ${round.round} on table ${round.table} (status 1) failed refund simulation:`, e);
    }
  }

  if(data.length === 0) {
    return {
      canExec: false,
      message: "No rounds to refund",
    };
  }

  return {
    canExec: true,
    callData: data
  };
});
