
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Modal,
  KeyboardAvoidingView, Platform, RefreshControl, TouchableOpacity,
  FlatList, Dimensions, ActivityIndicator, Keyboard, Pressable, LayoutAnimation, UIManager,
  KeyboardEvent, InteractionManager,
} from 'react-native';import { getMarketStatus as getMarketStatusFromService } from '../../services/notificationService';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolateColor } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useApp } from '../../contexts/AppContext';
import { useRouter, useFocusEffect } from 'expo-router';
import { StockCard } from '../../components/ui/StockCard';
import { StockLogo } from '../../components/ui/StockLogo';
import { MiniChart } from '../../components/ui/MiniChart';
import { AnimatedNumber, AnimatedPortfolioValue } from '../../components/ui/AnimatedNumber';
import { SpotlightOverlay, TutorialStep } from '../../components/SpotlightTutorial';
import { Confetti } from '../../components/Confetti';
import { useAlert } from '@/template';
import { resetBadgeCount } from '../../services/notificationService';
import { AVAILABLE_STOCKS, searchRemoteStocks, fetchMultipleQuotes } from '../../services/stockService';
import { prefetchLogos, warmLogoUniverse } from '../../services/logoService';
import { computeTradeStatus, validateTrade, tradeStatusMessage } from '../../services/tradeService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useBrokerConnection } from '../../hooks/useBrokerConnection';
import { startTabWalkthrough } from '../../services/tutorialWalkthroughBus';
import { subscribeTutorialStart, readTutorialPending, markOverlayMounted } from '../../services/tutorialStartBus';

const REVIEW_PROMPTED_KEY = 'ts_review_prompted';
const CUMULATIVE_STOCK_ADDS_KEY = 'ts_cumulative_stock_adds';

// Session 155 — Animated blue border for the Portfolio Value box. A slow
// (~6s per lap) rotating gradient inside an overflow-hidden container
// creates a subtle band of brighter blue that travels around the perimeter.
// Colors transition between the existing dark navy and the existing bright
// blue so the effect looks premium and never like a loading indicator.
function StaticBlueBorder({ children }: { children: React.ReactNode }) {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 6000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);
  const rotStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  return (
    <View style={{ borderRadius: 18, overflow: 'hidden', position: 'relative' }}>
      {/* Base dark-blue fill so the rotating gradient never exposes the
          underlying background at the corners of the oversized inner view. */}
      <LinearGradient
        colors={['#0F172A', '#1D4ED8', '#0F172A']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Rotating bright-blue band — much larger than its container so any
          rotation angle still fully covers the visible box. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: '-100%', left: '-100%', right: '-100%', bottom: '-100%',
          },
          rotStyle,
        ]}
      >
        <LinearGradient
          colors={['transparent', '#1D4ED8', '#3B82F6', '#60A5FA', '#3B82F6', '#1D4ED8', 'transparent']}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <View style={{ margin: 2.5, borderRadius: 16, overflow: 'hidden' }}>
        {children}
      </View>
    </View>
  );
}

// Static tap hand icon — no looping animation. Removed the repeated translate +
// ripple animation that ran every 2.5s to reduce continuous JS thread work.
function TapHandIcon({ color }: { color: string }) {
  return (
    <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
      <MaterialIcons name="touch-app" size={14} color={color} />
    </View>
  );
}

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

// Session 204 — pick a font size that guarantees the portfolio value
// never truncates. AnimatedNumber renders each digit at ~0.6 × fontSize
// pixels wide, so we compute a target font size based on the character
// count of the formatted value. Falls back to the previous 34/38 default
// for small portfolios.
function computePortfolioFontSize(value: number, isTablet: boolean): number {
  const safe = Number.isFinite(value) ? Math.abs(value) : 0;
  const formatted = safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const charCount = formatted.length + 1;
  const baseFontSize = isTablet ? 38 : 32;
  if (charCount <= 9) return baseFontSize;
  if (charCount <= 10) return isTablet ? 34 : 28;
  if (charCount <= 12) return isTablet ? 30 : 24;
  return isTablet ? 26 : 20;
}

function useScreenWidth() {
  const [w, setW] = useState(Dimensions.get('window').width);
  React.useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setW(window.width));
    return () => sub?.remove();
  }, []);
  return w;
}

type MarketSession = 'PRE_MARKET' | 'OPEN' | 'AFTER_HOURS' | 'CLOSED';

