import { LiveRouletteABI, TableCreated as TableCreatedEvent } from "../generated/LiveRoulette/LiveRouletteABI";
import { Table } from "../generated/schema";
import { TableTemplate } from "../generated/templates";
import { Address, BigInt, dataSource, ethereum } from "@graphprotocol/graph-ts";


export function handleMultiplePlayersTableCreated(event: TableCreatedEvent): void {
  let entity = new Table(
    event.transaction.hash.concatI32(event.logIndex.toI32())
  );
  
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
  let entity = new Table(
    block.hash.concatI32(block.number.toI32())
  );
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
