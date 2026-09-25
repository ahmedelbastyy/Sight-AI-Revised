/**
 * TradeSight AI — Trade System Core
 * =============================================================================
 * Shared trade model, TP/SL logic, P/L calculation, and cheap technical
 * screening. Consumed by AppContext (portfolio + auto-close), the Home tab,
 * the Journal tab, the Moves tab, the Camera AI, and edge functions.
 *
 * Session 119: added `tradeType` classification (Scalp / Intraday Momentum /
 * Breakout / Breakdown / Reversal / Mean Reversion / Momentum Continuation /
 * Chart Scan) so users always know WHY a trade was logged.
 *
 * Accuracy > reliability > efficiency > speed. All P/L math done in full
 * precision internally; only display values are rounded.
 * =============================================================================
 */

export interface Trade {
  id: string;
  ticker: string;
  shares: number;
  entryPrice: number;
  position: 'long' | 'short';
  takeProfit: number;
  stopLoss: number;
  entryDate: string;
  tradeType?: string;
}

export interface ClosedTrade {
  id: string;
  ticker: string;
  shares: number;
  entryPrice: number;
  exitPrice: number;
  position: 'long' | 'short';
  takeProfit: number;
  stopLoss: number;
  entryDate: string;
  exitDate: string;
  exitReason: 'take_profit' | 'stop_loss' | 'manual';
  pnl: number;
  pnlPercent: number;
  tradeType?: string;
  source?: 'ai_signal' | 'chart_scan' | 'manual';
}

export type AISignalStatus = 'active' | 'tp_hit' | 'sl_hit' | 'expired' | 'invalidated';

export interface AISignal {
  id: string;
  ticker: string;
  direction: 'buy' | 'short';
  entry: number;
  takeProfit: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
  createdAt: string;
  status: AISignalStatus;
  companyName?: string;
  sector?: string;
  outcomePrice?: number;
  tradeType?: string;
}

export type TradeStatus = 'on_track' | 'at_risk' | 'take_profit_hit' | 'stop_loss_hit';

export interface TradeStatusInfo {
  status: TradeStatus;
  distanceToTP: number;
  distanceToSL: number;
  distancePercentToTP: number;
  distancePercentToSL: number;
  closerTo: 'tp' | 'sl';
  hitTP: boolean;
  hitSL: boolean;
  progressPercent: number;   // 0 = at SL, 100 = at TP (legacy)
  entryToTPProgress: number; // 0 = at entry, 100 = at TP. Negative if behind entry.
  currentPnL: number;
  currentPnLPercent: number;
  isProfitable: boolean;
}

export function computeTradeStatus(
  trade: Pick<Trade, 'position' | 'entryPrice' | 'takeProfit' | 'stopLoss' | 'shares'>,
  currentPrice: number,
): TradeStatusInfo {
  const { position, entryPrice, takeProfit, stopLoss, shares } = trade;
  const isLong = position === 'long';
  const hitTP = isLong ? currentPrice >= takeProfit : currentPrice <= takeProfit;
  const hitSL = isLong ? currentPrice <= stopLoss : currentPrice >= stopLoss;

  const distanceToTP = Math.abs(takeProfit - currentPrice);
  const distanceToSL = Math.abs(currentPrice - stopLoss);
  const distancePercentToTP = currentPrice > 0 ? (distanceToTP / currentPrice) * 100 : 0;
  const distancePercentToSL = currentPrice > 0 ? (distanceToSL / currentPrice) * 100 : 0;

  const closerTo: 'tp' | 'sl' = distanceToTP < distanceToSL ? 'tp' : 'sl';

  const totalRange = Math.abs(takeProfit - stopLoss);
  const distFromSL = Math.abs(currentPrice - stopLoss);
  const progressPercent = totalRange > 0
    ? Math.max(0, Math.min(100, (distFromSL / totalRange) * 100))
    : 50;

  // Session 119 §15 — new Entry→Current→TP progress metric for the main
  // visual bar on Active Trade cards. 0% = at entry, 100% = at TP.
  // Negative values mean price has moved AGAINST the trade past entry.
  const entryToTPRange = Math.abs(takeProfit - entryPrice);
  let entryToTPProgress = 0;
  if (entryToTPRange > 0) {
    const distFromEntry = isLong ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
    entryToTPProgress = (distFromEntry / entryToTPRange) * 100;
  }

  const currentPnL = isLong
    ? (currentPrice - entryPrice) * shares
    : (entryPrice - currentPrice) * shares;
  const costBasis = entryPrice * shares;
  const currentPnLPercent = costBasis > 0 ? (currentPnL / costBasis) * 100 : 0;

  let status: TradeStatus;
  if (hitTP) status = 'take_profit_hit';
  else if (hitSL) status = 'stop_loss_hit';
  else if (closerTo === 'tp') status = 'on_track';
  else status = 'at_risk';

  return {
    status, distanceToTP, distanceToSL, distancePercentToTP, distancePercentToSL,
    closerTo, hitTP, hitSL, progressPercent, entryToTPProgress,
    currentPnL, currentPnLPercent, isProfitable: currentPnL >= 0,
  };
}

/**
 * Context-aware status message for a live trade (Session 119 §16).
 * NEVER uses the simplistic "Cut your losses" wording based purely on
 * distance-to-SL. Instead reflects the actual P/L situation.
 */
