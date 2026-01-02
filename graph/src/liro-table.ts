// biome-ignore lint/suspicious/noShadowRestrictedNames: BigInt is a reserved word
// biome-ignore lint/style/useImportType: not supported
import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
// biome-ignore lint/style/useImportType: not supported
import { LiroBetABI, LiroBetABI__getBetsResult } from "../generated/LiveRoulette/LiroBetABI";
// biome-ignore lint/style/useImportType: not supported
import { BetEnded as BetEndedEvent, BetPlaced as BetPlacedEvent } from "../generated/LiveRoulette/TableABI";
import { Bet, BetEnded, Chip, PlayerRoundBetPlaceds, PlayerRoundSingleBetPlaceds, Round, RoundBetPlaceds, Table } from "../generated/schema";
import { handleRouletteNumberRolled, handleRouletteStats } from "./liro-stat";

// Constants
const PENDING_WIN_AMOUNT = BigInt.fromI32(-1);
const DEFAULT_WIN_NUMBER = BigInt.fromI32(42);
const ROUND_STATUS_PENDING = BigInt.fromI32(1);
const ROUND_STATUS_COMPLETED = BigInt.fromI32(3);

/**
 * Handles the BetEnded event by updating all relevant entities with win amounts and status
 */
export function handleBetEnded(event: BetEndedEvent): void {
  // Create and save BetEnded entity
  const betEndedEntity = new BetEnded(event.params.bet);
  betEndedEntity.transactionHash = event.transaction.hash;
  betEndedEntity.bet = event.params.bet;
  betEndedEntity.save();

  // Get bet details from contract
  const betContract = LiroBetABI.bind(event.params.bet);
  const playerAddress = betContract.getPlayer();
  const betStatus = betContract.getStatus();
  const tableAddress = betContract.getTable();
  const roundNumber = event.params.round.toI32();

  // Update single bet placement
  updateSingleBetPlacement(event, roundNumber, playerAddress, betStatus);

  // Update player's round bet placements
  updatePlayerRoundBetPlacements(event, tableAddress, roundNumber, playerAddress, betStatus);

  // Update round bet placements
  updateRoundBetPlacements(event, tableAddress, roundNumber, betStatus);

  // Handle roulette statistics
  handleRouletteNumberRolled(event);
  handleRouletteStats(event);

  // Update bet entity
  updateBetEntity(event, betStatus);

  // Update round entity if not single player
  if (event.params.round !== BigInt.fromI32(0)) {
    updateRoundEntity(event, tableAddress);
  }
}

/**
 * Updates the single bet placement entity with win amount and status
 */
function updateSingleBetPlacement(
  event: BetEndedEvent,
  roundNumber: i32,
  playerAddress: Address,
  betStatus: BigInt
): void {
  const singleBetId = event.address.concatI32(roundNumber).concat(playerAddress).concat(event.params.bet);
  const singleBet = PlayerRoundSingleBetPlaceds.load(singleBetId);

  if (singleBet !== null) {
    singleBet.status = betStatus;
    singleBet.winAmount = event.params.winAmount;
    singleBet.save();
  }
}

/**
 * Updates the player's round bet placements with aggregated win amounts and status
 */
function updatePlayerRoundBetPlacements(
  event: BetEndedEvent,
  tableAddress: Address,
  roundNumber: i32,
  playerAddress: Address,
  betStatus: BigInt
): void {
  let playerRoundId = tableAddress.concatI32(roundNumber).concat(playerAddress);
  if (roundNumber === 0) {
    playerRoundId = playerRoundId.concat(event.params.bet);
  }

  const playerRound = PlayerRoundBetPlaceds.load(playerRoundId);
  if (playerRound !== null) {
    playerRound.status = betStatus;
    playerRound.winNumber = event.params.value;

    if (playerRound.winAmount !== PENDING_WIN_AMOUNT) {
      playerRound.winAmount = playerRound.winAmount.plus(event.params.winAmount);
    } else {
      playerRound.winAmount = event.params.winAmount;
    }

    playerRound.save();
  }
}

/**
 * Updates the round bet placements with aggregated win amounts and status
 */
function updateRoundBetPlacements(
  event: BetEndedEvent,
  tableAddress: Address,
  roundNumber: i32,
  betStatus: BigInt
): void {
  let roundId = tableAddress.concatI32(roundNumber);
  if (roundNumber === 0) {
    roundId = roundId.concat(event.params.bet);
  }

  const round = RoundBetPlaceds.load(roundId);
  if (round !== null) {
    round.status = betStatus;
    round.winNumber = event.params.value;

    if (round.winAmount !== PENDING_WIN_AMOUNT) {
      round.winAmount = round.winAmount.plus(event.params.winAmount);
    } else {
      round.winAmount = event.params.winAmount;
    }

    round.save();
  }
}

