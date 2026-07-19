import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import * as appConstants from "#constants/app-constants";
import { MAX_STARTER_CANDY_COUNT } from "#constants/game-constants";
import { AbilityAttr } from "#enums/ability-attr";
import { Nature } from "#enums/nature";
import { Passive } from "#enums/passive";
import { Unlockables } from "#enums/unlockables";
import { achvs } from "#system/achv";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { applyUnlockAllPreset, getAllRibbonFlags } from "#system/unlock-all";
import { VoucherType, vouchers } from "#system/voucher";
import { GameManager } from "#test/framework/game-manager";
import { getEnumValues } from "#utils/enums";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

describe("System - Unlock All Preset", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("applies automatically when the unlock-all build flag is enabled", () => {
    vi.spyOn(appConstants, "unlockAllBuild", "get").mockReturnValue(true);

    game = new GameManager(phaserGame);

    for (const speciesId of speciesDataRegistry.getAllStarters()) {
      expect(game.scene.gameData.starterData[speciesId].candyCount).toBe(MAX_STARTER_CANDY_COUNT);
    }
  });

  it("unlocks every supported progression flag without replacing existing save data", () => {
    game = new GameManager(phaserGame);
    const gameData = game.scene.gameData;
    const originalTrainerId = 12345;
    gameData.trainerId = originalTrainerId;

    applyUnlockAllPreset(gameData, 1);

    expect(gameData.trainerId).toBe(originalTrainerId);

    const allNatureFlags = getEnumValues(Nature).reduce((flags, nature) => flags | (1 << (nature + 1)), 0);
    const allAbilityFlags = AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
    const allPassiveFlags = Passive.UNLOCKED | Passive.ENABLED;
    const allRibbonFlags = getAllRibbonFlags();

    for (const species of speciesDataRegistry.getAllSpecies()) {
      const dexEntry = gameData.dexData[species.speciesId];
      expect(dexEntry.seenAttr).toBe(species.getFullUnlocksData());
      expect(dexEntry.caughtAttr).toBe(species.getFullUnlocksData());
      expect(dexEntry.natureAttr).toBe(allNatureFlags);
      expect(dexEntry.ivs).toEqual([31, 31, 31, 31, 31, 31]);
      expect(dexEntry.ribbons.getRibbons()).toBe(allRibbonFlags);
    }

    for (const speciesId of speciesDataRegistry.getAllStarters()) {
      const starterEntry = gameData.starterData[speciesId];
      const eggMoveCount = speciesEggMoves[speciesId]?.length ?? 0;
      expect(starterEntry.eggMoves).toBe((1 << eggMoveCount) - 1);
      expect(starterEntry.candyCount).toBe(MAX_STARTER_CANDY_COUNT);
      expect(starterEntry.abilityAttr).toBe(allAbilityFlags);
      expect(starterEntry.passiveAttr).toBe(allPassiveFlags);
      expect(starterEntry.valueReduction).toBe(2);
      expect(starterEntry.classicWinCount).toBeGreaterThanOrEqual(1);
    }

    for (const unlockable of getEnumValues(Unlockables)) {
      expect(gameData.unlocks[unlockable]).toBe(true);
    }

    for (const achievementId of Object.keys(achvs)) {
      expect(gameData.achvUnlocks[achievementId]).toBe(1);
    }
    for (const voucherId of Object.keys(vouchers)) {
      expect(gameData.voucherUnlocks[voucherId]).toBe(1);
    }
    for (const count of Object.values(gameData.voucherCounts)) {
      expect(count).toBeGreaterThan(0);
    }
    expect(gameData.voucherCounts[VoucherType.GOLDEN]).toBeGreaterThan(0);
    expect(gameData.gameStats.ribbonsOwned).toBe(speciesDataRegistry.getAllStarters().length);

    for (const flag of Object.values(RibbonData).filter((value): value is bigint => typeof value === "bigint")) {
      expect(allRibbonFlags & flag).toBe(flag);
    }
  });
});
