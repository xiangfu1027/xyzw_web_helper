<template>
  <MyCard class="helper" status-class="active">
    <template #icon>
      <n-icon size="24">
        <Flame />
      </n-icon>
    </template>
    <template #title>
      <h3>四圣活动</h3>
    </template>
    <template #badge>
      <span>{{ runningOperation ? `${runningOperation}中` : '就绪' }}</span>
    </template>
    <template #default>
      <div class="four-saints-content">
        <CustomizedCard mode="container">
          <CustomizedCard
            mode="execution-range"
            name="活动日期"
            v-model:inputValue="activityDate"
            placeholder="如260918，默认前一个周五"
          />
          <CustomizedCard
            mode="execution-range"
            name="执行范围"
            v-model:inputValue="executionRange"
            placeholder="留空执行全部，或输入 1-20 或 1,2,3"
          />
        </CustomizedCard>

        <CustomizedCard mode="container">
          <CustomizedCard
            mode="button"
            name="一键四圣"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleOneKeyFourSaints"
          />
          <CustomizedCard
            mode="button"
            name="领取签到奖励"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleClaimSignReward"
          />
          <CustomizedCard
            mode="button"
            name="领取免费"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleClaimFreeGoods"
          />
          <CustomizedCard
            mode="button"
            name="领取通行证"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleClaimWarOrder"
          />
          <CustomizedCard
            mode="button"
            name="本期任务"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleClaimPeriodTasks"
          />
          <CustomizedCard
            mode="button"
            name="本日任务"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleClaimDailyTasks"
          />
          <CustomizedCard
            mode="button"
            name="四圣抽奖"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleLottery"
          />
          <CustomizedCard
            mode="button-with-input"
            name="一键兑换"
            v-model:inputValue="cookieExchangeParam"
            placeholder="如5284,2"
            :disabled="isRunning || !tokenStore.hasTokens"
            @button-click="handleExchangeCookie"
          />
        </CustomizedCard>
      </div>

      <!-- 操作日志 -->
      <OperationLogCard
        page="fish-helper"
        card-type="四圣活动"
        :filter-operations="['一键四圣', '领取签到奖励', '领取免费', '领取通行证', '本期任务', '本日任务', '四圣抽奖', '一键兑换']"
      />
    </template>
  </MyCard>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useTokenStore } from '@/stores/tokenStore'
import { useOperationLogStore } from '@/stores/operationLogStore'
import { useMessage } from 'naive-ui'
import MyCard from '@/components/Common/MyCard.vue'
import CustomizedCard from '@/diy/CustomizedCard.vue'
import OperationLogCard from '@/diy/OneClickGoldFish/OperationLogCard.vue'
import { Flame } from '@vicons/ionicons5'
import ConnectionPoolManager from '@/utils/connectionPoolManager'

const tokenStore = useTokenStore()
const logStore = useOperationLogStore()
const message = useMessage()

const CARD_TYPE = '四圣活动'

// 初始化连接池管理器
const connectionPool = new ConnectionPoolManager(tokenStore, {
  maxConnections: 20,
  connectionTimeout: 3000,
  maxRetries: 2
})

const isRunning = ref(false)
const runningOperation = ref('')

// 格式化为 YYMMDD
const formatDate = (date) => {
  const yy = String(date.getFullYear() % 100).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

// 解析 YYMMDD 日期
const parseActivityDate = (value) => {
  const str = String(value || '').trim()
  if (!/^\d{6}$/.test(str)) return null
  const year = 2000 + parseInt(str.slice(0, 2), 10)
  const month = parseInt(str.slice(2, 4), 10)
  const day = parseInt(str.slice(4, 6), 10)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

// 默认活动日期：最近一个周五
const getDefaultActivityDate = () => {
  const today = new Date()
  const diff = (today.getDay() - 5 + 7) % 7
  return formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - diff))
}

const activityDate = ref(localStorage.getItem('four_saints_activity_date') || getDefaultActivityDate())
const executionRange = ref(localStorage.getItem('four_saints_execution_range') || '')
// 一键兑换参数：X,Y（X为道具ID，Y为兑换档位2或3）
const cookieExchangeParam = ref(localStorage.getItem('four_saints_cookie_exchange') || '')