/**
 * Updates the bet entity with win amount and status
 */
function updateBetEntity(event: BetEndedEvent, betStatus: BigInt): void {
  const bet = Bet.load(event.params.bet);
  if (bet !== null) {
    bet.winAmount = event.params.winAmount;
    bet.winNumber = event.params.value;
    bet.status = betStatus;
    bet.save();
  } else {
    // do nothing
  }
}

/**
 * Updates the round entity with total win amount and status
 */
function updateRoundEntity(event: BetEndedEvent, tableAddress: Address): void {
  const round = getOrCreateRound(tableAddress, event.params.round);
  round.totalWinAmount = round.totalWinAmount.plus(event.params.winAmount);
  round.winNumber = event.params.value;
  round.status = ROUND_STATUS_COMPLETED;
  round.save();
}

/**
 * Handles the BetPlaced event by creating and updating all relevant entities
 */
export function handleBetPlaced(event: BetPlacedEvent): void {
  const betContract = LiroBetABI.bind(event.params.bet);
  
  const roundNumber = event.params.round.toI32(); // event.params.round
  const playerAddress = betContract.getPlayer(); // NewBet event from TP(topic2), NEW BET Signature: 0xdc5bd605828c52e0f2371245383c1d4d49c0f35f93c95370583ad576276a00c1
  const betAmount = betContract.getAmount(); //  Transfer event from TP, PLAYER -> ROULEETTE ADDRESS( warning first transfer)
  const tableAddress = betContract.getTable();// event.address
  const betStatus = betContract.getStatus(); // 1
  const betDetails = betContract.getBets(); // 

  // Create single bet placement
  createSingleBetPlacement(event, roundNumber, playerAddress, betAmount, tableAddress, betStatus, betDetails);

  // Create or update player's round bet placements
  createOrUpdatePlayerRoundBetPlacements(event, roundNumber, playerAddress, betAmount, tableAddress, betStatus);

  // Create or update round bet placements
  createOrUpdateRoundBetPlacements(event, roundNumber, playerAddress, betAmount, tableAddress, betStatus, betDetails);

  // Create bet entity
  createBetEntity(event, betAmount, betStatus, playerAddress, betDetails, tableAddress);

  // Create or update round entity if not single player
  if (event.params.round !== BigInt.fromI32(0)) {
    createOrUpdateRoundEntity(event, tableAddress, betAmount);
  }
}

/**
 * Creates a new single bet placement entity
 */
function createSingleBetPlacement(
  event: BetPlacedEvent,
  roundNumber: i32,
  playerAddress: Address,
  betAmount: BigInt,
  tableAddress: Address,
  betStatus: BigInt,
  betDetails: LiroBetABI__getBetsResult
): void {
  const singleBetId = event.address.concatI32(roundNumber).concat(playerAddress).concat(event.params.bet);
  const singleBet = new PlayerRoundSingleBetPlaceds(singleBetId);

  singleBet.player = playerAddress;
  singleBet.bet = event.params.bet;
  singleBet.blockTimestamp = event.block.timestamp;
  singleBet.blockNumber = event.block.number;
  singleBet.round = event.params.round;
  singleBet.amount = betAmount;
  singleBet.winAmount = PENDING_WIN_AMOUNT;
  singleBet.table = tableAddress;
  singleBet.status = betStatus;
  singleBet.chips = createChips(betDetails, event.params.bet, playerAddress);

  singleBet.save();
}

/**
 * Creates or updates player's round bet placements
 */
function createOrUpdatePlayerRoundBetPlacements(
  event: BetPlacedEvent,
  roundNumber: i32,
  playerAddress: Address,
  betAmount: BigInt,
  tableAddress: Address,
  betStatus: BigInt
): void {
  let playerRoundId = event.address.concatI32(roundNumber).concat(playerAddress);
  if (roundNumber === 0) {
    playerRoundId = playerRoundId.concat(event.params.bet);
  }

  let playerRound = PlayerRoundBetPlaceds.load(playerRoundId);
  if (playerRound === null) {
    playerRound = new PlayerRoundBetPlaceds(playerRoundId);
    playerRound.player = playerAddress;
    playerRound.bet = event.params.bet;
    playerRound.betsCount = BigInt.fromI32(1);
    playerRound.round = event.params.round;
    playerRound.amount = betAmount;
    playerRound.winAmount = PENDING_WIN_AMOUNT;
    playerRound.table = tableAddress;
    playerRound.blockNumber = event.block.number;
    playerRound.blockTimestamp = event.block.timestamp;
    playerRound.status = betStatus;
  } else {
    playerRound.amount = playerRound.amount.plus(betAmount);
    playerRound.betsCount = playerRound.betsCount.plus(BigInt.fromI32(1));
  }

  playerRound.save();
}

