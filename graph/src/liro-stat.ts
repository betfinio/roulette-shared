// biome-ignore lint/style/useImportType: not supported
// biome-ignore lint/suspicious/noShadowRestrictedNames: BigInt is a reserved word
import { Address, BigDecimal, BigInt, Bytes, dataSource, log } from "@graphprotocol/graph-ts";
// biome-ignore lint/style/useImportType: not supported
import { BetEnded as BetEndedEvent } from "../generated/LiveRoulette/TableABI";
import { LiroBetABI } from "../generated/LiveRoulette/LiroBetABI";
import { RouletteNumber, RouletteStats, UniqueTableRounds } from "../generated/schema";

// Constants
const ZERO_ADDRESS = Address.zero();
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

/**
 * Handles the roulette number rolled event by updating statistics for the rolled number
 * @param event The BetEnded event containing the rolled number and bet information
 */
export function handleRouletteNumberRolled(event: BetEndedEvent): void {
  const context = dataSource.context();
  const singlePlayerAddress = context.getBytes("singleRouletteTableAddress");
  const bet = LiroBetABI.bind(event.params.bet);
  const player = bet.getPlayer();

  const rolledNumber = event.params.value;
  const entityId = generateEntityId(event.address, rolledNumber, singlePlayerAddress, player);

  // Check for unique round if not single player table
  if (!singlePlayerAddress.equals(event.address) && !isUniqueRound(event.address, event.params.round)) {
    return;
  }

  updateRouletteNumber(entityId, rolledNumber, event);
}

/**
 * Handles the roulette statistics update when a bet ends
 * @param event The BetEnded event containing the bet information
 */
export function handleRouletteStats(event: BetEndedEvent): void {
  const context = dataSource.context();
  const singlePlayerAddress = context.getBytes("singleRouletteTableAddress");
  const bet = LiroBetABI.bind(event.params.bet);
  const player = bet.getPlayer();

  const entityId = generateStatsEntityId(event.address, singlePlayerAddress, player);

  // Check for unique round if not single player table
  if (!singlePlayerAddress.equals(event.address) && !isUniqueRound(event.address, event.params.round)) {
    return;
  }

  updateRouletteStats(entityId, event);
}

/**
 * Generates a unique entity ID for roulette number tracking
 */
function generateEntityId(
  tableAddress: Address,
  rolledNumber: BigInt,
  singlePlayerAddress: Bytes,
  player: Address
): Bytes {
  let entityId = tableAddress.concatI32(rolledNumber.toI32());
  if (singlePlayerAddress.equals(tableAddress)) {
    entityId = entityId.concat(player);
  }
  return entityId;
}

/**
 * Generates a unique entity ID for roulette statistics
 */
function generateStatsEntityId(
  tableAddress: Bytes,
  singlePlayerAddress: Bytes,
  player: Bytes
): Bytes {
  let entityId = tableAddress;
  if (singlePlayerAddress.equals(tableAddress)) {
    entityId = entityId.concat(player);
  }
  return entityId;
}

/**
 * Checks if a round is unique for a table
 */
function isUniqueRound(tableAddress: Address, round: BigInt): boolean {
  const uniqueRoundId = tableAddress.concatI32(round.toI32());
  const isUniqueRound = UniqueTableRounds.load(uniqueRoundId);

  if (isUniqueRound != null) return false;

  const uniqueTableRounds = new UniqueTableRounds(uniqueRoundId);
  uniqueTableRounds.table = tableAddress;
  uniqueTableRounds.round = round;
  uniqueTableRounds.save();

  return true;
}

/**
 * Updates the roulette number entity with new roll information
 */
function updateRouletteNumber(entityId: Bytes, rolledNumber: BigInt, event: BetEndedEvent): void {
  let rouletteNumber = RouletteNumber.load(entityId);

  if (rouletteNumber == null) {
    rouletteNumber = new RouletteNumber(entityId);
    rouletteNumber.number = rolledNumber.toI32();
    rouletteNumber.lastUpdated = event.block.timestamp;
    rouletteNumber.count = BigInt.fromI32(1);
    rouletteNumber.score = BigDecimal.fromString(`1.${event.block.timestamp.toString()}`);
    rouletteNumber.table = event.address;
    rouletteNumber.player = event.address.equals(dataSource.context().getBytes("singleRouletteTableAddress"))
      ? LiroBetABI.bind(event.params.bet).getPlayer()
      : ZERO_ADDRESS;
  } else {
    rouletteNumber.count = rouletteNumber.count.plus(BigInt.fromI32(1));
    rouletteNumber.lastUpdated = event.block.timestamp;
    rouletteNumber.score = rouletteNumber.count.toBigDecimal().plus(
      BigDecimal.fromString(`0.${event.block.timestamp.toString()}`)
    );
  }

  rouletteNumber.save();
}

/**
 * Updates the roulette statistics entity with new roll information
 */
function updateRouletteStats(entityId: Bytes, event: BetEndedEvent): void {
  let rouletteStats = RouletteStats.load(entityId);

  if (rouletteStats == null) {
    rouletteStats = new RouletteStats(entityId);
    rouletteStats.table = event.address;
    rouletteStats.player = event.address.equals(dataSource.context().getBytes("singleRouletteTableAddress"))
      ? LiroBetABI.bind(event.params.bet).getPlayer()
      : ZERO_ADDRESS;
    rouletteStats.totalRolls = BigInt.fromI32(0);
    rouletteStats.oddCount = BigInt.fromI32(0);
    rouletteStats.evenCount = BigInt.fromI32(0);
    rouletteStats.redCount = BigInt.fromI32(0);
    rouletteStats.blackCount = BigInt.fromI32(0);
    rouletteStats.zeroCount = BigInt.fromI32(0);
  }

  const rolledNumber = event.params.value.toI32();
  const color = getColor(rolledNumber);

  rouletteStats.totalRolls = rouletteStats.totalRolls.plus(BigInt.fromI32(1));

  if (rolledNumber === 0) {
    rouletteStats.zeroCount = rouletteStats.zeroCount.plus(BigInt.fromI32(1));
  } else {
    if (rolledNumber % 2 === 1) {
      rouletteStats.oddCount = rouletteStats.oddCount.plus(BigInt.fromI32(1));
    } else {
      rouletteStats.evenCount = rouletteStats.evenCount.plus(BigInt.fromI32(1));
    }

    if (color === "Red") {
      rouletteStats.redCount = rouletteStats.redCount.plus(BigInt.fromI32(1));
    } else if (color === "Black") {
      rouletteStats.blackCount = rouletteStats.blackCount.plus(BigInt.fromI32(1));
    }
  }

  rouletteStats.save();
}

/**
 * Determines the color of a roulette number
 * @param number The roulette number to check
 * @returns The color of the number (Red, Black, Green, or Unknown)
 */
function getColor(number: i32): string {
  if (number === 0) return "Green";
  if (RED_NUMBERS.includes(number)) return "Red";
  if (BLACK_NUMBERS.includes(number)) return "Black";

  log.warning("Unknown color for number {}", [number.toString()]);
  return "Unknown";
}