watch(activityDate, (val) => {
  localStorage.setItem('four_saints_activity_date', val)
})
watch(executionRange, (val) => {
  localStorage.setItem('four_saints_execution_range', val)
})
watch(cookieExchangeParam, (val) => {
  localStorage.setItem('four_saints_cookie_exchange', val)
})

// 活动参数：活动日期（6位）即活动ID的日期基准
// actId = 活动日期 + "1"，activityId = 活动日期 + "5"，goodsId = 活动日期 + "41"，
// lotteryMissionId = 活动日期 + "105"（抽奖任务奖励）
// exchangeActivityId = 活动日期 + "3"，兑换 goodsId = 活动日期 + "3" + "0" + Y
const activityParams = computed(() => {
  const base = parseActivityDate(activityDate.value)
  if (!base) return null
  const baseStr = formatDate(base)
  return {
    actId: Number(`${baseStr}1`),
    activityId: Number(`${baseStr}5`),
    goodsId: Number(`${baseStr}41`),
    lotteryMissionId: Number(`${baseStr}105`),
    exchangeActivityId: Number(`${baseStr}3`),
    exchangeGoodsPrefix: `${baseStr}30`
  }
})

const delay = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms))

// 写入操作日志
const addLog = (operation, status, logMessage, token = null) => {
  logStore.addLog({
    page: 'fish-helper',
    cardType: CARD_TYPE,
    operation,
    tokenId: token?.id,
    tokenName: token?.name,
    status,
    message: logMessage
  })
}

// 批量执行：遍历执行范围内的 Token
const runBatchTask = async (operation, taskFn) => {
  const params = activityParams.value
  if (!params) {
    message.warning('活动日期格式不正确，请输入6位日期，如260918')
    return
  }

  const sortedTokensList = [...tokenStore.gameTokens].sort((a, b) => {
    const nameA = (a.name || '未命名').toLowerCase()
    const nameB = (b.name || '未命名').toLowerCase()
    return nameA.localeCompare(nameB)
  })

  if (sortedTokensList.length === 0) {
    message.warning('没有可用的Token')
    return
  }

  const tokenIndices = connectionPool.parseTokenRange(executionRange.value)
  const targetTokens = connectionPool.getTargetTokens(sortedTokensList, tokenIndices)

  if (targetTokens.length === 0) {
    message.warning('执行范围内没有有效的Token')
    return
  }

  const rangeText = executionRange.value ? `范围${executionRange.value}` : '全部'
  isRunning.value = true
  runningOperation.value = operation
  message.info(`开始${operation}（${rangeText}），共${targetTokens.length}个Token...`)
  addLog(operation, 'info', `开始${operation}，${rangeText}，共${targetTokens.length}个Token`)

  try {
    await connectionPool.batchOperate(targetTokens, async (token) => {
      const tokenIndex = sortedTokensList.findIndex((t) => t.id === token.id) + 1
      try {
        await taskFn(token, tokenIndex, params)
      } catch (error) {
        addLog(operation, 'error', `【序号${tokenIndex}】[${token.name || token.id}]${operation}失败: ${error.message || error}`, token)
      }
    })
    message.success(`${operation}完成`)
  } catch (error) {
    message.error(`${operation}执行出错: ${error.message || error}`)
    addLog(operation, 'error', `${operation}执行出错: ${error.message || error}`)
  } finally {
    isRunning.value = false
    runningOperation.value = ''
  }
}

// 获取四圣通行证信息
const fetchWarOrderInfo = async (tokenId, actId) => {
  const resp = await tokenStore.sendActivityWarOrderGet(tokenId, { actId })
  return resp?.activity?.warOrderActivityInfo?.[actId]
}

