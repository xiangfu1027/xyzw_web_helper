/**
 * 罐子类任务
 * 包含: resetBottles, batchlingguanzi
 */
import ConnectionPoolManager from '@/utils/connectionPoolManager.js';

/**
 * 创建罐子类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksBottle(deps) {
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
  } = deps;

  /**
   * 重置罐子（单个Token）
   */
  const resetBottlesForToken = async (tokenId, taskName = "") => {
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
        message: `${token.name} 开始重置罐子`,
        type: "info",
      });

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 停止计时...`,
        type: "info",
      });
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_stop",
        {},
        5000,
      );

      await new Promise((r) => setTimeout(r, 500));

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 开始计时...`,
        type: "info",
      });
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_start",
        {},
        5000,
      );

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 重置完成`,
        type: "success",
      });

    } catch (error) {
      console.error(error);
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 重置失败: ${error.message}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 重置罐子
   */
  const resetBottles = async () => {
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

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始重置罐子: ${token.name} ===`,
          type: "info",
        });

        // Execute commands
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 停止计时...`,
          type: "info",
        });
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "bottlehelper_stop",
          {},
          5000,
        );

        await new Promise((r) => setTimeout(r, 500));

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 开始计时...`,
          type: "info",
        });
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "bottlehelper_start",
          {},
          5000,
        );

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 重置完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 重置失败: ${error.message}`,
          type: "error",
        });
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量重置罐子结束");
  };

  /**
   * 一键领取盐罐（单个Token）
   */
  const batchlingguanziForToken = async (tokenId, taskName = "") => {
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
        message: `${token.name} 开始领取盐罐`,
        type: "info",
      });

      await tokenStore.sendMessageWithPromise(
        tokenId,
        "bottlehelper_claim",
        {},
        5000,
      );

      await new Promise((r) => setTimeout(r, 500));

      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 领取盐罐完成`,
        type: "success",
      });

    } catch (error) {
      console.error(error);
      logWithPrefix({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 领取盐罐失败: ${error.message || "未知错误"}`,
        type: "error",
      });
      // 不抛出异常，继续执行后续命令
    }
  };

  /**
   * 一键领取盐罐
   */
  const batchlingguanzi = async () => {
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
          message: `=== 开始一键领取盐罐: ${token.name} ===`,
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
        
        if (shouldStop.value) {
          await connectionPool.release(tokenId, true);
          break;
        }
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "bottlehelper_claim",
          {},
          5000,
        );
        await new Promise((r) => setTimeout(r, 500));
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 领取盐罐已完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取盐罐失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        await connectionPool.release(tokenId, true);
      }
    }

    // 销毁连接池
    await connectionPool.destroy();
    
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取盐罐结束");
  };

  return {
    resetBottles,
    resetBottlesForToken,
    batchlingguanzi,
    batchlingguanziForToken,
  };
}
