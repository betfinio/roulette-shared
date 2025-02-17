// This is a Web3 Function for Gelato that acts as a fallback mechanism for VRF (Verifiable Random Function) requests.
// Here's what the code does:

// 1. Imports and Constants
import type { Log } from "@ethersproject/providers";
import {
  Web3Function,
  type Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { BigNumber, Contract, ethers, utils } from "ethers";
import { getNextRandomness, getRoundTime } from "../drand/util";
import GelatoVRFConsumerBaseAbi from "./abis/GelatoVRFConsumerBase.json";
import Multicall3Abi from "./abis/Multicall3.json";
import { type Address, createPublicClient, http } from "viem";
import { polygon } from "viem/chains";

// Constants to control request processing limits
const MAX_FILTER_RANGE = 5000; // Maximum block range when querying logs
const MAX_FILTER_REQUESTS = 5; // Maximum number of log queries per execution
const MAX_MULTICALL_REQUESTS = 100; // Maximum number of requests to check in one multicall
const REQUEST_AGE = 60; // Time in seconds before a request is eligible for fallback

// 2. Main Function
Web3Function.onRun(async (context: Web3FunctionContext) => {
  // Setup: Initialize provider, contracts and get user arguments
  const { userArgs, gelatoArgs, multiChainProvider, storage, secrets } = context;
  const provider = multiChainProvider.default();
  const consumerAddress = userArgs.consumerAddress as string;
  const consumer = new Contract(
    consumerAddress,
    GelatoVRFConsumerBaseAbi,
    provider
  );

  // Initialize multicall contract (used for batch checking request status)
  const multicall3Address =
    gelatoArgs.chainId === 324 // zksync
      ? "0xF9cda624FBC7e059355ce98a31693d299FACd963"
      : "0xcA11bde05977b3631167028862bE2a173976CA11";
  const multicall = new Contract(multicall3Address, Multicall3Abi, provider);

  // Calculate current block with delay to avoid processing too recent requests
  const blockTipDelay =
    gelatoArgs.chainId === 1
      ? 5 // (~60 seconds on ethereum)
      : 20; // (~60 seconds for chain averaging 3s block time)
  const currentBlock = (await provider.getBlockNumber()) - blockTipDelay;

  // 3. Fetch Historical Requests
  const logs: Log[] = [];
  let lastBlock = Number(
    (await storage.get("lastBlock")) ?? userArgs.fromBlock ?? currentBlock
  );
  let nbRequests = 0;

  // Fetch logs in chunks to avoid RPC limitations
  while (lastBlock < currentBlock && nbRequests < MAX_FILTER_REQUESTS) {
    nbRequests++;
    const fromBlock = lastBlock + 1;
    const toBlock = Math.min(lastBlock + MAX_FILTER_RANGE, currentBlock);
    const topics = [consumer.interface.getEventTopic("RequestedRandomness")];

    try {
      const eventFilter = {
        address: consumer.address,
        topics,
        fromBlock,
        toBlock,
      };

      const result = await provider.getLogs(eventFilter);
      console.log(
        `Found ${result.length} request within blocks ${fromBlock}-${toBlock}.`
      );

      logs.push(...result);
      lastBlock = toBlock;
    } catch (error) {
      return {
        canExec: false,
        message: `Fail to getLogs ${fromBlock}-${toBlock}: ${(error as Error).message
          }.`,
      };
    }
  }

  // 4. Process Requests
  // Load existing requests from storage
  let requests: { h: string; t: number; i: number; r: string, tx: string, round: string, requestedHash: string }[] = JSON.parse(
    (await storage.get("requests")) ?? "[]"
  );

  // Parse new requests from logs
  for (const log of logs) {
    const [round, consumerData] = consumer.interface.decodeEventLog(
      "RequestedRandomness",
      log.data
    ) as [BigNumber, string];

    const decoded = utils.defaultAbiCoder.decode(
      ["uint256", "bytes"],
      consumerData
    );
    const requestId: BigNumber = decoded[0];
    const timestamp = Math.floor(getRoundTime(round.toNumber()) / 1000);

    const dataWithRound = utils.keccak256(utils.defaultAbiCoder.encode(["uint256", "bytes"], [round, consumerData]));

    requests.push({
      h: log.blockHash,
      tx: log.transactionHash,
      t: timestamp,
      i: log.logIndex,
      r: requestId.toString(),
      round: round.toString(),
      requestedHash: dataWithRound
    });
  }

  // 5. Filter Out Fulfilled Requests
  const multicallRequests = requests.slice(0, MAX_MULTICALL_REQUESTS);
  const multicallData = multicallRequests.map(({ r }) => {
    return {
      target: consumer.address,
      callData: consumer.interface.encodeFunctionData("requestPending", [r]),
    };
  });


  const { returnData } = (await multicall.callStatic.aggregate(
    multicallData
  )) as { blockNumber: BigNumber; returnData: string[] };
  requests = requests.filter((_, index) => {
    if (index >= MAX_MULTICALL_REQUESTS) return true;
    const isRequestPending = !!Number(returnData[index]);
    return isRequestPending;
  });

  // filter out invalid hash requests
  const zeroHashRequests = requests.slice(0, MAX_MULTICALL_REQUESTS)
  const zeroHashRequestsData = zeroHashRequests.map(({ r }) => {
    return {
      target: consumer.address,
      callData: consumer.interface.encodeFunctionData("requestedHash", [r]),
    };
  });

  const { returnData: zeroHashReturnData } = (await multicall.callStatic.aggregate(
    zeroHashRequestsData
  )) as { blockNumber: BigNumber; returnData: string[] };
  requests = requests.filter((_, index) => {
    if (index >= MAX_MULTICALL_REQUESTS) return true;
    const isValidHash = zeroHashReturnData[index] === requests[index].requestedHash;
    return isValidHash;
  });

  await storage.set("requests", JSON.stringify(requests));
  await storage.set("lastBlock", lastBlock.toString());

  console.log(`${requests.length} pending requests.`);

  // 6. Filter Out Recent Requests
  requests = requests.filter((req) => {
    const now = Math.floor(Date.now() / 1000);
    return now > req.t + REQUEST_AGE;
  });
  console.log(`${requests.length} overdue pending requests.`);

  if (requests.length === 0) {
    return {
      canExec: false,
      message: `All VRF requests before block ${lastBlock} were fulfilled.`,
    };
  }

  // 7. Process Random Request
  const randomRequestIndex = Math.floor(
    Math.random() * Math.min(MAX_MULTICALL_REQUESTS, requests.length)
  );
  const requestToFulfill = requests[randomRequestIndex];

  // Verify request still exists
  const logsToProcess = await provider.getLogs({
    address: consumerAddress,
    blockHash: requestToFulfill.h,
  });

  const logToProcess = logsToProcess.find(
    (l) => l.logIndex === requestToFulfill.i
  );

  if (logsToProcess.length === 0 || !logToProcess) {
    requests.splice(randomRequestIndex, 1);
    await storage.set("requests", JSON.stringify(requests));

    return {
      canExec: false,
      message: `Request no longer valid ${JSON.stringify(requestToFulfill)}.`,
    };
  }

  // 8. Generate and Return Randomness
  const [round, consumerData] = consumer.interface.decodeEventLog(
    "RequestedRandomness",
    logToProcess.data
  ) as [BigNumber, string];

  const { randomness } = await getNextRandomness(round.toNumber());
  const encodedRandomness = BigNumber.from(`0x${randomness}`);

  const consumerDataWithRound = utils.defaultAbiCoder.encode(
    ["uint256", "bytes"],
    [round, consumerData]
  );

  // Return calldata to fulfill the random request
  const client = createPublicClient({
    chain: polygon,
    transport: http(await secrets.get("RPC_URL")),
  });
  try {
    // simuate fulfill
    await client.simulateContract({
      address: consumerAddress as Address,
      abi: GelatoVRFConsumerBaseAbi,
      functionName: "fulfillRandomness",
      args: [encodedRandomness, consumerDataWithRound],
      account: '0x159aaab49593bc5d6299bf535fbb009196efd729'
    });
  } catch (error) {
    return {
      canExec: false,
      message: `Failed to simulate fulfillRandomness: ${JSON.stringify(error)}`,
    };
  }
  return {
    canExec: true,
    callData: [
      {
        to: consumerAddress,
        data: consumer.interface.encodeFunctionData("fulfillRandomness", [
          encodedRandomness,
          consumerDataWithRound,
        ]),
      },
    ],
  };
});