// 领取任务奖励（missionIds 依次领取；未完成或出错都继续下一个，不中断）
const claimTaskRewards = async (operation, token, tokenIndex, actId, missionIds) => {
  if (missionIds.length === 0) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]没有可领取的任务`, token)
    return
  }
  for (const missionId of missionIds) {
    try {
      await tokenStore.sendActivityWarOrderTaskClaim(token.id, { actId, missionId: Number(missionId) })
      addLog(operation, 'success', `【序号${tokenIndex}】[${token.name || token.id}]领取任务奖励成功 missionId=${missionId}`, token)
    } catch (error) {
      const errorText = String(error?.message || error)
      // 任务未完成/已领取属于正常情况，跳过继续下一个，不中断
      if (errorText.includes('任务未完成') || errorText.includes('任务未达成完成条件') || errorText.includes('已经领取过这个任务')) {
        addLog(operation, 'info', `【序号${tokenIndex}】[${token.name || token.id}]任务未完成，跳过 missionId=${missionId}，继续下一个`, token)
      } else {
        addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]领取任务奖励失败 missionId=${missionId}: ${errorText}，继续下一个`, token)
      }
    }
    await delay()
  }
}

// 步骤：领取签到奖励
const stepClaimSignReward = async (operation, token, tokenIndex, params) => {
  // patchDay 固定为 0
  await tokenStore.sendActivityClaimSignReward(token.id, {
    activityId: params.activityId,
    patchDay: 0
  })
  addLog(operation, 'success', `【序号${tokenIndex}】[${token.name || token.id}]领取签到奖励成功 (activityId=${params.activityId}, patchDay=0)`, token)
}

