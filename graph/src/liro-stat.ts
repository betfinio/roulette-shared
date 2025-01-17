import { Address, BigDecimal, BigInt, Bytes, dataSource, log } from "@graphprotocol/graph-ts";
import { BetEnded as BetEndedEvent } from "../generated/LiveRoulette/TableABI";
import { LiroBetABI } from "../generated/LiveRoulette/LiroBetABI";
import { RouletteNumber, RouletteStats, UniqueTableRounds } from "../generated/schema";

const ZERO_ADDRESS = Address.zero();

export function handleRouletteNumberRolled(event: BetEndedEvent): void {
  const context = dataSource.context();
  const singlePlayerAddress = context.getBytes("singleRouletteTableAddress");
  const bet = LiroBetABI.bind(event.params.bet);
  const player = bet.getPlayer();
  
  let rolledNumber = event.params.value;
  // Create a unique entity ID for the roulette number + table address
  let entityId: Bytes = event.address.concatI32(rolledNumber.toI32());
  
  if (singlePlayerAddress == event.address) {
    entityId = entityId.concat(player);
  }
  
  if (singlePlayerAddress != event.address) {
    const uniqueRoundId = entityId.concatI32(event.params.round.toI32());
    const isUniqueRound = UniqueTableRounds.load(uniqueRoundId);
    if (isUniqueRound != null) {
      return;
    }
    
    const uniqueTableRounds = new UniqueTableRounds(uniqueRoundId);
    uniqueTableRounds.table = event.address;
    uniqueTableRounds.round = event.params.round;
    uniqueTableRounds.save();
  }
  
  // Load existing entity or create a new one
  let rouletteNumber = RouletteNumber.load(entityId);
  if (rouletteNumber == null) {
    rouletteNumber = new RouletteNumber(entityId);
    rouletteNumber.number = rolledNumber.toI32();
    rouletteNumber.lastUpdated = event.block.timestamp;
    rouletteNumber.count = BigInt.fromI32(1); // Initialize count to 1
    // Initial score can be set based on initial count and max recency bonus
    
    rouletteNumber.score = BigDecimal.fromString("1." + event.block.timestamp.toString());
    rouletteNumber.table = event.address;
    
    if (singlePlayerAddress == event.address) {
      rouletteNumber.player = player;
    } else {
      rouletteNumber.player = ZERO_ADDRESS;
    }
    
    rouletteNumber.save();
    return;
  }
  
  
  // Update count and lastUpdated
  rouletteNumber.count = rouletteNumber.count.plus(BigInt.fromI32(1));
  rouletteNumber.lastUpdated = event.block.timestamp;
  let countDecimal = rouletteNumber.count.toBigDecimal();
  // Update the score
  rouletteNumber.score = countDecimal.plus(BigDecimal.fromString("0." + event.block.timestamp.toString()));
  // Save the updated entity
  rouletteNumber.save();
  
}

export function handleRouletteStats(event: BetEndedEvent): void {
  
  
  const context = dataSource.context();
  const singlePlayerAddress = context.getBytes("singleRouletteTableAddress");
  const bet = LiroBetABI.bind(event.params.bet);
  const player = bet.getPlayer();
  
  // Create a unique entity ID for the roulette number + table address
  let entityId: Bytes = event.address;
  
  if (singlePlayerAddress == event.address) {
    
    entityId = entityId.concat(player);
  }
  
  if (singlePlayerAddress != event.address) {
    const uniqueRoundId = entityId.concatI32(event.params.round.toI32());
    const isUniqueRound = UniqueTableRounds.load(uniqueRoundId);
    if (isUniqueRound != null) {
      return;
    }
    
    
    const uniqueTableRounds = new UniqueTableRounds(uniqueRoundId);
    uniqueTableRounds.table = event.address;
    uniqueTableRounds.round = event.params.round;
    uniqueTableRounds.save();
  }
  
  
  // Load existing entity or create a new one
  let rouletteStats = RouletteStats.load(entityId);
  
  if (rouletteStats == null) {
    rouletteStats = new RouletteStats(entityId);
    rouletteStats.table = event.address;
    
    if (singlePlayerAddress == event.address) {
      rouletteStats.player = player;
    } else {
      rouletteStats.player = ZERO_ADDRESS;
    }
    
    rouletteStats.totalRolls = BigInt.fromI32(0);
    rouletteStats.oddCount = BigInt.fromI32(0);
    rouletteStats.evenCount = BigInt.fromI32(0);
    rouletteStats.redCount = BigInt.fromI32(0);
    rouletteStats.blackCount = BigInt.fromI32(0);
    rouletteStats.zeroCount = BigInt.fromI32(0);
  }
  
  rouletteStats.totalRolls = rouletteStats.totalRolls.plus(BigInt.fromI32(1));
  
  const rolledNumber = event.params.value.toI32();
  let isZero = rolledNumber == 0;
  let isEven = rolledNumber != 0 && rolledNumber % 2 == 0;
  let isOdd = rolledNumber != 0 && rolledNumber % 2 == 1;
  let color = getColor(rolledNumber);
  
  // Update counts based on the rolled number
  if (isZero) {
    rouletteStats.zeroCount = rouletteStats.zeroCount.plus(BigInt.fromI32(1));
  } else {
    if (isOdd) {
      rouletteStats.oddCount = rouletteStats.oddCount.plus(BigInt.fromI32(1));
    }
    if (isEven) {
      rouletteStats.evenCount = rouletteStats.evenCount.plus(BigInt.fromI32(1));
    }
    if (color == "Red") {
      rouletteStats.redCount = rouletteStats.redCount.plus(BigInt.fromI32(1));
    } else if (color == "Black") {
      rouletteStats.blackCount = rouletteStats.blackCount.plus(BigInt.fromI32(1));
    }
    
  }
  
  rouletteStats.save();
  
  
}

function getColor(number: i32): string {
  
  
  let redNumbers = [
    1, 3, 5, 7, 9, 12, 14, 16, 18,
    19, 21, 23, 25, 27, 30, 32, 34, 36
  ];
  let blackNumbers = [
    2, 4, 6, 8, 10, 11, 13, 15, 17,
    20, 22, 24, 26, 28, 29, 31, 33, 35
  ];
  
  if (number == 0) {
    return "Green";
  } else if (redNumbers.includes(number)) {
    return "Red";
  } else if (blackNumbers.includes(number)) {
    return "Black";
  } else {
    log.warning("Unknown color for number {}", [number.toString()]);
    return "Unknown";
  }
}