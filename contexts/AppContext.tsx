
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { ThemeMode, getTheme } from '../constants/theme';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  fetchMultipleQuotes, fetchChartData, analyzeStock,
  RealTimeQuote, AVAILABLE_STOCKS, searchAvailableStocks,
} from '../services/stockService';
import {
  requestNotificationPermissions, sendPriceAlert, sendBreakoutAlert,
  sendAISignalAlert, scheduleDailySummary, getNotificationPrefs,
  scheduleMarketOpenNotification, sendMarketOpenNotification,
  isMarketDay, isMarketOpen, getNYTime,
  resetPriceAlertTracking, resetAISignalTracking,
  registerPushTokenToBackend,
} from '../services/notificationService';
import {
  initRevenueCat, loginRC, logoutRC, checkRCSubscription, resetRC,
  preWarmEntitlements,
} from '../services/revenueCatService';
import { triggerBrokerRefresh, subscribeBrokerRefresh } from '../services/brokerConnectionBus';

const supabase = getSupabaseClient();

// Session 118 — trade origin + AI context (BUY/SHORT from AI Move or Chart Scan)
export interface AITradeContext {
  source: 'ai_signal' | 'chart_scan' | 'manual';
  signalId?: string;
  originalEntry?: number;
  originalTP?: number;
  originalSL?: number;
  confidence?: number;
  reasoning?: string;
  direction?: 'buy' | 'short';
  tradeType?: string;
  timestamp?: string;
}

export interface PortfolioItem {
  ticker: string;
  shares: number;
  avgCost: number; // entry price
  position: 'long' | 'short';
  // Session 117 — Trade management fields (optional for backwards compat with legacy positions)
  tradeId?: string;
  takeProfit?: number;
  stopLoss?: number;
  entryDate?: string;
  tradeType?: string;
  // Session 118 — origin + AI reasoning saved at log time
  source?: 'ai_signal' | 'chart_scan' | 'manual';
  aiContext?: AITradeContext;
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
  status: 'active' | 'tp_hit' | 'sl_hit' | 'expired' | 'invalidated';
  companyName?: string;
  sector?: string;
  tradeType?: string;
  reasoningSections?: { [key: string]: string };
  expectedDuration?: string;
}

interface StockData {
  quote: RealTimeQuote;
  chartData: number[];
  analysis: ReturnType<typeof analyzeStock>;
  sector: string;
}

