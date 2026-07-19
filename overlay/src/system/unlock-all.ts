import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { MAX_STARTER_CANDY_COUNT } from "#constants/game-constants";
import { AbilityAttr } from "#enums/ability-attr";
import { Nature } from "#enums/nature";
import { Passive } from "#enums/passive";
import { Unlockables } from "#enums/unlockables";
import { achvs } from "#system/achv";
import type { GameData } from "#system/game-data";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { vouchers } from "#system/voucher";
import { getEnumValues } from "#utils/enums";

const MAX_STARTER_VALUE_REDUCTION = 2;
const UNLOCKED_VOUCHER_COUNT = 99;

/** Return a bitfield containing every ribbon known by the current upstream revision. */
export function getAllRibbonFlags(): bigint {
  return Object.values(RibbonData)
    .filter((value): value is bigint => typeof value === "bigint")
    .reduce((flags, ribbon) => flags | ribbon, 0n);
}

/**
 * Fill every progression-related unlock in a local save while preserving identity and run history.
 *
 * This is intentionally idempotent so it can be applied both when a save is created and after an
 * existing save is loaded.
 */
export function applyUnlockAllPreset(gameData: GameData, unlockedAt = Date.now()): void {
  const allNatureFlags = getEnumValues(Nature).reduce((flags, nature) => flags | (1 << (nature + 1)), 0);
  const allAbilityFlags = AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
  const allPassiveFlags = Passive.UNLOCKED | Passive.ENABLED;
  const allRibbonFlags = getAllRibbonFlags();

  for (const species of speciesDataRegistry.getAllSpecies()) {
    const dexEntry = gameData.dexData[species.speciesId];
    const fullUnlocks = species.getFullUnlocksData();

    dexEntry.seenAttr = fullUnlocks;
    dexEntry.caughtAttr = fullUnlocks;
    dexEntry.natureAttr = allNatureFlags;
    dexEntry.ivs.fill(31);
    dexEntry.ribbons = new RibbonData(allRibbonFlags);
  }

  const starterSpeciesIds = speciesDataRegistry.getAllStarters();
  for (const speciesId of starterSpeciesIds) {
    const starterEntry = gameData.starterData[speciesId];
    const eggMoveCount = speciesEggMoves[speciesId]?.length ?? 0;

    starterEntry.eggMoves = (1 << eggMoveCount) - 1;
    starterEntry.candyCount = MAX_STARTER_CANDY_COUNT;
    starterEntry.abilityAttr = allAbilityFlags;
    starterEntry.passiveAttr = allPassiveFlags;
    starterEntry.valueReduction = MAX_STARTER_VALUE_REDUCTION;
    starterEntry.classicWinCount = Math.max(starterEntry.classicWinCount, 1);
  }

  for (const unlockable of getEnumValues(Unlockables)) {
    gameData.unlocks[unlockable] = true;
  }

  for (const achievementId of Object.keys(achvs)) {
    gameData.achvUnlocks[achievementId] ??= unlockedAt;
  }

  for (const voucherId of Object.keys(vouchers)) {
    gameData.voucherUnlocks[voucherId] ??= unlockedAt;
  }

  for (const voucherType of Object.keys(gameData.voucherCounts)) {
    const index = Number(voucherType);
    gameData.voucherCounts[index] = Math.max(gameData.voucherCounts[index], UNLOCKED_VOUCHER_COUNT);
  }

  gameData.gameStats.ribbonsOwned = starterSpeciesIds.length;
}