export function tradeStatusMessage(info: TradeStatusInfo, ticker: string): { title: string; explanation: string; tone: 'good' | 'weakening' | 'loss' | 'strong' } {
  const pnl = info.currentPnL;
  const absPnl = Math.abs(pnl);
  if (info.hitTP) {
    return {
      title: 'Take Profit hit',
      explanation: `${ticker} reached your Take Profit. Trade will close automatically.`,
      tone: 'strong',
    };
  }
  if (info.hitSL) {
    return {
      title: 'Stop Loss hit',
      explanation: `${ticker} reached your Stop Loss. Trade will close automatically.`,
      tone: 'loss',
    };
  }
  if (info.isProfitable) {
    if (info.entryToTPProgress >= 60) {
      return {
        title: 'Trade progressing toward Take Profit',
        explanation: `You're up $${absPnl.toFixed(2)}. Setup is on track — you can take profit now or continue holding.`,
        tone: 'strong',
      };
    }
    return {
      title: 'Trade is looking good!',
      explanation: `You're currently up $${absPnl.toFixed(2)}. You can take profit now or continue holding toward your Take Profit.`,
      tone: 'good',
    };
  }
  // Losing (but not stopped out)
  if (info.closerTo === 'sl' && info.distancePercentToSL < 1.5) {
    return {
      title: 'Position under pressure',
      explanation: `You're down $${absPnl.toFixed(2)} and the price is near your Stop Loss. Setup may not recover — monitor closely.`,
      tone: 'loss',
    };
  }
  return {
    title: 'Trade conditions weakening',
    explanation: `You're currently down $${absPnl.toFixed(2)}. Momentum has softened against the original setup — watch for recovery or approach to Stop Loss.`,
    tone: 'weakening',
  };
}

export function computePnL(
  trade: Pick<Trade, 'position' | 'entryPrice' | 'shares'>,
  exitPrice: number,
): { pnl: number; pnlPercent: number } {
  const pnl = trade.position === 'long'
    ? (exitPrice - trade.entryPrice) * trade.shares
    : (trade.entryPrice - exitPrice) * trade.shares;
  const costBasis = trade.entryPrice * trade.shares;
  const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
  return { pnl, pnlPercent };
}

export function validateTrade(
  position: 'long' | 'short',
  entryPrice: number,
  takeProfit: number,
  stopLoss: number,
): string | null {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 'Entry price must be a positive number.';
  if (!Number.isFinite(takeProfit) || takeProfit <= 0) return 'Take Profit must be a positive number.';
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) return 'Stop Loss must be a positive number.';

  if (position === 'long') {
    if (takeProfit <= entryPrice) return 'For a Long, Take Profit must be ABOVE Entry.';
    if (stopLoss >= entryPrice) return 'For a Long, Stop Loss must be BELOW Entry.';
  } else {
    if (takeProfit >= entryPrice) return 'For a Short, Take Profit must be BELOW Entry.';
    if (stopLoss <= entryPrice) return 'For a Short, Stop Loss must be ABOVE Entry.';
  }
  return null;
}

export function screenStock(prices: number[]): { score: number; direction: 'bullish' | 'bearish' | 'neutral' } {
  if (prices.length < 20) return { score: 0, direction: 'neutral' };
  const current = prices[prices.length - 1];
  const sma5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;

  let score = 0;
  if (current > sma5 && sma5 > sma10 && sma10 > sma20) score += 30;
  else if (current < sma5 && sma5 < sma10 && sma10 < sma20) score -= 30;
  else if (current > sma20) score += 12;
  else if (current < sma20) score -= 12;

  const roc5 = ((current - prices[prices.length - 6]) / prices[prices.length - 6]) * 100;
  score += Math.max(-25, Math.min(25, roc5 * 4));

  let gain = 0, loss = 0;
  const rsiWindow = Math.min(14, prices.length - 1);
  for (let i = prices.length - rsiWindow; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gain += d; else loss += -d;
  }
  const rs = loss === 0 ? 100 : (gain / rsiWindow) / (loss / rsiWindow);
  const rsi = 100 - 100 / (1 + rs);
  if (rsi < 30) score += 15;
  else if (rsi > 70) score -= 15;
  else if (rsi < 40) score += 5;
  else if (rsi > 60) score -= 5;

  const returns: number[] = [];
  for (let i = 1; i < Math.min(prices.length, 20); i++) {
    returns.push(Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]));
  }
  const avgVol = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volBonus = Math.min(15, avgVol * 500);
  if (score > 0) score += volBonus;
  else if (score < 0) score -= volBonus;

  let upCount = 0, downCount = 0;
  for (let i = prices.length - 5; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) upCount++;
    else if (prices[i] < prices[i - 1]) downCount++;
  }
  if (upCount >= 4) score += 10;
  else if (downCount >= 4) score -= 10;

  score = Math.max(-100, Math.min(100, score));
  const direction = score > 8 ? 'bullish' : score < -8 ? 'bearish' : 'neutral';
  return { score, direction };
}

export function formatSignalNotificationBody(sig: AISignal): string {
  const dir = sig.direction === 'buy' ? 'BUY' : 'SHORT';
  return `${dir} ${sig.ticker} · Entry $${sig.entry.toFixed(2)} · TP $${sig.takeProfit.toFixed(2)} · SL $${sig.stopLoss.toFixed(2)}`;
}

export function isSignalStillActionable(sig: AISignal, currentPrice: number): boolean {
  if (sig.status !== 'active') return false;
  const range = Math.abs(sig.takeProfit - sig.stopLoss);
  const maxDrift = range * 0.4;
  return Math.abs(currentPrice - sig.entry) <= maxDrift;
}
