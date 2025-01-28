// biome-ignore lint/suspicious/noShadowRestrictedNames: BigInt is a reserved word
// biome-ignore lint/style/useImportType: not supported
import { Address, BigInt, Bytes, log } from "@graphprotocol/graph-ts";
// biome-ignore lint/style/useImportType: not supported
import { LiroBetABI, LiroBetABI__getBetsResult } from "../generated/LiveRoulette/LiroBetABI";
// biome-ignore lint/style/useImportType: not supported
import { BetEnded as BetEndedEvent, BetPlaced as BetPlacedEvent } from "../generated/LiveRoulette/TableABI";
import { Bet, BetEnded, Chip, PlayerRoundBetPlaceds, PlayerRoundSingleBetPlaceds, Round, RoundBetPlaceds, Table} from "../generated/schema";
import { handleRouletteNumberRolled, handleRouletteStats } from "./liro-stat";

export function handleBetEnded(event: BetEndedEvent): void {

  const entity = new BetEnded(event.params.bet);
  entity.transactionHash = event.transaction.hash;
  entity.transactionHash = event.transaction.hash;
  entity.bet = event.params.bet;
  entity.save();

  const bet = LiroBetABI.bind(event.params.bet);
  const round = event.params.round.toI32();
  const playerRoundSingleBetPlacedsId = event.address.concatI32(round).concat(bet.getPlayer()).concat(event.params.bet);
  const playerRoundSingleBetPlaced = PlayerRoundSingleBetPlaceds.load(playerRoundSingleBetPlacedsId);
  if (playerRoundSingleBetPlaced !== null) {
    playerRoundSingleBetPlaced.status = bet.getStatus();
    playerRoundSingleBetPlaced.winAmount = event.params.winAmount;
    playerRoundSingleBetPlaced.save();
  }


  let playerRoundPlacedsId = bet.getTable().concatI32(round).concat(bet.getPlayer());
  if (round === 0) {
    playerRoundPlacedsId = playerRoundPlacedsId.concat(event.params.bet);
  }
  const playerRoundPlaced = PlayerRoundBetPlaceds.load(playerRoundPlacedsId);
  if (playerRoundPlaced !== null) {
    playerRoundPlaced.status = bet.getStatus();

    if (playerRoundPlaced.winAmount !== BigInt.fromI32(-1)) {
      playerRoundPlaced.winAmount = playerRoundPlaced.winAmount.plus(event.params.winAmount);
    } else {
      playerRoundPlaced.winAmount = event.params.winAmount;
    }

    playerRoundPlaced.winNumber = event.params.value;
    playerRoundPlaced.save();
  }
  let roundPlacedsId = bet.getTable().concatI32(round);
  if (round === 0) {
    roundPlacedsId = roundPlacedsId.concat(event.params.bet);
  }
  const roundPlaced = RoundBetPlaceds.load(roundPlacedsId);
  if (roundPlaced !== null) {
    roundPlaced.status = bet.getStatus();

    roundPlaced.winNumber = event.params.value;

    if (roundPlaced.winAmount !== BigInt.fromI32(-1)) {
      roundPlaced.winAmount = roundPlaced.winAmount.plus(event.params.winAmount);
    } else {
      roundPlaced.winAmount = event.params.winAmount;
    }
    roundPlaced.save();
  }

  handleRouletteNumberRolled(event as BetEndedEvent);
  handleRouletteStats(event as BetEndedEvent);

  // new code
  // update bet entity
  const betEntity = Bet.load(event.params.bet);
  if (betEntity !== null) {
    betEntity.winAmount = event.params.winAmount;
    betEntity.winNumber = event.params.value;
    betEntity.status = bet.getStatus();
    betEntity.save();
  } else {
    throw new Error(`Bet ${event.params.bet} not found`);
  }
  // check if table is not single player
  if (event.params.round !== BigInt.fromI32(0)) {
    const roundEntity = getOrCreateRound(event.address, event.params.round);
    roundEntity.totalWinAmount = roundEntity.totalWinAmount.plus(event.params.winAmount);
    roundEntity.winNumber = event.params.value;
    roundEntity.status = BigInt.fromI32(3);
    roundEntity.save();
  }
}