function getMarketStatus(): { session: MarketSession; label: string; nextOpen: Date | null; isHoliday?: boolean; holidayName?: string } {
  const status = getMarketStatusFromService();
  return {
    session: status.session,
    label: status.label,
    nextOpen: status.nextOpen,
    isHoliday: status.isHoliday,
    holidayName: status.holidayName,
  };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const totalHours = Math.floor(totalSec / 3600);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const remainH = totalHours % 24;
    const m = Math.floor((totalSec % 3600) / 60);
    return `${days}d ${String(remainH).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  }
  const h = totalHours;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const screenWidth = useScreenWidth();
  const isTablet = screenWidth >= 600;
  const {
    watchlist, addToWatchlist, removeFromWatchlist,
    userName,
    isSubscribed, currentTheme: t, stockDataMap,
    refreshStocks, searchStocks, portfolio, addToPortfolio,
    addTradeWithTPSL, closeTradeManually,
    removeStockCompletely, canFreeUserAddStock,
    initNotifications, notificationsEnabled,
    hasCompletedOnboarding, hasSeenIntroOffer,
    hasCompletedTutorial, setHasCompletedTutorial,
    isOffline,
  } = useApp();

  // Session 184 — ROOT CAUSE FIX for the historical
  // "Cannot read property 'hasActiveConnection' of undefined" crash on Home.
  //
  // ROOT CAUSE (traced in Session 184):
  //   The previous version declared `const brokerConn = useBrokerConnection()`
  //   AFTER `tryStartTutorial`'s useCallback (which references
  //   `brokerConn.hasActiveConnection` both in its BODY and in its DEP ARRAY).
  //   The dependency-array expression is evaluated at useCallback creation
  //   time. When Hermes / Babel target older ES and transpile `const` to
  //   `var`, the identifier is HOISTED to the top of the function scope as
  //   `undefined`. During the very first render pass, evaluating
  //   `[..., brokerConn.hasActiveConnection]` therefore reads
  //   `undefined.hasActiveConnection` → TypeError:
  //   "Cannot read property 'hasActiveConnection' of undefined". Under
  //   strict `const` semantics the same code would throw a ReferenceError
  //   (TDZ); the fact that the app reports a TypeError proves the hoisted-
  //   as-`undefined` path is the one running.
  //
  // FIX: Move `useBrokerConnection()` to the FIRST hook after `useApp()`
  // destructuring so `brokerConn` is a fully-populated non-undefined
  // BrokerConnectionSummary object BEFORE any downstream callback, memo,
  // effect, or JSX reads it. `useBrokerConnection()` itself always returns
  // a stable shape with safe defaults for every field (see the hook return
  // statement) — once assigned it is never undefined and never mutated to
  // undefined during refresh (state fields update in place via setters).
  //
  // REGRESSION-SAFE: The hook has no dependency on tutorial / watchlist
  // state, so moving it earlier changes ordering only, not behavior. Every
  // existing reference to `brokerConn` throughout HomeScreen continues to
  // work unchanged; a single duplicate declaration further down the file
  // is removed to keep the identifier unique.
  const brokerConn = useBrokerConnection();

  // Session 175 — batch prefetch every logo the moment its ticker list
  // becomes known so cards render with the image already decoded. Fires
  // on watchlist / portfolio / trending changes; the module-level Set
  // in logoService dedupes across rerenders so this is cheap.
  //
  // Session 214 — ALSO prefetch the trending stocks universe on mount
  // so opening the search modal shows every logo instantly. Without this
  // the first search-modal render fires 12 parallel Clearbit / Google
  // favicon requests, which visibly staggered in.
  useEffect(() => {
    const trendingTickers = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'COIN', 'PLTR', 'UBER'];
    const tickers = Array.from(new Set([
      ...watchlist,
      ...portfolio.map(p => p.ticker),
      ...trendingTickers,
    ]));
    if (tickers.length > 0) prefetchLogos(tickers, 'high').catch(() => {});
  }, [watchlist, portfolio]);

  // Session 176 — opportunistically warm the built-in stock universe in
  // the background AFTER Home has painted. Runs once per app session,
  // with concurrency cap 2 so it can't compete with foreground quote
  // fetches or broker syncs. Repeat visits to any stock feel instant.
  useEffect(() => {
    const t = setTimeout(() => { warmLogoUniverse().catch(() => {}); }, 2500);
    return () => clearTimeout(t);
  }, []);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [pendingTicker, setPendingTicker] = useState('');
  const [pendingName, setPendingName] = useState('');
  const [shareCount, setShareCount] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  // Session 117 — Take Profit / Stop Loss required for new trades
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [positionType, setPositionType] = useState<'long' | 'short'>('long');
  const [shareModalMode, setShareModalMode] = useState<'add' | 'addMore'>('add');
  // Session 117 — I Have Sold modal state
  const [soldModalVisible, setSoldModalVisible] = useState(false);
  const [soldTradeId, setSoldTradeId] = useState<string | null>(null);
  const [soldExitPrice, setSoldExitPrice] = useState('');
  const [choiceOverlayVisible, setChoiceOverlayVisible] = useState(false);
  const [showNotifPrompt, setShowNotifPrompt] = useState(false);
  // Session 203 — persistent notification-banner dismissal. Once the
  // user taps EITHER "Enable" (which requests OS permission) OR "Later"
  // (which just dismisses), the banner disappears INSTANTLY and never
  // shows again on this device — even across app restarts — until the
  // user reinstalls or clears app data. We persist a single boolean to
  // AsyncStorage under `ts_notif_banner_dismissed` and initialize the
  // state from that value on mount so the banner is never displayed
  // even for a single frame after a dismissal.
  const [notifBannerDismissed, setNotifBannerDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('ts_notif_banner_dismissed')
      .then((v) => setNotifBannerDismissed(v === 'true'))
      .catch(() => setNotifBannerDismissed(false));
  }, []);
  const dismissNotifBanner = useCallback(() => {
    // Hide instantly — no LayoutAnimation delay, no waiting for OS dialog.
    setShowNotifPrompt(false);
    setNotifBannerDismissed(true);
    AsyncStorage.setItem('ts_notif_banner_dismissed', 'true').catch(() => {});
  }, []);
  const [showMarketBanner, setShowMarketBanner] = useState(true);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus);
  const [countdown, setCountdown] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);


  // Track keyboard for tutorial spotlight re-measurement
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);



  // Tutorial state
  const [tutorialStep, setTutorialStep] = useState<TutorialStep>('DONE');
  // Session 141 — confetti burst rendered once when the tutorial finishes.
  // Overlays every UI on the screen, cascades from the top through the
  // bottom edge, then unmounts itself — no lingering CPU work.
  const [showTutorialConfetti, setShowTutorialConfetti] = useState(false);
  const finishTutorialWithConfetti = useCallback(() => {
    setTutorialStep('DONE');
    setHasCompletedTutorial(true);
    tutorialStarted.current = false;
    // Session 185 — also reset the in-flight guard so any lingering
    // pathological retry loop terminates cleanly (belt & suspenders —
    // the loop already checks hasCompletedTutorial each iteration).
    tutorialStartInFlightRef.current = false;
    if (__DEV__) console.log('[tutorial] TUTORIAL_COMPLETED');
    setShowTutorialConfetti(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Session 167 — reduced confetti window from 5.2s to 3.2s to match
    // the faster Confetti duration (1.6-2.8s per particle). Trimmed JS-
    // thread work post-tutorial for a snappier hand-off.
    setTimeout(() => setShowTutorialConfetti(false), 3200);
  }, [setHasCompletedTutorial]);
  const [addBtnRect, setAddBtnRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [searchBarRect, setSearchBarRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [firstResultRect, setFirstResultRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [formRect, setFormRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [choiceOverlayRect, setChoiceOverlayRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Session 176 — HOME_WATCHLIST spotlight target. Highlights the
  // watchlist / stock-list area on Home after the user completes the
  // add-stock flow, so they see where their stocks will actually land.
  const [watchlistAreaRect, setWatchlistAreaRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const addBtnRef = useRef<View>(null);
  const searchBarRef = useRef<View>(null);
  const firstResultRef = useRef<View>(null);
  const formRef = useRef<View>(null);
  const choiceOverlayRef = useRef<View>(null);
  const watchlistAreaRef = useRef<View>(null);
  const tutorialStarted = useRef(false);
  // Session 185 — in-flight guard for the bounded-retry measurement loop.
  // Prevents multiple triggers (bus event + focus event + dep change all
  // landing on the same JS tick) from spawning parallel measurement loops.
  // Reset to false when measurement succeeds, when the tutorial completes,
  // and when the retry timeout elapses so subsequent triggers can restart.
  const tutorialStartInFlightRef = useRef(false);

  // Stable measurement helper — commits the FIRST valid (non-zero) reading
  // immediately for instant tutorial transitions, with retries on 0×0 if the
  // target hasn't laid out yet. The companion live-tracking effect (below)
  // continuously polls the active target, so any subsequent layout change
  // (rotation, scroll, content update, animation, modal slide, content
  // resize, future UI updates) is automatically picked up and the spotlight
  // re-positions in real time.
  //
  // Strategy:
  //  1. Defer to InteractionManager so any in-progress navigation, keyboard,
  //     or transition animations have completed before we sample. This is
  //     critical for the very first measurement — without it, we'd capture
  //     mid-animation positions.
  //  2. Take a measurement; if width/height are 0, retry up to 15 times via
  //     requestAnimationFrame (~16ms each at 60fps) until the component has
  //     laid out. Using rAF instead of setTimeout means we re-sample on every
  //     paint, capturing the layout the moment it becomes valid.
  //  3. Commit IMMEDIATELY on the first valid reading — no verification
  //     delay, no second sample. Any subsequent layout drift is caught by
  //     the live-tracking polling effect.
  //
  // Result: tutorial steps appear with no perceivable delay (the rAF retries
  // are imperceptible at 60fps), and the spotlight tracks the actual
  // rendered position of every target for as long as the step is active —
  // never relies on cached/estimated/hardcoded coordinates.
  const measureStable = useCallback((
    ref: { current: View | null },
    setter: (rect: { x: number; y: number; width: number; height: number } | null) => void,
    attempt: number = 0,
  ) => {
    // Session 185 — REMOVED InteractionManager.runAfterInteractions entirely.
    // Root cause of the historical "tutorial only appears after app restart"
    // bug: on the /welcome -> /(tabs) route transition expo-router keeps
    // interaction handles alive for the entire stack animation, so
    // InteractionManager's callback never fires until the animation
    // fully settles. On a cold restart there is no such animation, so
    // InteractionManager fires immediately — which is why the tutorial
    // was reliable after reopen but never in the same session as Welcome.
    // Using ONLY requestAnimationFrame guarantees the measurement runs
    // on the very next paint regardless of any pending navigation
    // animation. Retry bound generously raised (10 -> 20 for null-ref,
    // 15 -> 30 for zero-size) so a slow first layout can still catch up.
    if (!ref.current) {
      if (attempt < 20) requestAnimationFrame(() => measureStable(ref, setter, attempt + 1));
      return;
    }
    ref.current.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) {
        if (attempt < 30) requestAnimationFrame(() => measureStable(ref, setter, attempt + 1));
        return;
      }
      // Commit immediately — the live-tracking polling effect handles any
      // subsequent drift, so we never need to wait for verification here.
      setter({ x, y, width, height });
    });
  }, []);

  const measureAddBtn = useCallback(() => measureStable(addBtnRef, setAddBtnRect), [measureStable]);
  const measureSearchBar = useCallback(() => measureStable(searchBarRef, setSearchBarRect), [measureStable]);
  const measureFirstResult = useCallback(() => measureStable(firstResultRef, setFirstResultRect), [measureStable]);
  const measureForm = useCallback(() => measureStable(formRef, setFormRect), [measureStable]);
  const measureChoiceOverlay = useCallback(() => measureStable(choiceOverlayRef, setChoiceOverlayRect), [measureStable]);
  const measureWatchlistArea = useCallback(() => measureStable(watchlistAreaRef, setWatchlistAreaRect), [measureStable]);

  // Live-position tracking — the heart of the "highlight follows the actual
  // element" guarantee. While any tutorial step is active, this effect polls
  // the current target's screen rect every 250ms and updates state ONLY if
  // the position/size has drifted by more than 0.5pt. This means:
  //
  //   • If a button moves (e.g., layout reshuffles, content shifts above it,
  //     a banner appears/disappears, the keyboard opens, the user scrolls a
  //     parent ScrollView, the device rotates, split-screen activates), the
  //     spotlight automatically re-positions on the very next poll tick — the
  //     user always sees the highlight tracking the live rendered position.
  //
  //   • No fixed coordinates, no cached values, no estimates: every poll is
  //     a fresh `measureInWindow` call against the actual mounted ref. Future
  //     UI changes that move the highlighted element will be picked up
  //     automatically without any code changes.
  //
  //   • The 0.5pt threshold suppresses unnecessary re-renders when the
  //     position is stable (the common case), so polling adds negligible cost.
  //
  // The interval is created exactly once per tutorial-step transition (the
  // dependency list is just [tutorialStep]) and torn down when the step
  // changes or the tutorial completes. Reading the latest rect via a ref
  // (rectsRef, kept in sync via the second effect below) prevents the
  // interval from being torn down and recreated on every measurement update.
  const rectsRef = useRef<{
    ADD_BUTTON: { x: number; y: number; width: number; height: number } | null;
    SEARCH_BAR: { x: number; y: number; width: number; height: number } | null;
    PICK_STOCK: { x: number; y: number; width: number; height: number } | null;
    FILL_FORM: { x: number; y: number; width: number; height: number } | null;
    CHOICE_OVERLAY: { x: number; y: number; width: number; height: number } | null;
    HOME_WATCHLIST: { x: number; y: number; width: number; height: number } | null;
  }>({ ADD_BUTTON: null, SEARCH_BAR: null, PICK_STOCK: null, FILL_FORM: null, CHOICE_OVERLAY: null, HOME_WATCHLIST: null });

  useEffect(() => {
    rectsRef.current.ADD_BUTTON = addBtnRect;
    rectsRef.current.SEARCH_BAR = searchBarRect;
    rectsRef.current.PICK_STOCK = firstResultRect;
    rectsRef.current.FILL_FORM = formRect;
    rectsRef.current.CHOICE_OVERLAY = choiceOverlayRect;
    rectsRef.current.HOME_WATCHLIST = watchlistAreaRect;
  }, [addBtnRect, searchBarRect, firstResultRect, formRect, choiceOverlayRect, watchlistAreaRect]);

  useEffect(() => {
    if (tutorialStep === 'DONE') return;

    const REFS_AND_SETTERS: Record<
      'ADD_BUTTON' | 'SEARCH_BAR' | 'PICK_STOCK' | 'FILL_FORM' | 'CHOICE_OVERLAY' | 'HOME_WATCHLIST',
      { ref: { current: View | null }; setter: (r: { x: number; y: number; width: number; height: number } | null) => void }
    > = {
      ADD_BUTTON: { ref: addBtnRef, setter: setAddBtnRect },
      SEARCH_BAR: { ref: searchBarRef, setter: setSearchBarRect },
      PICK_STOCK: { ref: firstResultRef, setter: setFirstResultRect },
      FILL_FORM: { ref: formRef, setter: setFormRect },
      CHOICE_OVERLAY: { ref: choiceOverlayRef, setter: setChoiceOverlayRect },
      HOME_WATCHLIST: { ref: watchlistAreaRef, setter: setWatchlistAreaRect },
    };

    const trackPosition = () => {
      const config = REFS_AND_SETTERS[tutorialStep as keyof typeof REFS_AND_SETTERS];
      if (!config?.ref?.current) return;
      const currentRect = rectsRef.current[tutorialStep as keyof typeof rectsRef.current];
      config.ref.current.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return;
        if (
          !currentRect ||
          Math.abs(currentRect.x - x) > 0.5 ||
          Math.abs(currentRect.y - y) > 0.5 ||
          Math.abs(currentRect.width - width) > 0.5 ||
          Math.abs(currentRect.height - height) > 0.5
        ) {
          config.setter({ x, y, width, height });
        }
      });
    };

    trackPosition();
    const interval = setInterval(trackPosition, 250);
    return () => clearInterval(interval);
  }, [tutorialStep]);

  // Re-measure form rect when keyboard state changes during FILL_FORM step
  useEffect(() => {
    if (tutorialStep === 'FILL_FORM' && shareModalVisible) {
      const timer = setTimeout(measureForm, 200);
      return () => clearTimeout(timer);
    }
  }, [keyboardVisible, tutorialStep, shareModalVisible, measureForm]);

  // Session 182 — Event-driven tutorial start.
  //
  // ROOT CAUSE of the "tutorial only starts after app restart" bug:
  //   The previous approach relied on InteractionManager.runAfterInteractions
  //   to schedule the initial tutorial start. During the /welcome ->
  //   /(tabs) route transition, expo-router keeps interaction handles alive
  //   for the entire stack animation. InteractionManager's callback then
  //   never fired until the animation fully settled, and by that point the
  //   effect deps had already re-satisfied so no new schedule happened. On
  //   a fresh cold start there is no route transition, so InteractionManager
  //   fires immediately — which is why the tutorial worked after restart
  //   but never in the SAME session as Welcome.
  //
  // NEW ARCHITECTURE:
  //   1. welcome.tsx calls markTutorialPending() BEFORE it navigates. That
  //      flips both an in-memory bus flag AND a persisted AsyncStorage flag.
  //   2. HomeScreen listens to the bus (subscribeTutorialStart) — the
  //      listener fires INSTANTLY when the bus flag flips, even if
  //      HomeScreen is already mounted underneath /welcome in the route
  //      stack. This is the primary same-session fix.
  //   3. HomeScreen also runs a useFocusEffect that reads the persisted
  //      pending flag on every focus. This handles the cold-restart-mid-
  //      onboarding case (welcome.tsx set the flag, user killed the app,
  //      reopened, index.tsx routed straight to /(tabs) because
  //      hasCompletedOnboarding=true, HomeScreen focuses for the first
  //      time, and the tutorial fires exactly as if Welcome had just been
  //      dismissed).
  //   4. A third useEffect re-runs tryStartTutorial when eligibility deps
  //      (hasCompletedOnboarding, watchlist.length, modal state) change,
  //      preserving the historical behavior for edge cases.
  //   5. NO InteractionManager, NO arbitrary setTimeout. tryStartTutorial
  //      schedules only via requestAnimationFrame, which fires on the next
  //      paint regardless of pending navigation animations.
  //   6. hasCompletedTutorial (persisted per-user) is SEPARATE from the
  //      pending flag — it only flips true when the walkthrough is
  //      completed or skipped intentionally.
  const tryStartTutorial = useCallback(() => {
    if (__DEV__) console.log('[tutorial] TRY_START', {
      hasCompletedTutorial,
      hasCompletedOnboarding,
      searchVisible,
      shareModalVisible,
      tutorialStep,
      inFlight: tutorialStartInFlightRef.current,
      t: performance.now().toFixed(0),
    });
    // Session 185 — CANONICAL ELIGIBILITY.
    // The only gates are:
    //   1. hasCompletedTutorial  — the ONE authoritative completion flag
    //   2. hasCompletedOnboarding — user has passed Welcome
    //   3. No blocking modal on screen (search / share)
    //   4. Tutorial is not already actively displaying (tutorialStep === 'DONE')
    //   5. No measurement loop already in flight
    // Broker connection state, subscription state, watchlist length, and
    // hasSeenIntroOffer are DELIBERATELY excluded — they must never gate
    // the tutorial. Fresh users with a connected broker or a populated
    // watchlist follow the exact same start path as users without.
    if (hasCompletedTutorial) return;
    if (searchVisible || shareModalVisible) return;
    if (tutorialStep !== 'DONE') return;
    if (!hasCompletedOnboarding) return;
    if (tutorialStartInFlightRef.current) return;
    tutorialStartInFlightRef.current = true;
    if (__DEV__) console.log('[tutorial] TUTORIAL_START_REQUESTED');
    // BOUNDED-RETRY MEASUREMENT LOOP (Session 185).
    // Uses ONLY requestAnimationFrame — no InteractionManager (which is
    // the ROOT CAUSE of the historical "only after restart" bug because
    // expo-router's stack animation keeps interaction handles alive).
    // Retries until either:
    //   - measurement succeeds  → commits state + calls markOverlayMounted()
    //     to clear the pending flag from bus + AsyncStorage
    //   - hasCompletedTutorial flips true  → aborts loop
    //   - retry ceiling reached  → releases inFlight so a subsequent focus
    //     event / state change can restart the loop with fresh state
    //
    // markOverlayMounted() is the ONLY code path that clears the pending
    // flag on the happy path — so if the overlay never actually renders,
    // the pending flag stays set and future triggers can retry it. This
    // is exactly the "do not consume until overlay confirmed mounted"
    // guarantee the spec requires.
    let attempts = 0;
    const tryMeasure = () => {
      if (!tutorialStartInFlightRef.current) return;
      attempts += 1;
      // Safety ceiling — if measurement is still failing after ~5s at 60fps
      // we release the guard so subsequent triggers can retry with fresh
      // React state / layout instead of being permanently blocked.
      if (attempts > 300) {
        if (__DEV__) console.log('[tutorial] MEASURE_TIMEOUT_5S retryable, releasing inFlight');
        tutorialStartInFlightRef.current = false;
        return;
      }
      const node = addBtnRef.current;
      if (!node) {
        requestAnimationFrame(tryMeasure);
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (!tutorialStartInFlightRef.current) return;
        if (width <= 0 || height <= 0) {
          if (__DEV__ && attempts % 15 === 0) console.log('[tutorial] MEASURE_RETRY attempt=', attempts);
          requestAnimationFrame(tryMeasure);
          return;
        }
        if (__DEV__) console.log('[tutorial] MEASURE_READY', { x, y, width, height, attempts });
        // Commit BOTH the rect and the step in the same tick so the
        // overlay's render condition (tutorialStep === 'ADD_BUTTON' &&
        // addBtnRect) becomes true on the next paint.
        setAddBtnRect({ x, y, width, height });
        setTutorialStep('ADD_BUTTON');
        tutorialStarted.current = true;
        // Clear the pending bus + AsyncStorage flag ONLY now, after the
        // overlay is proven to be about to render. If any prior attempt
        // failed, the flag was left set so this retry could succeed.
        markOverlayMounted().catch(() => {});
        if (__DEV__) console.log('[tutorial] FIRST_OVERLAY_MOUNTED');
        tutorialStartInFlightRef.current = false;
      });
    };
    requestAnimationFrame(tryMeasure);
  }, [hasCompletedTutorial, hasCompletedOnboarding, searchVisible, shareModalVisible, tutorialStep]);

  // Session 185 — Three converging triggers, none of which CONSUME the
  // pending flag. Only markOverlayMounted() (called from tryStartTutorial's
  // measurement-success branch) clears the flag. If any single trigger's
  // tryStartTutorial call fails to actually mount the overlay, subsequent
  // triggers will retry.

  // Trigger #1 — BUS EVENT. Fires synchronously (or via microtask if the
  // token was set before this subscription registered) when Welcome calls
  // markTutorialPending(). Guaranteed to fire in the same JS session as
  // the button press, regardless of whether HomeScreen was already mounted
  // underneath the route stack.
  useEffect(() => {
    const unsub = subscribeTutorialStart(() => {
      if (__DEV__) console.log('[tutorial] BUS_EVENT_RECEIVED t=', performance.now().toFixed(0), 'ms');
      // Do NOT consume the pending flag here — tryStartTutorial's
      // measurement-success branch owns that responsibility so a failed
      // attempt leaves the flag intact for the next retry.
      tryStartTutorial();
    });
    return unsub;
  }, [tryStartTutorial]);

  // Trigger #2 — ROUTE FOCUS. Handles the cold-restart-mid-onboarding
  // path (welcome persisted the flag to AsyncStorage, user killed the
  // app, reopened, index.tsx routes straight to /(tabs), Home focuses
  // for the first time and hydrates the persisted flag). Also serves as
  // a general "Home is now focused, re-evaluate tutorial eligibility"
  // hook so state that arrived between renders is caught.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const pending = await readTutorialPending();
        if (cancelled) return;
        if (__DEV__) console.log('[tutorial] HOME_FOCUSED pending=', pending, 't=', performance.now().toFixed(0));
        // Do NOT consume. tryStartTutorial + markOverlayMounted own that lifecycle.
        tryStartTutorial();
      })();
      return () => { cancelled = true; };
    }, [tryStartTutorial])
  );

  // Trigger #3 — STATE-CHANGE RE-EVALUATION. When hasCompletedOnboarding
  // flips true, or a blocking modal closes, or tutorialStep transitions
  // back to DONE (unusual but possible), this re-runs the eligibility
  // check. tryStartTutorial's internal guards prevent double-start.
  useEffect(() => {
    tryStartTutorial();
  }, [tryStartTutorial]);

  const skipTutorial = useCallback(() => {
    // Session 167 — Skip Tutorial has been REMOVED per user request.
    // This handler is retained as a safety no-op so any lingering call
    // site cannot crash the tutorial. The tutorial is mandatory now.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, []);

  // When search modal opens during tutorial, advance to SEARCH_BAR.
  // No artificial setTimeout — measureStable already defers to
  // InteractionManager (waits for the modal slide animation to finish) and
  // retries on 0×0 readings, so we can advance the step immediately.
  useEffect(() => {
    if (tutorialStep === 'ADD_BUTTON' && searchVisible) {
      measureSearchBar();
      setTutorialStep('SEARCH_BAR');
    }
  }, [searchVisible, tutorialStep, measureSearchBar]);

  // When search query has results during tutorial, advance to PICK_STOCK.
  // Reverse-direction (PICK → SEARCH when user clears the query) advances just
  // as fast. measureStable handles per-call timing internally.
  useEffect(() => {
    if (tutorialStep === 'SEARCH_BAR' && searchQuery.length > 0) {
      measureFirstResult();
      setTutorialStep('PICK_STOCK');
    }
    if (tutorialStep === 'PICK_STOCK' && searchQuery.length === 0) {
      measureSearchBar();
      setTutorialStep('SEARCH_BAR');
    }
  }, [searchQuery, tutorialStep, measureFirstResult, measureSearchBar]);

  // Session 144 — when the CHOOSER overlay (Put in Trade / Add to Watchlist)
  // becomes visible during the tutorial, transition to the CHOICE_OVERLAY
  // step so the whole chooser card is highlighted and the tutorial explains
  // what each button does.
  //
  // Session 180 — When the CHOICE_OVERLAY step ends (user tapped Add to
  // Watchlist, tapped Trade and navigated to /put-in-trade, tapped the ×,
  // tapped the backdrop, OR returned to Home from /put-in-trade), we
  // advance to HOME_WATCHLIST so the highlight tutorial can complete
  // rather than getting stranded. Broker-connected users benefit here
  // because Trade → /put-in-trade → back-to-Home no longer leaves the
  // tutorial stuck.
  useEffect(() => {
    if ((tutorialStep === 'PICK_STOCK' || tutorialStep === 'SEARCH_BAR') && choiceOverlayVisible) {
      measureChoiceOverlay();
      setTutorialStep('CHOICE_OVERLAY');
    }
    if (tutorialStep === 'CHOICE_OVERLAY' && !choiceOverlayVisible && !searchVisible && !shareModalVisible) {
      const timer = setTimeout(() => {
        measureWatchlistArea();
        setTutorialStep('HOME_WATCHLIST');
      }, 320);
      return () => clearTimeout(timer);
    }
  }, [choiceOverlayVisible, tutorialStep, measureChoiceOverlay, searchVisible, shareModalVisible, measureWatchlistArea]);

  // When share modal opens during tutorial, advance to FILL_FORM immediately.
  useEffect(() => {
    if ((tutorialStep === 'PICK_STOCK' || tutorialStep === 'SEARCH_BAR' || tutorialStep === 'CHOICE_OVERLAY') && shareModalVisible) {
      measureForm();
      setTutorialStep('FILL_FORM');
    }
  }, [shareModalVisible, tutorialStep, measureForm]);

  // Real-time position tracking — re-measure the active tutorial target
  // whenever the screen dimensions change (rotation, resize, split-screen).
  // Combined with the onLayout-based measurements and measureStable's
  // retry+verification logic, this guarantees the spotlight always tracks
  // the live position of the target through any layout shift, with no
  // dependency on cached or estimated coordinates.
  useEffect(() => {
    if (tutorialStep === 'DONE') return;
    const sub = Dimensions.addEventListener('change', () => {
      if (tutorialStep === 'ADD_BUTTON') measureAddBtn();
      else if (tutorialStep === 'SEARCH_BAR') measureSearchBar();
      else if (tutorialStep === 'PICK_STOCK') measureFirstResult();
      else if (tutorialStep === 'FILL_FORM') measureForm();
      else if (tutorialStep === 'CHOICE_OVERLAY') measureChoiceOverlay();
    });
    return () => sub?.remove();
  }, [tutorialStep, measureAddBtn, measureSearchBar, measureFirstResult, measureForm, measureChoiceOverlay]);

  // Market status timer
  useEffect(() => {
    const interval = setInterval(() => {
      const status = getMarketStatus();
      setMarketStatus(status);
      if (status.nextOpen) {
        setCountdown(formatCountdown(status.nextOpen.getTime() - Date.now()));
      } else {
        setCountdown('');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check actual notification permission status on mount
  React.useEffect(() => {
    // Session 203 — respect the persistent dismissal flag. Once the user
    // has dismissed the banner (via Enable OR Later) we never re-show it
    // on this device.
    if (notifBannerDismissed === null) return; // still loading persisted flag
    if (notifBannerDismissed) return;
    const checkNotifStatus = async () => {
      try {
        const { status } = await (await import('expo-notifications')).getPermissionsAsync();
        if (status === 'granted') {
          setShowNotifPrompt(false);
          resetBadgeCount();
          return;
        }
      } catch (error) {
        console.error("Error checking notification permissions:", error);
      }
      if (!notificationsEnabled) {
        const timer = setTimeout(() => setShowNotifPrompt(true), 2000);
        return () => clearTimeout(timer);
      } else {
        resetBadgeCount();
      }
    };
    checkNotifStatus();
  }, [notificationsEnabled, notifBannerDismissed]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return searchStocks(searchQuery) as any[];
  }, [searchQuery, searchStocks]);

  // Remote search fallback for stocks not in local catalog
  const [remoteResults, setRemoteResults] = useState<{ ticker: string; name: string; sector: string }[]>([]);
  const remoteSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (remoteSearchTimer.current) clearTimeout(remoteSearchTimer.current);
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setRemoteResults([]);
      return;
    }
    // Only search remotely if local results are limited
    const localResults = searchStocks(searchQuery);
    if (localResults.length >= 5) {
      setRemoteResults([]);
      return;
    }
    // Debounce remote search by 400ms
    remoteSearchTimer.current = setTimeout(async () => {
      try {
        const remote = await searchRemoteStocks(searchQuery);
        // Filter out any that are already in local results
        const localTickers = new Set(localResults.map((r: any) => r.ticker));
        const newResults = remote.filter(r => !localTickers.has(r.ticker));
        setRemoteResults(newResults);
      } catch {
        setRemoteResults([]);
      }
    }, 400);
    return () => { if (remoteSearchTimer.current) clearTimeout(remoteSearchTimer.current); };
  }, [searchQuery, searchStocks]);

  // Combined search results: local + remote
  const combinedSearchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return [...searchResults, ...remoteResults];
  }, [searchResults, remoteResults, searchQuery]);

  const trendingStocks = useMemo(() => {
    const popular = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'COIN', 'PLTR', 'UBER'];
    return popular
      .map(t => AVAILABLE_STOCKS.find(s => s.ticker === t))
      .filter((s): s is typeof AVAILABLE_STOCKS[0] => s !== undefined);
  }, []);

  const handleRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setRefreshing(true);
    await refreshStocks();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setRefreshing(false);
  }, [refreshStocks]);

  const openSearchModal = useCallback(() => {
    setSearchQuery('');
    setSearchVisible(true);
    Haptics.selectionAsync();
  }, []);

  const closeSearchModal = useCallback(() => {
    // If in tutorial and user closes search, reset tutorial to ADD_BUTTON.
    // Reduced wait (300→200ms) keeps the reset feel snappy while still allowing
    // the search modal slide-out animation to clear the home screen so the
    // overlay doesn't render on top of the still-closing modal.
    if (tutorialStep !== 'DONE' && tutorialStep !== 'ADD_BUTTON') {
      setSearchVisible(false);
      setSearchQuery('');
      setShareModalVisible(false);
      setTimeout(() => {
        measureAddBtn();
        setTutorialStep('ADD_BUTTON');
      }, 200);
      return;
    }
    setSearchVisible(false);
    setSearchQuery('');
    setShareModalVisible(false);
  }, [tutorialStep, measureAddBtn]);

  const handleAddStock = useCallback((ticker: string, name: string) => {
    const inList = watchlist.includes(ticker);
    const hasActiveTrade = portfolio.some(p => p.ticker === ticker && p.tradeId);
    setPendingTicker(ticker);
    setPendingName(name);
    setShareCount('');
    setBuyPrice('');
    setTakeProfit('');
    setStopLoss('');
    setPositionType('long');
    setShareModalMode(inList ? 'addMore' : 'add');
    // Session 120 §8 — for a fresh stock, show a chooser first: Log Trade vs Add to Watchlist.
    // If they already hold an active trade, go straight to the addMore flow.
    if (hasActiveTrade) {
      setShareModalVisible(true);
    } else {
      setChoiceOverlayVisible(true);
    }
    Haptics.selectionAsync();
  }, [watchlist, portfolio]);

  // Session 192 - StoreReview requests from Home have been REMOVED.
  // Apple limits Sight to ~3 review prompts per year per user, so we
  // now consume our single allotted trigger from the scanner shutter
  // path (see services/storeReviewService.ts + ScannerContent.tsx),
  // which is Sight's most engaging moment. Firing an additional prompt
  // on the 10th cumulative watchlist add spent one of Apple's rare
  // slots on a low-signal moment and reduced overall opt-in rates.
  // The function is retained as a no-op so downstream call sites
  // (confirmAddStock / handleWatchlistOnly / choice overlay) do not
  // need to change.
  const incrementAndCheckReviewPrompt = useCallback(async () => {
    return;
  }, []);

  const confirmAddStock = useCallback(() => {
    const shares = parseFloat(shareCount) || 0;
    const price = parseFloat(buyPrice) || 0;
    const tp = parseFloat(takeProfit) || 0;
    const sl = parseFloat(stopLoss) || 0;

    if (shares <= 0 || price <= 0) {
      showAlert('Missing Info', 'Please enter both the number of shares and the entry price.');
      return;
    }
    if (tp <= 0 || sl <= 0) {
      showAlert('Missing Info', 'Please enter both a Take Profit and a Stop Loss price. These are required for every trade.');
      return;
    }
    const validationError = validateTrade(positionType, price, tp, sl);
    if (validationError) {
      showAlert('Invalid Trade', validationError);
      return;
    }

    // Check free user watchlist limit (max 3 stocks)
    if (!canFreeUserAddStock() && !watchlist.includes(pendingTicker)) {
      setShareModalVisible(false);
      setSearchVisible(false);
      setSearchQuery('');
      setPendingTicker('');
      router.push('/subscription');
      return;
    }

    // Session 117 — use TP/SL-aware trade creation so auto-close monitoring works
    addTradeWithTPSL({
      ticker: pendingTicker,
      shares,
      entryPrice: price,
      position: positionType,
      takeProfit: tp,
      stopLoss: sl,
    });
    setShareModalVisible(false);
    setSearchVisible(false);
    setSearchQuery('');
    setPendingTicker('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    incrementAndCheckReviewPrompt();

    if (tutorialStep === 'FILL_FORM') {
      finishTutorialWithConfetti();
    }
  }, [shareCount, buyPrice, takeProfit, stopLoss, positionType, pendingTicker, addTradeWithTPSL, showAlert, tutorialStep, finishTutorialWithConfetti, incrementAndCheckReviewPrompt, canFreeUserAddStock, watchlist, router]);

  const handleRemoveStock = useCallback(() => {
    removeStockCompletely(pendingTicker);
    setShareModalVisible(false);
    setSearchVisible(false);
    setSearchQuery('');
    setPendingTicker('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [pendingTicker, removeStockCompletely]);

  const handleWatchlistOnly = useCallback(() => {
    // Check free user watchlist limit (max 3 stocks)
    if (!canFreeUserAddStock() && !watchlist.includes(pendingTicker)) {
      setShareModalVisible(false);
      setSearchVisible(false);
      setSearchQuery('');
      setPendingTicker('');
      // Show subscription paywall immediately
      router.push('/subscription');
      return;
    }

    addToWatchlist(pendingTicker);
    setShareModalVisible(false);
    setSearchVisible(false);
    setSearchQuery('');
    setPendingTicker('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Increment cumulative stock add counter and check for review prompt
    incrementAndCheckReviewPrompt();

    if (tutorialStep === 'FILL_FORM') {
      finishTutorialWithConfetti();
    }
  }, [pendingTicker, addToWatchlist, tutorialStep, finishTutorialWithConfetti, incrementAndCheckReviewPrompt, canFreeUserAddStock, watchlist, router]);

  // Session 184 — brokerConn is now declared much earlier in this component
  // (right after useApp()) so downstream callbacks / effects that reference
  // it are guaranteed to see a fully-formed non-undefined object. The old
  // duplicate `const brokerConn = useBrokerConnection();` line that used to
  // sit here was removed as part of that root-cause fix.

  // Session 129 — periodic broker sync so Home stays aligned with the broker.
  useEffect(() => {
    if (!brokerConn.hasActiveConnection) return;
    brokerConn.sync().catch(() => {});
    const iv = setInterval(() => { brokerConn.sync().catch(() => {}); }, 60000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerConn.hasActiveConnection]);

  const brokerOwnedTickers = useMemo(() =>
    new Set(brokerConn.positions.map(p => (p.ticker || '').toUpperCase())),
    [brokerConn.positions]);

  // Session 215 — Watchlist and Active Trade are INDEPENDENT states per
  // user request. A ticker may appear in BOTH lists at the same time. The
  // watchlist is displayed as-is (with dedup for the ticker itself), and
  // Active Trades are rendered from broker positions / portfolio in their
  // own section. Previously we filtered out broker-owned tickers from
  // the watchlist which prevented users from keeping price alerts on
  // stocks they also owned. That filter has been removed.
  const displayWatchlist = useMemo(() => watchlist, [watchlist]);

  // Session 131 — every broker position is exposed per-account. AAPL held
  // in two different SnapTrade accounts stays as two distinct Active Trades
  // (never merged) with a small account label so the user always sees
  // which brokerage account each position belongs to.
  const brokerActiveTrades = useMemo(() => {
    if (!brokerConn.hasActiveConnection) return [];
    return brokerConn.positions
      .filter(p => Math.abs(Number(p.quantity) || 0) > 0)
      .map(p => {
        const qty = Number(p.quantity) || 0;
        const avg = Number(p.averagePrice) || 0;
        // Session 203 — overlay live price from stockDataMap when we have
        // a fresh Yahoo quote so P/L reflects real-time market values,
        // not the stale executionPrice the sync stored as a fallback.
        const liveQuote = stockDataMap.get((p.ticker || '').toUpperCase());
        const livePrice = liveQuote?.quote?.price;
        const cur = (livePrice && livePrice > 0)
          ? livePrice
          : (Number(p.currentPrice) > 0 ? Number(p.currentPrice) : avg);
        const shares = Math.abs(qty);
        const side: 'long' | 'short' = qty >= 0 ? 'long' : 'short';
        const pnl = side === 'long' ? (cur - avg) * shares : (avg - cur) * shares;
        const pnlPct = avg > 0 ? (pnl / (avg * shares)) * 100 : 0;
        const acctLabel = (p as any).institutionName
          ? `${(p as any).institutionName}${(p as any).accountName ? ' · ' + (p as any).accountName : ''}${(p as any).accountNumber ? ' ••••' + String((p as any).accountNumber).slice(-4) : ''}`
          : 'Brokerage';
        return {
          key: `broker-${p.accountId}-${p.ticker}`,
          accountId: p.accountId,
          accountLabel: acctLabel,
          ticker: p.ticker,
          shares,
          avgCost: avg,
          currentPrice: cur,
          position: side,
          pnl,
          pnlPercent: pnlPct,
          // Session 206 — expose the fresh chart series so Active Trade
          // cards on Home can render a small chart preview instead of
          // the previous account label line.
          chartData: liveQuote?.chartData ?? [],
          // Session 203 — forward TP / SL when SnapTrade returned bracket child orders
          takeProfit: (p as any).takeProfit ?? null,
          stopLoss: (p as any).stopLoss ?? null,
        };
      });
  }, [brokerConn.hasActiveConnection, brokerConn.positions, stockDataMap]);

  const portfolioValue = useMemo(() => {
    // BROKER = SOURCE OF TRUTH. Portfolio Value = SUM(account totals) across
    // eligible investment accounts (see useBrokerConnection). Uses SnapTrade
    // account.total_market_value whenever the broker returns it. Cost basis
    // = SUM(qty × avg_price) across every position on every eligible
    // account (positions never merged).
    if (brokerConn.hasActiveConnection) {
      let cb = 0;
      for (const p of brokerConn.positions) {
        const q = Math.abs(Number(p.quantity) || 0);
        const avg = Number(p.averagePrice) || 0;
        if (q > 0 && avg > 0) cb += q * avg;
      }
      const total = brokerConn.portfolioValue;
      const investedNow = Math.max(0, total - brokerConn.cash);
      const change = investedNow - cb;
      const changePercent = cb > 0 ? (change / cb) * 100 : 0;
      return { total, costBasis: cb, change, changePercent };
    }
    let totalCurrent = 0;
    let totalCostBasis = 0;
    portfolio.forEach(item => {
      const data = stockDataMap.get(item.ticker);
      if (data) {
        const currentVal = data.quote.price * item.shares;
        const costVal = item.avgCost * item.shares;
        if (item.position === 'short') {
          totalCurrent += costVal + (costVal - currentVal);
          totalCostBasis += costVal;
        } else {
          totalCurrent += currentVal;
          totalCostBasis += costVal;
        }
      } else {
        totalCurrent += item.avgCost * item.shares;
        totalCostBasis += item.avgCost * item.shares;
      }
    });
    const change = totalCurrent - totalCostBasis;
    const changePercent = totalCostBasis > 0 ? (change / totalCostBasis) * 100 : 0;
    return { total: totalCurrent, costBasis: totalCostBasis, change, changePercent };
  }, [portfolio, stockDataMap, brokerConn.hasActiveConnection, brokerConn.portfolioValue, brokerConn.positions, brokerConn.cash]);

  const isPositive = portfolioValue.change >= 0;
  const greeting = getGreeting();

  const getPortfolioInfo = useCallback((ticker: string) => {
    return portfolio.filter(p => p.ticker === ticker);
  }, [portfolio]);

  const screenHeight = Dimensions.get('window').height;
  const isSmallScreen = screenHeight < 700;
  const modalMaxWidth = Math.min(screenWidth - 32, isTablet ? 420 : 340);
  const modalPadding = isTablet ? 24 : (isSmallScreen ? 14 : 18);
  const inputHeight = isTablet ? 48 : (isSmallScreen ? 38 : 44);
  const btnHeight = isTablet ? 48 : (isSmallScreen ? 38 : 44);

  const marketBannerIcon = marketStatus.session === 'PRE_MARKET' ? 'wb-twilight'
    : marketStatus.session === 'AFTER_HOURS' ? 'nightlight-round'
    : marketStatus.session === 'CLOSED' ? 'schedule' : null;

  const marketBannerColor = marketStatus.session === 'PRE_MARKET' ? '#F59E0B'
    : marketStatus.session === 'AFTER_HOURS' ? '#8B5CF6'
    : '#EF4444';

  const showMarketStatusBanner = showMarketBanner && marketStatus.session !== 'OPEN';

  // Inline share form component rendered inside the search modal
  const renderShareForm = () => {
    if (!shareModalVisible) return null;

    return (
      <View style={styles.inlineShareOverlay}>
        <TouchableOpacity activeOpacity={1} style={styles.inlineShareBg}
          onPress={() => setShareModalVisible(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.inlineShareCenter}>
          <TouchableOpacity activeOpacity={1} onPress={() => { /* Do nothing to prevent closing when pressing form */ }}>
            <View
              ref={formRef}
              collapsable={false}
              onLayout={() => { if (tutorialStep === 'PICK_STOCK' || tutorialStep === 'FILL_FORM') measureForm(); }}
              style={[styles.shareModalContent, { backgroundColor: t.surface, borderColor: t.border, maxWidth: modalMaxWidth, width: modalMaxWidth, padding: modalPadding }]}
            >
              <TouchableOpacity activeOpacity={0.6}
                style={[styles.shareCloseBtn, { backgroundColor: t.background, borderColor: t.border }]}
                onPress={() => setShareModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={18} color={t.textSecondary} />
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: isSmallScreen ? 8 : 12, paddingRight: 32 }}>
                <StockLogo ticker={pendingTicker} size={isTablet ? 42 : 36} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: isTablet ? 18 : 16, fontWeight: '700', color: t.textPrimary }}>{pendingTicker}</Text>
                    {shareModalMode === 'addMore' ? (
                      <View style={{ backgroundColor: t.bullishBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: t.bullish }}>OWNED</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 12, color: t.textSecondary }} numberOfLines={1}>{pendingName}</Text>
                </View>
              </View>

              {shareModalMode === 'addMore' ? (
                <View style={{ marginBottom: 10 }}>
                  {getPortfolioInfo(pendingTicker).map((item, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: t.border }}>
                      <Text style={{ fontSize: 12, color: t.textSecondary }}>{item.position === 'long' ? 'Long' : 'Short'}: {item.shares} shares</Text>
                      <Text style={{ fontSize: 12, color: t.textSecondary }}>@ ${item.avgCost.toFixed(2)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary, marginBottom: 4 }}>POSITION</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: isSmallScreen ? 8 : 12 }}>
                <TouchableOpacity activeOpacity={0.7}
                  style={[styles.positionBtn, { borderColor: t.border, height: btnHeight }, positionType === 'long' && { backgroundColor: t.bullishBg, borderColor: t.bullish }]}
                  onPress={() => { setPositionType('long'); Haptics.selectionAsync(); }}>
                  <MaterialIcons name="trending-up" size={16} color={positionType === 'long' ? t.bullish : t.textTertiary} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: positionType === 'long' ? t.bullish : t.textSecondary }}>Long</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7}
                  style={[styles.positionBtn, { borderColor: t.border, height: btnHeight }, positionType === 'short' && { backgroundColor: t.bearishBg, borderColor: t.bearish }]}
                  onPress={() => { setPositionType('short'); Haptics.selectionAsync(); }}>
                  <MaterialIcons name="trending-down" size={16} color={positionType === 'short' ? t.bearish : t.textTertiary} />
                  <Text style={{ fontSize: 13, fontWeight: '600', color: positionType === 'short' ? t.bearish : t.textSecondary }}>Short</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary, marginBottom: 2 }}>SHARES *</Text>
              <TextInput
                style={[styles.shareInput, { backgroundColor: t.background, borderColor: t.border, color: t.textPrimary, height: inputHeight, marginBottom: isSmallScreen ? 8 : 12 }]}
                placeholder="Number of shares"
                placeholderTextColor={t.textTertiary}
                keyboardType="numeric"
                value={shareCount}
                onChangeText={setShareCount}
                autoFocus
                returnKeyType="next"
                blurOnSubmit={false}
              />

              <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary, marginBottom: 2 }}>
                ENTRY PRICE PER SHARE *
              </Text>
              <TextInput
                style={[styles.shareInput, { backgroundColor: t.background, borderColor: t.border, color: t.textPrimary, height: inputHeight, marginBottom: isSmallScreen ? 8 : 12 }]}
                placeholder="Entry price"
                placeholderTextColor={t.textTertiary}
                keyboardType="decimal-pad"
                value={buyPrice}
                onChangeText={setBuyPrice}
                returnKeyType="next"
                blurOnSubmit={false}
              />

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: isSmallScreen ? 8 : 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: t.bullish, marginBottom: 2 }}>TAKE PROFIT *</Text>
                  <TextInput
                    style={[styles.shareInput, { backgroundColor: t.background, borderColor: t.bullish + '40', color: t.textPrimary, height: inputHeight }]}
                    placeholder={positionType === 'long' ? 'Above entry' : 'Below entry'}
                    placeholderTextColor={t.textTertiary}
                    keyboardType="decimal-pad"
                    value={takeProfit}
                    onChangeText={setTakeProfit}
                    returnKeyType="next"
                    blurOnSubmit={false}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: t.bearish, marginBottom: 2 }}>STOP LOSS *</Text>
                  <TextInput
                    style={[styles.shareInput, { backgroundColor: t.background, borderColor: t.bearish + '40', color: t.textPrimary, height: inputHeight }]}
                    placeholder={positionType === 'long' ? 'Below entry' : 'Above entry'}
                    placeholderTextColor={t.textTertiary}
                    keyboardType="decimal-pad"
                    value={stopLoss}
                    onChangeText={setStopLoss}
                    returnKeyType="done"
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 8 }}>
                {shareModalMode === 'addMore' ? (
                  <>
                    <TouchableOpacity activeOpacity={0.7}
                      style={[styles.shareModalBtn, { borderColor: t.bearish, backgroundColor: t.bearishBg, height: btnHeight }]}
                      onPress={handleRemoveStock}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: t.bearish }}>Remove All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.7}
                      style={[styles.shareModalBtn, { backgroundColor: t.primary, borderColor: t.primary, height: btnHeight }]}
                      onPress={confirmAddStock}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>Add More</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity activeOpacity={0.7}
                      style={[styles.shareModalBtn, { borderColor: t.border, height: btnHeight }]}
                      onPress={handleWatchlistOnly}>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: t.textSecondary }} numberOfLines={1}>Watch Only</Text>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.7}
                      style={[styles.shareModalBtn, { backgroundColor: t.primary, borderColor: t.primary, height: btnHeight }]}
                      onPress={confirmAddStock}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFF' }}>Trade</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>

        {/* Spotlight Tutorial - Step 4: FILL_FORM (inside share overlay inside search modal) */}
        {tutorialStep === 'FILL_FORM' && formRect ? (
          <SpotlightOverlay
            step="FILL_FORM"
            spotlightRect={formRect}
            onSkip={skipTutorial}
            accentColor={t.primary}
            textColor="#FFFFFF"
            surfaceColor="#1E293B"
          />
        ) : null}
      </View>
    );
  };

  const renderSearchItem = useCallback(({ item: stock, index }: { item: { ticker: string; name: string; sector: string }; index: number }) => {
    const inList = watchlist.includes(stock.ticker);
    const portfolioItems = getPortfolioInfo(stock.ticker);
    const totalShares = portfolioItems.reduce((sum, p) => sum + p.shares, 0);
    const isFirstResult = index === 0 && searchQuery.length > 0;

    // Session 149 — row now navigates to the Stock Details page; the
    // circular + button on the right still opens the Put in Trade / Add
    // to Watchlist chooser (previous behavior for the whole row).
    // Session 164 — during the tutorial, ONLY the small + button on
    // the right of the stock row is clickable. Tapping anywhere else on
    // the row is a no-op so users are forced to press the highlighted
    // + button (which opens the Add-to-Watchlist / Trade chooser). This
    // is enforced by:
    //   1. Moving `firstResultRef` from the row TouchableOpacity to the
    //      inner + TouchableOpacity so the spotlight highlights just the
    //      + button, not the whole row.
    //   2. Suppressing the row's onPress (and pressed-state opacity)
    //      whenever the tutorial is running.
    const tutorialActive = tutorialStep !== 'DONE';
    return (
      <TouchableOpacity
        activeOpacity={tutorialActive ? 1 : 0.6}
        style={[styles.searchResultItem, { borderBottomColor: t.border }]}
        onPress={() => {
          if (tutorialActive) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            return;
          }
          Haptics.selectionAsync();
          setSearchVisible(false);
          setSearchQuery('');
          router.push(`/stock/${stock.ticker}` as any);
        }}
      >
        <StockLogo ticker={stock.ticker} size={isTablet ? 40 : 34} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.searchTicker, { color: t.textPrimary, fontSize: isTablet ? 16 : 15 }]}>{stock.ticker}</Text>
          <Text style={{ fontSize: isTablet ? 13 : 12, color: t.textSecondary, marginTop: 1 }} numberOfLines={1}>{stock.name}</Text>
          {totalShares > 0 ? (
            <Text style={{ fontSize: 11, color: t.primary, marginTop: 2, fontWeight: '600' }}>
              Owned: {totalShares} shares
            </Text>
          ) : null}
        </View>
        <Text style={{ fontSize: 11, color: t.textTertiary, marginRight: 6 }} numberOfLines={1}>{stock.sector}</Text>
        <TouchableOpacity
          ref={isFirstResult ? firstResultRef : undefined}
          onLayout={isFirstResult && (tutorialStep === 'SEARCH_BAR' || tutorialStep === 'PICK_STOCK') ? () => measureFirstResult() : undefined}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[styles.addButton, { backgroundColor: inList ? t.bullishBg : t.primary + '20', width: isTablet ? 40 : 36, height: isTablet ? 40 : 36, borderRadius: isTablet ? 20 : 18 }]}
          onPress={(e) => {
            e.stopPropagation();
            handleAddStock(stock.ticker, stock.name);
          }}
        >
          <MaterialIcons name={inList ? 'settings' : 'add'} size={18} color={inList ? t.bullish : t.primary} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [watchlist, t, handleAddStock, getPortfolioInfo, isTablet, searchQuery, tutorialStep, measureFirstResult, router]);

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.greeting, { color: t.textPrimary, fontSize: isTablet ? 22 : 20 }]}>{greeting}, {userName || 'Trader'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <Text style={[styles.greetingSub, { color: t.primaryLight }]}>Sight AI</Text>
            {isSubscribed ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, gap: 2 }}>
                <MaterialIcons name="workspace-premium" size={10} color="#FFD700" />
                <Text style={{ fontSize: 9, fontWeight: '800', color: '#FFD700', letterSpacing: 1 }}>PRO</Text>
              </View>
            ) : null}

          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity activeOpacity={0.6}
            style={[styles.headerButton, { backgroundColor: t.surface, borderColor: t.border }]}
            onPress={() => { Haptics.selectionAsync(); router.push('/notifications'); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialIcons name="notifications-none" size={22} color={t.textSecondary} />
          </TouchableOpacity>
          <View
            ref={addBtnRef}
            collapsable={false}
            onLayout={() => { if (tutorialStep === 'ADD_BUTTON') measureAddBtn(); }}
          >
            <TouchableOpacity activeOpacity={0.6}
              style={[styles.headerButton, { backgroundColor: t.surface, borderColor: t.border }]}
              onPress={openSearchModal}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <MaterialIcons name="add-circle-outline" size={24} color={t.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
        bounces={true}
        alwaysBounceVertical={true}
        overScrollMode="always"
        delaysContentTouches={false}
        onScrollBeginDrag={Keyboard.dismiss}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={t.primary}
            colors={[t.primary]}
            progressBackgroundColor={t.surface}
          />
        }
      >
        {/* Notification Prompt Banner — inside ScrollView so it scrolls away with content */}
        {showNotifPrompt && !notificationsEnabled ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={[styles.notifPrompt, { backgroundColor: t.primary + '12', borderColor: t.primary + '30' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name="notifications-active" size={20} color={t.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: t.textPrimary }}>Enable Notifications</Text>
                  <Text style={{ fontSize: 12, color: t.textSecondary }}>Get breakout alerts and price updates</Text>
                </View>
                <TouchableOpacity activeOpacity={0.6} onPress={dismissNotifBanner}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
                  <MaterialIcons name="close" size={20} color={t.textTertiary} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity activeOpacity={0.7}
                  style={{ flex: 1, height: 40, borderRadius: 8, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}
                  onPress={() => {
                    // Session 203 — Hide banner INSTANTLY and persist the dismissal.
                    // Then kick off the OS permission request in the background so the
                    // banner doesn't linger while the OS dialog is on screen.
                    dismissNotifBanner();
                    initNotifications()
                      .then((granted) => {
                        if (granted) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                      })
                      .catch(() => {});
                  }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Enable</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7}
                  style={{ flex: 1, height: 40, borderRadius: 8, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}
                  onPress={dismissNotifBanner}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: t.textTertiary }}>Later</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        {/* Market Status Banner — inside ScrollView so it scrolls away with content */}
        {showMarketStatusBanner ? (
          <View style={{ paddingHorizontal: 16, paddingTop: showNotifPrompt && !notificationsEnabled ? 8 : 12 }}>
            <View style={[styles.marketBanner, { backgroundColor: marketBannerColor + '12', borderColor: marketBannerColor + '30' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: marketBannerColor + '20', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialIcons name={marketBannerIcon as any} size={18} color={marketBannerColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: t.textPrimary }}>{marketStatus.label}</Text>
                  {countdown ? (
                    <Text style={{ fontSize: 11, color: t.textSecondary, marginTop: 1 }}>
                      Opens in <Text style={{ fontWeight: '700', color: marketBannerColor, fontVariant: ['tabular-nums'] }}>{countdown}</Text>
                    </Text>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity activeOpacity={0.6} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setShowMarketBanner(false); }}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}>
                <MaterialIcons name="close" size={18} color={t.textTertiary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={{ marginTop: 12 }}>
          {isSubscribed ? (
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]} onPress={() => { Haptics.selectionAsync(); router.push('/daily-summary' as any); }}>
              <View style={[styles.blueBorderWrapper, { marginHorizontal: isTablet ? 20 : 16 }]}>
                <StaticBlueBorder>
                  <View style={[styles.portfolioCardInner, { backgroundColor: t.surface }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <Text style={[styles.portfolioLabel, { color: t.textTertiary, marginBottom: 0 }]}>PORTFOLIO VALUE</Text>
                      {brokerConn.hasActiveConnection ? (
                        <View style={{ backgroundColor: t.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                          <Text style={{ fontSize: 9, fontWeight: '800', color: t.primary, letterSpacing: 0.5 }}>BROKER SYNCED</Text>
                        </View>
                      ) : null}
                    </View>
                    {(portfolio.length > 0 || brokerConn.hasActiveConnection) ? (
                      <>
                        {/* AnimatedPortfolioValue = odometer digit-roll +
                            green/red glow on value change (Session 113 #2).
                            The glow is purely visual — portfolioValue.total
                            is computed independently from live stockDataMap
                            and is passed unchanged. */}
                        <AnimatedPortfolioValue
                          value={portfolioValue.total}
                          prefix="$"
                          decimals={2}
                          duration={550}
                          style={{ ...styles.portfolioValue, color: t.textPrimary, fontSize: computePortfolioFontSize(portfolioValue.total, isTablet) }}
                        />
                        <View style={[styles.changeRow, { backgroundColor: isPositive ? t.bullishBg : t.bearishBg }]}>
                          <MaterialIcons name={isPositive ? 'arrow-drop-up' : 'arrow-drop-down'} size={20} color={isPositive ? t.bullish : t.bearish} />
                          <Text style={{ fontSize: 14, fontWeight: '600', color: isPositive ? t.bullish : t.bearish }}>
                            {isPositive ? '+' : ''}${Math.abs(portfolioValue.change).toFixed(2)} ({isPositive ? '+' : ''}{portfolioValue.changePercent.toFixed(2)}%)
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                          <Text style={{ fontSize: 12, color: t.textTertiary }}>
                            {brokerConn.hasActiveConnection
                              ? `Cash $${brokerConn.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Invested $${portfolioValue.costBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : `Cost Basis: $${portfolioValue.costBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </Text>
                          <TapHandIcon color={t.textTertiary + '80'} />
                        </View>
                      </>
                    ) : (
                      <>
                        <AnimatedPortfolioValue
                          value={0}
                          prefix="$"
                          decimals={2}
                          duration={550}
                          style={{ ...styles.portfolioValue, color: t.textPrimary, fontSize: computePortfolioFontSize(0, isTablet) }}
                        />
                        <Text style={{ fontSize: 12, color: t.textTertiary, marginTop: 6 }}>Connect a brokerage to sync your portfolio</Text>
                      </>
                    )}
                  </View>
                </StaticBlueBorder>
              </View>
            </Pressable>
          ) : (
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]} onPress={() => { Haptics.selectionAsync(); router.push('/daily-summary' as any); }}>
              <View style={[styles.portfolioCard, { backgroundColor: t.surface, borderColor: t.border, marginHorizontal: isTablet ? 20 : 16 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Text style={[styles.portfolioLabel, { color: t.textTertiary, marginBottom: 0 }]}>PORTFOLIO VALUE</Text>
                  {brokerConn.hasActiveConnection ? (
                    <View style={{ backgroundColor: t.primary + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 9, fontWeight: '800', color: t.primary, letterSpacing: 0.5 }}>BROKER SYNCED</Text>
                    </View>
                  ) : null}
                </View>
                {(portfolio.length > 0 || brokerConn.hasActiveConnection) ? (
                  <>
                    {/* AnimatedPortfolioValue — same premium animation as the
                        Pro view, including the brief green/red glow on value
                        change (Session 113 #2). */}
                    <AnimatedPortfolioValue
                      value={portfolioValue.total}
                      prefix="$"
                      decimals={2}
                      duration={550}
                      style={{ ...styles.portfolioValue, color: t.textPrimary, fontSize: computePortfolioFontSize(portfolioValue.total, isTablet) }}
                    />
                    <View style={[styles.changeRow, { backgroundColor: isPositive ? t.bullishBg : t.bearishBg }]}>
                      <MaterialIcons name={isPositive ? 'arrow-drop-up' : 'arrow-drop-down'} size={20} color={isPositive ? t.bullish : t.bearish} />
                      <Text style={{ fontSize: 14, fontWeight: '600', color: isPositive ? t.bullish : t.bearish }}>
                        {isPositive ? '+' : ''}${Math.abs(portfolioValue.change).toFixed(2)} ({isPositive ? '+' : ''}{portfolioValue.changePercent.toFixed(2)}%)
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: t.textTertiary }}>
                        {brokerConn.hasActiveConnection
                          ? `Cash $${brokerConn.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · Invested $${portfolioValue.costBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : `Cost Basis: $${portfolioValue.costBasis.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </Text>
                      <TapHandIcon color={t.textTertiary + '80'} />
                    </View>
                  </>
                ) : (
                  <>
                    <AnimatedPortfolioValue
                      value={0}
                      prefix="$"
                      decimals={2}
                      duration={550}
                      style={{ ...styles.portfolioValue, color: t.textPrimary, fontSize: computePortfolioFontSize(0, isTablet) }}
                    />
                    <Text style={{ fontSize: 12, color: t.textTertiary, marginTop: 6 }}>Connect a brokerage to sync your portfolio</Text>
                  </>
                )}
              </View>
            </Pressable>
          )}
        </View>

        {/* Session 200 — PENDING ORDERS (unfilled broker orders w/ cancel).
            Shows any BUY / SELL order the user placed (either through Sight or
            directly at the broker) that has not yet been filled at the
            brokerage. Each card carries a clear "Order has not yet been
            filled by broker" note and a Cancel Order button that calls
            snaptrade-cancel-order to cancel the order before the market
            fills it. Cancellation is optimistic — the card disappears
            instantly and the next broker sync (fired immediately by the
            hook after a successful cancel) confirms the terminal state. */}
        {brokerConn.hasActiveConnection && brokerConn.pendingOrders.length > 0 ? (
          <View>
            <View style={[styles.sectionHeader, { paddingHorizontal: isTablet ? 20 : 16 }]}>
              <Text style={[styles.sectionTitle, { color: '#F59E0B' }]}>PENDING ORDERS</Text>
              <Text style={[styles.sectionCount, { color: t.textTertiary }]}>{brokerConn.pendingOrders.length} unfilled</Text>
            </View>
            <View style={{ paddingHorizontal: isTablet ? 20 : 16, gap: 10, marginBottom: 20 }}>
              {brokerConn.pendingOrders.map((order) => {
                const isBuy = order.action === 'BUY';
                const orderTypeLabel = order.orderType === 'MARKET'
                  ? 'Market'
                  : order.orderType === 'LIMIT'
                    ? `Limit @ $${(order.price ?? 0).toFixed(2)}`
                    : order.orderType === 'STOP'
                      ? `Stop @ $${(order.stopPrice ?? 0).toFixed(2)}`
                      : order.orderType;
                const filledPct = order.totalQuantity > 0 ? (order.filledQuantity / order.totalQuantity) * 100 : 0;
                return (
                  <View key={order.id} style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: '#F59E0B40', padding: 14 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <StockLogo ticker={order.ticker} size={36} />
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 16, fontWeight: '700', color: t.textPrimary }}>{order.ticker}</Text>
                          <View style={{ backgroundColor: isBuy ? t.bullishBg : t.bearishBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: isBuy ? t.bullish : t.bearish }}>{order.action}</Text>
                          </View>
                          <View style={{ backgroundColor: '#F59E0B22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <MaterialIcons name="schedule" size={9} color="#F59E0B" />
                            <Text style={{ fontSize: 9, fontWeight: '700', color: '#F59E0B' }}>{order.isPartiallyFilled ? 'PARTIAL' : 'PENDING'}</Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 2 }}>
                          {order.totalQuantity} sh · {orderTypeLabel}
                        </Text>
                        <Text style={{ fontSize: 10, color: '#F59E0B', marginTop: 2, fontStyle: 'italic' }}>
                          {order.isPartiallyFilled
                            ? `Partially filled: ${order.filledQuantity}/${order.totalQuantity} shares`
                            : 'Order has not yet been filled by broker'}
                        </Text>
                      </View>
                    </View>
                    {order.isPartiallyFilled ? (
                      <View style={{ height: 4, backgroundColor: t.border, borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                        <View style={{ height: '100%', width: `${Math.max(0, Math.min(100, filledPct))}%`, backgroundColor: '#F59E0B' }} />
                      </View>
                    ) : null}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={{ height: 40, borderRadius: 10, borderWidth: 1, borderColor: t.bearish, backgroundColor: t.bearishBg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
                      onPress={() => {
                        Haptics.selectionAsync();
                        showAlert(
                          'Cancel Order?',
                          `Cancel this ${order.action} order for ${order.totalQuantity} shares of ${order.ticker}? This will attempt to cancel it at your broker before it fills.`,
                          [
                            { text: 'Keep Order', style: 'cancel' },
                            {
                              text: 'Cancel Order',
                              style: 'destructive',
                              onPress: async () => {
                                const result = await brokerConn.cancelOrder(order.accountId, order.brokerageOrderId);
                                if (result.success) {
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                                  showAlert('Order Cancelled', `Your ${order.ticker} order has been cancelled at the broker.`);
                                } else {
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                                  showAlert('Cancel Failed', result.error ?? 'Could not cancel the order. It may have already been filled.');
                                }
                              },
                            },
                          ],
                        );
                      }}
                    >
                      <MaterialIcons name="cancel" size={16} color={t.bearish} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: t.bearish }}>Cancel Order</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Session 117 — ACTIVE TRADES with TP/SL status */}
        {brokerConn.hasActiveConnection ? (
          <View>
            <View style={[styles.sectionHeader, { paddingHorizontal: isTablet ? 20 : 16 }]}>
              <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>ACTIVE TRADES</Text>
              <Text style={[styles.sectionCount, { color: t.textTertiary }]}>{brokerActiveTrades.length} open</Text>
            </View>
            {brokerActiveTrades.length === 0 ? (
              <View style={{ paddingHorizontal: isTablet ? 20 : 16, marginBottom: 20 }}>
                <View style={{ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <MaterialIcons name="account-balance-wallet" size={20} color={t.textTertiary} />
                  <Text style={{ flex: 1, fontSize: 13, color: t.textSecondary, lineHeight: 19 }}>
                    Your broker reports no open positions. Trades executed at your broker will appear here automatically.
                  </Text>
                </View>
              </View>
            ) : (
              <View style={{ paddingHorizontal: isTablet ? 20 : 16, gap: 10, marginBottom: 20 }}>
                {brokerActiveTrades.map((it) => {
                  const hasBasis = it.avgCost > 0;
                  const win = it.pnl >= 0;
                  // Session 203 — broker bracket display. When SnapTrade
                  // returned bracket child orders (TP / SL), we render
                  // the same entry → TP progress bar and SL line as
                  // locally-placed trades.
                  const hasTP = typeof it.takeProfit === 'number' && it.takeProfit > 0;
                  const hasSL = typeof it.stopLoss === 'number' && it.stopLoss > 0;
                  const hasBracket = hasBasis && hasTP && hasSL;
                  const barProgress = hasBracket && it.takeProfit! > it.avgCost
                    ? Math.max(0, Math.min(100, ((it.currentPrice - it.avgCost) / (it.takeProfit! - it.avgCost)) * 100))
                    : 0;
                  return (
                    <Pressable key={it.key}
                      onPress={() => { Haptics.selectionAsync(); router.push(`/stock/${it.ticker}` as any); }}
                      style={({ pressed }) => ({ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14, opacity: pressed ? 0.85 : 1 })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: hasBracket ? 12 : 0 }}>
                        <StockLogo ticker={it.ticker} size={36} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={{ fontSize: 16, fontWeight: '700', color: t.textPrimary }}>{it.ticker}</Text>
                            <View style={{ backgroundColor: it.position === 'long' ? t.bullishBg : t.bearishBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ fontSize: 10, fontWeight: '800', color: it.position === 'long' ? t.bullish : t.bearish }}>{it.position.toUpperCase()}</Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 1 }} numberOfLines={1}>
                            {it.shares} {it.shares === 1 ? 'share' : 'shares'} · ${it.currentPrice > 0 ? it.currentPrice.toFixed(2) : '—'}
                          </Text>
                        </View>
                        {/* Session 207 — mini chart to the LEFT of $ amount (like watchlist) */}
                        {it.chartData && it.chartData.length > 2 ? (
                          <MiniChart data={it.chartData} width={isTablet ? 72 : 56} height={26} color={win ? t.bullish : t.bearish} />
                        ) : null}
                        <View style={{ alignItems: 'flex-end', minWidth: 60 }}>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: hasBasis ? (win ? t.bullish : t.bearish) : t.textPrimary }} numberOfLines={1} adjustsFontSizeToFit>
                            {hasBasis ? `${win ? '+' : '-'}$${Math.abs(it.pnl).toFixed(2)}` : `$${(it.shares * it.currentPrice).toFixed(2)}`}
                          </Text>
                          {hasBasis ? (
                            <Text style={{ fontSize: 11, color: win ? t.bullish : t.bearish, fontWeight: '600' }}>
                              {win ? '+' : ''}{it.pnlPercent.toFixed(2)}%
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      {hasBracket ? (
                        <>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ fontSize: 10, color: t.textTertiary, fontWeight: '700' }}>ENTRY ${it.avgCost.toFixed(2)}</Text>
                            <Text style={{ fontSize: 10, color: t.textPrimary, fontWeight: '700' }}>${it.currentPrice.toFixed(2)}</Text>
                            <Text style={{ fontSize: 10, color: t.bullish, fontWeight: '700' }}>TP ${it.takeProfit!.toFixed(2)}</Text>
                          </View>
                          <View style={{ height: 6, backgroundColor: t.border, borderRadius: 3, overflow: 'hidden' }}>
                            <View style={{ height: '100%', width: `${barProgress}%`, backgroundColor: win ? t.bullish : t.bearish }} />
                          </View>
                          <Text style={{ fontSize: 10, color: t.bearish, fontWeight: '600', marginTop: 6 }}>
                            Stop Loss: ${it.stopLoss!.toFixed(2)}
                          </Text>
                        </>
                      ) : hasTP ? (
                        <Text style={{ fontSize: 11, color: t.bullish, fontWeight: '600', marginTop: 8 }}>
                          Take Profit: ${it.takeProfit!.toFixed(2)}
                        </Text>
                      ) : hasSL ? (
                        <Text style={{ fontSize: 11, color: t.bearish, fontWeight: '600', marginTop: 8 }}>
                          Stop Loss: ${it.stopLoss!.toFixed(2)}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : portfolio.filter(p => p.tradeId).length > 0 ? (
          <View>
            <View style={[styles.sectionHeader, { paddingHorizontal: isTablet ? 20 : 16 }]}>
              <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>ACTIVE TRADES</Text>
              <Text style={[styles.sectionCount, { color: t.textTertiary }]}>
                {portfolio.filter(p => p.tradeId).length} open
              </Text>
            </View>
            <View style={{ paddingHorizontal: isTablet ? 20 : 16, gap: 10, marginBottom: 20 }}>
              {portfolio.filter(p => p.tradeId).map((item) => {
                const data = stockDataMap.get(item.ticker);
                const currentPrice = data?.quote.price ?? item.avgCost;
                // Session 175 — an Active Trade is defined by tradeId alone.
                // TP / SL are optional metadata; when present we show the
                // progress bar and SL line, when absent we simply render the
                // trade card with entry/current/P&L. This removes the
                // regression where trades placed without TP/SL vanished from
                // Active Trades because the old filter required both.
                const hasTP = typeof item.takeProfit === 'number' && item.takeProfit > 0;
                const hasSL = typeof item.stopLoss === 'number' && item.stopLoss > 0;
                const hasBracket = hasTP && hasSL;
                const status = hasBracket ? computeTradeStatus({
                  position: item.position,
                  entryPrice: item.avgCost,
                  takeProfit: item.takeProfit!,
                  stopLoss: item.stopLoss!,
                  shares: item.shares,
                }, currentPrice) : null;
                const isLong = item.position === 'long';
                const rawPnl = isLong
                  ? (currentPrice - item.avgCost) * item.shares
                  : (item.avgCost - currentPrice) * item.shares;
                const costBasis = item.avgCost * item.shares;
                const pnl = status ? status.currentPnL : rawPnl;
                const pnlPct = status ? status.currentPnLPercent : (costBasis > 0 ? (rawPnl / costBasis) * 100 : 0);
                const isPositive = pnl >= 0;
                const barProgress = status ? Math.max(0, Math.min(100, status.entryToTPProgress)) : 0;
                return (
                  <Pressable key={item.tradeId}
                    onPress={() => { Haptics.selectionAsync(); router.push(`/stock/${item.ticker}` as any); }}
                    style={({ pressed }) => ({ backgroundColor: t.surface, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14, opacity: pressed ? 0.85 : 1 })}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: hasBracket ? 12 : 0 }}>
                      <StockLogo ticker={item.ticker} size={40} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 16, fontWeight: '700', color: t.textPrimary }}>{item.ticker}</Text>
                          <View style={{ backgroundColor: item.position === 'long' ? t.bullishBg : t.bearishBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: item.position === 'long' ? t.bullish : t.bearish }}>
                              {item.position.toUpperCase()}
                            </Text>
                          </View>
                          {item.tradeType ? (
                            <View style={{ backgroundColor: t.primary + '18', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, fontWeight: '700', color: t.primary }}>{item.tradeType.toUpperCase()}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={{ fontSize: 11, color: t.textTertiary, marginTop: 1 }} numberOfLines={1}>
                          {item.shares} {item.shares === 1 ? 'share' : 'shares'} · Entry ${item.avgCost.toFixed(2)} · Now ${currentPrice.toFixed(2)}
                        </Text>
                      </View>
                      {/* Session 207 — mini chart to the LEFT of $ amount (like watchlist) */}
                      {data?.chartData && data.chartData.length > 2 ? (
                        <MiniChart data={data.chartData} width={isTablet ? 72 : 56} height={26} color={isPositive ? t.bullish : t.bearish} />
                      ) : null}
                      <View style={{ alignItems: 'flex-end', minWidth: 60 }}>
                        <Text style={{ fontSize: 15, fontWeight: '800', color: isPositive ? t.bullish : t.bearish }} numberOfLines={1} adjustsFontSizeToFit>
                          {isPositive ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                        </Text>
                        <Text style={{ fontSize: 11, color: isPositive ? t.bullish : t.bearish, fontWeight: '600' }}>
                          {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
                        </Text>
                      </View>
                    </View>
                    {hasBracket ? (
                      <>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ fontSize: 10, color: t.textTertiary, fontWeight: '700' }}>ENTRY ${item.avgCost.toFixed(2)}</Text>
                          <Text style={{ fontSize: 10, color: t.textPrimary, fontWeight: '700' }}>${currentPrice.toFixed(2)}</Text>
                          <Text style={{ fontSize: 10, color: t.bullish, fontWeight: '700' }}>TP ${item.takeProfit!.toFixed(2)}</Text>
                        </View>
                        <View style={{ height: 6, backgroundColor: t.border, borderRadius: 3, overflow: 'hidden' }}>
                          <View style={{ height: '100%', width: `${barProgress}%`, backgroundColor: isPositive ? t.bullish : t.bearish }} />
                        </View>
                        <Text style={{ fontSize: 10, color: t.bearish, fontWeight: '600', marginTop: 6 }}>
                          Stop Loss: ${item.stopLoss!.toFixed(2)}
                        </Text>
                      </>
                    ) : hasTP ? (
                      <Text style={{ fontSize: 11, color: t.bullish, fontWeight: '600', marginTop: 8 }}>
                        Take Profit: ${item.takeProfit!.toFixed(2)}
                      </Text>
                    ) : hasSL ? (
                      <Text style={{ fontSize: 11, color: t.bearish, fontWeight: '600', marginTop: 8 }}>
                        Stop Loss: ${item.stopLoss!.toFixed(2)}
                      </Text>
                    ) : null}

                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View>
          {/* Session 135 — hide the WATCHLIST section header entirely when
              the user hasn't added anything yet, so the empty state stands
              on its own without a redundant title. */}
          {displayWatchlist.length > 0 ? (
            <View style={[styles.sectionHeader, { paddingHorizontal: isTablet ? 20 : 16 }]}>
              <Text style={[styles.sectionTitle, { color: t.textTertiary }]}>WATCHLIST</Text>
              <Text style={[styles.sectionCount, { color: t.textTertiary }]}>{displayWatchlist.length} stocks</Text>
            </View>
          ) : null}
          <View
            ref={watchlistAreaRef}
            collapsable={false}
            onLayout={() => { if (tutorialStep === 'HOME_WATCHLIST') measureWatchlistArea(); }}
            style={[styles.watchlistContainer, { paddingHorizontal: isTablet ? 20 : 16 }]}
          >
            {displayWatchlist.length === 0 ? (
              // Session 181 — During tutorial, always show the empty state
              // (even for broker-connected users) so the HOME_WATCHLIST
              // spotlight has a real visible target with non-zero
              // dimensions. Broker-connected users normally see broker
              // Active Trades as the primary content and this empty state
              // is hidden, but that collapses the watchlist container to
              // zero height and breaks the tutorial's Home step. After the
              // tutorial completes (tutorialStep === 'DONE'), broker users
              // return to normal hidden-empty-state behavior.
              (brokerConn.hasActiveConnection && tutorialStep === 'DONE') ? null : (
                <TouchableOpacity activeOpacity={0.7} style={[styles.emptyState, { paddingTop: showMarketStatusBanner ? 20 : 40 }]} onPress={openSearchModal}>
                  <Image source={require('../../assets/images/magnifying-glass.png')} style={[styles.emptyImage, { width: isTablet ? 180 : 140, height: isTablet ? 180 : 140 }]} contentFit="contain" />
                  <Text style={[styles.emptyTitle, { color: t.textPrimary }]}>No Stocks Yet</Text>
                  <Text style={[styles.emptyDesc, { color: t.textSecondary }]}>Tap here to Search Stocks</Text>
                  <View style={[styles.emptyButton, { backgroundColor: t.primary }]}>
                    <MaterialIcons name="add" size={20} color="#FFF" />
                    <Text style={styles.emptyButtonText}>Add Stocks</Text>
                  </View>
                </TouchableOpacity>
              )
            ) : (
              <>
                {displayWatchlist.map((ticker, i) => {
                  const data = stockDataMap.get(ticker);
                  if (!data) {
                    return (
                      <View key={ticker} style={[styles.loadingCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                        <StockLogo ticker={ticker} size={36} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.loadingTicker, { color: t.textPrimary }]}>{ticker}</Text>
                          <Text style={{ fontSize: 12, color: t.textTertiary }}>Loading...</Text>
                        </View>
                        <ActivityIndicator size="small" color={t.primary} />
                      </View>
                    );
                  }
                  return (
                    <View key={ticker}>
                      <StockCard
                        ticker={ticker}
                        name={data.quote.name}
                        price={data.quote.price}
                        change={data.quote.change}
                        changePercent={data.quote.changePercent}
                        signal={data.analysis.signal}
                        confidence={data.analysis.confidence}
                        chartData={data.chartData}
                        isSubscribed={isSubscribed}
                      />
                    </View>
                  );
                })}
                {/* Free user watchlist limit nudge */}
                {!isSubscribed && watchlist.length >= 3 ? (
                  <Pressable
                    style={({ pressed }) => [{ paddingVertical: 10, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 }]}
                    onPress={() => { Haptics.selectionAsync(); router.push('/subscription'); }}
                  >
                    <Text style={{ fontSize: 13, color: t.textTertiary, textAlign: 'center' }}>
                      Watchlist limit reached{' '}<Text style={{ color: t.primary, fontWeight: '600' }}>Upgrade to Pro</Text>
                    </Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Spotlight Tutorial - Step 1: ADD_BUTTON (on main screen) */}
      {tutorialStep === 'ADD_BUTTON' && addBtnRect ? (
        <SpotlightOverlay
          step="ADD_BUTTON"
          spotlightRect={addBtnRect}
          onSkip={skipTutorial}
          accentColor={t.primary}
          textColor="#FFFFFF"
          surfaceColor="#1E293B"
        />
      ) : null}

      {/* Session 176 — Spotlight Tutorial: HOME_WATCHLIST step. Shown on
          Home after the user completes the add-stock flow, BEFORE the
          tab walkthrough begins. Highlights the watchlist / stock-list
          area so users see where any stock they add will appear. Tapping
          Done marks the highlight tutorial complete and hands off to the
          tab walkthrough (Moves → Camera → Journal → Home + confetti). */}
      {/* Session 201 — HOME_WATCHLIST spotlight overlay is wrapped in a
          Modal so it truly overlays EVERYTHING including the tab bar.
          Prior implementation rendered inside the HomeScreen SafeAreaView
          which is bounded above the tab bar — that caused the tooltip to
          clip / sit below the visible area. A transparent Modal renders
          on top of the entire app root, so the spotlight cutout and
          tooltip are always fully visible.  */}
      {tutorialStep === 'HOME_WATCHLIST' && watchlistAreaRect ? (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          statusBarTranslucent={true}
          presentationStyle="overFullScreen"
          hardwareAccelerated={true}
          onRequestClose={() => {}}
        >
          <SpotlightOverlay
            step="HOME_WATCHLIST"
            spotlightRect={watchlistAreaRect}
            onSkip={skipTutorial}
            showNext
            nextLabel="Continue"
            onNext={() => {
              setTutorialStep('DONE');
              tutorialStarted.current = true;
              setHasCompletedTutorial(true);
              Haptics.selectionAsync().catch(() => {});
              startTabWalkthrough();
            }}
            accentColor={t.primary}
            textColor="#FFFFFF"
            surfaceColor="#1E293B"
          />
        </Modal>
      ) : null}

      {/* Search Modal - now contains the share form INSIDE it */}
      <Modal visible={searchVisible} animationType="slide" transparent={false} statusBarTranslucent={false}>
        <View style={[styles.modalContainer, { backgroundColor: t.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <View style={[styles.modalHeader, { paddingVertical: 8, paddingTop: 8 }]}>
            <Text style={[styles.modalTitle, { color: t.textPrimary }]}>Trade</Text>
            <TouchableOpacity activeOpacity={0.6} onPress={closeSearchModal}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={[styles.modalCloseBtn, { backgroundColor: t.surface, borderColor: t.border }]}>
              <MaterialIcons name="close" size={22} color={t.textSecondary} />
            </TouchableOpacity>
          </View>
          <View
            ref={searchBarRef}
            collapsable={false}
            onLayout={() => { if (tutorialStep === 'ADD_BUTTON' || tutorialStep === 'SEARCH_BAR') measureSearchBar(); }}
          >
            <View style={[styles.searchInputContainer, { backgroundColor: t.surface, borderColor: t.border }]}>
              <MaterialIcons name="search" size={20} color={t.textTertiary} />
              <TextInput
                style={[styles.searchInput, { color: t.textPrimary }]}
                placeholder="Search stocks..."
                placeholderTextColor={t.textTertiary}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus={tutorialStep === 'DONE' || tutorialStep === 'SEARCH_BAR'}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {searchQuery.length > 0 ? (
                <TouchableOpacity activeOpacity={0.6} onPress={() => setSearchQuery('')}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <MaterialIcons name="clear" size={18} color={t.textTertiary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          {searchQuery.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <MaterialIcons name="trending-up" size={18} color={t.primary} />
                <Text style={{ fontSize: 14, fontWeight: '700', color: t.textPrimary }}>Trending Stocks</Text>
              </View>
            </View>
          ) : null}
          <FlatList
            data={searchQuery.length > 0 ? combinedSearchResults : trendingStocks}
            keyExtractor={item => item.ticker}
            renderItem={renderSearchItem}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="on-drag"
            removeClippedSubviews={true}
            maxToRenderPerBatch={15}
            windowSize={10}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: searchQuery.length > 0 ? 8 : 0 }}
            ListEmptyComponent={
              searchQuery.length > 0 ? (
                <View style={styles.noResults}>
                  <MaterialIcons name="search-off" size={40} color={t.textTertiary} />
                  <Text style={{ fontSize: 14, color: t.textTertiary }}>No stocks found for "{searchQuery}"</Text>
                </View>
              ) : null
            }
          />

          {/* Share form rendered INSIDE the search modal as an overlay */}
          {renderShareForm()}

          {/* Spotlight Tutorial - Step 2: SEARCH_BAR */}
          {tutorialStep === 'SEARCH_BAR' && searchBarRect ? (
            <SpotlightOverlay
              step="SEARCH_BAR"
              spotlightRect={searchBarRect}
              onSkip={skipTutorial}
              accentColor={t.primary}
              textColor="#FFFFFF"
              surfaceColor="#1E293B"
            />
          ) : null}

          {/* Spotlight Tutorial - Step 3: PICK_STOCK */}
          {tutorialStep === 'PICK_STOCK' && firstResultRect ? (
            <SpotlightOverlay
              step="PICK_STOCK"
              spotlightRect={firstResultRect}
              onSkip={skipTutorial}
              accentColor={t.primary}
              textColor="#FFFFFF"
              surfaceColor="#1E293B"
            />
          ) : null}

          {/* Session 144 — Spotlight Tutorial - Step 4: CHOICE_OVERLAY.
              Highlights the Put in Trade / Add to Watchlist chooser card as
              a whole and explains each option in the tooltip. Rendered
              inside the search modal so it stacks on top of the chooser. */}
          {tutorialStep === 'CHOICE_OVERLAY' && choiceOverlayRect ? (
            <SpotlightOverlay
              step="CHOICE_OVERLAY"
              spotlightRect={choiceOverlayRect}
              onSkip={skipTutorial}
              accentColor={t.primary}
              textColor="#FFFFFF"
              surfaceColor="#1E293B"
            />
          ) : null}

          {/* Session 121 — CHOOSER OVERLAY: Log a Trade vs Add to Watchlist.
              Rendered INSIDE the search modal (not as a separate Modal) so it
              reliably stacks on top of the Log-a-Trade page on every device. */}
          {choiceOverlayVisible ? (
            <View style={[styles.inlineShareOverlay, { zIndex: 200 }]}>
              <TouchableOpacity activeOpacity={1} style={styles.inlineShareBg}
                onPress={() => setChoiceOverlayVisible(false)} />
              <View style={styles.inlineShareCenter}>
                <View
                  ref={choiceOverlayRef}
                  collapsable={false}
                  onLayout={() => { if (tutorialStep === 'PICK_STOCK' || tutorialStep === 'CHOICE_OVERLAY') measureChoiceOverlay(); }}
                  style={{ width: '100%', maxWidth: 380, backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.border, padding: 20 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <StockLogo ticker={pendingTicker} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: t.textPrimary }}>{pendingTicker}</Text>
                      <Text style={{ fontSize: 12, color: t.textSecondary }} numberOfLines={1}>{pendingName}</Text>
                    </View>
                    <Pressable onPress={() => setChoiceOverlayVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <MaterialIcons name="close" size={22} color={t.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={{ fontSize: 15, color: t.textSecondary, marginTop: 10, marginBottom: 16 }}>What do you want to do?</Text>
                  <Pressable
                    style={({ pressed }) => ({ backgroundColor: t.primary, borderRadius: 14, padding: 16, marginBottom: 10, opacity: pressed ? 0.9 : 1 })}
                    onPress={async () => {
                      Haptics.selectionAsync();
                      // Session 181 — CORRECTED: During tutorial, the Trade
                      // button is a SIMULATED interaction that ONLY advances
                      // the walkthrough. It does NOT navigate to /put-in-
                      // trade, does NOT call SnapTrade, does NOT add anything
                      // to the watchlist, does NOT fetch a quote, and does
                      // NOT create a journal entry. Broker-connected users
                      // see the EXACT same simulated behavior as non-broker
                      // users — broker state has ZERO effect on tutorial
                      // interactions because no real trade is submitted.
                      // Outside tutorial mode this button performs the
                      // normal real Trade flow (broker-aware navigation to
                      // /put-in-trade with a fresh live entry price).
                      const isTutorial = tutorialStep === 'PICK_STOCK' || tutorialStep === 'SEARCH_BAR' || tutorialStep === 'CHOICE_OVERLAY' || tutorialStep === 'FILL_FORM';
                      if (isTutorial) {
                        if (__DEV__) console.log('[tutorial] Trade press intercepted — SIMULATED (no /put-in-trade nav, no SnapTrade, no watchlist mutation)');
                        setChoiceOverlayVisible(false);
                        setSearchVisible(false);
                        setSearchQuery('');
                        setTimeout(() => {
                          measureWatchlistArea();
                          setTutorialStep('HOME_WATCHLIST');
                        }, 320);
                        return;
                      }
                      // Normal broker-aware Trade flow — unchanged outside tutorial
                      let currentPrice = stockDataMap.get(pendingTicker)?.quote.price ?? 0;
                      try {
                        const quotes = await fetchMultipleQuotes([pendingTicker]);
                        const q = quotes.get(pendingTicker);
                        if (q && q.price > 0) currentPrice = q.price;
                      } catch {}
                      setChoiceOverlayVisible(false);
                      setSearchVisible(false);
                      setSearchQuery('');
                      router.push({
                        pathname: '/put-in-trade',
                        params: {
                          ticker: pendingTicker,
                          action: 'buy',
                          entry: String(currentPrice || ''),
                          source: 'manual',
                        },
                      } as any);
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MaterialIcons name="flash-on" size={22} color="#FFF" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFF' }}>Trade</Text>
                        <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                          {brokerConn.hasActiveConnection
                            ? `Submit a real order via ${brokerConn.brokerNames[0] ?? 'your broker'}`
                            : 'Connect your brokerage and place a real order'}
                        </Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={22} color="#FFF" />
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => ({ backgroundColor: t.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.85 : 1 })}
                    onPress={() => {
                      // Session 181 — CORRECTED: During tutorial, the Add to
                      // Watchlist button is a SIMULATED interaction that ONLY
                      // advances the walkthrough. It does NOT add anything to
                      // the real watchlist, does NOT trigger the free-user
                      // paywall, does NOT persist to Supabase, does NOT
                      // increment the review prompt counter. Broker-connected
                      // users see the EXACT same simulated behavior as
                      // non-broker users. Outside tutorial mode this button
                      // performs the normal real Add to Watchlist flow.
                      const isTutorial = tutorialStep === 'PICK_STOCK' || tutorialStep === 'SEARCH_BAR' || tutorialStep === 'CHOICE_OVERLAY' || tutorialStep === 'FILL_FORM';
                      if (isTutorial) {
                        if (__DEV__) console.log('[tutorial] Add to Watchlist press intercepted — SIMULATED (no real watchlist mutation, no paywall, no persistence)');
                        setChoiceOverlayVisible(false);
                        setSearchVisible(false);
                        setSearchQuery('');
                        Haptics.selectionAsync();
                        setTimeout(() => {
                          measureWatchlistArea();
                          setTutorialStep('HOME_WATCHLIST');
                        }, 320);
                        return;
                      }
                      // Normal Add to Watchlist flow — unchanged outside tutorial
                      if (!canFreeUserAddStock() && !watchlist.includes(pendingTicker)) {
                        setChoiceOverlayVisible(false);
                        setSearchVisible(false);
                        setSearchQuery('');
                        router.push('/subscription');
                        return;
                      }
                      addToWatchlist(pendingTicker);
                      setChoiceOverlayVisible(false);
                      setSearchVisible(false);
                      setSearchQuery('');
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      incrementAndCheckReviewPrompt();
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MaterialIcons name="bookmark-add" size={22} color={t.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '800', color: t.textPrimary }}>Add to Watchlist</Text>
                        <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>Just watch — no trade tracking</Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={22} color={t.textSecondary} />
                    </View>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Legacy chooser Modal removed — now rendered as in-modal overlay above so it stacks on top of the Log-a-Trade page. */}
      <Modal visible={false} transparent animationType="fade" onRequestClose={() => setChoiceOverlayVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setChoiceOverlayVisible(false)} />
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.border, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <StockLogo ticker={pendingTicker} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: t.textPrimary }}>{pendingTicker}</Text>
                <Text style={{ fontSize: 12, color: t.textSecondary }} numberOfLines={1}>{pendingName}</Text>
              </View>
              <Pressable onPress={() => setChoiceOverlayVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={22} color={t.textSecondary} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 15, color: t.textSecondary, marginTop: 10, marginBottom: 16 }}>What do you want to do?</Text>
            <Pressable
              style={({ pressed }) => ({ backgroundColor: t.primary, borderRadius: 14, padding: 16, marginBottom: 10, opacity: pressed ? 0.9 : 1 })}
              onPress={() => {
                setChoiceOverlayVisible(false);
                setShareModalVisible(true);
                Haptics.selectionAsync();
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MaterialIcons name="playlist-add-check" size={22} color="#FFF" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFF' }}>Trade</Text>
                  <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>Track as an Active Trade with TP / SL</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color="#FFF" />
              </View>
            </Pressable>
            <Pressable
              style={({ pressed }) => ({ backgroundColor: t.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.85 : 1 })}
              onPress={() => {
                // Watchlist path — no shares, no entry, no trade tracking.
                if (!canFreeUserAddStock() && !watchlist.includes(pendingTicker)) {
                  setChoiceOverlayVisible(false);
                  setSearchVisible(false);
                  setSearchQuery('');
                  router.push('/subscription');
                  return;
                }
                addToWatchlist(pendingTicker);
                setChoiceOverlayVisible(false);
                setSearchVisible(false);
                setSearchQuery('');
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                incrementAndCheckReviewPrompt();
                if (tutorialStep === 'PICK_STOCK' || tutorialStep === 'SEARCH_BAR') {
                  setTutorialStep('DONE');
                  setHasCompletedTutorial(true);
                  tutorialStarted.current = false;
                }
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <MaterialIcons name="bookmark-add" size={22} color={t.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: t.textPrimary }}>Add to Watchlist</Text>
                  <Text style={{ fontSize: 12, color: t.textSecondary, marginTop: 2 }}>Just watch — no trade tracking</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={t.textSecondary} />
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Session 117 — "I Have Sold" exit price modal */}
      <Modal
        visible={soldModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSoldModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSoldModalVisible(false)} />
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: t.surface, borderRadius: 16, borderWidth: 1, borderColor: t.border, padding: 18 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: t.textPrimary, marginBottom: 4 }}>I Have Sold</Text>
            <Text style={{ fontSize: 13, color: t.textSecondary, marginBottom: 14 }}>What price did you sell at?</Text>
            <Text style={{ fontSize: 11, fontWeight: '600', color: t.textTertiary, marginBottom: 4 }}>EXIT PRICE *</Text>
            <TextInput
              style={{ backgroundColor: t.background, borderColor: t.border, borderWidth: 1, color: t.textPrimary, height: 46, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontWeight: '600' }}
              placeholder="e.g. 205.50"
              placeholderTextColor={t.textTertiary}
              keyboardType="decimal-pad"
              value={soldExitPrice}
              onChangeText={setSoldExitPrice}
              autoFocus
            />
            {(() => {
              const item = portfolio.find(p => p.tradeId === soldTradeId);
              const ep = parseFloat(soldExitPrice);
              if (!item || !Number.isFinite(ep) || ep <= 0) return null;
              const pnl = item.position === 'long'
                ? (ep - item.avgCost) * item.shares
                : (item.avgCost - ep) * item.shares;
              const pnlPercent = (pnl / (item.avgCost * item.shares)) * 100;
              const win = pnl >= 0;
              return (
                <View style={{ marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: win ? t.bullishBg : t.bearishBg }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: win ? t.bullish : t.bearish, letterSpacing: 0.5, marginBottom: 2 }}>ESTIMATED P/L</Text>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: win ? t.bullish : t.bearish }}>
                    {win ? '+' : '-'}${Math.abs(pnl).toFixed(2)} ({win ? '+' : ''}{pnlPercent.toFixed(2)}%)
                  </Text>
                </View>
              );
            })()}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Pressable
                style={{ flex: 1, height: 46, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => { setSoldModalVisible(false); setSoldTradeId(null); setSoldExitPrice(''); }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: t.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={{ flex: 2, height: 46, borderRadius: 10, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => {
                  const price = parseFloat(soldExitPrice);
                  if (!Number.isFinite(price) || price <= 0) {
                    showAlert('Invalid Price', 'Enter a valid exit price.');
                    return;
                  }
                  if (soldTradeId) {
                    const closed = closeTradeManually(soldTradeId, price);
                    if (closed) {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      const sign = closed.pnl >= 0 ? '+' : '-';
                      showAlert(
                        closed.pnl >= 0 ? 'Trade Closed — Winner' : 'Trade Closed',
                        `${closed.ticker}: ${sign}$${Math.abs(closed.pnl).toFixed(2)} (${closed.pnlPercent >= 0 ? '+' : ''}${closed.pnlPercent.toFixed(2)}%).\nSaved to your Journal.`,
                      );
                    }
                  }
                  setSoldModalVisible(false);
                  setSoldTradeId(null);
                  setSoldExitPrice('');
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFF' }}>Confirm Sale</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Session 141 — tutorial completion confetti. Rendered at the root of
          the Home tab so it overlays every UI including the tab bar. */}
      {showTutorialConfetti ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Session 167 — reduced count 80 -> 40 to remove JS-thread lag
              after the highlight tutorial completes. */}
          <Confetti count={40} />
        </View>
      ) : null}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  greeting: { fontWeight: '700', letterSpacing: -0.3 },
  greetingSub: { fontSize: 13, fontWeight: '500' },
  headerButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  blueBorderWrapper: { borderRadius: 18, marginBottom: 16, overflow: 'hidden' },
  rainbowBorder: { borderRadius: 18, padding: 2.5 },
  portfolioCardInner: { borderRadius: 16, padding: 18 },
  portfolioCard: { borderRadius: 16, padding: 18, borderWidth: 1, marginBottom: 16 },
  portfolioLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  portfolioValue: { fontWeight: '700', letterSpacing: -1 },
  emptyPortfolio: { fontSize: 14, marginTop: 4 },
  changeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  sectionCount: { fontSize: 12, fontWeight: '500' },
  watchlistContainer: { marginTop: 4, marginBottom: 20 },
  loadingCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1 },
  loadingTicker: { fontSize: 16, fontWeight: '700' },
  watchlistLimitCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 16, marginTop: 8, borderWidth: 1.5, borderStyle: 'dashed' },
  watchlistLimitIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  notifPrompt: { borderRadius: 14, padding: 14, borderWidth: 1 },
  marketBanner: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyImage: { marginBottom: 12, width: 120, height: 120 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptyDesc: { fontSize: 14, textAlign: 'center', marginBottom: 20 },
  emptyButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 9999, gap: 6 },
  emptyButtonText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  modalContainer: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  modalTitle: { fontSize: 20, fontWeight: '700' },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  searchInputContainer: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, marginHorizontal: 16, paddingHorizontal: 14, height: 48, borderWidth: 1, gap: 10 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, gap: 10 },
  searchTicker: { fontWeight: '700', letterSpacing: 0.5 },
  addButton: { alignItems: 'center', justifyContent: 'center' },
  noResults: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  // Inline share form overlay (rendered inside search modal)
  inlineShareOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  inlineShareBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  inlineShareCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  shareModalContent: { borderRadius: 16, borderWidth: 1 },
  shareCloseBtn: { position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, zIndex: 10 },
  shareInput: { borderRadius: 10, paddingHorizontal: 14, fontSize: 15, fontWeight: '600', borderWidth: 1 },
  shareModalBtn: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  positionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 8, borderWidth: 1.5, gap: 4 },
  // The error line was related to this style definition for shareModalOverlay, but it's commented out in the original.
  // Leaving it commented out as it was not actively used and the primary issue was elsewhere.
  // shareModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },

});