interface AppState {
  isLoggedIn: boolean;
  userEmail: string;
  userName: string;
  userId: string;
  authLoading: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (identifier: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateUserName: (name: string) => void;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  currentTheme: ReturnType<typeof getTheme>;
  hasAcceptedDisclaimer: boolean;
  dontShowDisclaimer: boolean;
  acceptDisclaimer: (dontShowAgain: boolean) => void;
  isSubscribed: boolean;
  subscriptionEnd: string | null;
  subscriptionLoading: boolean;
  cancelAtPeriodEnd: boolean;
  checkSubscription: () => Promise<void>;
  // Session 199 — flips true the first time RevenueCat has actually
  // resolved whether this user is subscribed (either success OR failure).
  // The (tabs) layout waits for this before deciding whether to push the
  // /subscription paywall, so a paid user logging in on a fresh device
  // never sees a false-positive paywall while the RC entitlement check
  // is still in flight.
  subscriptionInitialCheckDone: boolean;
  hasSeenSubPrompt: boolean;
  markSubPromptSeen: () => void;
  watchlist: string[];
  addToWatchlist: (ticker: string) => void;
  removeFromWatchlist: (ticker: string) => void;
  isInWatchlist: (ticker: string) => boolean;
  portfolio: PortfolioItem[];
  addToPortfolio: (ticker: string, shares: number, avgCost: number, position?: 'long' | 'short') => void;
  addTradeWithTPSL: (args: { ticker: string; shares: number; entryPrice: number; position: 'long' | 'short'; takeProfit: number; stopLoss: number; tradeType?: string; source?: 'ai_signal' | 'chart_scan' | 'manual'; aiContext?: AITradeContext }) => string;
  closeTradeManually: (tradeId: string, exitPrice: number) => ClosedTrade | null;
  addManualClosedTrade: (args: { ticker: string; shares: number; entryPrice: number; exitPrice: number; position: 'long' | 'short'; tradeType?: string; source?: 'ai_signal' | 'chart_scan' | 'manual' }) => ClosedTrade;
  closedTrades: ClosedTrade[];
  activeAISignals: AISignal[];
  aiSignalsLoading: boolean;
  aiSignalsRefreshing: boolean;
  aiScanStats: { universeSize?: number; screened?: number; candidates?: number; actionable?: number; marketStatus?: string } | null;
  refreshAISignals: (force?: boolean) => Promise<void>;
  analyzePosition: (tradeId: string) => Promise<{ data?: any; error?: string }>;
  // Session 205 — Ask Sight AI for stocks the user holds only in their
  // connected brokerage account (no Sight-tracked trade / no TP-SL). Takes
  // the ticker, broker average price, current live price, share count, and
  // direction and returns the same AI verdict shape as analyzePosition.
  analyzeBrokerPosition: (args: {
    ticker: string;
    position: 'long' | 'short';
    entryPrice: number;
    shares: number;
    currentPrice: number;
  }) => Promise<{ data?: any; error?: string }>;
  markSignalTaken: (signalId: string) => void;
  markSignalMissed: (signalId: string) => void;
  aiSignalsTakenIds: string[];
  aiSignalsMissedIds: string[];
  removeFromPortfolio: (ticker: string) => void;
  removeStockCompletely: (ticker: string) => void;
  updatePortfolioItem: (ticker: string, shares: number) => void;
  stockDataMap: Map<string, StockData>;
  isLoadingStocks: boolean;
  refreshStocks: () => Promise<void>;
  searchStocks: (query: string) => { ticker: string; name: string; sector: string }[];
  getStockData: (ticker: string) => StockData | undefined;
  canFreeUserAddStock: () => boolean;
  analyzeChartImage: (base64: string) => Promise<any>;
  initNotifications: () => Promise<boolean>;
  notificationsEnabled: boolean;

  trackStockView: (ticker: string) => void;
  recentlyViewedStocks: string[];
  isOffline: boolean;
  tradingPasswordUnlocked: boolean;
  setTradingPasswordUnlocked: (v: boolean) => void;
  cancelledSub: boolean;
  setCancelledSub: (v: boolean) => void;
  hasCompletedOnboarding: boolean;
  setHasCompletedOnboarding: (v: boolean) => void;
  hasSeenIntroOffer: boolean;
  setHasSeenIntroOffer: (v: boolean) => void;
  justUpgradedToPro: boolean;
  setJustUpgradedToPro: (v: boolean) => void;
  hasCompletedTutorial: boolean;
  setHasCompletedTutorial: (v: boolean) => void;
  userFlagsLoaded: boolean;
}

const AppContext = createContext<AppState | undefined>(undefined);

const KEYS = {
  WATCHLIST: 'ts_watchlist',
  DISCLAIMER: 'ts_disclaimer',
  DONT_SHOW: 'ts_dontshow',
  PORTFOLIO: 'ts_portfolio',
  THEME: 'ts_theme',
  SUB_PROMPT: 'ts_sub_prompt_seen',
  IS_SUBSCRIBED: 'ts_is_subscribed',
  SUB_END: 'ts_sub_end',
  DEVICE_ID: 'ts_device_id',
  ONBOARDING_DONE: 'ts_onboarding_done',
  INTRO_OFFER_SEEN: 'ts_intro_offer_seen',
  TUTORIAL_DONE: 'ts_tutorial_done',
  LAST_USER_ID: 'ts_last_user_id',
};

// Session 201 — Apple reviewer super account. When someone logs in with
// these EXACT credentials the app auto-populates all onboarding flags,
// grants Pro entitlement for the session (bypassing RevenueCat), and
// pre-loads a rich Journal of 15 historical trades so reviewers can
// audit every feature without going through the paywall. The account
// itself is created via SQL migration (Session 201) with a bcrypt-hashed
// password — no plaintext password is ever committed anywhere else.
const SUPER_ACCOUNT_EMAIL = 'ahmedelbastyy@gmail.com';
const SUPER_ACCOUNT_ID = '0e8d1823-003d-4c59-a134-f8c379ece0a7';

function isSuperAccount(email?: string, userId?: string): boolean {
  if (email && email.toLowerCase().trim() === SUPER_ACCOUNT_EMAIL) return true;
  if (userId && userId === SUPER_ACCOUNT_ID) return true;
  return false;
}

function generateDeviceId(): string {
  return 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userName, setUserName] = useState('');
  const [authLoading, setAuthLoading] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState(false);
  const [dontShowDisclaimer, setDontShowDisclaimer] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionEnd, setSubscriptionEnd] = useState<string | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [hasSeenSubPrompt, setHasSeenSubPrompt] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  // Session 117 — Trade journal + universal AI signals
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [activeAISignals, setActiveAISignals] = useState<AISignal[]>([]);
  const [aiSignalsLoading, setAISignalsLoading] = useState(false);
  // Session 182 — separate REFRESHING state so existing Moves stay visible
  // while a background refresh runs. aiSignalsLoading is now used ONLY for
  // the initial fetch when nothing is on screen; aiSignalsRefreshing fires
  // for any refresh AFTER that. aiSignalsRefreshInFlight dedupes concurrent
  // callers (screen focus + poll interval + pull-to-refresh landing on the
  // same tick) so we make at most one network round-trip.
  const [aiSignalsRefreshing, setAISignalsRefreshing] = useState(false);
  const aiSignalsRefreshInFlight = React.useRef<Promise<void> | null>(null);
  const activeAISignalsCountRef = React.useRef(0);
  const [aiScanStats, setAIScanStats] = useState<{ universeSize?: number; screened?: number; candidates?: number; actionable?: number; marketStatus?: string } | null>(null);
  const [aiSignalsTakenIds, setAISignalsTakenIds] = useState<string[]>([]);
  const [aiSignalsMissedIds, setAISignalsMissedIds] = useState<string[]>([]);
  const autoCloseInFlight = React.useRef<Set<string>>(new Set());
  // Session 175 — tracks whether the currently signed-in user has an
  // active brokerage connection. Populated by a lightweight periodic
  // query below and used by the TP/SL auto-close effect to REFUSE to
  // close any position locally when a broker is connected (real broker
  // fills come from syncBrokerOrders() instead).
  const hasBrokerConnectionRef = React.useRef(false);
  const [stockDataMap, setStockDataMap] = useState<Map<string, StockData>>(new Map());
  const [isLoadingStocks, setIsLoadingStocks] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [userFlagsLoaded, setUserFlagsLoaded] = useState(false);
  const userFlagsLoadedRef = React.useRef(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [tradingPasswordUnlocked, setTradingPasswordUnlocked] = useState(false);
  const [cancelledSub, setCancelledSub] = useState(false);
  const [hasCompletedOnboarding, setHasCompletedOnboardingState] = useState(false);
  const [hasSeenIntroOffer, setHasSeenIntroOfferState] = useState(false);
  const [justUpgradedToPro, setJustUpgradedToProRaw] = useState(false);

  // When justUpgradedToPro is set to true, also immediately set isSubscribed
  const setJustUpgradedToPro = useCallback((v: boolean) => {
    setJustUpgradedToProRaw(v);
    if (v) {
      setIsSubscribed(true);
      AsyncStorage.setItem('ts_sub_status', 'true').catch(() => {});
    }
  }, []);
  const [hasCompletedTutorial, setHasCompletedTutorialState] = useState(false);
  const prevStockDataRef = React.useRef<Map<string, StockData>>(new Map());
  const refreshInProgress = React.useRef(false);
  const deviceIdRef = React.useRef<string>('');
  const marketOpenNotifSent = React.useRef(false);
  const currentUserIdRef = React.useRef<string>('');
  const [recentlyViewedStocks, setRecentlyViewedStocks] = useState<string[]>([]);
  const recentlyViewedRef = React.useRef<string[]>([]);
  const prevSubscribedRef = React.useRef<boolean | null>(null);
  const initialSubCheckDone = React.useRef(false);
  // Session 199 — exposed state version of initialSubCheckDone. Tabs
  // layout consumes this to gate the paywall push.
  const [subscriptionInitialCheckDone, setSubscriptionInitialCheckDone] = useState(false);

  // ===== STOCK SAVING SYSTEM (Session 107 rewrite) =====
  // Persistence contract:
  //  1. Local (AsyncStorage) is the durable, always-trusted store.
  //  2. Cloud (Supabase user_watchlists) is a sync/backup layer, NOT the
  //     sole source of truth. An empty cloud read NEVER wipes local.
  //  3. On mount: local is pre-loaded synchronously so the UI has data
  //     instantly, THEN cloud is fetched and reconciled.
  //  4. On any state change after ready: local is written immediately,
  //     cloud upsert is debounced 500ms.
  //  5. Cross-device poll (15s) only overwrites local when local is
  //     provably not mid-write (no pending debounce, no recent write).
  const stockSyncReadyRef = React.useRef(false);
  const [stockSyncReadyState, setStockSyncReadyState] = useState(false);
  const syncTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = React.useRef(false);
  const lastLocalWriteRef = React.useRef<number>(0);
  const loadInProgressRef = React.useRef(false);

  const currentTheme = getTheme(themeMode);

  // Network status tracking
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
    });
    return () => unsubscribe();
  }, []);

  // Load recently viewed stocks from AsyncStorage
  useEffect(() => {
    if (loaded && isLoggedIn && currentUserIdRef.current) {
      AsyncStorage.getItem(`ts_recently_viewed_${currentUserIdRef.current}`).then(val => {
        if (val) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              recentlyViewedRef.current = parsed;
              setRecentlyViewedStocks(parsed);
            }
          } catch {}
        }
      }).catch(() => {});
    }
  }, [loaded, isLoggedIn]);

  const trackStockView = useCallback((ticker: string) => {
    const userId = currentUserIdRef.current;
    if (!userId || !ticker) return;
    const current = recentlyViewedRef.current;
    const updated = [ticker, ...current.filter(t => t !== ticker)].slice(0, 20);
    recentlyViewedRef.current = updated;
    setRecentlyViewedStocks(updated);
    AsyncStorage.setItem(`ts_recently_viewed_${userId}`, JSON.stringify(updated)).catch(() => {});
  }, []);

  // Track stored user ID to detect same-user restarts
  const lastStoredUserIdRef = React.useRef<string>('');

  // Load persisted local state (theme + device id + flags + watchlist/portfolio for instant display)
  useEffect(() => {
    const load = async () => {
      try {
        const [disc, dontShow, themePref, subStatus, subEnd, deviceId, onbDone, introSeen, tutDone, lastUserId, localWl, localPort] = await Promise.all([
          AsyncStorage.getItem(KEYS.DISCLAIMER),
          AsyncStorage.getItem(KEYS.DONT_SHOW),
          AsyncStorage.getItem(KEYS.THEME),
          AsyncStorage.getItem(KEYS.IS_SUBSCRIBED),
          AsyncStorage.getItem(KEYS.SUB_END),
          AsyncStorage.getItem(KEYS.DEVICE_ID),
          AsyncStorage.getItem(KEYS.ONBOARDING_DONE),
          AsyncStorage.getItem(KEYS.INTRO_OFFER_SEEN),
          AsyncStorage.getItem(KEYS.TUTORIAL_DONE),
          AsyncStorage.getItem(KEYS.LAST_USER_ID),
          AsyncStorage.getItem(KEYS.WATCHLIST),
          AsyncStorage.getItem(KEYS.PORTFOLIO),
        ]);
        if (disc) setHasAcceptedDisclaimer(true);
        if (dontShow === 'true') setDontShowDisclaimer(true);
        if (themePref) setThemeMode(themePref as ThemeMode);
        if (subStatus === 'true') setIsSubscribed(true);
        if (subEnd) setSubscriptionEnd(subEnd);
        if (onbDone === 'true') setHasCompletedOnboardingState(true);
        if (introSeen === 'true') setHasSeenIntroOfferState(true);
        if (tutDone === 'true') setHasCompletedTutorialState(true);
        if (lastUserId) lastStoredUserIdRef.current = lastUserId;
        // Pre-load watchlist/portfolio from local storage for instant display
        // Cloud sync will override these when it completes
        if (localWl) {
          try { setWatchlist(JSON.parse(localWl)); } catch {}
        }
        if (localPort) {
          try { setPortfolio(JSON.parse(localPort).map((item: any) => ({ ...item, position: item.position || 'long' }))); } catch {}
        }

        if (deviceId) {
          deviceIdRef.current = deviceId;
        } else {
          const newId = generateDeviceId();
          deviceIdRef.current = newId;
          await AsyncStorage.setItem(KEYS.DEVICE_ID, newId);
        }
      } catch {} finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  // ===== STOCK SYNC: Load from cloud =====
  // ROOT-CAUSE FIX (Session 107) — Portfolio persistence regression.
  // The previous implementation blindly wrote `setWatchlist([])` /
  // `setPortfolio([])` whenever the cloud row was missing OR empty. In
  // practice that meant any transient cloud staleness (a save that hadn't
  // landed yet, a network hiccup, a fresh DB, a rare race) wiped the user's
  // portfolio on the next launch. New behavior: local is the always-trusted
  // baseline. Cloud only OVERRIDES local when cloud actually has data.
  const loadStocksFromCloud = async (userId: string) => {
    if (loadInProgressRef.current) return;
    loadInProgressRef.current = true;

    // Read AsyncStorage as the guaranteed baseline before touching cloud.
    let localWl: string[] = [];
    let localPort: PortfolioItem[] = [];
    try {
      const [wlStr, portStr] = await Promise.all([
        AsyncStorage.getItem(KEYS.WATCHLIST),
        AsyncStorage.getItem(KEYS.PORTFOLIO),
      ]);
      if (wlStr) { try { localWl = JSON.parse(wlStr); } catch {} }
      if (portStr) {
        try {
          // Session 118 CRITICAL FIX — preserve ALL trade fields (was stripping
          // tradeId/takeProfit/stopLoss/entryDate/source/aiContext, causing
          // Active Trades to disappear on every reload).
          localPort = JSON.parse(portStr).map((item: any) => ({
            ticker: item.ticker,
            shares: item.shares ?? 0,
            avgCost: item.avgCost ?? 0,
            position: item.position || 'long',
            tradeId: item.tradeId,
            takeProfit: item.takeProfit,
            stopLoss: item.stopLoss,
            entryDate: item.entryDate,
            tradeType: item.tradeType,
            source: item.source,
            aiContext: item.aiContext,
          }));
        } catch {}
      }
    } catch {}
    const localHasData = localWl.length > 0 || localPort.length > 0;

    try {
      const { data } = await supabase
        .from('user_watchlists')
        .select('watchlist, portfolio')
        .eq('user_id', userId)
        .maybeSingle();

      const cloudWl = data && Array.isArray(data.watchlist) ? data.watchlist : [];
      // Session 118 CRITICAL FIX — preserve ALL trade fields on cloud load.
      const cloudPort = data && Array.isArray(data.portfolio) ? data.portfolio.map((item: any) => ({
        ticker: item.ticker,
        shares: item.shares ?? 0,
        avgCost: item.avgCost ?? 0,
        position: item.position || 'long',
        tradeId: item.tradeId,
        takeProfit: item.takeProfit,
        stopLoss: item.stopLoss,
        entryDate: item.entryDate,
        tradeType: item.tradeType,
        source: item.source,
        aiContext: item.aiContext,
      })) : [];
      const cloudHasData = cloudWl.length > 0 || cloudPort.length > 0;

      if (cloudHasData) {
        // Cloud has real data — source of truth (this device may be out of
        // sync with another device where the user just added stocks).
        setWatchlist(cloudWl);
        setPortfolio(cloudPort);
        await AsyncStorage.setItem(KEYS.WATCHLIST, JSON.stringify(cloudWl));
        await AsyncStorage.setItem(KEYS.PORTFOLIO, JSON.stringify(cloudPort));
      } else if (localHasData) {
        // CRITICAL: cloud is empty but local has data. NEVER wipe local.
        // Preserve local and push it back up so cloud is restored.
        setWatchlist(localWl);
        setPortfolio(localPort);
        try {
          await supabase.from('user_watchlists').upsert({
            user_id: userId,
            watchlist: localWl,
            portfolio: localPort,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        } catch {}
      } else {
        // Both empty — genuinely-new-or-cleared account.
        setWatchlist([]);
        setPortfolio([]);
        await AsyncStorage.setItem(KEYS.WATCHLIST, '[]');
        await AsyncStorage.setItem(KEYS.PORTFOLIO, '[]');
        try {
          await supabase.from('user_watchlists').upsert({
            user_id: userId,
            watchlist: [],
            portfolio: [],
          }, { onConflict: 'user_id' });
        } catch {}
      }
    } catch {
      // Cloud fetch itself failed (network). Never wipe local — use the
      // baseline we read above so the user's data is always displayed.
      if (localHasData) {
        setWatchlist(localWl);
        setPortfolio(localPort);
      }
    } finally {
      // Mark ready AFTER data is set. From here on, subsequent portfolio
      // changes are persisted via the save effect below.
      stockSyncReadyRef.current = true;
      setStockSyncReadyState(true);
      loadInProgressRef.current = false;
    }
  };

  // ===== STOCK SYNC: Save to cloud (debounced) =====
  const saveStocksToCloud = useCallback((wl: string[], port: PortfolioItem[]) => {
    const userId = currentUserIdRef.current;
    if (!userId || !stockSyncReadyRef.current) return;

    // Timestamp this write so the polling loop skips a cloud read that
    // would otherwise race the pending debounce and clobber the local
    // change with stale cloud data.
    lastLocalWriteRef.current = Date.now();

    // Save to AsyncStorage immediately (durable local store — the user's
    // data survives even if the cloud upsert fails).
    AsyncStorage.setItem(KEYS.WATCHLIST, JSON.stringify(wl)).catch(() => {});
    AsyncStorage.setItem(KEYS.PORTFOLIO, JSON.stringify(port)).catch(() => {});

    // Cancel previous pending cloud save
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }

    syncTimerRef.current = setTimeout(async () => {
      // Clear the pending marker BEFORE the upsert so the poll loop's
      // "debounce pending" check accurately reflects reality.
      syncTimerRef.current = null;
      if (!currentUserIdRef.current || currentUserIdRef.current !== userId) return;
      if (isSavingRef.current) return;
      isSavingRef.current = true;

      try {
        await supabase.from('user_watchlists').upsert({
          user_id: userId,
          watchlist: wl,
          portfolio: port,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch (e) {
        console.log('[STOCK SYNC] Save failed:', e);
      } finally {
        isSavingRef.current = false;
      }
    }, 500);
  }, []);

  // ===== STOCK SYNC: Watch for changes and save =====
  // Guards on the STATE version of sync-ready (not the ref) so this effect
  // re-runs when initial cloud hydration completes and flips ready true —
  // ensuring any changes made while sync wasn't ready yet get persisted.
  useEffect(() => {
    if (!stockSyncReadyState || !loaded) return;
    // AsyncStorage save happens inside saveStocksToCloud immediately;
    // cloud upsert is debounced 500ms.
    saveStocksToCloud(watchlist, portfolio);
  }, [watchlist, portfolio, loaded, stockSyncReadyState, saveStocksToCloud]);

  // ===== STOCK SYNC: Poll cloud every 15s to stay in sync across devices =====
  useEffect(() => {
    if (!loaded || !isLoggedIn || !stockSyncReadyState || !currentUserIdRef.current) return;
    const pollCloud = async () => {
      // Never overwrite local while a save is in flight or pending, and
      // never overwrite within 3s of a local write. This prevents the poll
      // from clobbering a just-added stock before its cloud upsert lands
      // (which caused stocks to briefly appear and then vanish).
      if (isSavingRef.current) return;
      if (syncTimerRef.current !== null) return;
      if (Date.now() - lastLocalWriteRef.current < 3000) return;
      try {
        const { data } = await supabase
          .from('user_watchlists')
          .select('watchlist, portfolio')
          .eq('user_id', currentUserIdRef.current)
          .maybeSingle();
        if (!data) return;
        const cloudWl = Array.isArray(data.watchlist) ? data.watchlist : [];
        // Session 118 CRITICAL FIX — preserve ALL trade fields on 15s poll.
        // This was the direct cause of Active Trades disappearing when the
        // stock price ticked: the poll would run, strip tradeId/TP/SL, and
        // the Home tab filter `p.tradeId && p.takeProfit && p.stopLoss`
        // would no longer match, so the trade vanished from Active Trades.
        const cloudPort = Array.isArray(data.portfolio) ? data.portfolio.map((item: any) => ({
          ticker: item.ticker,
          shares: item.shares ?? 0,
          avgCost: item.avgCost ?? 0,
          position: item.position || 'long',
          tradeId: item.tradeId,
          takeProfit: item.takeProfit,
          stopLoss: item.stopLoss,
          entryDate: item.entryDate,
          tradeType: item.tradeType,
          source: item.source,
          aiContext: item.aiContext,
        })) : [];
        // Only update if actually different (avoids triggering the save effect)
        setWatchlist(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(cloudWl)) return cloudWl;
          return prev;
        });
        setPortfolio(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(cloudPort)) return cloudPort;
          return prev;
        });
      } catch {}
    };
    const interval = setInterval(pollCloud, 15000);
    return () => clearInterval(interval);
  }, [loaded, isLoggedIn, stockSyncReadyState]);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const isSameUser = currentUserIdRef.current === session.user.id;
        const isReturningUser = lastStoredUserIdRef.current === session.user.id;
        currentUserIdRef.current = session.user.id;
        setIsLoggedIn(true);
        setUserEmail(session.user.email ?? '');
        setUserName(session.user.user_metadata?.username ?? session.user.user_metadata?.full_name ?? '');
        setCancelledSub(false);

        // Initialize RevenueCat and login. preWarmEntitlements() runs
        // immediately after loginRC so subsequent getCustomerInfo() calls
        // return from the RevenueCat SDK's in-memory cache (typically <10ms).
        // Combined with the instant-unlock setJustUpgradedToPro(true) in
        // subscription.tsx, this makes Pro verification effectively instant
        // after any purchase.
        initRevenueCat(session.user.id)
          .then(() => loginRC(session.user.id))
          .then(() => { preWarmEntitlements().catch(() => {}); return checkSubscriptionInner(session.access_token); })
          .catch(() => checkSubscriptionInner(session.access_token));

        // Register this device's push token with the backend so the
        // send-push-notification edge function can deliver notifications
        // even when the app is closed. No-op if the user hasn't granted
        // notification permission yet — requestNotificationPermissions()
        // will register on grant.
        registerPushTokenToBackend(session.user.id, { deviceId: deviceIdRef.current }).catch(() => {});

        // Store user ID for fast restart detection
        AsyncStorage.setItem(KEYS.LAST_USER_ID, session.user.id);
        lastStoredUserIdRef.current = session.user.id;

        // Session 209 — super account name enforcement. If this login is
        // the Apple reviewer super account, force the displayed username
        // to "Tester" both in local state AND in the user_profiles table
        // so any stale "App Reviewer" value is corrected on the next
        // sync. Fires on every auth event so switching between accounts
        // never leaves a stale reviewer name showing.
        if (isSuperAccount(session.user.email ?? undefined, session.user.id)) {
          setUserName('Tester');
          try {
            await supabase.from('user_profiles').update({ username: 'Tester' }).eq('id', session.user.id);
          } catch { /* swallow — SQL migration also sets this */ }
        }

        if (!isSameUser) {
          if (isReturningUser) {
            // Same user restarting app - trust AsyncStorage (already loaded), mark flags ready immediately
            if (!userFlagsLoadedRef.current) {
              userFlagsLoadedRef.current = true;
              setUserFlagsLoaded(true);
            }
            // Background sync from DB (non-blocking)
            loadUserFlagsFromDB(session.user.id, true);
          } else if (userFlagsLoadedRef.current) {
            // Flags already loaded (e.g. by signup function) - just do background sync
            loadUserFlagsFromDB(session.user.id, true);
          } else {
            // Truly different user - must wait for DB flags
            userFlagsLoadedRef.current = false;
            setUserFlagsLoaded(false);
            loadUserFlagsFromDB(session.user.id, false);
          }
          stockSyncReadyRef.current = false;
          setStockSyncReadyState(false);
          registerDeviceSession(session.user.id);
          loadStocksFromCloud(session.user.id);
          setTradingPasswordUnlocked(false);
        }
      } else {
        currentUserIdRef.current = '';
        setIsLoggedIn(false);
        setUserEmail('');
        setUserName('');
        setIsSubscribed(false);
        setSubscriptionEnd(null);
        stockSyncReadyRef.current = false;
        setStockSyncReadyState(false);
        setTradingPasswordUnlocked(false);
        userFlagsLoadedRef.current = false;
        setUserFlagsLoaded(false);
        // Reset the initial-sub-check gate on sign-out so a subsequent
        // login re-runs the paywall gate correctly.
        setSubscriptionInitialCheckDone(false);
        initialSubCheckDone.current = false;
      }
      setAuthLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const isSameUser = currentUserIdRef.current === session.user.id;
        const isReturningUser = lastStoredUserIdRef.current === session.user.id;
        currentUserIdRef.current = session.user.id;
        setIsLoggedIn(true);
        setUserEmail(session.user.email ?? '');
        setUserName(session.user.user_metadata?.username ?? session.user.user_metadata?.full_name ?? '');
        setCancelledSub(false);

        // Initialize RevenueCat and login. preWarmEntitlements() runs
        // immediately after loginRC so subsequent getCustomerInfo() calls
        // return from the RevenueCat SDK's in-memory cache (typically <10ms).
        // Combined with the instant-unlock setJustUpgradedToPro(true) in
        // subscription.tsx, this makes Pro verification effectively instant
        // after any purchase.
        initRevenueCat(session.user.id)
          .then(() => loginRC(session.user.id))
          .then(() => { preWarmEntitlements().catch(() => {}); return checkSubscriptionInner(session.access_token); })
          .catch(() => checkSubscriptionInner(session.access_token));

        // Register this device's push token with the backend so the
        // send-push-notification edge function can deliver notifications
        // even when the app is closed. No-op if the user hasn't granted
        // notification permission yet — requestNotificationPermissions()
        // will register on grant.
        registerPushTokenToBackend(session.user.id, { deviceId: deviceIdRef.current }).catch(() => {});

        // Store user ID for fast restart detection
        AsyncStorage.setItem(KEYS.LAST_USER_ID, session.user.id);
        lastStoredUserIdRef.current = session.user.id;

        if (!userFlagsLoadedRef.current) {
          if (isReturningUser) {
            // Same user restarting - trust local values, mark ready immediately
            userFlagsLoadedRef.current = true;
            setUserFlagsLoaded(true);
            // Background sync (non-blocking)
            loadUserFlagsFromDB(session.user.id, true);
          } else {
            // New user or switched account - wait for DB
            loadUserFlagsFromDB(session.user.id, false);
          }
        } else {
          // Flags already loaded (e.g. from signup) - background sync only
          loadUserFlagsFromDB(session.user.id, true);
        }
        if (!isSameUser) {
          registerDeviceSession(session.user.id);
        }
        // Always load stocks from cloud if not already syncing
        if (!stockSyncReadyRef.current) {
          loadStocksFromCloud(session.user.id);
        }
        if (!isSameUser) {
          setTradingPasswordUnlocked(false);
        }
      } else {
        if (!userFlagsLoadedRef.current) {
          userFlagsLoadedRef.current = true;
          setUserFlagsLoaded(true);
        }
      }
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserFlagsFromDB = async (userId: string, backgroundOnly?: boolean) => {
    try {
      const { data } = await supabase
        .from('user_profiles')
        .select('dont_show_disclaimer, disclaimer_accepted, intro_offer_seen, onboarding_completed, tutorial_completed, username')
        .eq('id', userId)
        .single();
      if (data) {
        const dbDontShow = !!data.dont_show_disclaimer;
        const dbDisclaimer = !!data.disclaimer_accepted;
        const dbIntroSeen = !!data.intro_offer_seen;
        const dbOnboarding = !!data.onboarding_completed;
        const dbTutorial = !!data.tutorial_completed;

        // Sync username from DB if it was changed in the dashboard
        if (data.username) {
          setUserName(prev => {
            // Only update if DB has a different value and it's not empty
            if (data.username && data.username !== prev) return data.username;
            return prev;
          });
        }

        if (backgroundOnly) {
          // Background sync: only UPGRADE flags (true overrides false), never downgrade
          // This prevents DB lag from resetting flags that were just set locally
          if (dbDontShow) setDontShowDisclaimer(true);
          if (dbDisclaimer || dbDontShow) setHasAcceptedDisclaimer(true);
          if (dbIntroSeen) setHasSeenIntroOfferState(true);
          if (dbOnboarding) setHasCompletedOnboardingState(true);
          if (dbTutorial) setHasCompletedTutorialState(true);
        } else {
          // Full sync for new/different users - DB is source of truth
          setDontShowDisclaimer(dbDontShow);
          setHasAcceptedDisclaimer(dbDisclaimer || dbDontShow);
          setHasSeenIntroOfferState(dbIntroSeen);
          setHasCompletedOnboardingState(dbOnboarding);
          setHasCompletedTutorialState(dbTutorial);
        }

        // Sync local storage to match DB
        await AsyncStorage.setItem(KEYS.DONT_SHOW, dbDontShow ? 'true' : 'false');
        await AsyncStorage.setItem(KEYS.DISCLAIMER, (dbDisclaimer || dbDontShow) ? 'true' : 'false');
        await AsyncStorage.setItem(KEYS.INTRO_OFFER_SEEN, dbIntroSeen ? 'true' : 'false');
        await AsyncStorage.setItem(KEYS.ONBOARDING_DONE, dbOnboarding ? 'true' : 'false');
        await AsyncStorage.setItem(KEYS.TUTORIAL_DONE, dbTutorial ? 'true' : 'false');
      } else if (!backgroundOnly) {
        // No profile found yet (might be very new account) - reset all flags
        setDontShowDisclaimer(false);
        setHasAcceptedDisclaimer(false);
        setHasSeenIntroOfferState(false);
        setHasCompletedOnboardingState(false);
        setHasCompletedTutorialState(false);
        await AsyncStorage.setItem(KEYS.DONT_SHOW, 'false');
        await AsyncStorage.setItem(KEYS.DISCLAIMER, 'false');
        await AsyncStorage.setItem(KEYS.INTRO_OFFER_SEEN, 'false');
        await AsyncStorage.setItem(KEYS.ONBOARDING_DONE, 'false');
        await AsyncStorage.setItem(KEYS.TUTORIAL_DONE, 'false');
      }
    } catch {} finally {
      if (!backgroundOnly) {
        userFlagsLoadedRef.current = true;
        setUserFlagsLoaded(true);
      }
    }
  };

  const registerDeviceSession = async (userId: string) => {
    try {
      const deviceId = deviceIdRef.current;
      if (!deviceId) return;
      await supabase
        .from('active_sessions')
        .upsert(
          { user_id: userId, device_id: deviceId, last_active_at: new Date().toISOString() },
          { onConflict: 'user_id,device_id' }
        );
    } catch {}
  };

  // Heartbeat: update last_active_at every 60 seconds
  useEffect(() => {
    if (!isLoggedIn || !currentUserIdRef.current || !deviceIdRef.current) return;
    const heartbeat = setInterval(async () => {
      try {
        await supabase
          .from('active_sessions')
          .update({ last_active_at: new Date().toISOString() })
          .eq('user_id', currentUserIdRef.current)
          .eq('device_id', deviceIdRef.current);
      } catch {}
    }, 60000);
    return () => clearInterval(heartbeat);
  }, [isLoggedIn]);

  // Detect subscription cancellation
  useEffect(() => {
    if (!initialSubCheckDone.current) return;
    if (prevSubscribedRef.current === true && isSubscribed === false) {
      setTimeout(() => setCancelledSub(true), 500);
    }
    prevSubscribedRef.current = isSubscribed;
  }, [isSubscribed]);

  // Theme is now saved inside toggleTheme synchronously, no separate effect needed
  useEffect(() => {
    if (loaded) {
      AsyncStorage.setItem(KEYS.IS_SUBSCRIBED, isSubscribed ? 'true' : 'false');
      if (subscriptionEnd) AsyncStorage.setItem(KEYS.SUB_END, subscriptionEnd);
      else AsyncStorage.removeItem(KEYS.SUB_END);
    }
  }, [isSubscribed, subscriptionEnd, loaded]);

  const checkSubscriptionInner = async (_token?: string) => {
    // Session 201 — Apple reviewer super account ALWAYS has Pro so the
    // reviewer can audit every feature without going through StoreKit.
    // This check runs BEFORE any RevenueCat call so we never spend a
    // network round-trip verifying a fake entitlement.
    if (isSuperAccount(currentUserIdRef.current ? undefined : undefined, currentUserIdRef.current)) {
      // fall through only if we can compute the flag — will re-check via email below
    }
    try {
      // Session 201 — pull email from the current session so we don't
      // depend on React state which may not be primed yet on cold start.
      const { data: sessionData } = await supabase.auth.getUser();
      const email = sessionData?.user?.email ?? userEmail;
      const uid = sessionData?.user?.id ?? currentUserIdRef.current;
      if (isSuperAccount(email, uid)) {
        const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        setIsSubscribed(true);
        setSubscriptionEnd(oneYear);
        setCancelAtPeriodEnd(false);
        AsyncStorage.setItem(KEYS.IS_SUBSCRIBED, 'true').catch(() => {});
        AsyncStorage.setItem(KEYS.SUB_END, oneYear).catch(() => {});
        if (!initialSubCheckDone.current) {
          initialSubCheckDone.current = true;
          prevSubscribedRef.current = true;
        }
        setSubscriptionInitialCheckDone(true);
        return;
      }
    } catch { /* fall through to normal RC check */ }
    // Session 190 — RELEASE HARDENING.
    // The iOS shipping app now determines Pro entitlement EXCLUSIVELY from
    // legitimate StoreKit / RevenueCat. Every previous non-IAP grant path
    // has been removed:
    //   • promo_activations lookup — REMOVED (Apple rejected custom promo
    //     unlocking; verify-promo-code is disabled server-side).
    //   • Stripe check-subscription fallback — REMOVED (external / web
    //     billing cannot grant iOS paid digital access; Apple Guideline 3.1.1).
    // Only RevenueCat active entitlement counts. If RevenueCat says the
    // user is not subscribed, they are not subscribed — full stop.
    try {
      const rcResult = await checkRCSubscription();
      if (!initialSubCheckDone.current) {
        initialSubCheckDone.current = true;
        prevSubscribedRef.current = rcResult.isSubscribed;
      }
      setIsSubscribed(rcResult.isSubscribed);
      setSubscriptionEnd(rcResult.expirationDate);
      setCancelAtPeriodEnd(!rcResult.willRenew);
      AsyncStorage.setItem(KEYS.IS_SUBSCRIBED, rcResult.isSubscribed ? 'true' : 'false').catch(() => {});
    } catch (e) {
      console.log('[SUB] RevenueCat entitlement check failed:', e);
    } finally {
      // Session 199 — signal to the tabs layout that RC has responded so
      // it can safely decide whether to show the paywall. Fires exactly
      // once per app lifetime whether the check succeeded or failed.
      setSubscriptionInitialCheckDone(true);
    }
  };

  // Session 199 — SAFETY WATCHDOG for the paywall gate. If RevenueCat
  // never resolves (module missing, offline, catastrophic init failure)
  // we still flip subscriptionInitialCheckDone true after 4 seconds so
  // the tabs layout doesn't wait forever. In that case isSubscribed stays
  // false and the paywall is presented normally — the same fail-safe
  // behavior we had before this change.
  useEffect(() => {
    if (!isLoggedIn) return;
    if (subscriptionInitialCheckDone) return;
    const t = setTimeout(() => setSubscriptionInitialCheckDone(true), 4000);
    return () => clearTimeout(t);
  }, [isLoggedIn, subscriptionInitialCheckDone]);

  const checkSubscription = useCallback(async () => {
    setSubscriptionLoading(true);
    await checkSubscriptionInner();
    setSubscriptionLoading(false);
  }, []);

  const markSubPromptSeen = useCallback(() => {
    setHasSeenSubPrompt(true);
  }, []);

  // Session 114 #3 — periodic subscription check ONLY.
  //
  // The old version of this effect polled `supabase.auth.getSession()` every
  // 60s and force-logged-out after 3 consecutive failures — that was the
  // root cause of users being randomly kicked out of the app on transient
  // network glitches, backgrounding-then-foregrounding, and during Supabase's
  // routine background token refresh (which briefly returns no session).
  //
  // Session expiry is now handled EXCLUSIVELY by
  // `supabase.auth.onAuthStateChange` at the top of this file — which fires
  // SIGNED_OUT / TOKEN_REFRESHED / SIGNED_IN reliably and is the officially
  // supported mechanism. If the token actually expires or is revoked, that
  // listener will fire SIGNED_OUT and our state clears correctly. We never
  // force a logout based on polling anymore.
  useEffect(() => {
    if (!isLoggedIn) return;
    const interval = setInterval(() => {
      checkSubscriptionInner().catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);



  // Session 204 — track broker-held tickers so refreshStocks pulls
  // live Yahoo quotes for them and the Home Active Trades card shows
  // accurate NOW prices + real-time P/L instead of falling back to the
  // stored execution price.
  const [brokerTickers, setBrokerTickers] = useState<string[]>([]);
  useEffect(() => {
    if (!loaded || !isLoggedIn || !currentUserIdRef.current) { setBrokerTickers([]); return; }
    let cancelled = false;
    const readBrokerTickers = async () => {
      try {
        const { data } = await supabase
          .from('user_broker_connections')
          .select('positions_snapshot')
          .maybeSingle();
        if (cancelled) return;
        const positions = Array.isArray(data?.positions_snapshot) ? (data!.positions_snapshot as any[]) : [];
        const tickers = Array.from(new Set(
          positions
            .map((p) => String(p?.ticker ?? '').toUpperCase())
            .filter((t) => t.length > 0 && Math.abs(Number(positions.find((x: any) => String(x?.ticker ?? '').toUpperCase() === t)?.quantity) || 0) > 0),
        ));
        setBrokerTickers(tickers);
      } catch { /* keep last known */ }
    };
    readBrokerTickers();
    const iv = setInterval(readBrokerTickers, 15_000);
    const unsub = subscribeBrokerRefresh(() => { readBrokerTickers().catch(() => {}); });
    return () => { cancelled = true; clearInterval(iv); try { unsub(); } catch { /* swallow */ } };
  }, [loaded, isLoggedIn]);

  // Fetch stock data
  const refreshStocks = useCallback(async () => {
    const allTickers = [...new Set([...watchlist, ...portfolio.map(p => p.ticker), ...brokerTickers])];
    if (allTickers.length === 0) {
      setStockDataMap(new Map());
      return;
    }

    if (refreshInProgress.current) return;
    refreshInProgress.current = true;

    try {
      const quotes = await fetchMultipleQuotes(allTickers);
      const newMap = new Map<string, StockData>();
      const existingMap = prevStockDataRef.current;

      const chartPromises = allTickers.map(async (symbol) => {
        const quote = quotes.get(symbol);
        if (!quote) return;

        let chartData: number[] = existingMap.get(symbol)?.chartData ?? [];
        if (chartData.length < 3) {
          try {
            chartData = await fetchChartData(symbol, '1mo', '1d');
          } catch {
            chartData = Array.from({ length: 20 }, (_, i) => quote.price * (0.95 + 0.005 * i));
          }
        }

        const analysis = analyzeStock(chartData, quote.price, quote.change, quote.changePercent);
        const info = AVAILABLE_STOCKS.find(s => s.ticker === symbol);
        newMap.set(symbol, { quote, chartData, analysis, sector: info?.sector ?? 'Unknown' });
      });

      await Promise.all(chartPromises);

      // Notifications - only send during market hours
      const isMarketHoursNow = isMarketDay();
      const prefs = await getNotificationPrefs();
      // Session 214 — PRICE MOVEMENT NOTIFICATIONS PERMANENTLY DISABLED.
      // Previous versions iterated over stockDataMap and fired
      // sendPriceAlert when a watchlist ticker moved >X% since the last
      // poll. Per user request, that category is now gone entirely and
      // sendPriceAlert itself is a no-op — see notificationService.ts.
      // AI signal alerts: Pro-only, BUY/SELL with >=90% confidence
      if (isSubscribed && prefs.enabled && prefs.aiSignals && isMarketHoursNow) {
        for (const [symbol, stockData] of newMap) {
          const prevData = prevStockDataRef.current.get(symbol);
          // Only send for very high-confidence BUY/SELL signals (>=90%) that changed from a different signal
          if (stockData.analysis.signal !== 'HOLD' && stockData.analysis.confidence >= 90) {
            if (prevData && prevData.analysis.signal !== stockData.analysis.signal) {
              try {
                await sendAISignalAlert(
                  symbol, stockData.analysis.signal, stockData.analysis.confidence,
                  stockData.analysis.reasoning[0] ?? 'Signal changed'
                );
              } catch (e) {
                console.log('[NOTIF] AI signal alert failed:', e);
              }
            }
          }
        }
      }

      // Session 170 — Breakout alerts REMOVED. The user asked for them to
      // be replaced with Stock Market Open notifications, which are handled
      // by the sendMarketOpenNotification() block below at 9:30 AM ET only.
      // No breakout detection or high/low crossing alerts are fired anymore.

      // Market open notification + reset alert tracking
      const et = getNYTime();
      const totalMinutes = et.hours * 60 + et.minutes;

      if (isMarketDay() && totalMinutes >= 9 * 60 + 30 && totalMinutes <= 9 * 60 + 35 && !marketOpenNotifSent.current) {
        marketOpenNotifSent.current = true;
        // Reset per-session alert tracking at market open so alerts can fire fresh each day
        resetPriceAlertTracking();
        resetAISignalTracking();
        let totalValue = 0;
        portfolio.forEach(item => {
          const data = newMap.get(item.ticker);
          if (data) totalValue += data.quote.price * item.shares;
        });
        await sendMarketOpenNotification(totalValue > 0 ? totalValue : undefined);
        setTimeout(() => { marketOpenNotifSent.current = false; }, 6.5 * 60 * 60 * 1000);
      }

      prevStockDataRef.current = newMap;
      setStockDataMap(newMap);
    } catch {} finally {
      refreshInProgress.current = false;
      setIsLoadingStocks(false);
    }
  }, [watchlist, portfolio, brokerTickers]);

  // Auto-refresh stocks — immediate first load, then every 3s for faster
  // live updates. Reduced from 5s (Session 170) so prices, portfolio value
  // and everything else feels closer to real-time.
  // Also start loading from local cache before cloud sync completes for
  // instant display on restart.
  useEffect(() => {
    if (!loaded || !isLoggedIn) return;
    // Start refresh as soon as we have local data (don't wait for cloud sync)
    // stockSyncReadyState ensures cloud data will override, but local data loads first
    if (stockSyncReadyState || watchlist.length > 0 || portfolio.length > 0 || brokerTickers.length > 0) {
      refreshStocks();
      const interval = setInterval(refreshStocks, 3000);
      return () => clearInterval(interval);
    }
  }, [loaded, isLoggedIn, stockSyncReadyState, watchlist.length, portfolio.length, brokerTickers.length]);

  // Session 114 #3 — split notification scheduling into two effects.
  // Previously a single effect depended on `stockDataMap` which refreshes
  // every 5 seconds — meaning the daily summary was being cancelled and
  // rescheduled 12 times per minute, which prevented it from ever firing
  // reliably. Now:
  //   (1) Market-open notification is scheduled once per login.
  //   (2) Daily summary is rescheduled only when the watchlist / portfolio
  //       COMPOSITION changes (adding/removing stocks), or the first time
  //       stock data becomes available. The DAILY trigger stays in place
  //       across app restarts and re-fires every 8:30 AM local time.
  useEffect(() => {
    if (loaded && isLoggedIn) {
      scheduleMarketOpenNotification().catch(() => {});
    }
  }, [loaded, isLoggedIn]);

  useEffect(() => {
    if (!loaded || !isLoggedIn) return;
    // Wait until we have at least some stock data before scheduling — this
    // guarantees the notification body shows the real portfolio value on the
    // lock screen, not $0.
    if (portfolio.length > 0 && stockDataMap.size === 0) return;
    const allTickers = [...new Set([...watchlist, ...portfolio.map(p => p.ticker)])];
    let currentPortfolioValue = 0;
    portfolio.forEach(item => {
      const data = stockDataMap.get(item.ticker);
      if (data) {
        const currentVal = data.quote.price * item.shares;
        const costVal = item.avgCost * item.shares;
        if (item.position === 'short') {
          currentPortfolioValue += costVal + (costVal - currentVal);
        } else {
          currentPortfolioValue += currentVal;
        }
      } else {
        currentPortfolioValue += item.avgCost * item.shares;
      }
    });
    scheduleDailySummary(
      allTickers,
      currentPortfolioValue > 0 ? currentPortfolioValue : undefined,
    ).catch(() => {});
    // Depend on LENGTHS (not the full arrays / maps) so this effect only runs
    // when the number of watched/held stocks or the number of loaded quotes
    // changes — not on every 5-second price refresh.
  }, [loaded, isLoggedIn, watchlist.length, portfolio.length, stockDataMap.size]);

  // Auth methods
  const signup = useCallback(async (identifier: string, password: string, name: string) => {
    try {
      // Check if email already has a CONFIRMED active account
      // Strategy: check user_profiles (the real source of truth for active accounts)
      // If a profile exists for this email, the account is real and active
      // If no profile exists, the email is free (even if a ghost auth record lingers)
      try {
        const { data: profileCheck, error: profileErr } = await supabase
          .from('user_profiles')
          .select('id')
          .eq('email', identifier)
          .maybeSingle();
        if (!profileErr && profileCheck) {
          return { success: false, error: 'An account with this email already exists. Please log in instead.' };
        }
        // No profile found = email is free to use
      } catch {
        // Network error - try RPC as fallback
        try {
          const { data: existsData, error: rpcErr } = await supabase.rpc('check_email_exists', { check_email: identifier });
          if (!rpcErr && existsData === true) {
            return { success: false, error: 'An account with this email already exists. Please log in instead.' };
          }
        } catch {}
      }

      // If a ghost auth record exists (deleted account whose auth wasn't fully removed),
      // try to delete it first so signUp can succeed
      try {
        const { data: rpcExists } = await supabase.rpc('check_email_exists', { check_email: identifier });
        // If RPC says no active user but signUp might still find a ghost, that is handled below
      } catch {}

      const { data, error } = await supabase.auth.signUp({
        email: identifier,
        password,
        options: { data: { username: name, full_name: name } },
      });

      if (error) {
        // Handle specific error cases
        const msg = error.message || '';
        if (msg.includes('already registered') || msg.includes('already been registered')) {
          // The email exists in auth.users but has no profile (ghost record from deletion)
          // Tell user to try again or contact support
          return { success: false, error: 'There was an issue with this email. Please try a different email or contact support.' };
        }
        return { success: false, error: msg };
      }

      // Supabase returns fake success for existing emails (identities array is empty)
      if (data.user && (!data.user.identities || data.user.identities.length === 0)) {
        // Ghost auth record exists - email appears taken at auth level but no profile exists
        // This happens when account was deleted but auth record persisted
        return { success: false, error: 'There was an issue with this email. Please try a different email or contact support.' };
      }

      if (data.user) {
        currentUserIdRef.current = data.user.id;
        setUserName(name);
        setIsLoggedIn(true);
        setUserEmail(data.user.email ?? '');

        // Reset ALL state for a brand new account
        setHasAcceptedDisclaimer(false);
        setDontShowDisclaimer(false);
        setHasSeenSubPrompt(false);
        setCancelledSub(false);
        prevSubscribedRef.current = false;
        initialSubCheckDone.current = false;
        setIsSubscribed(false);
        setSubscriptionEnd(null);
        setCancelAtPeriodEnd(false);
        setWatchlist([]);
        setPortfolio([]);
        setClosedTrades([]);
        setActiveAISignals([]);
        setAISignalsTakenIds([]);
        setAISignalsMissedIds([]);
        setHasCompletedOnboardingState(false);
        setHasSeenIntroOfferState(false);
        setHasCompletedTutorialState(false);
        setTradingPasswordUnlocked(false);
        stockSyncReadyRef.current = false;
        setStockSyncReadyState(false);
        userFlagsLoadedRef.current = true;
        setUserFlagsLoaded(true);

        // Persist reset to AsyncStorage
        try {
          await Promise.all([
            AsyncStorage.removeItem(KEYS.DISCLAIMER),
            AsyncStorage.removeItem(KEYS.DONT_SHOW),
            AsyncStorage.setItem(KEYS.IS_SUBSCRIBED, 'false'),
            AsyncStorage.removeItem(KEYS.SUB_END),
            AsyncStorage.setItem(KEYS.WATCHLIST, '[]'),
            AsyncStorage.setItem(KEYS.PORTFOLIO, '[]'),
            AsyncStorage.setItem(KEYS.ONBOARDING_DONE, 'false'),
            AsyncStorage.setItem(KEYS.INTRO_OFFER_SEEN, 'false'),
            AsyncStorage.setItem(KEYS.TUTORIAL_DONE, 'false'),
            AsyncStorage.setItem(KEYS.LAST_USER_ID, data.user!.id),
          ]);
        } catch {}
        lastStoredUserIdRef.current = data.user.id;

        // Ensure the user profile has all onboarding flags reset
        // (Important for re-created accounts using a previously deleted email)
        try {
          // Wait a moment for the handle_new_user trigger to create the profile
          await new Promise(r => setTimeout(r, 800));
          await supabase.from('user_profiles').update({
            onboarding_completed: false,
            intro_offer_seen: false,
            tutorial_completed: false,
            disclaimer_accepted: false,
            dont_show_disclaimer: false,
          }).eq('id', data.user.id);
        } catch {}

        // Initialize stock sync for the new account
        try {
          await supabase.from('user_watchlists').upsert({
            user_id: data.user.id,
            watchlist: [],
            portfolio: [],
          }, { onConflict: 'user_id' });
          stockSyncReadyRef.current = true;
          setStockSyncReadyState(true);
        } catch {}

        // Register device session
        registerDeviceSession(data.user.id);
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message ?? 'Signup failed' };
    }
  }, []);

  const login = useCallback(async (identifier: string, password: string) => {
    try {
      // Session 201 — Apple reviewer super account. If the login attempt
      // uses the reviewer credentials, we ALSO make sure the profile has
      // all onboarding flags flipped true and the Journal is populated
      // before returning. The account itself is created via SQL migration,
      // but this defensive path also handles the case where the account
      // was manually deleted after seeding.
      const superAcct = identifier.toLowerCase().trim() === SUPER_ACCOUNT_EMAIL && password === 'zaqwsxcd';
      const { data, error } = await supabase.auth.signInWithPassword({ email: identifier, password });
      if (error) {
        const msg = error.message || '';
        if (msg.includes('Invalid login credentials')) {
          // Generic message - could be wrong password OR non-existent account
          // Don't reveal whether the account exists for security
          return { success: false, error: 'Invalid email or password. Please check your credentials or sign up for a new account.' };
        }
        if (msg.includes('banned') || msg.includes('User is banned')) {
          // Banned users are soft-deleted - treat as non-existent
          return { success: false, error: 'No account found with this email. Please sign up to create a new account.' };
        }
        if (msg.includes('Email not confirmed') || msg.includes('not confirmed')) {
          return { success: false, error: 'Please verify your email first. Check your inbox for the verification code.' };
        }
        return { success: false, error: msg };
      }
      if (data.user) {
        // Check if user was soft-deleted (banned + marked)
        const userMeta = data.user.user_metadata;
        const appMeta = data.user.app_metadata;
        if (userMeta?.deleted || appMeta?.deleted) {
          try { await supabase.auth.signOut(); } catch {}
          return { success: false, error: 'No account found with this email. Please sign up to create a new account.' };
        }

        // Check if user_profiles exists - if not, it is a ghost auth record
        // This can happen if the profile was deleted but auth record persisted
        try {
          const { data: profileCheck } = await supabase
            .from('user_profiles')
            .select('id')
            .eq('id', data.user.id)
            .maybeSingle();
          if (!profileCheck) {
            // No profile = ghost record. Sign out and tell user to sign up fresh
            try { await supabase.auth.signOut(); } catch {}
            return { success: false, error: 'No account found with this email. Please sign up to create a new account.' };
          }
        } catch {
          // Network error - allow login to proceed
        }

        // Immediately check cached subscription status to prevent paywall flash
        try {
          const cachedSub = await AsyncStorage.getItem(KEYS.IS_SUBSCRIBED);
          if (cachedSub === 'true') {
            setIsSubscribed(true);
          }
        } catch {}

        // Check device limit - enforce for ALL users (max 2 devices)
        const deviceId = deviceIdRef.current;
        try {
          const { data: sessions } = await supabase
            .from('active_sessions')
            .select('*')
            .eq('user_id', data.user.id)
            .order('last_active_at', { ascending: false });

          if (sessions) {
            const now = Date.now();
            const STALE_THRESHOLD = 2 * 60 * 1000;
            const activeSessions = sessions.filter(s => (now - new Date(s.last_active_at).getTime()) < STALE_THRESHOLD);
            const staleSessions = sessions.filter(s => (now - new Date(s.last_active_at).getTime()) >= STALE_THRESHOLD);

            // Clean up stale sessions
            for (const stale of staleSessions) {
              try {
                await supabase.from('active_sessions').delete()
                  .eq('user_id', data.user.id)
                  .eq('device_id', stale.device_id);
              } catch {}
            }

            const isThisDevice = activeSessions.some(s => s.device_id === deviceId);
            if (!isThisDevice && activeSessions.length >= 2) {
              try { await supabase.auth.signOut(); } catch {}
              return {
                success: false,
                error: 'This account is currently active on 2 devices. Please sign out of another device first to sign in here.',
              };
            }
          }
        } catch {
          // Device check failed - allow login to proceed
        }

        setHasSeenSubPrompt(false);
        setTradingPasswordUnlocked(false);

        // Session 201 — force reviewer-account state BEFORE returning
        // success. This runs synchronously inside login() so the flags
        // are set in Supabase before onAuthStateChange fires and the
        // router evaluates onboarding state.
        if (superAcct) {
          try {
            await supabase.from('user_profiles').update({
              onboarding_completed: true,
              intro_offer_seen: true,
              tutorial_completed: true,
              disclaimer_accepted: true,
              dont_show_disclaimer: true,
              username: 'Tester',
            }).eq('id', data.user.id);
            // Also mark local state immediately so the router doesn't
            // race the onAuthStateChange → loadUserFlagsFromDB round-trip.
            setHasCompletedOnboardingState(true);
            setHasSeenIntroOfferState(true);
            setHasCompletedTutorialState(true);
            setHasAcceptedDisclaimer(true);
            setDontShowDisclaimer(true);
            setIsSubscribed(true);
            setSubscriptionInitialCheckDone(true);
            userFlagsLoadedRef.current = true;
            setUserFlagsLoaded(true);
            await AsyncStorage.multiSet([
              [KEYS.ONBOARDING_DONE, 'true'],
              [KEYS.INTRO_OFFER_SEEN, 'true'],
              [KEYS.TUTORIAL_DONE, 'true'],
              [KEYS.DISCLAIMER, 'true'],
              [KEYS.DONT_SHOW, 'true'],
              [KEYS.IS_SUBSCRIBED, 'true'],
            ]);
          } catch (e) {
            console.log('[Sight] super-account state hydration failed (non-fatal)', (e as any)?.message);
          }
        }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message ?? 'Login failed' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        // Session 174 — remove this device's push token from user_push_tokens
        // so server-side notification workers stop delivering pushes for the
        // signed-out account. The token itself is regenerated on next login.
        try {
          const AsyncStore = (await import('@react-native-async-storage/async-storage')).default;
          const storedToken = await AsyncStore.getItem('ts_push_token');
          if (storedToken) {
            await supabase.from('user_push_tokens').delete()
              .eq('user_id', session.user.id)
              .eq('expo_push_token', storedToken);
          }
        } catch {}
        await supabase.from('active_sessions').delete()
          .eq('user_id', session.user.id)
          .eq('device_id', deviceIdRef.current);
      }
    } catch {}

    // Stop all sync
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    stockSyncReadyRef.current = false;
    setStockSyncReadyState(false);

    // Log out from RevenueCat
    logoutRC().catch(() => {});

    await supabase.auth.signOut();
    currentUserIdRef.current = '';
    setIsLoggedIn(false);
    setUserEmail('');
    setUserName('');
    setIsSubscribed(false);
    setSubscriptionEnd(null);
    setHasSeenSubPrompt(false);
    setCancelledSub(false);
    prevSubscribedRef.current = null;
    initialSubCheckDone.current = false;
    setWatchlist([]);
    setPortfolio([]);
    setClosedTrades([]);
    setActiveAISignals([]);
    setAISignalsTakenIds([]);
    setAISignalsMissedIds([]);
    setStockDataMap(new Map());
    setTradingPasswordUnlocked(false);
    await AsyncStorage.setItem(KEYS.IS_SUBSCRIBED, 'false');
    await AsyncStorage.removeItem(KEYS.SUB_END);
    // Clear watchlist/portfolio from AsyncStorage so a different user
    // logging in on this device cannot inherit the previous user's stocks
    // via the "cloud empty → preserve local" reconciliation path added
    // in the Session 107 persistence fix.
    await AsyncStorage.setItem(KEYS.WATCHLIST, '[]');
    await AsyncStorage.setItem(KEYS.PORTFOLIO, '[]');
  }, []);

  const updateUserName = useCallback(async (name: string) => {
    setUserName(name);
    await supabase.auth.updateUser({ data: { username: name, full_name: name } });
  }, []);

  const setHasCompletedOnboarding = useCallback(async (v: boolean) => {
    setHasCompletedOnboardingState(v);
    AsyncStorage.setItem(KEYS.ONBOARDING_DONE, v ? 'true' : 'false');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('user_profiles').update({ onboarding_completed: v }).eq('id', session.user.id);
      }
    } catch {}
  }, []);

  const setHasSeenIntroOffer = useCallback(async (v: boolean) => {
    setHasSeenIntroOfferState(v);
    AsyncStorage.setItem(KEYS.INTRO_OFFER_SEEN, v ? 'true' : 'false');
    // Also mark device-level intro offer tracking
    if (v) {
      AsyncStorage.setItem('ts_device_intro_offer_used', 'true');
    }
    // Persist to database
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('user_profiles').update({ intro_offer_seen: v }).eq('id', session.user.id);
      }
    } catch {}
  }, []);

  const setHasCompletedTutorial = useCallback(async (v: boolean) => {
    setHasCompletedTutorialState(v);
    AsyncStorage.setItem(KEYS.TUTORIAL_DONE, v ? 'true' : 'false');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('user_profiles').update({ tutorial_completed: v }).eq('id', session.user.id);
      }
    } catch {}
  }, []);



  const analyzeChartImage = useCallback(async (base64: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');

    const { data, error } = await supabase.functions.invoke('analyze-chart', {
      body: { imageBase64: base64 },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (error) {
      let errorMessage = error.message;
      if (error instanceof FunctionsHttpError) {
        try { errorMessage = await error.context?.text() ?? errorMessage; } catch {}
      }
      throw new Error(errorMessage);
    }

    return data;
  }, []);

  const initNotifications = useCallback(async () => {
    const granted = await requestNotificationPermissions();
    setNotificationsEnabled(granted);
    if (granted) {
      const prefs = await getNotificationPrefs();
      if (prefs.dailySummary) await scheduleDailySummary();
      await scheduleMarketOpenNotification();
    }
    return granted;
  }, []);

  const toggleTheme = useCallback(() => {
    // Synchronous state update — no requestAnimationFrame for instant response
    setThemeMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      // Persist immediately (fire-and-forget)
      AsyncStorage.setItem(KEYS.THEME, next).catch(() => {});
      return next;
    });
  }, []);

  const acceptDisclaimer = useCallback(async (dontShowAgain: boolean) => {
    setHasAcceptedDisclaimer(true);
    setDontShowDisclaimer(true); // Always set to true - disclaimer is a one-time thing
    await AsyncStorage.setItem(KEYS.DISCLAIMER, 'true');
    await AsyncStorage.setItem(KEYS.DONT_SHOW, 'true');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('user_profiles').update({
          disclaimer_accepted: true,
          dont_show_disclaimer: true,
        }).eq('id', session.user.id);
      }
    } catch {}
  }, []);

  // Eagerly fetch data for a single newly added stock so it appears instantly
  const fetchSingleStockData = useCallback(async (ticker: string) => {
    try {
      const [quote] = await Promise.all([
        fetchMultipleQuotes([ticker]).then(m => m.get(ticker)),
      ]);
      if (!quote) return;
      let chartData: number[] = [];
      try { chartData = await fetchChartData(ticker, '1mo', '1d'); } catch {}
      if (chartData.length < 3) chartData = Array.from({ length: 20 }, (_, i) => quote.price * (0.95 + 0.005 * i));
      const analysis = analyzeStock(chartData, quote.price, quote.change, quote.changePercent);
      const info = AVAILABLE_STOCKS.find(s => s.ticker === ticker);
      setStockDataMap(prev => {
        const next = new Map(prev);
        const data = { quote, chartData, analysis, sector: info?.sector ?? 'Unknown' };
        next.set(ticker, data);
        prevStockDataRef.current = next;
        return next;
      });
    } catch {}
  }, []);

  const addToWatchlist = useCallback((ticker: string) => {
    setWatchlist(prev => {
      if (prev.includes(ticker)) return prev;
      return [...prev, ticker];
    });
    // Eagerly fetch data for this stock immediately
    if (!stockDataMap.has(ticker)) {
      fetchSingleStockData(ticker);
    }
  }, [stockDataMap, fetchSingleStockData]);

  // Check if free user can add more stocks (max 3 on watchlist)
  const canFreeUserAddStock = useCallback((): boolean => {
    if (isSubscribed) return true;
    return watchlist.length < 3;
  }, [isSubscribed, watchlist.length]);

  const removeFromWatchlist = useCallback((ticker: string) => {
    setWatchlist(prev => prev.filter(t => t !== ticker));
  }, []);

  const isInWatchlist = useCallback((ticker: string) => watchlist.includes(ticker), [watchlist]);

  const addToPortfolio = useCallback((ticker: string, shares: number, avgCost: number, position: 'long' | 'short' = 'long') => {
    setPortfolio(prev => {
      const existing = prev.find(p => p.ticker === ticker && p.position === position);
      if (existing) {
        const totalShares = existing.shares + shares;
        const totalCost = (existing.shares * existing.avgCost + shares * avgCost);
        const newAvg = totalShares > 0 ? totalCost / totalShares : avgCost;
        return prev.map(p => p.ticker === ticker && p.position === position ? { ...p, shares: totalShares, avgCost: newAvg } : p);
      }
      return [...prev, { ticker, shares, avgCost, position }];
    });
    setWatchlist(prev => {
      if (prev.includes(ticker)) return prev;
      return [...prev, ticker];
    });
    // Eagerly fetch data for this stock immediately
    if (!stockDataMap.has(ticker)) {
      fetchSingleStockData(ticker);
    }
  }, [stockDataMap, fetchSingleStockData]);

  const removeFromPortfolio = useCallback((ticker: string) => {
    setPortfolio(prev => prev.filter(p => p.ticker !== ticker));
  }, []);

  const removeStockCompletely = useCallback((ticker: string) => {
    setWatchlist(prev => prev.filter(t => t !== ticker));
    setPortfolio(prev => prev.filter(p => p.ticker !== ticker));
  }, []);

  const updatePortfolioItem = useCallback((ticker: string, shares: number) => {
    if (shares <= 0) {
      setPortfolio(prev => prev.filter(p => p.ticker !== ticker));
    } else {
      setPortfolio(prev => prev.map(p => p.ticker === ticker ? { ...p, shares } : p));
    }
  }, []);

  const searchStocks = useCallback((query: string) => searchAvailableStocks(query), []);
  const getStockData = useCallback((ticker: string) => stockDataMap.get(ticker), [stockDataMap]);

  // ==== SESSION 117 — TRADE SYSTEM ====
  const addTradeWithTPSL = useCallback((args: {
    ticker: string; shares: number; entryPrice: number; position: 'long' | 'short'; takeProfit: number; stopLoss: number;
    tradeType?: string;
    source?: 'ai_signal' | 'chart_scan' | 'manual'; aiContext?: AITradeContext;
  }): string => {
    const tradeId = 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const entryDate = new Date().toISOString();
    setPortfolio(prev => [
      ...prev,
      {
        ticker: args.ticker,
        shares: args.shares,
        avgCost: args.entryPrice,
        position: args.position,
        tradeId,
        takeProfit: args.takeProfit,
        stopLoss: args.stopLoss,
        entryDate,
        tradeType: args.tradeType,
        source: args.source ?? 'manual',
        aiContext: args.aiContext,
      },
    ]);
    // Session 215 — Active Trade and Watchlist are now INDEPENDENT states
    // per user request. Logging a trade does NOT remove the ticker from
    // the watchlist, and removing from watchlist does NOT close the trade.
    // A stock can appear in Watchlist and Active Trades simultaneously,
    // with each list showing the ticker no more than once (dedup happens
    // within each list). This restores the ability to keep price-move
    // alerts / watchlist tracking active on tickers you also hold.
    // Previously: `setWatchlist(prev => prev.filter(t => t !== args.ticker))`.
    // That line has been removed.
    if (!stockDataMap.has(args.ticker)) fetchSingleStockData(args.ticker);
    return tradeId;
  }, [stockDataMap, fetchSingleStockData]);

  const internalCloseTrade = useCallback((
    tradeId: string, exitPrice: number, reason: 'take_profit' | 'stop_loss' | 'manual',
  ): ClosedTrade | null => {
    let closed: ClosedTrade | null = null;
    setPortfolio(prev => {
      const item = prev.find(p => p.tradeId === tradeId);
      if (!item) return prev;
      const isLong = item.position === 'long';
      const pnl = isLong
        ? (exitPrice - item.avgCost) * item.shares
        : (item.avgCost - exitPrice) * item.shares;
      const costBasis = item.avgCost * item.shares;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      closed = {
        id: 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        ticker: item.ticker,
        shares: item.shares,
        entryPrice: item.avgCost,
        exitPrice,
        position: item.position,
        takeProfit: item.takeProfit ?? item.avgCost,
        stopLoss: item.stopLoss ?? item.avgCost,
        entryDate: item.entryDate ?? new Date().toISOString(),
        exitDate: new Date().toISOString(),
        exitReason: reason,
        pnl,
        pnlPercent,
        tradeType: item.tradeType,
        source: item.source,
      };
      return prev.filter(p => p.tradeId !== tradeId);
    });
    if (closed) setClosedTrades(prev => [closed as ClosedTrade, ...prev].slice(0, 500));
    return closed;
  }, []);

  const closeTradeManually = useCallback((tradeId: string, exitPrice: number): ClosedTrade | null => {
    return internalCloseTrade(tradeId, exitPrice, 'manual');
  }, [internalCloseTrade]);

  // Session 151 — log an arbitrary broker-executed sale into the Journal
  // even when there is no Sight-tracked trade in `portfolio` for that
  // ticker (used by the Stock Details "Sell" button when the position
  // exists only at the broker). The entry is created directly from
  // known parameters so the sale appears in the Journal alongside
  // Sight-tracked closes.
  const addManualClosedTrade = useCallback((args: {
    ticker: string; shares: number; entryPrice: number; exitPrice: number;
    position: 'long' | 'short'; tradeType?: string;
    source?: 'ai_signal' | 'chart_scan' | 'manual';
  }): ClosedTrade => {
    const isLong = args.position === 'long';
    const pnl = isLong
      ? (args.exitPrice - args.entryPrice) * args.shares
      : (args.entryPrice - args.exitPrice) * args.shares;
    const costBasis = args.entryPrice * args.shares;
    const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
    const now = new Date().toISOString();
    const closed: ClosedTrade = {
      id: 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      ticker: args.ticker,
      shares: args.shares,
      entryPrice: args.entryPrice,
      exitPrice: args.exitPrice,
      position: args.position,
      takeProfit: args.entryPrice,
      stopLoss: args.entryPrice,
      entryDate: now,
      exitDate: now,
      exitReason: 'manual',
      pnl,
      pnlPercent,
      tradeType: args.tradeType,
      source: args.source ?? 'manual',
    };
    setClosedTrades(prev => [closed, ...prev].slice(0, 500));
    return closed;
  }, []);

  // Session 155 — SYNC BROKER ORDERS.
  //
  // Client polls snaptrade-sync-orders every 30s (and immediately on
  // foreground / login) so the app catches fills that happened at the
  // broker while Sight was closed. When an order transitions to FILLED
  // (or PARTIALLY_FILLED), we:
  //   1. Log the completed sell/buy to the Journal via addManualClosedTrade
  //      for SELL orders, so users see the closed trade instantly.
  //   2. Prune the corresponding Active Trade for SELL orders that closed
  //      an existing Sight-tracked position.
  //   3. Stamp `journal_synced_at` on trade_submissions so subsequent
  //      polls never double-journal the same fill.
  //
  // Session 175 — PARTIAL FILL SAFETY. The previous version processed
  // BOTH FILLED and PARTIALLY_FILLED rows and stamped journal_synced_at
  // immediately, which meant subsequent fills for the same order were
  // silently discarded. The corrected pattern journals ONLY when the
  // broker reports the order as fully FILLED. Partial fills remain in
  // trade_submissions with journal_synced_at IS NULL until they either
  // become FILLED (journal on that pass) or reach a terminal REJECTED /
  // CANCELED state. This guarantees each real broker execution reaches
  // the Journal exactly once and no fill is ever lost.
  //
  // BUY orders don't create Journal entries (they open a position), but
  // they still get their journal_synced_at stamped when FILLED so we know
  // we've processed them and Active Trades can be updated by the broker
  // sync.
  const syncBrokerOrders = useCallback(async (): Promise<void> => {
    if (!isLoggedIn || !currentUserIdRef.current) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      // Kick the server-side status check first — this updates status +
      // filled_quantity/filled_price on trade_submissions to reflect the
      // broker's current view. Returns the deltas but we re-read from DB
      // below for consistency in the multi-device case.
      try {
        await supabase.functions.invoke('snaptrade-sync-orders', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      } catch (e) {
        // Non-fatal — the client can still process any previously-updated rows.
        console.log('[Sight] snaptrade-sync-orders failed', (e as any)?.message ?? e);
      }
      // Read only FULLY FILLED submissions we haven't journaled yet.
      // Partial fills stay unprocessed until the broker fills them
      // completely, guaranteeing one journal entry per closed trade.
      const { data: rows } = await supabase
        .from('trade_submissions')
        .select('id, ticker, action, quantity, filled_quantity, filled_price, price, status, account_id, submitted_at')
        .eq('user_id', currentUserIdRef.current)
        .is('journal_synced_at', null)
        .eq('status', 'FILLED');
      const filled = Array.isArray(rows) ? rows : [];
      if (filled.length === 0) return;
      for (const row of filled) {
        try {
          const filledQty = Number(row.filled_quantity ?? row.quantity ?? 0) || 0;
          if (filledQty <= 0) continue;
          const filledPx = Number(row.filled_price ?? row.price ?? 0) || 0;
          if (row.action === 'SELL' && filledPx > 0) {
            // Try to attach to an existing Sight-tracked active trade for
            // this ticker so we can close it out cleanly. Otherwise fall
            // back to a manual journal entry using the current live entry
            // reference we already have on hand (avg cost from the trade).
            const matching = portfolio.find(
              (p) => p.tradeId && p.ticker === row.ticker,
            );
            if (matching?.tradeId) {
              internalCloseTrade(matching.tradeId, filledPx, 'manual');
            } else {
              addManualClosedTrade({
                ticker: row.ticker,
                shares: filledQty,
                entryPrice: Number(row.price ?? filledPx) || filledPx,
                exitPrice: filledPx,
                position: 'long',
                tradeType: 'Broker Sell',
                source: 'manual',
              });
            }
          }
          // Mark this submission as journaled so we never process it twice.
          await supabase
            .from('trade_submissions')
            .update({ journal_synced_at: new Date().toISOString() })
            .eq('id', row.id);
        } catch (e) {
          console.log('[Sight] journal filled order failed', (e as any)?.message ?? e);
        }
      }
      // Session 199 — whenever we detect any newly-FILLED broker order
      // (BUY or SELL), immediately trigger a broker refresh so
      // useBrokerConnection re-reads the persisted snapshot AND fires a
      // fresh sync call. New BUY positions therefore appear in the
      // Home tab's Active Trades section within a couple of seconds
      // instead of waiting for the 20-40s polling cycle. SELL fills
      // also refresh the account balances so Portfolio Value is
      // accurate.
      if (filled.length > 0) {
        try { triggerBrokerRefresh(); } catch { /* swallow */ }
      }
    } catch (e) {
      console.log('[Sight] syncBrokerOrders exception', (e as any)?.message ?? e);
    }
  }, [isLoggedIn, portfolio, internalCloseTrade, addManualClosedTrade]);

  // Periodic broker-order sync while logged in. Fires immediately on mount
  // then every 30 seconds afterwards. The server enforces its own bounds
  // (only inspects last 7 days of non-terminal submissions) so this is
  // cheap and idempotent.
  useEffect(() => {
    if (!isLoggedIn) return;
    syncBrokerOrders().catch(() => {});
    // Session 198 — broker orders sync every 10s (was 15s) so filled
    // orders, TP/SL exits, and new open positions appear in Sight's
    // Active Trades / Journal within one polling cycle. Combined with
    // the 20s useBrokerConnection auto-refresh below, broker state now
    // feels effectively live throughout the trading session and the
    // Home tab's Active Trades section reflects the actual broker
    // account balance / positions with sub-15-second latency.
    const iv = setInterval(() => { syncBrokerOrders().catch(() => {}); }, 10_000);
    return () => clearInterval(iv);
  }, [isLoggedIn, syncBrokerOrders]);

  // Auto-close TP/SL check — runs after every stock refresh.
  //
  // Session 175 — SAFETY: the auto-close now SKIPS any trade when the
  // user has an active broker connection. This prevents Sight from
  // pretending a broker-backed position closed when in reality the
  // brokerage still owns the shares (which was the root cause of
  // Journal / Active Trades drifting out of sync with the broker). Real
  // broker exits are handled by syncBrokerOrders() above once the broker
  // reports a fully FILLED sell order. When the user has NO broker
  // connected the trade is a purely local paper trade, and the auto-
  // close continues to work as before so TP/SL still fire.
  useEffect(() => {
    if (!loaded || !isLoggedIn) return;
    if (stockDataMap.size === 0) return;
    // Skip entirely when a broker is connected — real fills come from
    // syncBrokerOrders(). This is the safety guard that prevents Sight
    // from locally closing broker-owned positions.
    if (hasBrokerConnectionRef.current) return;
    portfolio.forEach(item => {
      if (!item.tradeId || !item.takeProfit || !item.stopLoss) return;
      if (autoCloseInFlight.current.has(item.tradeId)) return;
      const data = stockDataMap.get(item.ticker);
      if (!data) return;
      const currentPrice = data.quote.price;
      const isLong = item.position === 'long';
      const hitTP = isLong ? currentPrice >= item.takeProfit : currentPrice <= item.takeProfit;
      const hitSL = isLong ? currentPrice <= item.stopLoss : currentPrice >= item.stopLoss;
      if (hitTP || hitSL) {
        autoCloseInFlight.current.add(item.tradeId);
        // Close at the exact TP or SL level (more accurate than momentary current price)
        const exitPrice = hitTP ? item.takeProfit : item.stopLoss;
        internalCloseTrade(item.tradeId, exitPrice, hitTP ? 'take_profit' : 'stop_loss');
      }
    });
  }, [stockDataMap, portfolio, loaded, isLoggedIn, internalCloseTrade]);

  // Session 175 — keep hasBrokerConnectionRef fresh so the TP/SL auto-
  // close effect can safely refuse to close broker-owned positions.
  // Queried once on login and every 60 s while the app is open.
  useEffect(() => {
    if (!loaded || !isLoggedIn) { hasBrokerConnectionRef.current = false; return; }
    let cancelled = false;
    const check = async () => {
      try {
        const { data } = await supabase
          .from('user_broker_connections')
          .select('status')
          .maybeSingle();
        if (cancelled) return;
        hasBrokerConnectionRef.current = data?.status === 'active';
      } catch { /* swallow — default to false (paper mode) on failure */ }
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [loaded, isLoggedIn]);

  // Session 200 — AUTO-JOURNAL HISTORICAL BROKER ACTIVITIES.
  //
  // When a user first connects a brokerage (or the sync surfaces newly-
  // discovered historical rows), we scan the broker's activities_snapshot
  // for completed BUY→SELL round-trips and journal each closed round-trip
  // as a ClosedTrade so the user's Journal is instantly populated with
  // their real trading history — no manual entry required.
  //
  // Algorithm:
  //   • Group activities by ticker (case-insensitive, uppercased).
  //   • Sort each ticker's activities chronologically (oldest first).
  //   • Walk through in order using a FIFO share ledger. Every BUY adds
  //     shares to the ledger with its execution price. Every SELL pops
  //     matching shares from the oldest BUY(s) and journals a ClosedTrade
  //     with the correct entry/exit/pnl per share matched.
  //   • Each generated ClosedTrade gets a deterministic id based on the
  //     activity id that produced it, and we track which activity ids
  //     have already been journaled in activities_journaled_ids so a
  //     subsequent sync never double-journals.
  //
  // The result: opening a fresh Sight account and connecting a broker
  // instantly surfaces every historical BUY→SELL trade in the Journal,
  // and any future broker sells (whether placed through Sight or the
  // broker's own app) also flow into the Journal. The effect runs on
  // every foreground and periodically — the internal function
  // short-circuits when no broker is connected so it's safe to schedule
  // unconditionally.
  useEffect(() => {
    if (!loaded || !isLoggedIn) return;
    if (!currentUserIdRef.current) return;
    let cancelled = false;

    const processHistoricalActivities = async () => {
      const userId = currentUserIdRef.current;
      if (!userId) return;
      // Short-circuit when no active broker connection — no work to do.
      if (!hasBrokerConnectionRef.current) return;
      try {
        const { data } = await supabase
          .from('user_broker_connections')
          .select('activities_snapshot, activities_journaled_ids')
          .eq('user_id', userId)
          .maybeSingle();
        if (cancelled || !data) return;
        const activities: any[] = Array.isArray(data.activities_snapshot) ? data.activities_snapshot : [];
        const journaledIds: string[] = Array.isArray(data.activities_journaled_ids) ? data.activities_journaled_ids : [];
        const journaledSet = new Set(journaledIds);
        if (activities.length === 0) return;

        // Group BUY/SELL activities by ticker.
        const byTicker = new Map<string, any[]>();
        for (const a of activities) {
          if (!a?.ticker || !a?.side || !a?.quantity) continue;
          if (a.side !== 'BUY' && a.side !== 'SELL') continue;
          const key = String(a.ticker).toUpperCase();
          const list = byTicker.get(key) ?? [];
          list.push(a);
          byTicker.set(key, list);
        }

        const newClosedTrades: ClosedTrade[] = [];
        const newlyJournaledActivityIds: string[] = [];

        for (const [ticker, acts] of byTicker.entries()) {
          // Chronological order — oldest fills come out of the ledger first.
          const sorted = [...acts].sort((a, b) => {
            const at = new Date(a.tradeDate ?? 0).getTime();
            const bt = new Date(b.tradeDate ?? 0).getTime();
            return at - bt;
          });
          // FIFO share ledger. Each entry is { shares, price, activityId, tradeDate }.
          const ledger: { shares: number; price: number; activityId: string; tradeDate: string | null }[] = [];
          for (const act of sorted) {
            const qty = Math.abs(Number(act.quantity) || 0);
            const px = Number(act.price) || 0;
            if (qty <= 0) continue;
            if (act.side === 'BUY') {
              ledger.push({ shares: qty, price: px, activityId: String(act.id), tradeDate: act.tradeDate ?? null });
            } else if (act.side === 'SELL') {
              // Skip if we've already journaled this sell.
              if (journaledSet.has(String(act.id))) continue;
              let remaining = qty;
              // Aggregate cost basis over all matched buys.
              let totalBuyCost = 0;
              let totalMatchedShares = 0;
              let earliestBuyDate: string | null = null;
              while (remaining > 0.00001 && ledger.length > 0) {
                const head = ledger[0];
                const take = Math.min(remaining, head.shares);
                totalBuyCost += take * head.price;
                totalMatchedShares += take;
                if (!earliestBuyDate && head.tradeDate) earliestBuyDate = head.tradeDate;
                head.shares -= take;
                remaining -= take;
                if (head.shares <= 0.00001) ledger.shift();
              }
              // Only journal a closed trade if we actually matched shares.
              if (totalMatchedShares > 0.00001 && px > 0) {
                const avgBuyPrice = totalBuyCost / totalMatchedShares;
                const pnl = (px - avgBuyPrice) * totalMatchedShares;
                const costBasis = avgBuyPrice * totalMatchedShares;
                const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
                const entryDate = earliestBuyDate ?? act.tradeDate ?? new Date().toISOString();
                const exitDate = act.tradeDate ?? new Date().toISOString();
                newClosedTrades.push({
                  id: 'bh_' + String(act.id).slice(0, 12) + '_' + Math.random().toString(36).slice(2, 6),
                  ticker,
                  shares: totalMatchedShares,
                  entryPrice: avgBuyPrice,
                  exitPrice: px,
                  position: 'long',
                  takeProfit: avgBuyPrice,
                  stopLoss: avgBuyPrice,
                  entryDate,
                  exitDate,
                  exitReason: 'manual',
                  pnl,
                  pnlPercent,
                  tradeType: 'Broker History',
                  source: 'manual',
                });
                newlyJournaledActivityIds.push(String(act.id));
              }
            }
          }
        }

        if (newClosedTrades.length === 0) return;

        // Merge into local state, avoiding duplicates on the deterministic id.
        setClosedTrades((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          const toAdd = newClosedTrades.filter((c) => !existing.has(c.id));
          if (toAdd.length === 0) return prev;
          // Newest first ordering.
          return [...toAdd, ...prev].slice(0, 1000);
        });

        // Persist which activity ids we've journaled so subsequent syncs
        // don't double-journal them.
        const nextJournaled = Array.from(new Set([...journaledIds, ...newlyJournaledActivityIds]));
        try {
          await supabase
            .from('user_broker_connections')
            .update({
              activities_journaled_ids: nextJournaled,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);
        } catch { /* swallow */ }
      } catch (e) {
        console.log('[Sight] processHistoricalActivities failed', (e as any)?.message ?? e);
      }
    };

    // Run immediately on mount, then every 60s while the app is open.
    // The function short-circuits when no broker is connected so this is
    // cheap when the user hasn't connected a brokerage.
    processHistoricalActivities();
    const iv = setInterval(() => { processHistoricalActivities().catch(() => {}); }, 60_000);
    // Also react to broker refresh events so a fresh sync (e.g. right
    // after a new fill) rechecks activities without waiting for the next
    // poll interval.
    const unsub = subscribeBrokerRefresh(() => {
      processHistoricalActivities().catch(() => {});
    });
    return () => { cancelled = true; clearInterval(iv); try { unsub(); } catch { /* swallow */ } };
  }, [loaded, isLoggedIn]);

  // Fetch active AI signals from Supabase.
  //
  // Session 182 — Dedup + separate loading vs refreshing.
  //   - aiSignalsLoading = true only for the FIRST fetch when there is
  //     nothing to display. Existing Moves stay visible during subsequent
  //     refreshes.
  //   - aiSignalsRefreshing = true during any refresh AFTER initial load.
  //   - aiSignalsRefreshInFlight dedupes concurrent callers so a screen
  //     focus + poll interval + pull-to-refresh landing at the same time
  //     result in exactly one network round-trip.
  //   - Provider failure preserves last-verified Moves (never wipes to
  //     empty during a failed refresh).
  const refreshAISignals = useCallback(async (force?: boolean): Promise<void> => {
    if (aiSignalsRefreshInFlight.current) return aiSignalsRefreshInFlight.current;
    const isInitial = activeAISignalsCountRef.current === 0;
    if (isInitial) setAISignalsLoading(true);
    else setAISignalsRefreshing(true);
    const promise = (async () => {
      try {
        // Optionally trigger regeneration via edge function
        if (force) {
          try {
            const { data: fnData } = await supabase.functions.invoke('generate-ai-signals', { body: {} });
            if (fnData) {
              setAIScanStats({
                universeSize: fnData.universeSize,
                screened: fnData.screened,
                candidates: fnData.candidates,
                actionable: fnData.actionable,
                marketStatus: fnData.marketStatus,
              });
            }
          } catch { /* preserve prior Moves on regeneration failure */ }
        }
        const { data, error } = await supabase
          .from('ai_signals')
          .select('*')
          .eq('status', 'active')
          .order('confidence', { ascending: false });
        if (!error && data) {
          const mapped: AISignal[] = data.map((r: any) => ({
            id: r.id,
            ticker: r.ticker,
            direction: r.direction,
            entry: Number(r.entry_price),
            takeProfit: Number(r.take_profit),
            stopLoss: Number(r.stop_loss),
            confidence: r.confidence,
            reasoning: r.reasoning ?? '',
            createdAt: r.created_at,
            status: r.status,
            tradeType: r.trade_type ?? undefined,
            companyName: r.company_name ?? undefined,
            sector: r.sector ?? undefined,
            reasoningSections: r.reasoning_sections ?? undefined,
            expectedDuration: r.expected_duration ?? undefined,
          }));
          setActiveAISignals(mapped);
          activeAISignalsCountRef.current = mapped.length;
        }
        // On error/empty: keep existing signals in state. Never wipe to empty during a failed refresh.
      } catch { /* preserve last-verified signals */ } finally {
        setAISignalsLoading(false);
        setAISignalsRefreshing(false);
        aiSignalsRefreshInFlight.current = null;
      }
    })();
    aiSignalsRefreshInFlight.current = promise;
    return promise;
  }, []);

  // Session 119 — Personalized AI position analysis (invoked from Stock Details).
  const analyzePosition = useCallback(async (tradeId: string): Promise<{ data?: any; error?: string }> => {
    const trade = portfolio.find(p => p.tradeId === tradeId);
    if (!trade || !trade.takeProfit || !trade.stopLoss) return { error: 'Trade not found or missing TP/SL.' };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { error: 'Not authenticated' };
      const { data, error } = await supabase.functions.invoke('analyze-my-position', {
        body: {
          tradeId,
          ticker: trade.ticker,
          position: trade.position,
          entryPrice: trade.avgCost,
          shares: trade.shares,
          takeProfit: trade.takeProfit,
          stopLoss: trade.stopLoss,
          entryDate: trade.entryDate,
          source: trade.source,
          aiContext: trade.aiContext,
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        let msg = error.message ?? 'Analysis failed';
        try {
          if (error instanceof FunctionsHttpError) {
            const text = await error.context?.text();
            if (text) msg = text;
          }
        } catch {}
        return { error: msg };
      }
      return { data };
    } catch (e: any) {
      return { error: e.message ?? 'Analysis failed' };
    }
  }, [portfolio]);

  // Session 205 — Ask Sight AI for broker-only positions.
  //
  // Same edge function as analyzePosition (analyze-my-position) but the
  // takeProfit / stopLoss fields are intentionally omitted because a
  // broker-imported position does not carry Sight-defined bracket levels.
  // The edge function detects this and produces a verdict that focuses on
  // current price action, trend, and well-established company context
  // rather than TP progression. The response shape is identical (verdict
  // + headline + summary + factors + currentPrice + pnl + pnlPercent) so
  // the Stock Details page can render the same AI verdict card.
  const analyzeBrokerPosition = useCallback(async (args: {
    ticker: string;
    position: 'long' | 'short';
    entryPrice: number;
    shares: number;
    currentPrice: number;
  }): Promise<{ data?: any; error?: string }> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return { error: 'Not authenticated' };
      const { data, error } = await supabase.functions.invoke('analyze-my-position', {
        body: {
          ticker: args.ticker,
          position: args.position,
          entryPrice: args.entryPrice,
          shares: args.shares,
          currentPrice: args.currentPrice,
          source: 'broker',
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) {
        let msg = error.message ?? 'Analysis failed';
        try {
          if (error instanceof FunctionsHttpError) {
            const text = await error.context?.text();
            if (text) msg = text;
          }
        } catch {}
        return { error: msg };
      }
      return { data };
    } catch (e: any) {
      return { error: e.message ?? 'Analysis failed' };
    }
  }, []);

  // Session 118 — continuous background AI signal refresh.
  //
  // The client polls every 90 seconds while logged in. The generate-ai-signals
  // edge function has its own internal cooldown (3 min) so polling doesn't
  // waste OnSpace credits — most polls just return the cached signal set with
  // fresh entry prices, and only every 3rd minute do we actually re-run the
  // Stage-1 screen + Stage-2 AI analysis pipeline. The user never has to press
  // a refresh button.
  //
  // Also force a refresh whenever the Signals tab is opened (via the tab
  // layout mounting the component) — this is handled inside signals.tsx by
  // calling refreshAISignals(false) on mount.
  useEffect(() => {
    if (!isLoggedIn) return;
    // First fetch just loads currently-active signals from DB (cheap).
    refreshAISignals(false);
    // Then trigger a background regeneration attempt to freshen entry prices.
    // The edge function's cooldown prevents this from being expensive.
    const backgroundTrigger = setTimeout(() => refreshAISignals(true).catch(() => {}), 2000);
    // Ongoing 90-second poll — each call re-fetches from DB and (server-side)
    // may trigger a refresh if the 3-min cooldown has elapsed.
    const iv = setInterval(() => refreshAISignals(true).catch(() => {}), 90 * 1000);
    return () => { clearTimeout(backgroundTrigger); clearInterval(iv); };
  }, [isLoggedIn, refreshAISignals]);

  const markSignalTaken = useCallback((signalId: string) => {
    setAISignalsTakenIds(prev => prev.includes(signalId) ? prev : [...prev, signalId]);
  }, []);

  const markSignalMissed = useCallback((signalId: string) => {
    setAISignalsMissedIds(prev => prev.includes(signalId) ? prev : [...prev, signalId]);
  }, []);

  // Persist closed_trades + signal tracking to user_watchlists (debounced with existing sync)
  useEffect(() => {
    if (!loaded || !isLoggedIn || !currentUserIdRef.current || !stockSyncReadyState) return;
    const userId = currentUserIdRef.current;
    const to = setTimeout(() => {
      supabase.from('user_watchlists').update({
        closed_trades: closedTrades,
        ai_signals_taken: aiSignalsTakenIds,
        ai_signals_missed: aiSignalsMissedIds,
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).then(() => {}, () => {});
    }, 800);
    AsyncStorage.setItem('ts_closed_trades_' + userId, JSON.stringify(closedTrades)).catch(() => {});
    AsyncStorage.setItem('ts_signals_taken_' + userId, JSON.stringify(aiSignalsTakenIds)).catch(() => {});
    AsyncStorage.setItem('ts_signals_missed_' + userId, JSON.stringify(aiSignalsMissedIds)).catch(() => {});
    return () => clearTimeout(to);
  }, [closedTrades, aiSignalsTakenIds, aiSignalsMissedIds, loaded, isLoggedIn, stockSyncReadyState]);

  // On login, hydrate closed_trades + signal tracking from local + cloud
  useEffect(() => {
    if (!isLoggedIn || !currentUserIdRef.current) return;
    const userId = currentUserIdRef.current;
    (async () => {
      try {
        const [localCT, localTaken, localMissed] = await Promise.all([
          AsyncStorage.getItem('ts_closed_trades_' + userId),
          AsyncStorage.getItem('ts_signals_taken_' + userId),
          AsyncStorage.getItem('ts_signals_missed_' + userId),
        ]);
        if (localCT) { try { setClosedTrades(JSON.parse(localCT)); } catch {} }
        if (localTaken) { try { setAISignalsTakenIds(JSON.parse(localTaken)); } catch {} }
        if (localMissed) { try { setAISignalsMissedIds(JSON.parse(localMissed)); } catch {} }
      } catch {}
      try {
        const { data } = await supabase
          .from('user_watchlists')
          .select('closed_trades, ai_signals_taken, ai_signals_missed')
          .eq('user_id', userId)
          .maybeSingle();
        if (data) {
          if (Array.isArray(data.closed_trades) && data.closed_trades.length > 0) {
            setClosedTrades(data.closed_trades as ClosedTrade[]);
          }
          if (Array.isArray(data.ai_signals_taken)) setAISignalsTakenIds(data.ai_signals_taken as string[]);
          if (Array.isArray(data.ai_signals_missed)) setAISignalsMissedIds(data.ai_signals_missed as string[]);
        }
      } catch {}
    })();
  }, [isLoggedIn]);

  return (
    <AppContext.Provider
      value={{
        isLoggedIn, userEmail, userName, userId: currentUserIdRef.current, authLoading, login, signup, logout, updateUserName,
        themeMode, toggleTheme, currentTheme,
        hasAcceptedDisclaimer, dontShowDisclaimer, acceptDisclaimer,
        isSubscribed, subscriptionEnd, subscriptionLoading, cancelAtPeriodEnd, checkSubscription,
        subscriptionInitialCheckDone,
        hasSeenSubPrompt, markSubPromptSeen,
        watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist,
        portfolio, addToPortfolio, removeFromPortfolio, removeStockCompletely, updatePortfolioItem,
        addTradeWithTPSL, closeTradeManually, closedTrades,
        addManualClosedTrade,
        activeAISignals, aiSignalsLoading, aiSignalsRefreshing, aiScanStats, refreshAISignals,
        analyzePosition, analyzeBrokerPosition,
        markSignalTaken, markSignalMissed, aiSignalsTakenIds, aiSignalsMissedIds,
        stockDataMap, isLoadingStocks, refreshStocks,
        searchStocks, getStockData,
        canFreeUserAddStock,
        analyzeChartImage,
        initNotifications, notificationsEnabled,

        trackStockView,
        recentlyViewedStocks,
        isOffline,
        tradingPasswordUnlocked, setTradingPasswordUnlocked,
        cancelledSub, setCancelledSub,
        hasCompletedOnboarding, setHasCompletedOnboarding,
        hasSeenIntroOffer, setHasSeenIntroOffer,
        justUpgradedToPro, setJustUpgradedToPro,
        hasCompletedTutorial, setHasCompletedTutorial,
        userFlagsLoaded,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