/**
 * Creates or updates round bet placements
 */
function createOrUpdateRoundBetPlacements(
  event: BetPlacedEvent,
  roundNumber: i32,
  playerAddress: Address,
  betAmount: BigInt,
  tableAddress: Address,
  betStatus: BigInt,
  betDetails: LiroBetABI__getBetsResult
): void {
  let roundId = event.address.concatI32(roundNumber);
  if (roundNumber === 0) {
    roundId = roundId.concat(event.params.bet);
  }

  let round = RoundBetPlaceds.load(roundId);
  if (round === null) {
    round = new RoundBetPlaceds(roundId);
    round.bet = event.params.bet;
    round.betsCount = BigInt.fromI32(1);
    round.player = playerAddress;
    round.round = event.params.round;
    round.amount = betAmount;
    round.winAmount = PENDING_WIN_AMOUNT;
    round.table = tableAddress;
    round.blockNumber = event.block.number;
    round.blockTimestamp = event.block.timestamp;
    round.status = betStatus;
    round.chips = createChips(betDetails, event.params.bet, playerAddress);
  } else {
    round.amount = round.amount.plus(betAmount);
    round.betsCount = round.betsCount.plus(BigInt.fromI32(1));
    round.chips = round.chips.concat(createChips(betDetails, event.params.bet, playerAddress));
  }

  round.save();
}

/**
 * Creates a new bet entity
 */
function createBetEntity(
  event: BetPlacedEvent,
  betAmount: BigInt,
  betStatus: BigInt,
  playerAddress: Address,
  betDetails: LiroBetABI__getBetsResult,
  tableAddress: Address
): void {
  const bet = new Bet(event.params.bet);
  bet.amount = betAmount;
  bet.winAmount = BigInt.fromI32(0);
  bet.winNumber = DEFAULT_WIN_NUMBER;
  bet.status = betStatus;
  bet.player = playerAddress;
  bet.chips = createChips(betDetails, event.params.bet, playerAddress);
  bet.table = event.address;
  bet.round = event.params.round;
  bet.save();
}

/**
 * Creates or updates round entity
 */
function createOrUpdateRoundEntity(
  event: BetPlacedEvent,
  tableAddress: Address,
  betAmount: BigInt
): void {
  const round = getOrCreateRound(tableAddress, event.params.round);
  round.totalBetAmount = round.totalBetAmount.plus(betAmount);
  round.bets.push(event.params.bet);
  round.save();
}

/**
 * Creates chip entities for a bet and returns their IDs
 */
function createChips(bets: LiroBetABI__getBetsResult, betAddress: Address, player: Address): Array<Bytes> {
  const chipIds = new Array<Bytes>();
  const amounts = bets.getAmounts();
  const bitmaps = bets.getBitmaps();

  for (let i = 0; i < amounts.length; i++) {
    const chipId = betAddress.concatI32(i);
    const chip = new Chip(chipId);
    chip.amount = amounts[i];
    chip.bitMap = bitmaps[i];
    chip.player = player;
    chip.save();
    chipIds.push(chipId);
  }

  return chipIds;
}

/**
 * Gets an existing round or creates a new one
 */
export function getOrCreateRound(tableAddress: Address, roundId: BigInt): Round {
  const roundEntityId = tableAddress.concatI32(roundId.toI32());
  let round = Round.load(roundEntityId);

  if (round === null) {
    const table = Table.load(tableAddress);
    if (table === null) {
      throw new Error(`Table ${tableAddress.toHexString()} not found`);
    }

    round = new Round(roundEntityId);
    round.table = tableAddress;
    round.round = roundId;
    round.winNumber = DEFAULT_WIN_NUMBER;
    round.status = ROUND_STATUS_PENDING;
    round.started = calculateRoundStartTime(table, roundId);
    round.totalBetAmount = BigInt.fromI32(0);
    round.totalWinAmount = BigInt.fromI32(0);
    round.bets = [];
    round.save();
  }

  return round;
}

/**
 * Calculates the start time for a round based on table interval
 */
function calculateRoundStartTime(table: Table, roundId: BigInt): BigInt {
  return table.interval.times(roundId);
}

