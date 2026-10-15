import { HERO_DICT, STAR_DICT } from "@/utils/HeroList";
import { PEACH_TASKS } from "@/utils/PeachTaskIds";
import { XyzwLegionWarWebSocketClient } from '@/utils/xyzwLegionWarWebSocket.js';
import ConnectionPoolManager from '@/utils/connectionPoolManager.js';

/**
 * 开箱、钓鱼、招募类任务
 * 包含: batchOpenBox, batchClaimBoxPointReward, batchFish, batchRecruit
 */

/**
 * 创建物品类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksItem(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    helperSettings,
    delayConfig,
  } = deps;

  const boxNames = {
    2001: "木质宝箱",
    2002: "青铜宝箱",
    2003: "黄金宝箱",
    2004: "铂金宝箱",
  };

  const fishNames = { 1: "普通鱼竿", 2: "黄金鱼竿" };

  const heroIds = Object.keys(HERO_DICT).map(Number);

  /**
   * 批量英雄升星（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchHeroUpgradeForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始英雄升星`,
        type: "info",
      });

      // 获取角色信息
      const roleInfoRes = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        5000
      );
      const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
      const heroes = role.heroes || {};
      const items = role.items || {};

      // 筛选碎片足够升下一星级的武将
      const upgradableHeroes = [];
      for (const [heroIdStr, heroData] of Object.entries(heroes)) {
        const heroId = Number(heroIdStr);
        const currentStar = heroData.star || 0;
        if (currentStar >= 30) continue; // 已满级

        const starInfo = STAR_DICT[currentStar];
        if (!starInfo || starInfo.cost === 0) continue;

        const fragmentCost = starInfo.cost;
        // 碎片itemId与heroId相同
        const fragmentItem = items[heroId];
        const fragmentCount = fragmentItem?.quantity || 0;

        if (fragmentCount >= fragmentCost) {
          upgradableHeroes.push({
            heroId,
            currentStar,
            fragmentCount,
            fragmentCost,
          });
          console.log(`${token.name} 可升星武将: ${HERO_DICT[heroId]?.name || heroId}, 当前星级${currentStar}, 碎片${fragmentCount}, 需要${fragmentCost}`);
        }
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 共${upgradableHeroes.length}个武将可升星`,
        type: "info",
      });

      // 只对碎片足够的武将执行升星
      for (const { heroId, currentStar, fragmentCount, fragmentCost } of upgradableHeroes) {
        if (shouldStop.value) break;

        // 计算最多可升次数
        const maxUpgrades = Math.min(10, Math.floor(fragmentCount / fragmentCost));

        for (let i = 1; i <= maxUpgrades; i++) {
          if (shouldStop.value) break;

          try {
            const res = await tokenStore.sendMessageWithPromise(
              tokenId,
              "hero_heroupgradestar",
              { heroId },
              5000,
            );
            const ok = res && (res.code === 0 || res.success === true || res.result === 0);

            if (ok) {
              logWithPrefix({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${HERO_DICT[heroId]?.name || heroId} 升星成功 (第${i}次)`,
                type: "success",
              });
            } else {
              throw new Error("升星失败");
            }
          } catch (err) {
            break;
          }
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 英雄升星完成`,
        type: "success",
      });

    } catch (error) {
      console.error(error);
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `英雄升星失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 批量英雄升星
   */
  const batchHeroUpgrade = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始英雄升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 获取角色信息
        const roleInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000
        );
        const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
        const heroes = role.heroes || {};
        const items = role.items || {};

        // 筛选碎片足够升下一星级的武将
        const upgradableHeroes = [];
        for (const [heroIdStr, heroData] of Object.entries(heroes)) {
          const heroId = Number(heroIdStr);
          const currentStar = heroData.star || 0;
          if (currentStar >= 30) continue; // 已满级

          const starInfo = STAR_DICT[currentStar];
          if (!starInfo || starInfo.cost === 0) continue;

          const fragmentCost = starInfo.cost;
          // 碎片itemId与heroId相同
          const fragmentItem = items[heroId];
          const fragmentCount = fragmentItem?.quantity || 0;

          if (fragmentCount >= fragmentCost) {
            upgradableHeroes.push({
              heroId,
              currentStar,
              fragmentCount,
              fragmentCost,
            });
            console.log(`${token.name} 可升星武将: ${HERO_DICT[heroId]?.name || heroId}, 当前星级${currentStar}, 碎片${fragmentCount}, 需要${fragmentCost}`);
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 共${upgradableHeroes.length}个武将可升星`,
          type: "info",
        });

        // 只对碎片足够的武将执行升星
        for (const { heroId, currentStar, fragmentCount, fragmentCost } of upgradableHeroes) {
          if (shouldStop.value) break;

          // 计算最多可升次数
          const maxUpgrades = Math.min(10, Math.floor(fragmentCount / fragmentCost));

          for (let i = 1; i <= maxUpgrades; i++) {
            if (shouldStop.value) break;

            try {
              const res = await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_heroupgradestar",
                { heroId },
                5000,
              );
              const ok =
                res &&
                (res.code === 0 || res.success === true || res.result === 0);

              if (ok) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${HERO_DICT[heroId]?.name || heroId} 升星成功 (第${i}次)`,
                  type: "success",
                });
              } else {
                throw new Error("升星失败");
              }
            } catch (err) {
              break;
            }
            await new Promise((r) => setTimeout(r, delayConfig.action));
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 英雄升星完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `英雄升星失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量英雄升星结束");
  };

  /**
   * 批量图鉴升星（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchBookUpgradeForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始图鉴升星`,
        type: "info",
      });

      for (const heroId of heroIds) {
        if (shouldStop.value) break;

        // 每个英雄尝试最多10次图鉴升星
        for (let i = 1; i <= 10; i++) {
          if (shouldStop.value) break;

          try {
            const res = await tokenStore.sendMessageWithPromise(
              tokenId,
              "book_upgrade",
              { heroId },
              5000,
            );
            const ok = res && (res.code === 0 || res.success === true || res.result === 0);

            if (ok) {
              logWithPrefix({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 英雄ID:${heroId} 图鉴升星成功 (第${i}次)`,
                type: "success",
              });
              // 成功了继续尝试下一级
            } else {
              // 失败说明无法继续图鉴升星，跳出循环
              throw new Error("图鉴升星失败");
            }
          } catch (err) {
            // 失败则停止当前英雄的图鉴升星尝试
            break;
          }
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 图鉴升星完成`,
        type: "success",
      });

    } catch (error) {
      console.error(error);
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `图鉴升星失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 批量图鉴升星
   */
  const batchBookUpgrade = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始图鉴升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (const heroId of heroIds) {
          if (shouldStop.value) break;

          // 每个英雄尝试最多10次图鉴升星（只要成功就继续，失败则跳过该英雄）
          for (let i = 1; i <= 10; i++) {
            if (shouldStop.value) break;

            try {
              const res = await tokenStore.sendMessageWithPromise(
                tokenId,
                "book_upgrade",
                { heroId },
                5000,
              );
              const ok =
                res &&
                (res.code === 0 || res.success === true || res.result === 0);

              if (ok) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 英雄ID:${heroId} 图鉴升星成功 (第${i}次)`,
                  type: "success",
                });
                // 成功了继续尝试下一级，直到失败或达到10次
              } else {
                // 失败说明无法继续图鉴升星（碎片不足或满星），跳出循环处理下一个英雄
                throw new Error("图鉴升星失败");
              }
            } catch (err) {
              // 失败则停止当前英雄的图鉴升星尝试
              break;
            }
            await new Promise((r) => setTimeout(r, delayConfig.action));
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 图鉴升星完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `图鉴升星失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量图鉴升星结束");
  };

  /**
   * 批量领取图鉴奖励（单个Token）
   */
  const batchClaimStarRewardsForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始领取图鉴奖励`,
        type: "info",
      });

      // 领取图鉴星星奖励
      const starRewardRes = await tokenStore.sendMessageWithPromise(
        tokenId,
        "book_claimstarreward",
        {},
        5000
      );

      if (starRewardRes?.result === 0) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 图鉴星星奖励领取成功`,
          type: "success",
        });
      } else {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 图鉴星星奖励领取失败: ${starRewardRes?.hint || "未知错误"}`,
          type: "warning",
        });
      }

      // 领取图鉴成就奖励
      const achievementRewardRes = await tokenStore.sendMessageWithPromise(
        tokenId,
        "book_claimachievementreward",
        {},
        5000
      );

      if (achievementRewardRes?.result === 0) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 图鉴成就奖励领取成功`,
          type: "success",
        });
      } else {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 图鉴成就奖励领取失败: ${achievementRewardRes?.hint || "未知错误"}`,
          type: "warning",
        });
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 图鉴奖励领取完成`,
        type: "success",
      });

    } catch (error) {
      console.error(error);
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `图鉴奖励领取失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 批量领取图鉴奖励
   */
  const batchClaimStarRewards = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 顺序执行：执行完一个token所有任务后，再执行下一个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取图鉴奖励: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 1; i <= 10; i++) {
          if (shouldStop.value) break;
          try {
            const res = await tokenStore.sendMessageWithPromise(
              tokenId,
              "book_claimpointreward",
              {},
              5000,
            );
            const ok =
              res && (res.code === 0 || res.success === true || res.result === 0);

            if (ok) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取图鉴奖励成功`,
                type: "success",
              });
            } else {
              // 如果领取失败（比如没有奖励可领了），停止尝试
              throw new Error("领取奖励失败");
            }
          } catch (err) {
            // 失败则停止尝试
            break;
          }
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取图鉴奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `领取图鉴奖励失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    }

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取图鉴奖励结束");
  };

  /**
   * 领取宝箱积分
   */
  const batchClaimBoxPointReward = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取宝箱积分: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
          {},
          5000,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱积分领取成功`,
          type: "success",
        });

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `领取失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取宝箱积分结束");
  };

  /**
   * 批量领取蟠桃园任务
   */
  const batchClaimPeachTasks = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取蟠桃园任务奖励: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_getpayloadtask",
          {},
          5000
        );

        const payloadTask = res?.payloadTask || res?.data?.payloadTask;

        if (payloadTask && payloadTask.taskMap) {
          const taskMap = payloadTask.taskMap;
          const tasks = [];
          Object.values(taskMap).forEach((item) => {
            const availableTasks = PEACH_TASKS.filter(
              (t) =>
                t.type === item.typ &&
                item.progress >= t.target &&
                item.claimedProgress < t.target,
            );
            tasks.push(...availableTasks);
          });

          let claimedCount = 0;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 获取到 ${tasks.length} 个任务奖励`,
            type: "info",
          });

          for (const task of tasks) {
            if (shouldStop.value) break;
            // status not reliable or not present, try claim all
            try {
              const claimRes = await tokenStore.sendMessageWithPromise(
                tokenId,
                "legion_claimpayloadtask",
                { taskId: task.id },
                5000
              );
              const ok = claimRes && claimRes.payloadTask;
              if (ok) {
                claimedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取${task.desc}任务奖励成功`,
                  type: "success",
                });
              }

            } catch (err) {
              // ignore
            }
            await new Promise((r) => setTimeout(r, delayConfig.action));
          }

          // Check and claim point rewards (Moved out of loop to ensure execution)
          try {
            const progressMapres = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legion_getpayloadtask",
              {},
              5000
            );
            
            if (progressMapres && progressMapres.payloadTask) {
                const legionPoint = progressMapres.payloadTask.legionPoint || 0;
                const selfPoint = progressMapres.payloadTask.selfPoint || 0;
                // progressMap key might be string or number, handle both safely
                const progressMap = progressMapres.payloadTask.progressMap || {};
                const taskGroupprogressMap = progressMap[1] || progressMap["1"] || 0;
                const selfPointprogressMap = progressMap[2] || progressMap["2"] || 0;

                // Club Rewards - Claim all if progress is greater than claimed progress
                if (legionPoint > taskGroupprogressMap && taskGroupprogressMap < 25) {
                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "legion_claimpayloadtaskprogress",
                      { taskGroup: 1 },
                      5000
                    );
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取俱乐部任务奖励 (当前积分: ${legionPoint})`,
                      type: "success",
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                  } catch (e) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取俱乐部任务奖励失败: ${e.message}`,
                      type: "error",
                    });
                  }
                }

                // Personal Rewards - Claim all if progress is greater than claimed progress
                if (selfPoint > selfPointprogressMap && selfPointprogressMap < 25) {
                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "legion_claimpayloadtaskprogress",
                      { taskGroup: 2 },
                      5000
                    );
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取个人任务奖励 (当前积分: ${selfPoint})`,
                      type: "success",
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                  } catch (e) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取个人任务奖励失败: ${e.message}`,
                      type: "error",
                    });
                  }
                }
            }
          } catch (err) {
             console.error("领取蟠桃园积分奖励异常:", err);
             addLog({
               time: new Date().toLocaleTimeString(),
               message: `${token.name} 领取积分奖励异常: ${err.message}`,
               type: "error",
             });
          }

          if (claimedCount === 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 没有可领取的任务奖励`,
              type: "info",
            });
          }

        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未获取到任务奖励列表`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取蟠桃园任务奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取蟠桃园任务奖励失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取蟠桃园任务奖励结束");
  };

  /**
   * 一键灯神扫荡（单个Token）
   */
  const batchGenieSweepForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    logWithPrefix({
      time: new Date().toLocaleTimeString(),
      message: `${token.name} 开始灯神扫荡`,
      type: "info",
    });

    // 执行3次genie_buysweep命令
    for (let i = 0; i < 3; i++) {
      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          'genie_buysweep',
          {},
          5000
        );
      } catch (error) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} genie_buysweep ${i + 1}/3 失败: ${error.message}`,
          type: "warning",
        });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 获取角色信息，检查灯神免费扫荡是否可用
    const roleInfo = tokenStore.gameData?.roleInfo?.role;
    const statisticsTime = roleInfo?.statisticsTime ?? {};
    
    // 辅助函数：检查今天是否可用
    const isTodayAvailable = (lastClaimTime) => {
      if (!lastClaimTime) return true;
      const lastDate = new Date(lastClaimTime * 1000);
      const today = new Date();
      return lastDate.toDateString() !== today.toDateString();
    };

    // 灯神扫荡 - 循环执行4次，每次使用不同的genieId（1-4），检查是否可用
    const kingdoms = ["魏国", "蜀国", "吴国", "群雄"];
    for (let genieId = 1; genieId <= 4; genieId++) {
      const isAvailable = isTodayAvailable(statisticsTime[`genie:daily:free:${genieId}`]);
      
      if (!isAvailable) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${kingdoms[genieId - 1]}灯神今日已扫荡，跳过`,
          type: "info",
        });
        continue;
      }

      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          'genie_sweep',
          { genieId: genieId, sweepCnt: 1 },
          5000
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${kingdoms[genieId - 1]}灯神扫荡成功`,
          type: "success",
        });
      } catch (error) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} genie_sweep 灯神${genieId} 失败: ${error.message}`,
          type: "warning",
        });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logWithPrefix({
      time: new Date().toLocaleTimeString(),
      message: `${token.name} 灯神扫荡完成`,
      type: "success",
    });
  };

  /**
   * 一键灯神扫荡
   */
  const batchGenieSweep = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始灯神扫荡: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 执行3次genie_buysweep命令
        let buysweepSuccess = true;
        for (let i = 0; i < 3; i++) {
          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              'genie_buysweep',
              {},
              5000
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} genie_buysweep ${i + 1}/3 成功`,
              type: "success",
            });
          } catch (error) {
            if (i === 0) {
              // 第一次执行失败，跳过剩余命令
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} genie_buysweep 第1次失败，跳过剩余命令`,
                type: "warning",
              });
              buysweepSuccess = false;
              break;
            } else {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} genie_buysweep ${i + 1}/3 失败: ${error.message}`,
                type: "warning",
              });
            }
          }
          if (buysweepSuccess) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // 如果genie_buysweep成功，执行灯神扫荡
        if (buysweepSuccess) {
          // 灯神扫荡 - 循环执行4次，每次使用不同的genieId（1-4）
          for (let genieId = 1; genieId <= 4; genieId++) {
            try {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                'genie_sweep',
                { genieId: genieId, sweepCnt: 1 },
                5000
              );
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} genie_sweep 灯神${genieId} 成功`,
                type: "success",
              });
            } catch (error) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} genie_sweep 灯神${genieId} 失败: ${error.message}`,
                type: "warning",
              });
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // 刷新信息
        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 灯神扫荡完成 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `灯神扫荡失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键灯神扫荡结束");
  };

  const getTodayBossId = () => {
    const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
    const dayOfWeek = new Date().getDay();
    return DAY_BOSS_MAP[dayOfWeek];
  };

  const batchLegionBoss = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始俱乐部BOSS`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        try {
          await tokenStore.sendPresetteamSaveTeam(
            tokenId,
            { teamId: 1 },
            5000
          );
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (switchError) {
          const switchErrorMsg = switchError.message || switchError.toString();
          if (!switchErrorMsg.includes('200020')) {
            throw switchError;
          }
        }

        await tokenStore.sendMessageWithPromise(
          tokenId,
          'fight_startlegionboss',
          {},
          5000
        );

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 俱乐部BOSS完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 俱乐部BOSS失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键俱乐部BOSS结束");
  };

  const batchFreeGift = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始每日免费礼包`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        try {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            'system_signinreward',
            {},
            5000
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 签到成功`,
            type: "success",
          });
        } catch (signinError) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 签到跳过: ${signinError.message}`,
            type: "warning",
          });
        }

        await new Promise(resolve => setTimeout(resolve, 500));

        try {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            'discount_claimreward',
            { discountId: 1 },
            5000
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 免费礼包领取成功`,
            type: "success",
          });
        } catch (discountError) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 免费礼包领取失败: ${discountError.message}`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 每日免费礼包异常: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键每日免费礼包结束");
  };

  const batchDailyBoss = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const todayBossId = getTodayBossId();

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始每日咸王（BOSS ID: ${todayBossId}）`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        for (let i = 0; i < 3; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            'fight_startboss',
            { bossId: todayBossId },
            12000
          );
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 咸王挑战完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 咸王挑战失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键每日咸王结束");
  };

  const batchOpenBox = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const boxType = isScheduledTask
      ? batchSettings.defaultBoxType
      : helperSettings.boxType;
    const totalCount = isScheduledTask
      ? batchSettings.boxCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量开箱: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱类型: ${boxNames[boxType]}, 数量: ${totalCount}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "item_openbox",
            { itemId: boxType, number: 10 },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开箱进度: ${(i + 1) * 10}/${totalCount}`,
            type: "info",
          });
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "item_openbox",
            { itemId: boxType, number: remainder },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开箱进度: ${totalCount}/${totalCount}`,
            type: "info",
          });
        }
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
        );
        await new Promise((r) => setTimeout(r, delayConfig.action));
        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 开箱完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `开箱失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量开箱结束");
  };

  /**
   * 批量钓鱼
   */
  const batchFish = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const fishType = isScheduledTask
      ? batchSettings.defaultFishType
      : helperSettings.fishType;
    const totalCount = isScheduledTask
      ? batchSettings.fishCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量钓鱼: ${token.name} ===`,
          type: "info",
        });
        
        await ensureConnection(tokenId);

        // 检查鱼竿数量
        let role = tokenStore.gameData?.roleInfo?.role;
        if (!role) {
           try {
             const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
             role = roleInfo?.role;
           } catch {}
        }
        // 普通鱼竿: 1011, 黄金鱼竿: 1012
        const rodId = fishType === 1 ? 1011 : 1012;
        const rodCount = role?.items?.[rodId]?.quantity || 0;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 鱼竿类型: ${fishNames[fishType]}, 目标数量: ${totalCount}, 当前库存: ${rodCount}`,
          type: "info",
        });

        let availableCount = totalCount;
        if (rodCount < totalCount) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 库存不足 (${rodCount} < ${totalCount})，将仅消耗现有库存`,
                type: "warning",
             });
             availableCount = rodCount;
        }

        if (availableCount <= 0) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 没有可用的鱼竿，停止任务`,
                type: "warning",
            });
            tokenStatus.value[tokenId] = "completed";
            return;
        }

        const batches = Math.floor(availableCount / 10);
        const remainder = availableCount % 10;

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_lottery",
            { type: fishType, lotteryNumber: 10, newFree: true },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼进度: ${(i + 1) * 10}/${availableCount}`,
            type: "info",
          });

          // 每5轮（50次）后，重新校验鱼竿数量
          if ((i + 1) % 5 === 0 && i < batches - 1) {
             try {
                const roleRes = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "role_getroleinfo",
                  {},
                  5000,
                );
                const currentRole = roleRes?.role || roleRes?.data?.role;
                if (currentRole) {
                    const currentRodCount = currentRole.items?.[rodId]?.quantity || 0;
                    
                    // 剩余需要的次数 (不包括当前这轮，因为i已经执行完了，所以剩余次数是 (batches - 1 - i) * 10 + remainder)
                    // 但实际上我们只需要知道下一轮是否有足够的鱼竿
                    // 如果当前库存少于10，说明下一轮可能不够，或者整个任务不够
                    // 重新计算 availableCount 可能会比较复杂，因为循环是基于 batches
                    
                    if (currentRodCount < 10) {
                        addLog({
                            time: new Date().toLocaleTimeString(),
                            message: `${token.name} 同步后发现鱼竿不足 (${currentRodCount} < 10)，停止后续批量任务`,
                            type: "warning",
                        });
                        // 强制停止
                        break; 
                    }
                }
             } catch (e) {
                 // ignore
             }
          }

          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_lottery",
            { type: fishType, lotteryNumber: remainder, newFree: true },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼进度: ${availableCount}/${availableCount}`,
            type: "info",
          });
        }
        // 自动领取鱼竿累计奖励
        try {
           const roleRes = await tokenStore.sendMessageWithPromise(
             tokenId,
             "role_getroleinfo",
             {},
             5000,
           );
           const currentRole = roleRes?.role || roleRes?.data?.role;
           if (currentRole) {
              const points = currentRole.statistics?.["artifact:point"] || 0;
              const exchangeCount = Math.floor(points / 20);
              
              if (exchangeCount > 0) {
                 addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 检测到鱼竿累计使用 ${points}，开始领取 ${exchangeCount} 次累计奖励`,
                    type: "info",
                 });
                 
                 for (let k = 0; k < exchangeCount && !shouldStop.value; k++) {
                    try {
                       await tokenStore.sendMessageWithPromise(
                         tokenId,
                         "artifact_exchange",
                         {},
                         3000
                       );
                       // 稍微延迟，避免请求过快
                       await new Promise((r) => setTimeout(r, 500)); 
                    } catch (err) {
                       addLog({
                          time: new Date().toLocaleTimeString(),
                          message: `${token.name} 领取累计奖励失败 (第${k+1}次): ${err.message}`,
                          type: "warning",
                       });
                       break; // 如果出错可能是不满足条件，停止领取
                    }
                 }
                 addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 累计奖励领取结束`,
                    type: "success",
                 });
              }
           }
        } catch (e) {
           addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 检查累计奖励失败: ${e.message}`,
              type: "warning",
           });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 钓鱼完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `钓鱼失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量钓鱼结束");
  };

  /**
   * 批量招募
   */
  const batchRecruit = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const totalCount = isScheduledTask
      ? batchSettings.recruitCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量招募: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 招募数量: ${totalCount}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "hero_recruit",
            { recruitType: 1, recruitNumber: 10 },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `招募进度: ${(i + 1) * 10}/${totalCount}`,
            type: "info",
          });
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "hero_recruit",
            { recruitType: 1, recruitNumber: remainder },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `招募进度: ${totalCount}/${totalCount}`,
            type: "info",
          });
        }

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 招募完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `招募失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量招募结束");
  };

  const batchOpenBoxByPoints = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const targetPoints = isScheduledTask
      ? batchSettings.targetBoxPoints
      : helperSettings.targetPoints;

    const boxPriority = [
      { id: 2001, name: "木质宝箱", points: 1, reserve: 200 },
      { id: 2002, name: "青铜宝箱", points: 10, reserve: 0 },
      { id: 2003, name: "黄金宝箱", points: 20, reserve: 0 },
      { id: 2004, name: "铂金宝箱", points: 50, reserve: 0 },
    ];

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始按积分开箱: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 目标积分: ${targetPoints}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const roleInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000,
        );
        const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
        const items = role.items || {};

        const boxInventory = {};
        let totalAvailablePoints = 0;

        for (const box of boxPriority) {
          const count = items[box.id]?.quantity || 0;
          boxInventory[box.id] = count;
          totalAvailablePoints += count * box.points;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 箱子库存: 木质=${boxInventory[2001]}, 青铜=${boxInventory[2002]}, 黄金=${boxInventory[2003]}, 铂金=${boxInventory[2004]}`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 可获得总积分: ${totalAvailablePoints}`,
          type: "info",
        });

        if (totalAvailablePoints < targetPoints) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 积分不足! 需要 ${targetPoints}, 可获得 ${totalAvailablePoints}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
          return;
        }

        const boxToOpen = {};
        let remainingPoints = targetPoints;

        const woodenAvailable = boxInventory[2001] - 200;
        if (woodenAvailable >= 10) {
          const woodenPoints = woodenAvailable * 1;
          const pointsNeeded = Math.min(woodenPoints, remainingPoints);
          let woodenToOpen = Math.min(pointsNeeded, woodenAvailable);
          woodenToOpen = Math.floor(woodenToOpen / 10) * 10;
          if (woodenToOpen === 0 && woodenAvailable >= 10 && pointsNeeded > 0) {
            woodenToOpen = 10;
          }
          
          if (woodenToOpen >= 10) {
            boxToOpen[2001] = woodenToOpen;
            remainingPoints -= woodenToOpen * 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 计划开 木质宝箱: ${woodenToOpen} 个 (积分: ${woodenToOpen})`,
              type: "info",
            });
          }
        }

        if (remainingPoints > 0) {
          const bronzeAvailable = Math.floor(boxInventory[2002] / 10) * 10;
          const goldAvailable = Math.floor(boxInventory[2003] / 10) * 10;
          const platinumAvailable = Math.floor(boxInventory[2004] / 10) * 10;
          const woodenTotal = Math.floor(boxInventory[2001] / 10) * 10;

          let bestResult = null;
          let minWaste = Infinity;

          for (let bronze = 0; bronze <= bronzeAvailable; bronze += 10) {
            const bronzePoints = bronze * 10;
            if (bronzePoints > remainingPoints) break;
            
            for (let gold = 0; gold <= goldAvailable; gold += 10) {
              const goldPoints = gold * 20;
              if (bronzePoints + goldPoints > remainingPoints) break;
              
              const afterBronzeGold = remainingPoints - bronzePoints - goldPoints;
              
              for (let platinum = 0; platinum <= platinumAvailable; platinum += 10) {
                const platinumPoints = platinum * 50;
                if (platinumPoints > afterBronzeGold) break;
                
                const afterPlatinum = afterBronzeGold - platinumPoints;
                
                let wooden = 0;
                if (afterPlatinum > 0) {
                  wooden = Math.ceil(afterPlatinum / 10) * 10;
                  if (wooden > woodenTotal || wooden > 100) continue;
                }
                
                const totalPoints = bronzePoints + goldPoints + platinumPoints + wooden;
                const waste = totalPoints - targetPoints;
                
                if (waste >= 0 && waste < minWaste) {
                  minWaste = waste;
                  bestResult = { bronze, gold, platinum, wooden, totalPoints };
                  if (waste === 0) break;
                }
              }
              if (minWaste === 0) break;
            }
            if (minWaste === 0) break;
          }

          if (bestResult) {
            if (bestResult.bronze > 0) {
              boxToOpen[2002] = bestResult.bronze;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 青铜宝箱: ${bestResult.bronze} 个 (积分: ${bestResult.bronze * 10})`,
                type: "info",
              });
            }
            if (bestResult.gold > 0) {
              boxToOpen[2003] = bestResult.gold;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 黄金宝箱: ${bestResult.gold} 个 (积分: ${bestResult.gold * 20})`,
                type: "info",
              });
            }
            if (bestResult.platinum > 0) {
              boxToOpen[2004] = bestResult.platinum;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 铂金宝箱: ${bestResult.platinum} 个 (积分: ${bestResult.platinum * 50})`,
                type: "info",
              });
            }
            if (bestResult.wooden > 0) {
              boxToOpen[2001] = (boxToOpen[2001] || 0) + bestResult.wooden;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 木质宝箱: ${bestResult.wooden} 个 (积分: ${bestResult.wooden})`,
                type: "info",
              });
            }
            remainingPoints = 0;
          }
        }

        for (const box of boxPriority) {
          if (shouldStop.value) break;

          const count = boxToOpen[box.id] || 0;
          if (count <= 0) continue;

          const batches = Math.floor(count / 10);
          const remainder = count % 10;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开始开 ${box.name}: ${count} 个`,
            type: "info",
          });

          for (let i = 0; i < batches && !shouldStop.value; i++) {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "item_openbox",
              { itemId: box.id, number: 10 },
              5000,
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${box.name} 开箱进度: ${(i + 1) * 10}/${count}`,
              type: "info",
            });
            await new Promise((r) => setTimeout(r, delayConfig.action));
          }

          if (remainder > 0 && !shouldStop.value) {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "item_openbox",
              { itemId: box.id, number: remainder },
              5000,
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${box.name} 开箱进度: ${count}/${count}`,
              type: "info",
            });
          }
        }

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 按积分开箱完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `按积分开箱失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("按积分开箱结束");
  };

  /**
   * 俱乐部BOSS - ForToken版本
   * @param {string} tokenId - Token ID
   */
  const batchLegionBossForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始俱乐部BOSS`,
        type: "info",
      });

      try {
        await tokenStore.sendPresetteamSaveTeam(
          tokenId,
          { teamId: 1 },
          5000
        );
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (switchError) {
        const switchErrorMsg = switchError.message || switchError.toString();
        if (!switchErrorMsg.includes('200020')) {
          throw switchError;
        }
      }

      await tokenStore.sendMessageWithPromise(
        tokenId,
        'fight_startlegionboss',
        {},
        5000
      );

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 俱乐部BOSS完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 俱乐部BOSS失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 每日免费礼包 - ForToken版本
   */
  const batchFreeGiftForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    // 创建带任务名称前缀的日志函数
    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始每日免费礼包`,
        type: "info",
      });

      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          'system_signinreward',
          {},
          5000
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 签到成功`,
          type: "success",
        });
      } catch (signinError) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 签到跳过: ${signinError.message}`,
          type: "warning",
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));

      try {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          'discount_claimreward',
          { discountId: 1 },
          5000
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 免费礼包领取成功`,
          type: "success",
        });
      } catch (discountError) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 免费礼包领取失败: ${discountError.message}`,
          type: "warning",
        });
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 每日免费礼包完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 每日免费礼包异常: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 每日咸王 - ForToken版本
   * @param {string} tokenId - Token ID
   */
  const batchDailyBossForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    const todayBossId = getTodayBossId();

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始每日咸王（BOSS ID: ${todayBossId}）`,
        type: "info",
      });

      for (let i = 0; i < 3; i++) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          'fight_startboss',
          { bossId: todayBossId },
          12000
        );
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 咸王挑战完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 咸王挑战失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 一键免费钓鱼⭐（批量）
   */
  const batchFreeFishing = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始免费钓鱼`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        for (let i = 0; i < 3; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            'artifact_lottery',
            { type: 1, lotteryNumber: 1, newFree: true },
            8000
          );
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 免费钓鱼完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 免费钓鱼失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键免费钓鱼结束");
  };

  /**
   * 一键免费钓鱼⭐（单个Token）
   */
  const batchFreeFishingForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始免费钓鱼`,
        type: "info",
      });

      for (let i = 0; i < 3; i++) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          'artifact_lottery',
          { type: 1, lotteryNumber: 1, newFree: true },
          8000
        );
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 免费钓鱼完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 免费钓鱼失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 一键宠物蛋⭐（批量）
   */
  const batchPetEgg = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始宠物蛋`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        // 执行4次购买宠物蛋
        for (let i = 0; i < 4; i++) {
          try {
            await tokenStore.sendLegionStoreBuyGoods(tokenId, { id: 205 });
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (buyError) {
            const errorMsg = buyError?.message || buyError || '';
            if (errorMsg.includes('2300370') || errorMsg.includes('俱乐部商品购买数量超出上限')) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 第 ${i + 1}/4 次购买失败: ${errorMsg}，停止剩余购买`,
                type: "warning",
              });
              break;
            }
            throw buyError;
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宠物蛋完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宠物蛋失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键宠物蛋结束");
  };

  /**
   * 一键宠物蛋⭐（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchPetEggForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    // 创建带任务名称前缀的日志函数
    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始宠物蛋`,
        type: "info",
      });

      // 执行4次购买宠物蛋
      for (let i = 0; i < 4; i++) {
        try {
          await tokenStore.sendLegionStoreBuyGoods(tokenId, { id: 205 });
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (buyError) {
          const errorMsg = buyError?.message || buyError || '';
          if (errorMsg.includes('2300370') || errorMsg.includes('俱乐部商品购买数量超出上限')) {
            logWithPrefix({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第 ${i + 1}/4 次购买失败: ${errorMsg}，停止剩余购买`,
              type: "warning",
            });
            break;
          }
          throw buyError;
        }
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 宠物蛋完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 宠物蛋失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 一键扭蛋⭐（批量）
   */
  const batchGacha = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始扭蛋`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        // 执行1次扭蛋
        try {
          await tokenStore.sendGachaDrawReward(tokenId, {});
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (drawErr) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 抽奖失败: ${drawErr.message}，继续领取阶段奖励`,
            type: "warning",
          });
        }

        // 获取扭蛋信息，领取未领取的阶段奖励
        try {
          const gachaInfo = await tokenStore.sendGachaGetInfo(tokenId, {});
          const roleGacha = gachaInfo?.roleGacha;
          const claimedMap = roleGacha?.claimedStageIdMap || {};
          const stageGachaCnt = roleGacha?.stageGachaCnt || 0;
          // 每10次抽奖解锁一个阶段，计算已解锁的最大stageId
          const maxStageId = Math.floor(stageGachaCnt / 10);
          for (let stageId = 1; stageId <= maxStageId; stageId++) {
            // 跳过已领取的阶段
            if (claimedMap[stageId] === true) continue;
            await tokenStore.sendGachaClaimStageReward(tokenId, { stageId });
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 领取扭蛋阶段奖励 stageId=${stageId}`,
              type: "success",
            });
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (stageErr) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 领取扭蛋阶段奖励失败: ${stageErr.message}`,
            type: "warning",
          });
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 扭蛋完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 扭蛋失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键扭蛋结束");
  };

  /**
   * 一键扭蛋⭐（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchGachaForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始扭蛋`,
        type: "info",
      });

      // 执行1次扭蛋
      try {
        await tokenStore.sendGachaDrawReward(tokenId, {});
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (drawErr) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 抽奖失败: ${drawErr.message}，继续领取阶段奖励`,
          type: "warning",
        });
      }

      // 获取扭蛋信息，领取未领取的阶段奖励
      try {
        const gachaInfo = await tokenStore.sendGachaGetInfo(tokenId, {});
        const roleGacha = gachaInfo?.roleGacha;
        const claimedMap = roleGacha?.claimedStageIdMap || {};
        const stageGachaCnt = roleGacha?.stageGachaCnt || 0;
        // 每10次抽奖解锁一个阶段，计算已解锁的最大stageId
        const maxStageId = Math.floor(stageGachaCnt / 10);
        for (let stageId = 1; stageId <= maxStageId; stageId++) {
          // 跳过已领取的阶段
          if (claimedMap[stageId] === true) continue;
          await tokenStore.sendGachaClaimStageReward(tokenId, { stageId });
          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 领取扭蛋阶段奖励 stageId=${stageId}`,
            type: "success",
          });
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (stageErr) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取扭蛋阶段奖励失败: ${stageErr.message}`,
          type: "warning",
        });
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 扭蛋完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 扭蛋失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 篝火营地报名（批量）
   */
  const batchCampSignup = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始篝火营地报名`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        await tokenStore.sendClubSignup(tokenId, {});
        await new Promise(resolve => setTimeout(resolve, 500));

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 篝火营地报名完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 篝火营地报名失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("篝火营地报名结束");
  };

  /**
   * 篝火营地报名（单个Token）
   */
  const batchCampSignupForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始篝火营地报名`,
        type: "info",
      });

      await tokenStore.sendClubSignup(tokenId, {});
      await new Promise(resolve => setTimeout(resolve, 500));

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 篝火营地报名完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 篝火营地报名失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 篝火营地战斗（批量，战力模式）
   */
  const batchCampFight = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 辅助函数：带"操作过快"重试的命令执行
    const executeWithRetry = async (commandFn, commandName, tokenName, maxRetries = 3) => {
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          return await commandFn();
        } catch (e) {
          const errMsg = e.message || String(e);
          if (errMsg.includes('操作过快') && retry < maxRetries - 1) {
            const retryDelay = 120000; // 2分钟
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `[${tokenName}]${commandName}操作过快，${retryDelay / 1000}秒后重试 (${retry + 1}/${maxRetries})`,
              type: "warning",
            });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            throw e;
          }
        }
      }
    };

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始篝火营地战斗`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        // 步骤1：presetteam_saveteam 切换阵容2
        try {
          await executeWithRetry(
            () => tokenStore.sendPresetteamSaveTeam(tokenId, { teamId: 2 }),
            'presetteam_saveteam',
            token.name
          );
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (e) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 切换阵容2失败，继续执行`,
            type: "warning",
          });
        }

        // 步骤2：club_getinfo 获取篝火营地信息
        const clubInfo = await executeWithRetry(
          () => tokenStore.sendClubGetInfo(tokenId, {}),
          'club_getinfo',
          token.name
        );
        const oppoMap = clubInfo?.club?.oppoMap;
        if (!oppoMap) throw new Error('未获取到篝火营地对手信息');

        const dayOfWeek = new Date().getDay();
        const dayToOppo = { 2: '2', 3: '3', 4: '4' };
        const oppoKey = dayToOppo[dayOfWeek];
        if (!oppoKey) throw new Error(`今天星期${dayOfWeek}，篝火营地战力模式只在周2、周3、周4开放`);

        const oppoData = oppoMap[oppoKey];
        if (!oppoData) throw new Error(`未找到星期${dayOfWeek}对应的对手`);

        // 当天日期键（YYMMDD）
        const todayDate = new Date();
        const todayKey = `${String(todayDate.getFullYear() % 100).padStart(2, '0')}${String(todayDate.getMonth() + 1).padStart(2, '0')}${String(todayDate.getDate()).padStart(2, '0')}`;

        // 获取 siege 信息
        const siegeData = clubInfo?.siege || {};
        const attackMap = siegeData.attackMap || {};
        const todayAttackData = attackMap[todayKey] || {};
        const aSuccessCnt = todayAttackData.aSuccessCnt || 0;
        const attackCnt = todayAttackData.attackCnt || 0;

        const taskProgress = siegeData.taskProgress || {};
        const taskClaimedMap = siegeData.taskClaimedMap || {};

        // 判断是否跳过步骤7
        let skipStep7 = true;
        let hasUnclaimedTask = false;
        let hasCompletedTask = false;
        const taskMapping = { 4: 1, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13 };
        for (const [taskKey, claimedKey] of Object.entries(taskMapping)) {
          const taskValue = taskProgress[taskKey] || 0;
          const claimedValue = taskClaimedMap[claimedKey];
          if (taskValue !== 0) {
            hasCompletedTask = true;
            if (!claimedValue) {
              hasUnclaimedTask = true;
              skipStep7 = false;
              break;
            }
          }
        }

        let skipStep7Reason = '';
        if (!hasCompletedTask) {
          skipStep7Reason = '所有任务都未完成，跳过步骤7';
        } else if (skipStep7) {
          skipStep7Reason = '所有已完成任务的奖励都已领取，跳过步骤7';
        } else {
          skipStep7Reason = '有已完成但未领取的任务，执行步骤7';
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 步骤2：成功挑战${aSuccessCnt}次，已攻击${attackCnt}次，${skipStep7Reason}`,
          type: "info",
        });

        // 判断是否跳过步骤3-5（成功挑战次数>=3）
        const skipBattle = aSuccessCnt >= 3;
        if (skipBattle) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 今日已成功挑战${aSuccessCnt}次，跳过步骤3-5`,
            type: "info",
          });
        }

        let battleTeam = null;
        let weaponId = null;
        let petUId = null;
        let challengeCount = 0;

        // 步骤3-5：只在未跳过时执行
        if (!skipBattle) {
          // 步骤3：构建挑战队列（优先队列 + 普通队列）
          const buildChallengeCaches = (defenders) => {
            const defenderList = [];
            for (const [nodeId, def] of Object.entries(defenders || {})) {
              defenderList.push({
                nodeId: parseInt(nodeId),
                roleId: def.roleId,
                challengeCnt: def.challengeCnt,
                failCnt: def.failCnt,
                name: def.name,
                mirror: def.mirror
              });
            }
            const pick = (d) => ({
              nodeId: d.nodeId,
              roleId: d.roleId,
              challengeCnt: d.challengeCnt,
              failCnt: d.failCnt,
              name: d.name,
              mirror: d.mirror
            });
            return {
              priorityCache: defenderList
                .filter(d => d.challengeCnt === 1)
                .sort((a, b) => a.failCnt - b.failCnt)
                .slice(0, 3)
                .map(pick),
              defenderCache: defenderList
                .filter(d => d.challengeCnt < 5)
                .sort((a, b) => a.failCnt - b.failCnt)
                .slice(0, 10)
                .map(pick)
            };
          };

          let { priorityCache, defenderCache } = buildChallengeCaches(oppoData.defenders || {});

          // 步骤4：fight_startlevel 获取当前阵容
          const fightResult = await executeWithRetry(
            () => tokenStore.sendFightStartLevel(tokenId, {}),
            'fight_startlevel',
            token.name
          );
          const battleData = fightResult?.battleData?.leftTeam;
          if (!battleData) throw new Error('未获取到战斗数据');

          const team = battleData.team || {};
          weaponId = battleData.weaponId;
          petUId = battleData.petUId;
          battleTeam = {};
          for (let pos = 0; pos <= 4; pos++) {
            if (team[pos]) {
              battleTeam[pos] = team[pos].id;
            }
          }
          await new Promise(resolve => setTimeout(resolve, 800));

          // 步骤5：循环挑战
          const maxChallenges = Math.max(0, 10 - attackCnt);
          let stopChallenge = false;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤5：今日已挑战${attackCnt}次，成功${aSuccessCnt}次，本轮最多挑战${maxChallenges}次`,
            type: "info",
          });

          // 封装循环挑战逻辑
          const runChallengeLoop = async (queues, startCount) => {
            let count = startCount;
            for (const queue of queues) {
              while (count < maxChallenges && queue.length > 0 && !stopChallenge) {
                const target = queue[0];

                try {
                  const attackResult = await executeWithRetry(
                    () => tokenStore.sendClubAttack(tokenId, {
                      nodeId: target.nodeId,
                      targetId: target.roleId,
                      targetIsMirror: target.mirror,
                      challengeCnt: target.challengeCnt,
                      failCnt: target.failCnt,
                      useItem: false,
                      teamSetParams: {
                        lordWeaponId: weaponId,
                        petUId: petUId,
                        battleTeam: battleTeam
                      }
                    }),
                    'club_attack',
                    token.name
                  );

                  count++;
                  const resultStr = JSON.stringify(attackResult || {});

                  if (resultStr.includes('今日成功挑战次数已用完')) {
                    stopChallenge = true;
                    break;
                  }

                  if (resultStr.includes('今日挑战次数已用完')) {
                    break;
                  }

                  queue.shift();
                } catch (e) {
                  const errorMsg = e.message || String(e);
                  if (errorMsg.includes('13000090') || errorMsg.includes('今日成功挑战次数已用完')) {
                    stopChallenge = true;
                    break;
                  }
                  if (errorMsg.includes('今日挑战次数已用完')) {
                    break;
                  }
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 挑战${target.name}异常: ${errorMsg}，继续挑战下一个`,
                    type: "warning",
                  });
                  queue.shift();
                  continue;
                }

                await new Promise(resolve => setTimeout(resolve, 800));
                queue.sort((a, b) => a.failCnt - b.failCnt);
              }
            }
            return count;
          };

          // 首轮循环挑战
          challengeCount = await runChallengeLoop([priorityCache, defenderCache], 0);

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤5：循环挑战完成，共执行${challengeCount}次`,
            type: "info",
          });

          // 队列打完但当日次数没用满且未收到"今日成功挑战次数已用完"时，重新拉取对手继续挑战（最多刷新2次）
          let refreshRound = 0;
          const maxRefreshRounds = 2;
          while (!stopChallenge && challengeCount < maxChallenges && refreshRound < maxRefreshRounds) {
            refreshRound++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤5：队列已打完，剩余${maxChallenges - challengeCount}次，重新拉取对手（第${refreshRound}次）`,
              type: "info",
            });

            const refreshClubInfo = await executeWithRetry(
              () => tokenStore.sendClubGetInfo(tokenId, {}),
              'club_getinfo',
              token.name
            );
            const refreshDefenders = refreshClubInfo?.club?.oppoMap?.[oppoKey]?.defenders || {};
            const newCaches = buildChallengeCaches(refreshDefenders);
            priorityCache = newCaches.priorityCache;
            defenderCache = newCaches.defenderCache;

            if (priorityCache.length === 0 && defenderCache.length === 0) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 步骤5：未获取到可挑战的对手，停止挑战`,
                type: "warning",
              });
              break;
            }

            const beforeCount = challengeCount;
            challengeCount = await runChallengeLoop([priorityCache, defenderCache], challengeCount);

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤5：第${refreshRound}次刷新后新增挑战${challengeCount - beforeCount}次`,
              type: "info",
            });

            if (challengeCount === beforeCount) break;
          }

          // 如果遇到"今日成功挑战次数已用完"，直接结束步骤5
          if (stopChallenge) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤5：今日成功挑战次数已用完，结束步骤5`,
              type: "info",
            });
          }
          // 循环结束后，执行club_getinfo + club_attackmonster
          else {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤5：执行club_getinfo获取今日成功挑战次数`,
              type: "info",
            });

            const newClubInfo = await executeWithRetry(
              () => tokenStore.sendClubGetInfo(tokenId, {}),
              'club_getinfo',
              token.name
            );
            const newSiegeData = newClubInfo?.siege || {};
            const newAttackData = (newSiegeData.attackMap || {})[todayKey] || {};
            const aSuccessCntNow = newAttackData.aSuccessCnt || 0;

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} aSuccessCnt=${aSuccessCntNow}，需要执行${3 - aSuccessCntNow}次club_attackmonster`,
              type: "info",
            });

            const remainingChallenges = 3 - aSuccessCntNow;
            if (remainingChallenges > 0) {
              for (let i = 0; i < remainingChallenges; i++) {
                try {
                  await executeWithRetry(
                    () => tokenStore.sendClubAttackMonster(tokenId, {
                      useItem: false,
                      teamSetParams: {
                        lordWeaponId: weaponId,
                        petUId: petUId,
                        battleTeam: battleTeam
                      }
                    }),
                    'club_attackmonster',
                    token.name
                  );
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} club_attackmonster成功 (${i + 1}/${remainingChallenges})`,
                    type: "success",
                  });
                } catch (e) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} club_attackmonster失败: ${e.message || e}`,
                    type: "warning",
                  });
                }
                await new Promise(resolve => setTimeout(resolve, 800));
              }
            }
          }
        }

        // 周4额外操作：升级、领取奖励、抽奖
        if (dayOfWeek === 4) {
          // 执行club_upgradelevel，出错也继续
          try {
            await executeWithRetry(
              () => tokenStore.sendClubUpgradeLevel(tokenId, {}),
              'club_upgradelevel',
              token.name
            );
            await new Promise(resolve => setTimeout(resolve, 800));
          } catch (e) {
            // 出错也继续
          }

          // 执行club_claimlevelreward 1次，出错也继续
          try {
            await executeWithRetry(
              () => tokenStore.sendClubClaimLevelReward(tokenId, {}),
              'club_claimlevelreward',
              token.name
            );
            await new Promise(resolve => setTimeout(resolve, 800));
          } catch (e) {
            // 出错也继续
          }

          // 执行club_draw 3次，出错跳过剩余
          for (let drawCount = 1; drawCount <= 3; drawCount++) {
            try {
              await executeWithRetry(
                () => tokenStore.sendClubDraw(tokenId, {}),
                'club_draw',
                token.name
              );
              await new Promise(resolve => setTimeout(resolve, 800));
            } catch (e) {
              break;
            }
          }
        }

        // 步骤7：执行club_getinfo获取完成任务和领取奖励情况，根据情况领取未领取任务奖励
        if (skipStep7) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤7：所有已完成任务的奖励都已领取，跳过步骤7`,
            type: "info",
          });
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤7：执行club_getinfo获取任务完成情况`,
            type: "info",
          });

          const finalClubInfo = await executeWithRetry(
            () => tokenStore.sendClubGetInfo(tokenId, {}),
            'club_getinfo',
            token.name
          );
          const finalSiegeData = finalClubInfo?.siege || {};
          const finalTaskProgress = finalSiegeData.taskProgress || {};
          const finalTaskClaimedMap = finalSiegeData.taskClaimedMap || {};

          // 构建需要领取的confId列表
          // taskProgress中4对应confId 1，5-13一一对应confId 5-13
          // taskClaimedMap中1对应任务4，5-13一一对应
          const confIdsToClaim = [];

          // 检查任务4（对应confId 1）
          if (finalTaskProgress[4] !== undefined && finalTaskProgress[4] !== 0) {
            if (!finalTaskClaimedMap[1]) {
              confIdsToClaim.push(1);
            }
          }

          // 检查任务5-13（对应confId 5-13）
          for (let taskKey = 5; taskKey <= 13; taskKey++) {
            if (finalTaskProgress[taskKey] !== undefined && finalTaskProgress[taskKey] !== 0) {
              if (!finalTaskClaimedMap[taskKey]) {
                confIdsToClaim.push(taskKey);
              }
            }
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤7：需要领取的confId: [${confIdsToClaim.join(',')}]`,
            type: "info",
          });

          // 依次领取未领取的任务奖励
          for (const confId of confIdsToClaim) {
            try {
              await executeWithRetry(
                () => tokenStore.sendClubTaskClaim(tokenId, { confId }),
                'club_taskclaim',
                token.name
              );
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 步骤7：领取confId=${confId}成功`,
                type: "success",
              });
            } catch (e) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 步骤7：领取confId=${confId}失败: ${e.message || e}`,
                type: "warning",
              });
            }
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 篝火营地战斗完成，挑战${challengeCount}次`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 篝火营地战斗失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("篝火营地战斗结束");
  };

  /**
   * 篝火营地战斗（单个Token，战力模式）
   */
  const batchCampFightForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    // 辅助函数：带"操作过快"重试的命令执行
    const executeWithRetry = async (commandFn, commandName, maxRetries = 3) => {
      for (let retry = 0; retry < maxRetries; retry++) {
        try {
          return await commandFn();
        } catch (e) {
          const errMsg = e.message || String(e);
          if (errMsg.includes('操作过快') && retry < maxRetries - 1) {
            const retryDelay = 120000; // 2分钟
            logWithPrefix({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${commandName}操作过快，${retryDelay / 1000}秒后重试 (${retry + 1}/${maxRetries})`,
              type: "warning",
            });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else {
            throw e;
          }
        }
      }
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始篝火营地战斗`,
        type: "info",
      });

      // 步骤1：presetteam_saveteam 切换阵容2
      try {
        await executeWithRetry(
          () => tokenStore.sendPresetteamSaveTeam(tokenId, { teamId: 2 }),
          'presetteam_saveteam'
        );
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (e) {
        // 继续执行
      }

      // 步骤2：club_getinfo 获取篝火营地信息
      const clubInfo = await executeWithRetry(
        () => tokenStore.sendClubGetInfo(tokenId, {}),
        'club_getinfo'
      );
      const oppoMap = clubInfo?.club?.oppoMap;
      if (!oppoMap) throw new Error('未获取到篝火营地对手信息');

      const dayOfWeek = new Date().getDay();
      const dayToOppo = { 2: '2', 3: '3', 4: '4' };
      const oppoKey = dayToOppo[dayOfWeek];
      if (!oppoKey) throw new Error(`今天星期${dayOfWeek}，篝火营地战力模式只在周2、周3、周4开放`);

      const oppoData = oppoMap[oppoKey];
      if (!oppoData) throw new Error(`未找到星期${dayOfWeek}对应的对手`);

      // 当天日期键（YYMMDD）
      const todayDate = new Date();
      const todayKey = `${String(todayDate.getFullYear() % 100).padStart(2, '0')}${String(todayDate.getMonth() + 1).padStart(2, '0')}${String(todayDate.getDate()).padStart(2, '0')}`;

      // 获取 siege 信息
      const siegeData = clubInfo?.siege || {};
      const attackMap = siegeData.attackMap || {};
      const todayAttackData = attackMap[todayKey] || {};
      const aSuccessCnt = todayAttackData.aSuccessCnt || 0;
      const attackCnt = todayAttackData.attackCnt || 0;

      const taskProgress = siegeData.taskProgress || {};
      const taskClaimedMap = siegeData.taskClaimedMap || {};

      // 判断是否跳过步骤7
      let skipStep7 = true;
      let hasUnclaimedTask = false;
      let hasCompletedTask = false;
      const taskMapping = { 4: 1, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13 };
      for (const [taskKey, claimedKey] of Object.entries(taskMapping)) {
        const taskValue = taskProgress[taskKey] || 0;
        const claimedValue = taskClaimedMap[claimedKey];
        if (taskValue !== 0) {
          hasCompletedTask = true;
          if (!claimedValue) {
            hasUnclaimedTask = true;
            skipStep7 = false;
            break;
          }
        }
      }

      let skipStep7Reason = '';
      if (!hasCompletedTask) {
        skipStep7Reason = '所有任务都未完成，跳过步骤7';
      } else if (skipStep7) {
        skipStep7Reason = '所有已完成任务的奖励都已领取，跳过步骤7';
      } else {
        skipStep7Reason = '有已完成但未领取的任务，执行步骤7';
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 步骤2：成功挑战${aSuccessCnt}次，已攻击${attackCnt}次，${skipStep7Reason}`,
        type: "info",
      });

      // 判断是否跳过步骤3-5（成功挑战次数>=3）
      const skipBattle = aSuccessCnt >= 3;
      if (skipBattle) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 今日已成功挑战${aSuccessCnt}次，跳过步骤3-5`,
          type: "info",
        });
      }

      let battleTeam = null;
      let weaponId = null;
      let petUId = null;
      let challengeCount = 0;

      // 步骤3-5：只在未跳过时执行
      if (!skipBattle) {
        // 步骤3：构建挑战队列（优先队列 + 普通队列）
        const buildChallengeCaches = (defenders) => {
          const defenderList = [];
          for (const [nodeId, def] of Object.entries(defenders || {})) {
            defenderList.push({
              nodeId: parseInt(nodeId),
              roleId: def.roleId,
              challengeCnt: def.challengeCnt,
              failCnt: def.failCnt,
              name: def.name,
              mirror: def.mirror
            });
          }
          const pick = (d) => ({
            nodeId: d.nodeId,
            roleId: d.roleId,
            challengeCnt: d.challengeCnt,
            failCnt: d.failCnt,
            name: d.name,
            mirror: d.mirror
          });
          return {
            priorityCache: defenderList
              .filter(d => d.challengeCnt === 1)
              .sort((a, b) => a.failCnt - b.failCnt)
              .slice(0, 3)
              .map(pick),
            defenderCache: defenderList
              .filter(d => d.challengeCnt < 5)
              .sort((a, b) => a.failCnt - b.failCnt)
              .slice(0, 10)
              .map(pick)
          };
        };

        let { priorityCache, defenderCache } = buildChallengeCaches(oppoData.defenders || {});

        // 步骤4：fight_startlevel 获取当前阵容
        const fightResult = await executeWithRetry(
          () => tokenStore.sendFightStartLevel(tokenId, {}),
          'fight_startlevel'
        );
        const battleData = fightResult?.battleData?.leftTeam;
        if (!battleData) throw new Error('未获取到战斗数据');

        const team = battleData.team || {};
        weaponId = battleData.weaponId;
        petUId = battleData.petUId;
        battleTeam = {};
        for (let pos = 0; pos <= 4; pos++) {
          if (team[pos]) {
            battleTeam[pos] = team[pos].id;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 800));

        // 步骤5：循环挑战
        const maxChallenges = Math.max(0, 10 - attackCnt);
        let stopChallenge = false;

        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 步骤5：今日已挑战${attackCnt}次，成功${aSuccessCnt}次，本轮最多挑战${maxChallenges}次`,
          type: "info",
        });

        // 封装循环挑战逻辑
        const runChallengeLoop = async (queues, startCount) => {
          let count = startCount;
          for (const queue of queues) {
            while (count < maxChallenges && queue.length > 0 && !stopChallenge) {
              const target = queue[0];

              try {
                const attackResult = await executeWithRetry(
                  () => tokenStore.sendClubAttack(tokenId, {
                    nodeId: target.nodeId,
                    targetId: target.roleId,
                    targetIsMirror: target.mirror,
                    challengeCnt: target.challengeCnt,
                    failCnt: target.failCnt,
                    useItem: false,
                    teamSetParams: {
                      lordWeaponId: weaponId,
                      petUId: petUId,
                      battleTeam: battleTeam
                    }
                  }),
                  'club_attack'
                );

                count++;
                const resultStr = JSON.stringify(attackResult || {});

                if (resultStr.includes('今日成功挑战次数已用完')) {
                  stopChallenge = true;
                  break;
                }

                if (resultStr.includes('今日挑战次数已用完')) {
                  break;
                }

                queue.shift();
              } catch (e) {
                const errorMsg = e.message || String(e);
                if (errorMsg.includes('13000090') || errorMsg.includes('今日成功挑战次数已用完')) {
                  stopChallenge = true;
                  break;
                }
                if (errorMsg.includes('今日挑战次数已用完')) {
                  break;
                }
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 挑战${target.name}异常: ${errorMsg}，继续挑战下一个`,
                  type: "warning",
                });
                queue.shift();
                continue;
              }

              await new Promise(resolve => setTimeout(resolve, 800));
              queue.sort((a, b) => a.failCnt - b.failCnt);
            }
          }
          return count;
        };

        // 首轮循环挑战
        challengeCount = await runChallengeLoop([priorityCache, defenderCache], 0);

        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 步骤5：循环挑战完成，共执行${challengeCount}次`,
          type: "info",
        });

        // 队列打完但当日次数没用满且未收到"今日成功挑战次数已用完"时，重新拉取对手继续挑战（最多刷新2次）
        let refreshRound = 0;
        const maxRefreshRounds = 2;
        while (!stopChallenge && challengeCount < maxChallenges && refreshRound < maxRefreshRounds) {
          refreshRound++;
          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤5：队列已打完，剩余${maxChallenges - challengeCount}次，重新拉取对手（第${refreshRound}次）`,
            type: "info",
          });

          const refreshClubInfo = await executeWithRetry(
            () => tokenStore.sendClubGetInfo(tokenId, {}),
            'club_getinfo'
          );
          const refreshDefenders = refreshClubInfo?.club?.oppoMap?.[oppoKey]?.defenders || {};
          const newCaches = buildChallengeCaches(refreshDefenders);
          priorityCache = newCaches.priorityCache;
          defenderCache = newCaches.defenderCache;

          if (priorityCache.length === 0 && defenderCache.length === 0) {
            logWithPrefix({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤5：未获取到可挑战的对手，停止挑战`,
              type: "warning",
            });
            break;
          }

          const beforeCount = challengeCount;
          challengeCount = await runChallengeLoop([priorityCache, defenderCache], challengeCount);

          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤5：第${refreshRound}次刷新后新增挑战${challengeCount - beforeCount}次`,
            type: "info",
          });

          if (challengeCount === beforeCount) break;
        }

        // 如果遇到"今日成功挑战次数已用完"，直接结束步骤5
        if (stopChallenge) {
          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤5：今日成功挑战次数已用完，结束步骤5`,
            type: "info",
          });
        }
        // 循环结束后，执行club_getinfo + club_attackmonster
        else {
          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 步骤5：执行club_getinfo获取今日成功挑战次数`,
            type: "info",
          });

          const newClubInfo = await executeWithRetry(
            () => tokenStore.sendClubGetInfo(tokenId, {}),
            'club_getinfo'
          );
          const newSiegeData = newClubInfo?.siege || {};
          const newAttackData = (newSiegeData.attackMap || {})[todayKey] || {};
          const aSuccessCntNow = newAttackData.aSuccessCnt || 0;

          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} aSuccessCnt=${aSuccessCntNow}，需要执行${3 - aSuccessCntNow}次club_attackmonster`,
            type: "info",
          });

          const remainingChallenges = 3 - aSuccessCntNow;
          if (remainingChallenges > 0) {
            for (let i = 0; i < remainingChallenges; i++) {
              try {
                await executeWithRetry(
                  () => tokenStore.sendClubAttackMonster(tokenId, {
                    useItem: false,
                    teamSetParams: {
                      lordWeaponId: weaponId,
                      petUId: petUId,
                      battleTeam: battleTeam
                    }
                  }),
                  'club_attackmonster'
                );
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} club_attackmonster成功 (${i + 1}/${remainingChallenges})`,
                  type: "success",
                });
              } catch (e) {
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} club_attackmonster失败: ${e.message || e}`,
                  type: "warning",
                });
              }
              await new Promise(resolve => setTimeout(resolve, 800));
            }
          }
        }
      }

      // 周4额外操作：升级、领取奖励、抽奖
      if (dayOfWeek === 4) {
        // 执行club_upgradelevel，出错也继续
        try {
          await executeWithRetry(
            () => tokenStore.sendClubUpgradeLevel(tokenId, {}),
            'club_upgradelevel'
          );
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (e) {
          // 出错也继续
        }

        // 执行club_claimlevelreward 1次，出错也继续
        try {
          await executeWithRetry(
            () => tokenStore.sendClubClaimLevelReward(tokenId, {}),
            'club_claimlevelreward'
          );
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (e) {
          // 出错也继续
        }

        // 执行club_draw 3次，出错跳过剩余
        for (let drawCount = 1; drawCount <= 3; drawCount++) {
          try {
            await executeWithRetry(
              () => tokenStore.sendClubDraw(tokenId, {}),
              'club_draw'
            );
            await new Promise(resolve => setTimeout(resolve, 800));
          } catch (e) {
            break;
          }
        }
      }

      // 步骤7：执行club_getinfo获取完成任务和领取奖励情况，根据情况领取未领取任务奖励
      if (skipStep7) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 步骤7：所有已完成任务的奖励都已领取，跳过步骤7`,
          type: "info",
        });
      } else {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 步骤7：执行club_getinfo获取任务完成情况`,
          type: "info",
        });

        const finalClubInfo = await executeWithRetry(
          () => tokenStore.sendClubGetInfo(tokenId, {}),
          'club_getinfo'
        );
        const finalSiegeData = finalClubInfo?.siege || {};
        const finalTaskProgress = finalSiegeData.taskProgress || {};
        const finalTaskClaimedMap = finalSiegeData.taskClaimedMap || {};

        // 构建需要领取的confId列表
        // taskProgress中4对应confId 1，5-13一一对应confId 5-13
        // taskClaimedMap中1对应任务4，5-13一一对应
        const confIdsToClaim = [];

        // 检查任务4（对应confId 1）
        if (finalTaskProgress[4] !== undefined && finalTaskProgress[4] !== 0) {
          if (!finalTaskClaimedMap[1]) {
            confIdsToClaim.push(1);
          }
        }

        // 检查任务5-13（对应confId 5-13）
        for (let taskKey = 5; taskKey <= 13; taskKey++) {
          if (finalTaskProgress[taskKey] !== undefined && finalTaskProgress[taskKey] !== 0) {
            if (!finalTaskClaimedMap[taskKey]) {
              confIdsToClaim.push(taskKey);
            }
          }
        }

        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 步骤7：需要领取的confId: [${confIdsToClaim.join(',')}]`,
          type: "info",
        });

        // 依次领取未领取的任务奖励
        for (const confId of confIdsToClaim) {
          try {
            await executeWithRetry(
              () => tokenStore.sendClubTaskClaim(tokenId, { confId }),
              'club_taskclaim'
            );
            logWithPrefix({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤7：领取confId=${confId}成功`,
              type: "success",
            });
          } catch (e) {
            logWithPrefix({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 步骤7：领取confId=${confId}失败: ${e.message || e}`,
              type: "warning",
            });
          }
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 篝火营地战斗完成，挑战${challengeCount}次`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 篝火营地战斗失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 盐场报名（批量）
   */
  const batchSaltSignup = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始盐场报名`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        await tokenStore.sendLegionSignup(tokenId, {});
        await new Promise(resolve => setTimeout(resolve, 500));

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 盐场报名完成`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 盐场报名失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("盐场报名结束");
  };

  /**
   * 盐场报名（单个Token）
   */
  const batchSaltSignupForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始盐场报名`,
        type: "info",
      });

      await tokenStore.sendLegionSignup(tokenId, {});
      await new Promise(resolve => setTimeout(resolve, 500));

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 盐场报名完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 盐场报名失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 盐场布阵（批量）
   */
  const batchSaltFormation = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // 创建连接池
    const connectionPool = new ConnectionPoolManager(tokenStore, {
      maxConnections: 5,
      connectionTimeout: 3000,
      idleTimeout: 60000,
      queueTimeout: 120000,
      reconnectDelay: 1000,
      maxRetries: 3
    });

    // 顺序执行每个token
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始盐场布阵`,
          type: "info",
        });

        // 获取连接
        const connected = await connectionPool.acquire(tokenId);
        if (!connected) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 连接失败，跳过`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "failed";
          continue;
        }

        // 获取战斗数据
        const fightResult = await tokenStore.sendFightStartLevel(tokenId, {});
        let battleTeam = {};
        let lordWeaponId = 0;
        let petUId = '';
        
        let leftTeam = null;
        if (fightResult && fightResult.battleData && fightResult.battleData.leftTeam) {
          leftTeam = fightResult.battleData.leftTeam;
        } else if (fightResult && fightResult.leftTeam) {
          leftTeam = fightResult.leftTeam;
        }
        
        if (leftTeam) {
          lordWeaponId = leftTeam.weaponId || 0;
          petUId = leftTeam.petUId || '';
          
          if (leftTeam.team) {
            const teamEntries = Array.isArray(leftTeam.team)
              ? leftTeam.team
              : Object.values(leftTeam.team);
            teamEntries.forEach(hero => {
              if (hero && hero.index !== undefined && hero.id !== undefined) {
                battleTeam[hero.index] = hero.id;
              }
            });
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));

        // 获取盐场信息
        const battlefieldInfo = await tokenStore.sendLegionGetBattlefield(tokenId, {});
        const battlefieldId = battlefieldInfo?.info?.battlefieldId;
        if (!battlefieldId) throw new Error('未获取到盐场ID');

        const sid = battlefieldInfo?.info?.sid;
        if (!sid) throw new Error('未获取到盐场sid');

        // 使用盐场专用WebSocket
        const baseWsUrl = 'wss://xxz-xyzw-new.hortorgames.com/agent' + `?p=${encodeURIComponent(token.token)}&e=x&sid2=${sid}&lang=chinese`;
        
        const legionWarWs = new XyzwLegionWarWebSocketClient({
          url: baseWsUrl,
          utils: null,
          hint: battlefieldId,
          heartbeatMs: 5000
        });
        
        // 等待连接建立
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('盐场WebSocket连接超时'));
          }, 10000);
          
          legionWarWs.onConnect = () => {
            clearTimeout(timeout);
            resolve();
          };
          legionWarWs.onError = (error) => {
            clearTimeout(timeout);
            reject(error);
          };
          legionWarWs.init();
        });
        
        try {
          // 进入盐场
          await legionWarWs.send("war_enterbattlefield", { battlefieldId, useGzip: true });
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 设置布阵
          await legionWarWs.send("war_setbattleteam", { battlefieldId, battleTeam, lordWeaponId, petUId });
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 队伍入场
          await legionWarWs.send("war_teamsetbattleteam", { battlefieldId, battleTeam, lordWeaponId, petUId });
          await new Promise(resolve => setTimeout(resolve, 500));
        } finally {
          // 关闭盐场WebSocket
          if (legionWarWs.socket && legionWarWs.socket.readyState === WebSocket.OPEN) {
            legionWarWs.socket.close();
          }
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 盐场布阵完成`,
          type: "success",
        });

        tokenStatus.value[tokenId] = "success";
      } catch (error) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 盐场布阵失败: ${error.message}`,
          type: "error",
        });
        tokenStatus.value[tokenId] = "failed";
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("盐场布阵结束");
  };

  /**
   * 盐场布阵（单个Token）
   */
  const batchSaltFormationForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始盐场布阵`,
        type: "info",
      });

      // 获取战斗数据
      const fightResult = await tokenStore.sendFightStartLevel(tokenId, {});
      let battleTeam = {};
      let lordWeaponId = 0;
      let petUId = '';
      
      let leftTeam = null;
      if (fightResult && fightResult.battleData && fightResult.battleData.leftTeam) {
        leftTeam = fightResult.battleData.leftTeam;
      } else if (fightResult && fightResult.leftTeam) {
        leftTeam = fightResult.leftTeam;
      }
      
      if (leftTeam) {
        lordWeaponId = leftTeam.weaponId || 0;
        petUId = leftTeam.petUId || '';
        
        if (leftTeam.team) {
          const teamEntries = Array.isArray(leftTeam.team)
            ? leftTeam.team
            : Object.values(leftTeam.team);
          teamEntries.forEach(hero => {
            if (hero && hero.index !== undefined && hero.id !== undefined) {
              battleTeam[hero.index] = hero.id;
            }
          });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));

      // 获取盐场信息
      const battlefieldInfo = await tokenStore.sendLegionGetBattlefield(tokenId, {});
      const battlefieldId = battlefieldInfo?.info?.battlefieldId;
      if (!battlefieldId) throw new Error('未获取到盐场ID');

      const sid = battlefieldInfo?.info?.sid;
      if (!sid) throw new Error('未获取到盐场sid');

      // 使用盐场专用WebSocket
      const baseWsUrl = 'wss://xxz-xyzw-new.hortorgames.com/agent' + `?p=${encodeURIComponent(token.token)}&e=x&sid2=${sid}&lang=chinese`;
      
      const legionWarWs = new XyzwLegionWarWebSocketClient({
        url: baseWsUrl,
        utils: null,
        hint: battlefieldId,
        heartbeatMs: 5000
      });
      
      // 等待连接建立
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('盐场WebSocket连接超时'));
        }, 10000);
        
        legionWarWs.onConnect = () => {
          clearTimeout(timeout);
          resolve();
        };
        legionWarWs.onError = (error) => {
          clearTimeout(timeout);
          reject(error);
        };
        legionWarWs.init();
      });
      
      try {
        // 步骤2: 进入盐场
        await legionWarWs.send("war_enterbattlefield", { battlefieldId, useGzip: true });
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 步骤3: 设置布阵
        await legionWarWs.send("war_setbattleteam", { battlefieldId, battleTeam, lordWeaponId, petUId });
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 步骤4: 队伍入场
        await legionWarWs.send("war_teamsetbattleteam", { battlefieldId, battleTeam, lordWeaponId, petUId });
        await new Promise(resolve => setTimeout(resolve, 500));
      } finally {
        // 关闭盐场WebSocket
        if (legionWarWs.socket && legionWarWs.socket.readyState === WebSocket.OPEN) {
          legionWarWs.socket.close();
        }
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 盐场布阵完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 盐场布阵失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 批量开箱⭐（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchOpenBoxForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      const boxType = helperSettings.boxType;
      const totalCount = helperSettings.count;
      const batches = Math.floor(totalCount / 10);
      const remainder = totalCount % 10;

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始开箱 (${boxNames[boxType]} x${totalCount})`,
        type: "info",
      });

      for (let i = 0; i < batches; i++) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_openbox",
          { itemId: boxType, number: 10 },
          5000,
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开箱进度: ${(i + 1) * 10}/${totalCount}`,
          type: "info",
        });
        await new Promise((r) => setTimeout(r, delayConfig.action));
      }

      if (remainder > 0) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_openbox",
          { itemId: boxType, number: remainder },
          5000,
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开箱进度: ${totalCount}/${totalCount}`,
          type: "info",
        });
      }

      await tokenStore.sendMessageWithPromise(
        tokenId,
        "item_batchclaimboxpointreward",
      );
      await new Promise((r) => setTimeout(r, delayConfig.action));
      await tokenStore.sendMessage(tokenId, "role_getroleinfo");

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开箱完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开箱失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 按积分开箱⭐（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchOpenBoxByPointsForToken = async (tokenId) => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    try {
      const targetPoints = helperSettings.targetPoints;

      const boxPriority = [
        { id: 2001, name: "木质宝箱", points: 1, reserve: 200 },
        { id: 2002, name: "青铜宝箱", points: 10, reserve: 0 },
        { id: 2003, name: "黄金宝箱", points: 20, reserve: 0 },
        { id: 2004, name: "铂金宝箱", points: 50, reserve: 0 },
      ];

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始按积分开箱 (目标: ${targetPoints})`,
        type: "info",
      });

      const roleInfoRes = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        5000,
      );
      const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
      const items = role.items || {};

      const boxInventory = {};
      let totalAvailablePoints = 0;

      for (const box of boxPriority) {
        const count = items[box.id]?.quantity || 0;
        boxInventory[box.id] = count;
        totalAvailablePoints += count * box.points;
      }

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 箱子库存: 木质=${boxInventory[2001]}, 青铜=${boxInventory[2002]}, 黄金=${boxInventory[2003]}, 铂金=${boxInventory[2004]}`,
        type: "info",
      });
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 可获得总积分: ${totalAvailablePoints}`,
        type: "info",
      });

      if (totalAvailablePoints < targetPoints) {
        throw new Error(`积分不足! 需要 ${targetPoints}, 可获得 ${totalAvailablePoints}`);
      }

      const boxToOpen = {};
      let remainingPoints = targetPoints;

      const woodenAvailable = boxInventory[2001] - 200;
      if (woodenAvailable >= 10) {
        const woodenPoints = woodenAvailable * 1;
        const pointsNeeded = Math.min(woodenPoints, remainingPoints);
        let woodenToOpen = Math.min(pointsNeeded, woodenAvailable);
        woodenToOpen = Math.floor(woodenToOpen / 10) * 10;
        if (woodenToOpen === 0 && woodenAvailable >= 10 && pointsNeeded > 0) {
          woodenToOpen = 10;
        }

        if (woodenToOpen >= 10) {
          boxToOpen[2001] = woodenToOpen;
          remainingPoints -= woodenToOpen * 1;
        }
      }

      if (remainingPoints > 0) {
        const bronzeAvailable = Math.floor(boxInventory[2002] / 10) * 10;
        const goldAvailable = Math.floor(boxInventory[2003] / 10) * 10;
        const platinumAvailable = Math.floor(boxInventory[2004] / 10) * 10;
        const woodenTotal = Math.floor(boxInventory[2001] / 10) * 10;

        let bestResult = null;
        let minWaste = Infinity;

        for (let bronze = 0; bronze <= bronzeAvailable; bronze += 10) {
          const bronzePoints = bronze * 10;
          if (bronzePoints > remainingPoints) break;

          for (let gold = 0; gold <= goldAvailable; gold += 10) {
            const goldPoints = gold * 20;
            if (bronzePoints + goldPoints > remainingPoints) break;

            const afterBronzeGold = remainingPoints - bronzePoints - goldPoints;

            for (let platinum = 0; platinum <= platinumAvailable; platinum += 10) {
              const platinumPoints = platinum * 50;
              if (platinumPoints > afterBronzeGold) break;

              const afterPlatinum = afterBronzeGold - platinumPoints;

              let wooden = 0;
              if (afterPlatinum > 0) {
                wooden = Math.ceil(afterPlatinum / 10) * 10;
                if (wooden > woodenTotal || wooden > 100) continue;
              }

              const totalPoints = bronzePoints + goldPoints + platinumPoints + wooden;
              const waste = totalPoints - targetPoints;

              if (waste >= 0 && waste < minWaste) {
                minWaste = waste;
                bestResult = { bronze, gold, platinum, wooden, totalPoints };
                if (waste === 0) break;
              }
            }
            if (minWaste === 0) break;
          }
          if (minWaste === 0) break;
        }

        if (bestResult) {
          if (bestResult.bronze > 0) boxToOpen[2002] = bestResult.bronze;
          if (bestResult.gold > 0) boxToOpen[2003] = bestResult.gold;
          if (bestResult.platinum > 0) boxToOpen[2004] = bestResult.platinum;
          if (bestResult.wooden > 0) {
            boxToOpen[2001] = (boxToOpen[2001] || 0) + bestResult.wooden;
          }
          remainingPoints = 0;
        }
      }

      for (const box of boxPriority) {
        const count = boxToOpen[box.id] || 0;
        if (count <= 0) continue;

        const batches = Math.floor(count / 10);
        const remainder = count % 10;

        for (let i = 0; i < batches; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "item_openbox",
            { itemId: box.id, number: 10 },
            5000,
          );
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        if (remainder > 0) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "item_openbox",
            { itemId: box.id, number: remainder },
            5000,
          );
        }
      }

      await tokenStore.sendMessage(tokenId, "role_getroleinfo");

      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 按积分开箱完成`,
        type: "success",
      });
    } catch (error) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 按积分开箱失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 领取宝箱积分⭐（单个Token）
   */
  const batchClaimBoxPointRewardForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始领取宝箱积分`,
        type: "info",
      });

      await tokenStore.sendMessageWithPromise(
        tokenId,
        "item_batchclaimboxpointreward",
        {},
        5000,
      );

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 宝箱积分领取成功`,
        type: "success",
      });

      await tokenStore.sendMessage(tokenId, "role_getroleinfo");
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 领取宝箱积分失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 批量钓鱼⭐（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchFishForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      const fishType = helperSettings.fishType;
      const totalCount = helperSettings.count;

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始钓鱼 (${fishNames[fishType]} x${totalCount})`,
        type: "info",
      });

      // 检查鱼竿数量
      let role = tokenStore.gameData?.roleInfo?.role;
      if (!role) {
        try {
          const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          role = roleInfo?.role;
        } catch {}
      }
      const rodId = fishType === 1 ? 1011 : 1012;
      const rodCount = role?.items?.[rodId]?.quantity || 0;

      let availableCount = totalCount;
      if (rodCount < totalCount) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 库存不足 (${rodCount} < ${totalCount})，将仅消耗现有库存`,
          type: "warning",
        });
        availableCount = rodCount;
      }

      if (availableCount <= 0) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 没有可用的鱼竿，停止任务`,
          type: "warning",
        });
        return;
      }

      const batches = Math.floor(availableCount / 10);
      const remainder = availableCount % 10;

      for (let i = 0; i < batches; i++) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "artifact_lottery",
          { type: fishType, lotteryNumber: 10, newFree: true },
          5000,
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 钓鱼进度: ${(i + 1) * 10}/${availableCount}`,
          type: "info",
        });

        // 每5轮（50次）后，重新校验鱼竿数量
        if ((i + 1) % 5 === 0 && i < batches - 1) {
          try {
            const roleRes = await tokenStore.sendMessageWithPromise(
              tokenId,
              "role_getroleinfo",
              {},
              5000,
            );
            const currentRole = roleRes?.role || roleRes?.data?.role;
            if (currentRole) {
              const currentRodCount = currentRole.items?.[rodId]?.quantity || 0;
              if (currentRodCount < 10) {
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 同步后发现鱼竿不足 (${currentRodCount} < 10)，停止后续批量任务`,
                  type: "warning",
                });
                break;
              }
            }
          } catch (e) {
            // ignore
          }
        }

        await new Promise((r) => setTimeout(r, delayConfig.action));
      }

      if (remainder > 0) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "artifact_lottery",
          { type: fishType, lotteryNumber: remainder, newFree: true },
          5000,
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 钓鱼进度: ${availableCount}/${availableCount}`,
          type: "info",
        });
      }

      // 自动领取鱼竿累计奖励
      try {
        const roleRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000,
        );
        const currentRole = roleRes?.role || roleRes?.data?.role;
        if (currentRole) {
          const points = currentRole.statistics?.["artifact:point"] || 0;
          const exchangeCount = Math.floor(points / 20);

          if (exchangeCount > 0) {
            logWithPrefix({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 检测到鱼竿累计使用 ${points}，开始领取 ${exchangeCount} 次累计奖励`,
              type: "info",
            });

            for (let k = 0; k < exchangeCount; k++) {
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "artifact_exchange",
                  {},
                  3000
                );
                await new Promise((r) => setTimeout(r, 500));
              } catch (err) {
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取累计奖励失败 (第${k + 1}次): ${err.message}`,
                  type: "warning",
                });
                break;
              }
            }
          }
        }
      } catch (e) {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 检查累计奖励失败: ${e.message}`,
          type: "warning",
        });
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 钓鱼完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 钓鱼失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 批量招募⭐（单个Token）
   * @param {string} tokenId - Token ID
   */
  const batchRecruitForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      const totalCount = helperSettings.count;
      const batches = Math.floor(totalCount / 10);
      const remainder = totalCount % 10;

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始招募 (数量: ${totalCount})`,
        type: "info",
      });

      for (let i = 0; i < batches; i++) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_recruit",
          { recruitType: 1, recruitNumber: 10 },
          5000,
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 招募进度: ${(i + 1) * 10}/${totalCount}`,
          type: "info",
        });
        await new Promise((r) => setTimeout(r, delayConfig.action));
      }

      if (remainder > 0) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_recruit",
          { recruitType: 1, recruitNumber: remainder },
          5000,
        );
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 招募进度: ${totalCount}/${totalCount}`,
          type: "info",
        });
      }

      await tokenStore.sendMessage(tokenId, "role_getroleinfo");

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 招募完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 招募失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  /**
   * 领取蟠桃园任务⭐（单个Token）
   */
  const batchClaimPeachTasksForToken = async (tokenId, taskName = "") => {
    const token = tokens.value.find((t) => t.id === tokenId);
    if (!token) return;

    const logWithPrefix = (log) => {
      const prefix = taskName ? `【${taskName}】` : "";
      addLog({
        ...log,
        message: `${prefix}${log.message}`
      });
    };

    try {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始领取蟠桃园任务奖励`,
        type: "info",
      });

      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "legion_getpayloadtask",
        {},
        5000
      );

      const payloadTask = res?.payloadTask || res?.data?.payloadTask;

      if (payloadTask && payloadTask.taskMap) {
        const taskMap = payloadTask.taskMap;
        const tasks = [];
        Object.values(taskMap).forEach((item) => {
          const availableTasks = PEACH_TASKS.filter(
            (t) =>
              t.type === item.typ &&
              item.progress >= t.target &&
              item.claimedProgress < t.target,
          );
          tasks.push(...availableTasks);
        });

        let claimedCount = 0;

        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 获取到 ${tasks.length} 个任务奖励`,
          type: "info",
        });

        for (const task of tasks) {
          try {
            const claimRes = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legion_claimpayloadtask",
              { taskId: task.id },
              5000
            );
            const ok = claimRes && claimRes.payloadTask;
            if (ok) {
              claimedCount++;
              logWithPrefix({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取${task.desc}任务奖励成功`,
                type: "success",
              });
            }
          } catch (err) {
            // ignore
          }
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        // Check and claim point rewards
        try {
          const progressMapres = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_getpayloadtask",
            {},
            5000
          );

          if (progressMapres && progressMapres.payloadTask) {
            const legionPoint = progressMapres.payloadTask.legionPoint || 0;
            const selfPoint = progressMapres.payloadTask.selfPoint || 0;
            const progressMap = progressMapres.payloadTask.progressMap || {};
            const taskGroupprogressMap = progressMap[1] || progressMap["1"] || 0;
            const selfPointprogressMap = progressMap[2] || progressMap["2"] || 0;

            // Club Rewards
            if (legionPoint > taskGroupprogressMap && taskGroupprogressMap < 25) {
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "legion_claimpayloadtaskprogress",
                  { taskGroup: 1 },
                  5000
                );
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取俱乐部任务奖励 (当前积分: ${legionPoint})`,
                  type: "success",
                });
                await new Promise((r) => setTimeout(r, 1000));
              } catch (e) {
                logWithPrefix({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取俱乐部任务奖励失败: ${e.message}`,
                  type: "error",
                });
              }
            }

            // Personal Rewards
            if (selfPoint > selfPointprogressMap && selfPointprogressMap < 25) {
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "legion_claimpayloadtaskprogress",
                  { taskGroup: 2 },
                  5000
                );
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取个人任务奖励 (当前积分: ${selfPoint})`,
                  type: "success",
                });
                await new Promise((r) => setTimeout(r, 1000));
              } catch (e) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取个人任务奖励失败: ${e.message}`,
                  type: "error",
                });
              }
            }
          }
        } catch (err) {
          console.error("领取蟠桃园积分奖励异常:", err);
          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 领取积分奖励异常: ${err.message}`,
            type: "error",
          });
        }

        if (claimedCount === 0) {
          logWithPrefix({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 没有可领取的任务奖励`,
            type: "info",
          });
        }
      } else {
        logWithPrefix({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 未获取到任务奖励列表`,
          type: "warning",
        });
      }

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 蟠桃园任务奖励领取完成`,
        type: "success",
      });
    } catch (error) {
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 领取蟠桃园任务奖励失败: ${error.message}`,
        type: "error",
      });
      throw error;
    }
  };

  return {
    batchOpenBox,
    batchOpenBoxForToken,
    batchOpenBoxByPoints,
    batchOpenBoxByPointsForToken,
    batchClaimBoxPointReward,
    batchClaimBoxPointRewardForToken,
    batchFish,
    batchFishForToken,
    batchRecruit,
    batchRecruitForToken,
    batchHeroUpgrade,
    batchHeroUpgradeForToken,
    batchBookUpgrade,
    batchBookUpgradeForToken,
    batchClaimStarRewards,
    batchClaimStarRewardsForToken,
    batchClaimPeachTasks,
    batchClaimPeachTasksForToken,
    batchGenieSweep,
    batchGenieSweepForToken,
    batchLegionBoss,
    batchLegionBossForToken,
    batchFreeGift,
    batchFreeGiftForToken,
    batchDailyBoss,
    batchDailyBossForToken,
    batchFreeFishing,
    batchFreeFishingForToken,
    batchPetEgg,
    batchPetEggForToken,
    batchGacha,
    batchGachaForToken,
    batchCampSignup,
    batchCampSignupForToken,
    batchCampFight,
    batchCampFightForToken,
    batchSaltSignup,
    batchSaltSignupForToken,
    batchSaltFormation,
    batchSaltFormationForToken,
  };
}
