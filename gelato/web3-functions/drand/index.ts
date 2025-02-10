import * as ethers from "ethers";
import { Contract } from "ethers";
import { type Address, createPublicClient, http, parseAbi } from "viem";

import {
  Web3Function,
  type Web3FunctionEventContext,
} from "@gelatonetwork/web3-functions-sdk";
import { getNextRandomness } from "./util";
import { polygon, polygonAmoy } from "viem/chains";

// contract abis
const CONSUMER_ABI = [
  "event RequestedRandomness(uint256 round, bytes data)",
  "function fulfillRandomness(uint256 randomness, bytes calldata data) external",
];

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  const { userArgs, multiChainProvider, log, secrets, gelatoArgs } = context;

  const provider = multiChainProvider.default();

  const publicClient = createPublicClient({
    chain: gelatoArgs.chainId === 80002 ? polygonAmoy : polygon,
    transport: http(await secrets.get("RPC_URL")),
  });

  const consumerAddress = userArgs.consumerAddress as string;
  const consumer = new Contract(consumerAddress, CONSUMER_ABI, provider);

  const event = consumer.interface.parseLog(log);
  const [round, consumerData] = event.args;

  const { randomness } = await getNextRandomness(Number(round));
  const encodedRandomness = ethers.BigNumber.from(`0x${randomness}`);

  const consumerDataWithRound = ethers.utils.defaultAbiCoder.encode(
    ["uint256", "bytes"],
    [round, consumerData]
  );

  const data = consumer.interface.encodeFunctionData("fulfillRandomness", [
    encodedRandomness,
    consumerDataWithRound,
  ]);
  try {

    await publicClient.simulateContract({
      address: consumerAddress as Address,
      abi: parseAbi(CONSUMER_ABI),
      functionName: "fulfillRandomness",
      args: [encodedRandomness, consumerDataWithRound],
      account: '0x159aaab49593bc5d6299bf535fbb009196efd729' as Address,
    });
    console.log('ok');
  } catch (e) {
    console.log('error');
    console.log(JSON.stringify(e));
  }

  return {
    canExec: true,
    callData: [{ to: consumerAddress, data }],
  };
});