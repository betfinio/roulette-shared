// biome-ignore lint/style/useImportType: <explanation>
import { LiveRouletteABI, RefundCall, RefundSingleBetCall, TableCreated as TableCreatedEvent } from "../generated/LiveRoulette/LiveRouletteABI";

// biome-ignore lint/style/useImportType: not supported
import { Requested as RequestedEvent } from "../generated/LiveRoulette/LiveRouletteABI";
import { Bet, Table } from "../generated/schema";
import { TableTemplate } from "../generated/templates";
// biome-ignore lint/suspicious/noShadowRestrictedNames: BigInt is a reserved word
// biome-ignore lint/style/useImportType: <explanation>
import { Address, BigInt, dataSource, ethereum, log } from "@graphprotocol/graph-ts";
import { getOrCreateRound } from "./liro-table";
import { LiroBetABI } from "../generated/LiveRoulette/LiroBetABI";


export function handleMultiplePlayersTableCreated(event: TableCreatedEvent): void {
  const entity = new Table(event.params.table);

  entity.address = event.params.table;
  entity.interval = event.params.interval;
  entity.blockNumber = event.block.number;
  entity.blockTimestamp = event.block.timestamp;
  entity.transactionHash = event.transaction.hash;
  entity.save();

  const singlePlayerAddress = LiveRouletteABI.bind(dataSource.address()).singlePlayerTable();
  const context = dataSource.context();
  context.setBytes("singleRouletteTableAddress", singlePlayerAddress);
  TableTemplate.createWithContext(Address.fromBytes(entity.address), context);
}

export function handleSinglePlayerTableCreated(block: ethereum.Block): void {
  const singlePlayerAddress = LiveRouletteABI.bind(dataSource.address()).singlePlayerTable();
  const entity = new Table(singlePlayerAddress);
  entity.interval = BigInt.zero();
  entity.address = singlePlayerAddress;
  entity.blockNumber = block.number;
  entity.blockTimestamp = block.timestamp;
  entity.transactionHash = block.hash;
  entity.save();

  const context = dataSource.context();
  context.setBytes("singleRouletteTableAddress", singlePlayerAddress);
  TableTemplate.createWithContext(Address.fromBytes(entity.address), context);
}

export function handleRequested(event: RequestedEvent): void {
  if (event.params.round !== BigInt.fromI32(0)) {
    const roundEntity = getOrCreateRound(event.params.table, event.params.round);
    roundEntity.status = BigInt.fromI32(2);
    roundEntity.save();
  }
  log.info("Requested event received for round {}", [event.params.round.toString()]);
}


export function handleRefundMulti(call: RefundCall): void {
  const round = call.inputs._round;
  const table = call.inputs._table;
  const roundEntity = getOrCreateRound(table, round);
  roundEntity.totalWinAmount = BigInt.fromI32(0);
  roundEntity.status = BigInt.fromI32(4);
  roundEntity.save();

  for (let i = 0; i < roundEntity.bets.length; i++) {
    const bet = Bet.load(roundEntity.bets[i]);
    if (bet !== null) {
      bet.status = BigInt.fromI32(3);
      bet.save();
    }
  }
}

export function handleRefundSingle(call: RefundSingleBetCall): void {
  const bet = LiroBetABI.bind(call.inputs._bet);
  const betEntity = Bet.load(call.inputs._bet);
  if (betEntity !== null) {
    betEntity.status = bet.getStatus();
    betEntity.save();
  }
}