export function handleBetPlaced(event: BetPlacedEvent): void {

  const bet = LiroBetABI.bind(event.params.bet);

  const round = event.params.round.toI32();

  const playerRoundSingleBetPlacedsId = event.address.concatI32(round).concat(bet.getPlayer()).concat(event.params.bet);
  const playerRoundSingleBetPlaced = new PlayerRoundSingleBetPlaceds(playerRoundSingleBetPlacedsId);
  const player = bet.getPlayer();
  playerRoundSingleBetPlaced.player = player;
  playerRoundSingleBetPlaced.bet = event.params.bet;
  playerRoundSingleBetPlaced.blockTimestamp = event.block.timestamp;
  playerRoundSingleBetPlaced.blockNumber = event.block.number;
  playerRoundSingleBetPlaced.round = event.params.round;
  playerRoundSingleBetPlaced.amount = bet.getAmount();
  playerRoundSingleBetPlaced.winAmount = BigInt.fromI32(-1);
  playerRoundSingleBetPlaced.table = bet.getTable();
  playerRoundSingleBetPlaced.status = bet.getStatus();
  playerRoundSingleBetPlaced.chips = createChips(bet.getBets(), event.params.bet, player);

  playerRoundSingleBetPlaced.save();


  let playerRoundPlacedsId = event.address.concatI32(round).concat(bet.getPlayer());
  if (round === 0) {
    playerRoundPlacedsId = playerRoundPlacedsId.concat(event.params.bet);
  }

  let playerRoundPlaced = PlayerRoundBetPlaceds.load(playerRoundPlacedsId);
  if (playerRoundPlaced === null) {
    playerRoundPlaced = new PlayerRoundBetPlaceds(playerRoundPlacedsId);
    playerRoundPlaced.player = bet.getPlayer();
    playerRoundPlaced.bet = event.params.bet;
    playerRoundPlaced.betsCount = BigInt.fromI32(1);
    playerRoundPlaced.round = event.params.round;
    playerRoundPlaced.player = bet.getPlayer();
    playerRoundPlaced.amount = bet.getAmount();
    playerRoundPlaced.winAmount = BigInt.fromI32(-1);
    playerRoundPlaced.table = bet.getTable();
    playerRoundPlaced.blockNumber = event.block.number;
    playerRoundPlaced.blockTimestamp = event.block.timestamp;
    playerRoundPlaced.status = bet.getStatus();
    playerRoundPlaced.save();
  } else {
    playerRoundPlaced.amount = playerRoundPlaced.amount.plus(bet.getAmount());
    playerRoundPlaced.betsCount = playerRoundPlaced.betsCount.plus(BigInt.fromI32(1));
    playerRoundPlaced.save();
  }
  let roundPlacedsId = event.address.concatI32(round);
  if (round === 0) {
    roundPlacedsId = roundPlacedsId.concat(event.params.bet);
  }
  let roundPlaced = RoundBetPlaceds.load(roundPlacedsId);
  if (roundPlaced === null) {
    roundPlaced = new RoundBetPlaceds(roundPlacedsId);
    roundPlaced.bet = event.params.bet;
    roundPlaced.betsCount = BigInt.fromI32(1);
    roundPlaced.player = player;
    roundPlaced.round = event.params.round;
    roundPlaced.amount = bet.getAmount();
    roundPlaced.winAmount = BigInt.fromI32(-1);
    roundPlaced.table = bet.getTable();
    roundPlaced.blockNumber = event.block.number;
    roundPlaced.blockTimestamp = event.block.timestamp;
    roundPlaced.status = bet.getStatus();
    roundPlaced.chips = createChips(bet.getBets(), event.params.bet, player);
    roundPlaced.save();
  } else {
    roundPlaced.amount = roundPlaced.amount.plus(bet.getAmount());
    roundPlaced.betsCount = roundPlaced.betsCount.plus(BigInt.fromI32(1));
    roundPlaced.chips = roundPlaced.chips.concat(createChips(bet.getBets(), event.params.bet, player));

    roundPlaced.save();
  }

  // new code

  // create bet entity
  const betEntity = new Bet(event.params.bet);
  betEntity.amount = bet.getAmount();
  betEntity.winAmount = BigInt.fromI32(0);
  betEntity.winNumber = BigInt.fromI32(42);
  betEntity.status = bet.getStatus();
  betEntity.player = player;
  betEntity.chips = createChips(bet.getBets(), event.params.bet, player);
  betEntity.table = event.address;
  betEntity.round = event.params.round;
  betEntity.save();
  // check if table is not single player
  if (event.params.round !== BigInt.fromI32(0)) {
    // create round entity
    const roundEntity = getOrCreateRound(event.address, event.params.round);
    roundEntity.totalBetAmount = roundEntity.totalBetAmount.plus(bet.getAmount());
    roundEntity.bets.push(betEntity.id);
    roundEntity.save();
  }
}



function createChips(bets: LiroBetABI__getBetsResult, betAddress: Address, player: Address): Array<Bytes> {
  const chipIds = new Array<Bytes>();
  for (let i = 0; i < bets.getAmounts().length; i++) {
    const chipId = betAddress.concatI32(i);
    const chip = new Chip(chipId);
    chip.amount = bets.getAmounts()[i];
    chip.bitMap = bets.getBitmaps()[i];
    chip.player = player;
    chip.save();
    chipIds.push(chipId);
  }
  return chipIds;
}


export function getOrCreateRound(tableAddress: Address, roundId: BigInt): Round {
  const _round = tableAddress.concatI32(roundId.toI32());
  let round = Round.load(_round);
  if (round === null) {
    const table = Table.load(tableAddress);
    if (table === null) {
      throw new Error(`Table ${tableAddress.toHexString()} not found`);
    }
    round = new Round(_round);
    round.table = tableAddress;
    round.round = roundId;
    round.winNumber = BigInt.fromI32(42);
    round.status = BigInt.fromI32(1);
    round.started = getStarted(table, roundId);
    round.totalBetAmount = BigInt.fromI32(0);
    round.totalWinAmount = BigInt.fromI32(0);
    round.bets = [];
    round.save();
  }
  return round;
}

function getStarted(table: Table, roundId: BigInt): BigInt {
  const started = table.interval.times(roundId);
  return started;
}