// 步骤：四圣抽奖
// 流程：十抽（times=10，执行1次，成功与否都继续单抽）→ 单抽（times=1，最多10次）→
// 单抽失败则领取累计抽奖奖励（id=1，最多5次）→ 领奖成功回到单抽；
// 停止条件：单抽失败后紧接着领累计奖励也失败（连续两次失败，中间没有成功）。
// 中间任意一次成功都会清除上一次失败记录，重新回到单抽
const stepLottery = async (operation, token, tokenIndex) => {
  const tokenName = token.name || token.id

  // 1. 十抽1次（成功与否都继续执行单抽）
  try {
    await tokenStore.sendActivityLottery(token.id, { times: 10 })
    addLog(operation, 'success', `【序号${tokenIndex}】[${tokenName}]十抽成功（times=10）`, token)
  } catch (error) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${tokenName}]十抽失败: ${error.message || error}，继续单抽`, token)
  }
  await delay()

  // 2. 单抽与领取累计抽奖奖励交替执行
  // 单抽成功 → 继续单抽；单抽失败 → 领累计奖励，领奖成功 → 回到单抽；
  // 只有单抽刚失败、紧接着领累计奖励也失败（连续两次失败，中间没有成功），才停止该Token
  let singleCnt = 0
  let claimCnt = 0
  // 紧邻的上一次单抽是否失败
  let singleJustFailed = false

  while (true) {
    // 单抽（最多10次）
    if (singleCnt < 10) {
      try {
        await tokenStore.sendActivityLottery(token.id, { times: 1 })
        singleCnt++
        singleJustFailed = false
        addLog(operation, 'success', `【序号${tokenIndex}】[${tokenName}]单抽成功（第${singleCnt}/10次）`, token)
        await delay()
        continue
      } catch (error) {
        singleJustFailed = true
        addLog(operation, 'warning', `【序号${tokenIndex}】[${tokenName}]单抽第${singleCnt + 1}/10次失败: ${error.message || error}，尝试领取累计抽奖奖励`, token)
      }
    }

    // 领取累计抽奖奖励（最多20次），成功则回到单抽
    if (claimCnt < 20) {
      try {
        // 先获取抽奖信息，找到下一个未领取的累计奖励 id
        const lotteryInfoResp = await tokenStore.sendActivityGetLotteryInfo(token.id)
        const cumulativeClaimedMap = lotteryInfoResp?.lotteryInfo?.cumulativeClaimedMap || {}
        
        // 找到第一个值不为 true 的 id（id 从 1 开始累加）
        let nextClaimId = null
        for (let id = 1; id <= 20; id++) {
          if (cumulativeClaimedMap[id] !== true) {
            nextClaimId = id
            break
          }
        }
        
        if (nextClaimId === null) {
          addLog(operation, 'warning', `【序号${tokenIndex}】[${tokenName}]所有累计抽奖奖励已领取完毕`, token)
          break
        }
        
        await tokenStore.sendActivityClaimLotteryCumulative(token.id, { id: nextClaimId })
        claimCnt++
        singleJustFailed = false
        addLog(operation, 'success', `【序号${tokenIndex}】[${tokenName}]领取累计抽奖奖励成功（id=${nextClaimId}，第${claimCnt}/20次），回到单抽`, token)
        await delay()
        continue
      } catch (error) {
        addLog(operation, 'warning', `【序号${tokenIndex}】[${tokenName}]领取累计抽奖奖励第${claimCnt + 1}/20次失败: ${error.message || error}`, token)
      }
    }

    // 到这里说明单抽失败（或次数用尽）且领累计奖励也失败（或次数用尽），停止该Token
    addLog(
      operation,
      'error',
      `【序号${tokenIndex}】[${tokenName}]单抽${singleJustFailed ? '失败' : '次数已用尽'}且领取累计抽奖奖励${claimCnt >= 20 ? '次数已用尽' : '失败'}，停止该Token抽奖`,
      token
    )
    break
  }
}

// 步骤：本日任务（taskClaimed 中为 false 的 missionId）
const stepClaimDailyTasks = async (operation, token, tokenIndex, params) => {
  const info = await fetchWarOrderInfo(token.id, params.actId)
  const taskClaimed = info?.taskClaimed || {}
  const missionIds = Object.keys(taskClaimed).filter((missionId) => taskClaimed[missionId] === false)
  await claimTaskRewards(operation, token, tokenIndex, params.actId, missionIds)
}

// 步骤：本期任务（complete 中的所有 missionId，跳过 taskClaimed 中已为 true 的）
const stepClaimPeriodTasks = async (operation, token, tokenIndex, params) => {
  const info = await fetchWarOrderInfo(token.id, params.actId)
  const complete = info?.complete || {}
  const taskClaimed = info?.taskClaimed || {}
  const missionIds = Object.keys(complete).filter((missionId) => taskClaimed[missionId] !== true)
  await claimTaskRewards(operation, token, tokenIndex, params.actId, missionIds)
}

// 步骤：领取通行证
const stepClaimWarOrder = async (operation, token, tokenIndex, params) => {
  await tokenStore.sendActivityWarOrderRewardClaim(token.id, { actId: params.actId })
  addLog(operation, 'success', `【序号${tokenIndex}】[${token.name || token.id}]领取通行证奖励成功 (actId=${params.actId})`, token)
}

// 步骤：领取抽奖任务奖励（missionId = 活动日期 + "105"）
const stepClaimLotteryTask = async (operation, token, tokenIndex, params) => {
  await tokenStore.sendActivityWarOrderTaskClaim(token.id, {
    actId: params.actId,
    missionId: params.lotteryMissionId
  })
  addLog(operation, 'success', `【序号${tokenIndex}】[${token.name || token.id}]领取抽奖任务奖励成功 (actId=${params.actId}, missionId=${params.lotteryMissionId})`, token)
}

// 领取签到奖励
const handleClaimSignReward = () => runBatchTask('领取签到奖励', (token, tokenIndex, params) => stepClaimSignReward('领取签到奖励', token, tokenIndex, params))

// 领取免费
const handleClaimFreeGoods = () => runBatchTask('领取免费', async (token, tokenIndex, params) => {
  await tokenStore.sendActivityCommonBuyGoods(token.id, { goodsId: params.goodsId })
  addLog('领取免费', 'success', `【序号${tokenIndex}】[${token.name || token.id}]领取免费成功 (goodsId=${params.goodsId})`, token)
})

// 领取通行证
const handleClaimWarOrder = () => runBatchTask('领取通行证', (token, tokenIndex, params) => stepClaimWarOrder('领取通行证', token, tokenIndex, params))

// 本期任务
const handleClaimPeriodTasks = () => runBatchTask('本期任务', (token, tokenIndex, params) => stepClaimPeriodTasks('本期任务', token, tokenIndex, params))

// 本日任务
const handleClaimDailyTasks = () => runBatchTask('本日任务', (token, tokenIndex, params) => stepClaimDailyTasks('本日任务', token, tokenIndex, params))

// 四圣抽奖
const handleLottery = () => runBatchTask('四圣抽奖', (token, tokenIndex) => stepLottery('四圣抽奖', token, tokenIndex))

// 一键兑换
// 输入 X,Y（如 5284,2）：X 为道具ID，通过 role_getroleinfo 读取该道具数量 Z
// activityId = 活动日期 + "3"，goodsId = 活动日期 + "3" + "0" + Y
// Y=2 时每份消耗5个，quantity = Z/5 取整；Y=3 时每份消耗3个，quantity = Z/3 取整
const handleExchangeCookie = () => {
  const parts = String(cookieExchangeParam.value || '').split(/[,，]/).map((item) => item.trim())
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
    message.warning('请输入 X,Y 格式的参数，如 5284,2')
    return
  }
  const itemId = Number(parts[0])
  const exchangeType = Number(parts[1])
  if (exchangeType !== 2 && exchangeType !== 3) {
    message.warning('Y 只能是 2 或 3')
    return
  }
  const unitCost = exchangeType === 2 ? 5 : 3

  runBatchTask('一键兑换', async (token, tokenIndex, params) => {
    const operation = '一键兑换'
    const tokenName = token.name || token.id

    const roleInfo = await tokenStore.sendMessageWithPromise(token.id, 'role_getroleinfo', {}, 10000)
    const items = roleInfo?.role?.items || {}
    const item = items[itemId] || items[String(itemId)]
    const z = item?.quantity || 0

    const quantity = Math.floor(z / unitCost)
    if (quantity <= 0) {
      addLog(operation, 'warning', `【序号${tokenIndex}】[${tokenName}]道具${itemId}数量${z}，不足${unitCost}个，跳过兑换`, token)
      return
    }

    const activityId = params.exchangeActivityId
    const goodsId = Number(`${params.exchangeGoodsPrefix}${exchangeType}`)
    await tokenStore.sendActivityExchange(token.id, { activityId, goodsId, quantity })
    addLog(operation, 'success', `【序号${tokenIndex}】[${tokenName}]兑换成功 (activityId=${activityId}, goodsId=${goodsId}, quantity=${quantity})`, token)
    await delay()
  })
}

// 一键四圣：依次执行 领取签到奖励 → 本日任务 → 本期任务 → 领取通行证 → 四圣抽奖 → 领取抽奖任务奖励
const handleOneKeyFourSaints = () => runBatchTask('一键四圣', async (token, tokenIndex, params) => {
  const operation = '一键四圣'

  try {
    await stepClaimSignReward(operation, token, tokenIndex, params)
  } catch (error) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]领取签到奖励失败: ${error.message || error}，继续下一步`, token)
  }
  await delay()

  try {
    await stepClaimDailyTasks(operation, token, tokenIndex, params)
  } catch (error) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]本日任务失败: ${error.message || error}，继续下一步`, token)
  }
  await delay()

  try {
    await stepClaimPeriodTasks(operation, token, tokenIndex, params)
  } catch (error) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]本期任务失败: ${error.message || error}，继续下一步`, token)
  }
  await delay()

  try {
    await stepClaimWarOrder(operation, token, tokenIndex, params)
  } catch (error) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]领取通行证失败: ${error.message || error}，继续下一步`, token)
  }
  await delay()

  await stepLottery(operation, token, tokenIndex)
  await delay()

  try {
    await stepClaimLotteryTask(operation, token, tokenIndex, params)
  } catch (error) {
    addLog(operation, 'warning', `【序号${tokenIndex}】[${token.name || token.id}]领取抽奖任务奖励失败: ${error.message || error}`, token)
  }
})
</script>
