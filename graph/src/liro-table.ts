import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import { LiroBetABI, LiroBetABI__getBetsResult } from "../generated/LiveRoulette/LiroBetABI";
import { BetEnded as BetEndedEvent, BetPlaced as BetPlacedEvent } from "../generated/LiveRoulette/TableABI";
import { BetEnded, Chip, PlayerRoundBetPlaceds, PlayerRoundSingleBetPlaceds, RoundBetPlaceds } from "../generated/schema";
import { handleRouletteNumberRolled, handleRouletteStats } from "./liro-stat";

export function handleBetEnded(event: BetEndedEvent): void {
  
  let entity = new BetEnded(event.params.bet);
  entity.transactionHash = event.transaction.hash;
  entity.transactionHash = event.transaction.hash;
  entity.bet = event.params.bet;
  entity.save();
  
  const bet = LiroBetABI.bind(event.params.bet);
  const round = event.params.round.toI32();
  let playerRoundSingleBetPlacedsId = event.address.concatI32(round).concat(bet.getPlayer()).concat(event.params.bet);
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
  let playerRoundPlaced = PlayerRoundBetPlaceds.load(playerRoundPlacedsId);
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
  let roundPlaced = RoundBetPlaceds.load(roundPlacedsId);
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
}

export function handleBetPlaced(event: BetPlacedEvent): void {
  
  const bet = LiroBetABI.bind(event.params.bet);
  
  const round = event.params.round.toI32();
  
  let playerRoundSingleBetPlacedsId = event.address.concatI32(round).concat(bet.getPlayer()).concat(event.params.bet);
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
  
  // return bets.getAmounts().map<Bytes>((amount) => {
  //     const chipId = betAddress.concatI32(1)
  //     const chip = new Chip(chipId);
  //     chip.amount = amount;
  //     chip.bitMap = BigInt.fromI32(-1)
  //     chip.save()
  //     return chipId
  // })
  
  return chipIds;
  
  
}




