
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform, ScrollView, Dimensions, Keyboard, Alert } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../../contexts/AppContext';
import { TradingPasswordGate } from '../../components/TradingPasswordGate';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Confetti } from '../../components/Confetti';
import { subscribeTabWalkthrough, consumeTabWalkthroughStart } from '../../services/tutorialWalkthroughBus';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeIn, ZoomIn, useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring, FadeOut, SlideInDown, SlideOutDown, Easing } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';


// Import all tab screens as components
import HomeScreen from './index';
import JournalScreen from './journal';
import UploadScreen from './upload';
import MovesScreen from './signals';
import SettingsScreen from './settings';

// Session 172 — unified startup background. Must match the native splash
// (#050B1F configured in app.json) and the WelcomeLaunch container so
// the tab layer never exposes a pure-black frame during the launch
// handoff or between tab swipes.
const ROOT_BG = '#050B1F';

// Session 161 — Moves icon changed from 'auto-awesome' (stars/sparkle)
// to 'trending-up' (upward arrow with line, symbolizing a stock going up).
// This is the visual language traders expect and it distinguishes Moves
// (actionable BUY setups) from the AI-analysis star iconography used
// elsewhere in the app.
const TAB_CONFIG = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'moves', label: 'Moves', icon: 'trending-up' },
  { key: 'upload', label: '', icon: 'add-a-photo', isCenter: true },
  { key: 'journal', label: 'Journal', icon: 'menu-book' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

const PAGE_GAP = 8;

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { currentTheme: t, isSubscribed, cancelledSub, setCancelledSub, hasCompletedOnboarding, hasSeenSubPrompt, markSubPromptSeen, userEmail, userId, tradingPasswordUnlocked, setTradingPasswordUnlocked, portfolio, stockDataMap, setHasCompletedTutorial, subscriptionInitialCheckDone } = useApp();

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [paywallReady, setPaywallReady] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [screenWidth, setScreenWidth] = useState(Dimensions.get('window').width);
  // Lazy-mount tabs to reduce cold-start work. Home (index 0) is always mounted
  // because it's the first screen the user sees. Other tabs only mount when the
  // user first navigates near them (target tab + immediate neighbors are
  // preloaded so swipe transitions feel instant). This cuts the number of
  // components running on cold start from 5 → 1, dramatically reducing the
  // amount of state/effect setup work happening before first paint.
  const [visitedTabs, setVisitedTabs] = useState<Set<number>>(new Set([0]));
  const returningPaywallShown = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();
  const isScrollingRef = useRef(false);
  const programmaticScrollRef = useRef(false);

  // Track screen width changes
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setScreenWidth(window.width);
    });
    return () => sub?.remove();
  }, []);

  // Note: Review prompt is handled in welcome-pro.tsx after user taps "Start Trading with Pro"
  // No additional review trigger needed here to avoid duplicate prompts

  // Track whether portfolio data has finished its initial load
  const portfolioDataReady = useRef(false);
  const [portfolioLoaded, setPortfolioLoaded] = useState(false);

  // Check if portfolio stocks have loaded their data
  useEffect(() => {
    if (portfolioDataReady.current) return;
    // If user has no portfolio stocks, data is ready immediately
    if (portfolio.length === 0) {
      portfolioDataReady.current = true;
      setPortfolioLoaded(true);
      return;
    }
    // Check if at least one portfolio stock has loaded data
    const hasData = portfolio.some(p => stockDataMap.has(p.ticker));
    if (hasData) {
      portfolioDataReady.current = true;
      setPortfolioLoaded(true);
    }
  }, [portfolio, stockDataMap]);

  // Safety: force portfolio loaded after 3 seconds max
  useEffect(() => {
    if (portfolioDataReady.current) return;
    const timer = setTimeout(() => {
      portfolioDataReady.current = true;
      setPortfolioLoaded(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Show paywall for returning non-subscribed users (not during onboarding)
  // Flow: trading password gate → subscription (if needed) → home
  // Pro users: skip paywall entirely, show home directly (don't wait for portfolio)
  // Free users: wait for portfolio to load behind the paywall for seamless transition
  useEffect(() => {
    // Wait for trading password to be resolved first
    if (!tradingPasswordUnlocked) return;
    // Session 199 — WAIT for RevenueCat to actually resolve the user's
    // entitlement status before deciding whether to push the paywall.
    // Before this gate, a paid user logging in on a fresh device could
    // see the paywall for ~1 second while RC verified their Apple ID
    // subscription, because isSubscribed defaulted to false. AppContext
    // now flips subscriptionInitialCheckDone true after the first RC
    // check completes (with a 4s safety watchdog if RC fails), so we
    // NEVER show a false-positive paywall to a legitimate paid user.
    if (!subscriptionInitialCheckDone) return;
    // Already shown? Don't re-show
    if (returningPaywallShown.current) {
      if (!paywallReady) setPaywallReady(true);
      return;
    }
    returningPaywallShown.current = true;

    if (isSubscribed || hasSeenSubPrompt) {
      // Pro users OR users who already visited the paywall this session
      // (via app/index.tsx routing on cold start, or explicitly closed
      // /subscription earlier this session): skip the auto-push and show
      // Home directly. Prevents the previous bug where Free users saw the
      // paywall twice on cold start (once from index routing, once from
      // the tabs layout pushing it again after they closed it).
      setPaywallReady(true);
      return;
    }

    if (hasCompletedOnboarding && !isSubscribed) {
      // Free users: show subscription paywall — but first check cached sub status
      const checkAndShowPaywall = async () => {
        try {
          // Check local cached subscription status - if user was Pro last time, skip paywall
          const cachedSub = await AsyncStorage.getItem('ts_is_subscribed');
          if (cachedSub === 'true') {
            setPaywallReady(true);
            return;
          }
        } catch (error) {
          // Handle or log the error, but proceed to show paywall if caching failed
          console.error("Failed to read cached subscription status:", error);
        }
        // Also check if justUpgradedToPro is set — skip paywall
        // (Handles case where subscription was just purchased before reaching tabs)
        if (isSubscribed) {
          setPaywallReady(true);
          return;
        }
        // Push paywall first, then reveal tabs underneath immediately.
        // Subscription screen covers the tabs anyway, and the 120ms delay we
        // used to have here added noticeable perceived latency on cold start.
        router.push('/subscription');
        setPaywallReady(true);
      };
      checkAndShowPaywall();
    } else {
      // Users still in onboarding - show content right away
      setPaywallReady(true);
    }
  }, [hasCompletedOnboarding, isSubscribed, tradingPasswordUnlocked, hasSeenSubPrompt, router, setPaywallReady, subscriptionInitialCheckDone]);

  useEffect(() => {
    if (cancelledSub) {
      setShowCancelModal(true);
      setCancelledSub(false);
    }
  }, [cancelledSub, setCancelledSub]);

  const markVisited = useCallback((index: number) => {
    setVisitedTabs(prev => {
      if (prev.has(index)
          && (index === 0 || prev.has(index - 1))
          && (index === 4 || prev.has(index + 1))) {
        return prev;
      }
      const next = new Set(prev);
      next.add(index);
      if (index > 0) next.add(index - 1);
      if (index < 4) next.add(index + 1);
      return next;
    });
  }, []);

  const handleScroll = useCallback((e: any) => {
    if (programmaticScrollRef.current) return; // Ignore programmatic scrolls
    const offsetX = e.nativeEvent.contentOffset.x;
    const page = Math.round(offsetX / screenWidth);
    if (page !== currentPage && page >= 0 && page <= 4) {
      markVisited(page);
      setCurrentPage(page);
      Haptics.selectionAsync();
    }
  }, [currentPage, screenWidth, markVisited]);

  const handleScrollBegin = useCallback(() => {
    isScrollingRef.current = true;
  }, []);

  const handleScrollEnd = useCallback(() => {
    isScrollingRef.current = false;
  }, []);

  // Tab bounce animation
  const tabBounce = useSharedValue(1);
  const tabBounceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tabBounce.value }],
  }));

  // State for the walkthrough
  const [walkStep, setWalkStep] = useState<null | 0 | 1 | 2 | 3>(null);
  const [showWalkConfetti, setShowWalkConfetti] = useState(false);
  const [showWalkCard, setShowWalkCard] = useState(false);

  const runWalkStep = useCallback((step: 0 | 1 | 2 | 3) => {
    // Session 161 — pageMap follows the new Moves → Camera → Journal → Home
    // order. Each step number maps to the tab index that will be shown.
    const pageMap: Record<0 | 1 | 2 | 3, number> = { 0: 1, 1: 2, 2: 3, 3: 0 };
    const targetPage = pageMap[step];
    if (typeof targetPage !== 'number') return;
    programmaticScrollRef.current = true;
    markVisited(targetPage);
    setCurrentPage(targetPage);
    try {
      // Session 169 — smoother tab transition. Animated scroll gives the
      // user visible feedback that they're being moved to a new tab, so
      // the tutorial feels connected instead of jump-cut. The 220ms
      // animation is short enough to feel snappy but long enough to be
      // perceived as "the tab is moving here".
      scrollRef.current?.scrollTo({ x: targetPage * screenWidth, animated: true });
    } catch (error) { /* swallow */ console.error("Error scrolling during walkthrough:", error); }
    setTimeout(() => { programmaticScrollRef.current = false; }, 260);
    Haptics.selectionAsync().catch(() => {});
  }, [screenWidth, markVisited]);

  const handleTabPress = useCallback((index: number) => {
    // Session 168 — during the tab walkthrough, manual tab taps are
    // disabled so the auto-advancing tutorial can navigate uninterrupted.
    // Once the tutorial completes, tab taps behave normally.
    if (walkStep !== null) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    if (index === currentPage) return;
    Haptics.selectionAsync();
    programmaticScrollRef.current = true;
    // Mark the target (and neighbors) as visited BEFORE the scroll so the
    // destination tab content is already rendered when the ScrollView lands.
    markVisited(index);
    setCurrentPage(index);
    scrollRef.current?.scrollTo({ x: index * screenWidth, animated: false });
    // Reset flag after scroll completes
    setTimeout(() => { programmaticScrollRef.current = false; }, 100);
  }, [screenWidth, currentPage, markVisited, walkStep]);

  const tabBarHeight = Platform.select({ ios: insets.bottom + 60, android: insets.bottom + 60, default: 70 });

  // Session 161 — tab walkthrough reordered per user requirements.
  // Physical tab positions: Home(0), Moves(1), Upload/Camera(2),
  // Journal(3), Settings(4). Walkthrough now flows:
  //   Moves → Camera → Journal → Home  (user's requested order)
  //   Step 0 → Moves     (page 1)  — explain the AI Moves tab
  //   Step 1 → Camera    (page 2)  — explain chart scanning + Skip for Now
  //   Step 2 → Journal   (page 3)  — explain the trading journal
  //   Step 3 → Home      (page 0)  — final acknowledgement + confetti
  // Session 168 — Smoother auto-advancing tutorial flow. On every step
  // the sequence is:
  //   t=0             navigate to the target tab (via runWalkStep)
  //   t=SHOW_DELAY    walkthrough card fades in explaining the tab
  //   t=+CARD_VISIBLE card fades away, tab is fully visible on its own
  //   t=+FREE_LOOK    auto-advance to the next tab (repeats for 0->1->2)
  // The final step (walkStep=3, Home) shows the card INSTANTLY and keeps
  // it visible until the user taps Done — no auto-advance out of the
  // tutorial. Auto-advance is torn down cleanly if the user completes
  // the tutorial or the effect re-runs.
  useEffect(() => {
    if (walkStep === null) { setShowWalkCard(false); return; }
    const isLastStep = walkStep === 3;
    // Session 169 — smoother, snappier timing. The tab has already begun
    // its animated slide (see runWalkStep), so we wait 380ms for the
    // slide to settle before the card fades in. On the final step (Home)
    // we shorten the delay to 160ms so it feels immediate. Card visible
    // 3400ms, then 1800ms of free-look before auto-advance. Overall the
    // tutorial completes in ~17s instead of ~19s and feels more premium.
    const SHOW_DELAY = isLastStep ? 160 : 380;
    const CARD_VISIBLE = 3400;
    const FREE_LOOK = 1800;

    setShowWalkCard(false);
    const showTimer = setTimeout(() => setShowWalkCard(true), SHOW_DELAY);

    if (isLastStep) {
      // Home step: card stays visible until user taps Done.
      return () => clearTimeout(showTimer);
    }

    const hideTimer = setTimeout(
      () => setShowWalkCard(false),
      SHOW_DELAY + CARD_VISIBLE,
    );
    const advanceTimer = setTimeout(() => {
      const nextStep = (walkStep + 1) as 0 | 1 | 2 | 3;
      setWalkStep(nextStep);
      runWalkStep(nextStep);
    }, SHOW_DELAY + CARD_VISIBLE + FREE_LOOK);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(advanceTimer);
    };
  }, [walkStep, runWalkStep]); // Added runWalkStep to deps

  // Session 161 — set `ts_tutorial_active` flag whenever the walkthrough
  // is running so downstream screens (Stock Details, etc.) can disable
  // interactions that would otherwise fire off-topic side effects.
  useEffect(() => {
    if (walkStep !== null) {
      AsyncStorage.setItem('ts_tutorial_active', 'true').catch(() => {});
    } else {
      AsyncStorage.setItem('ts_tutorial_active', 'false').catch(() => {});
    }
  }, [walkStep]);

  useEffect(() => {
    const unsub = subscribeTabWalkthrough(() => {
      if (consumeTabWalkthroughStart()) {
        setWalkStep(0);
        runWalkStep(0);
      }
    });
    // Also handle the case where startTabWalkthrough() was invoked
    // BEFORE this listener was attached (rare, but safe).
    if (consumeTabWalkthroughStart()) {
      setWalkStep(0);
      runWalkStep(0);
    }
    return unsub;
  }, [runWalkStep]);

  // Session 186 — Deep-link to a specific tab when a notification or other
  // caller has written `ts_pending_tab` to AsyncStorage (currently used by
  // AI Moves reminder notifications, which deep-link to the AI Moves tab).
  // Reads once on mount + whenever the paywall gate opens the tabs. The
  // flag is consumed atomically — removed BEFORE navigating so an
  // interrupted mount cannot cause repeated redirects.
  useEffect(() => {
    if (!paywallReady) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('ts_pending_tab');
        if (cancelled || !raw) return;
        await AsyncStorage.removeItem('ts_pending_tab').catch(() => {});
        const idx =
          raw === 'home' ? 0 :
          raw === 'moves' ? 1 :
          raw === 'upload' ? 2 :
          raw === 'journal' ? 3 :
          raw === 'settings' ? 4 :
          -1;
        if (idx < 0) return;
        // Only switch when we are not currently inside the tab walkthrough
        // — the walkthrough manages its own tab position.
        if (walkStep !== null) return;
        programmaticScrollRef.current = true;
        markVisited(idx);
        setCurrentPage(idx);
        try { scrollRef.current?.scrollTo({ x: idx * screenWidth, animated: false }); } catch { /* swallow */ }
        setTimeout(() => { programmaticScrollRef.current = false; }, 100);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [paywallReady, screenWidth, markVisited, walkStep]);

  const advanceWalk = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    if (walkStep === null) return;
    if (walkStep < 3) {
      const next = (walkStep + 1) as 0 | 1 | 2 | 3;
      setWalkStep(next);
      runWalkStep(next);
      return;
    }
    // walkStep === 3 — final Home step: finish + confetti + mark tutorial
    // as complete so the onboarding flow is officially done.
    setWalkStep(null);
    setHasCompletedTutorial(true);
    setShowWalkConfetti(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Session 167 — reduced confetti window from 5.2s to 3.2s to minimize
    // JS-thread work post-tutorial (matches the shorter Confetti duration).
    setTimeout(() => setShowWalkConfetti(false), 3200);
  }, [walkStep, runWalkStep, setHasCompletedTutorial]);

  // Session 168 — auto-advancing tutorial copy. Steps 0-2 auto-dismiss
  // and auto-advance to the next tab, so no CTA is needed. Step 3 (Home)
  // shows the final card with a Done button that closes the tutorial and
  // fires confetti.
  const WALK_CONFIG: Record<0 | 1 | 2 | 3, { icon: string; title: string; body: string }> = {
    0: {
      icon: 'trending-up',
      title: 'AI Moves',
      body: 'Live BUY / SHORT setups from a dual-model AI scan — 85% confidence minimum. Tap any Move to see the reasoning, or Put in Trade to send it straight to your broker.',
    },
    1: {
      icon: 'camera-outline',
      title: 'Chart Scanner',
      body: 'Point your camera at any stock chart (TV, laptop, or another phone) and Sight AI detects the pattern, key levels, and suggests entry / TP / SL. Grant camera access when you\u2019re ready to try it.',
    },
    2: {
      icon: 'menu-book',
      title: 'Journal',
      body: 'Every closed trade lands here automatically — TP hits, SL hits, and manual sells. Track your P/L, win rate, and AI signal performance day by day.',
    },
    3: {
      icon: 'home',
      title: 'You\u2019re all set!',
      body: 'You\u2019ve seen every tab. Tap Done to start using Sight.',
    },
  };

  return (
    <TradingPasswordGate
      userEmail={userEmail}
      userId={userId}
      isUnlocked={tradingPasswordUnlocked}
      onUnlock={() => setTradingPasswordUnlocked(true)}
    >
    {!paywallReady ? null : (
    <View style={{ flex: 1, backgroundColor: ROOT_BG }}>

      {/* Status bar: white text/icons on dark backgrounds, black on light */}
      <StatusBar style={(() => {
        const bg = t.background;
        // Check if background is light (white or near-white)
        if (bg === '#FFFFFF' || bg === '#F8FAFC' || bg === '#F1F5F9' || bg === '#F9FAFB') return 'dark';
        return 'light';
      })()} />
      {/* Horizontal ScrollView with paging - shows adjacent tab content during swipe */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBegin}
        onMomentumScrollEnd={handleScrollEnd}
        scrollEventThrottle={16}
        bounces={false}
        decelerationRate="fast"
        // Session 135 — horizontal swipe navigation between tabs is
        // disabled. Users must tap the bottom tab bar to change tabs;
        // vertical scrolling inside each tab is unaffected.
        scrollEnabled={false}
        style={{ flex: 1 }}
      >
        <View style={{ width: screenWidth, flex: 1 }}>
          {visitedTabs.has(0) ? <ErrorBoundary><HomeScreen /></ErrorBoundary> : <View style={{ flex: 1, backgroundColor: t.background }} />}
        </View>
        <View style={{ width: screenWidth, flex: 1 }}>
          {visitedTabs.has(1) ? <ErrorBoundary><MovesScreen /></ErrorBoundary> : <View style={{ flex: 1, backgroundColor: t.background }} />}
        </View>
        <View style={{ width: screenWidth, flex: 1 }}>
          {visitedTabs.has(2) ? <ErrorBoundary><UploadScreen /></ErrorBoundary> : <View style={{ flex: 1, backgroundColor: t.background }} />}
        </View>
        <View style={{ width: screenWidth, flex: 1 }}>
          {visitedTabs.has(3) ? <ErrorBoundary><JournalScreen /></ErrorBoundary> : <View style={{ flex: 1, backgroundColor: t.background }} />}
        </View>
        <View style={{ width: screenWidth, flex: 1 }}>
          {visitedTabs.has(4) ? <ErrorBoundary><SettingsScreen /></ErrorBoundary> : <View style={{ flex: 1, backgroundColor: t.background }} />}
        </View>
      </ScrollView>

      {/* Custom Tab Bar */}
      <View style={[styles.tabBar, {
        height: tabBarHeight,
        paddingBottom: Platform.select({ ios: insets.bottom + 8, android: insets.bottom + 8, default: 8 }),
        backgroundColor: t.backgroundSecondary,
        borderTopColor: t.border,
      }]}>
        {TAB_CONFIG.map((tab, index) => {
          const isActive = currentPage === index;
          if (tab.isCenter) {
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.7}
                style={styles.tabItem}
                onPress={() => handleTabPress(index)}
              >
                <View style={[styles.centerButton, { backgroundColor: t.primary }, isActive && { backgroundColor: t.primaryDark, transform: [{ scale: 1.05 }] }]}>
                  <MaterialIcons name={tab.icon as any} size={26} color="#FFF" />
                </View>
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity
              key={tab.key}
              activeOpacity={0.7}
              style={styles.tabItem}
              onPress={() => handleTabPress(index)}
            >
              <MaterialIcons name={tab.icon as any} size={24} color={isActive ? t.primary : t.textTertiary} />
              <Text style={[styles.tabLabel, { color: isActive ? t.primary : t.textTertiary }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Subscription cancelled modal */}
      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={styles.cancelOverlay}>
          <Animated.View entering={ZoomIn.duration(400)} style={[styles.cancelCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            <Animated.View entering={FadeIn.duration(600).delay(200)} style={{ alignItems: 'center' }}>
              <View style={[styles.cancelIconCircle, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
                <MaterialIcons name="sentiment-dissatisfied" size={44} color="#EF4444" />
              </View>
              <Text style={[styles.cancelTitle, { color: t.textPrimary }]}>We are sad to see you go</Text>
              <Text style={[styles.cancelSubtitle, { color: t.textSecondary }]}>
                Your Pro subscription has been cancelled. You will no longer have access to premium features like AI signals, chart analysis, and trade targets.
              </Text>
              <Text style={[styles.cancelRejoin, { color: t.textTertiary }]}>
                You can always rejoin Sight Pro anytime from the Settings tab.
              </Text>
              <TouchableOpacity activeOpacity={0.7}
                style={[styles.cancelBtn, { backgroundColor: t.primary }]}
                onPress={() => setShowCancelModal(false)}>
                <Text style={styles.cancelBtnText}>Got It</Text>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>

      {/* Session 145/169 — Tab walkthrough overlay. Rendered on top of the
          currently-visible tab. Wrapped in Animated.View with FadeIn /
          FadeOut so the card doesn't hard-cut in and out anymore; the
          card itself uses SlideInDown for a subtle rise from the bottom
          of the screen, matching the intended premium feel. */}
      {walkStep !== null && showWalkCard ? (
        <Animated.View
          pointerEvents="auto"
          style={styles.walkOverlay}
          entering={FadeIn.duration(260).easing(Easing.out(Easing.cubic))}
          exiting={FadeOut.duration(200)}
        >
          <TouchableOpacity activeOpacity={1} style={StyleSheet.absoluteFill} onPress={() => {}} />
          <Animated.View
            entering={SlideInDown.duration(360).springify().damping(16).mass(0.9)}
            exiting={FadeOut.duration(180)}
            style={[styles.walkCard, { backgroundColor: t.surface, borderColor: t.border }]}
          >
            <View style={styles.walkHeaderRow}>
              <View style={[styles.walkIconWrap, { backgroundColor: t.primary + '22', borderColor: t.primary + '55' }]}>
                <MaterialCommunityIcons name={WALK_CONFIG[walkStep].icon as any} size={18} color={t.primary} />
              </View>
              <View style={styles.walkProgressRow}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.walkDot,
                      {
                        backgroundColor: i === walkStep ? t.primary : i < walkStep ? t.primary + '90' : t.primary + '30',
                        width: i === walkStep ? 16 : 5,
                      },
                    ]}
                  />
                ))}
              </View>
            </View>
            <Text style={[styles.walkTitle, { color: t.textPrimary }]}>{WALK_CONFIG[walkStep].title}</Text>
            <Text style={[styles.walkBody, { color: t.textSecondary }]}>{WALK_CONFIG[walkStep].body}</Text>
            {walkStep === 3 ? (
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.walkCta, { backgroundColor: t.primary }]}
                onPress={advanceWalk}
              >
                <Text style={styles.walkCtaText}>Done</Text>
                <MaterialIcons name="check" size={14} color="#FFF" />
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        </Animated.View>
      ) : null}

      {/* Session 145 — Confetti burst rendered when the walkthrough returns
          the user to Home. Cascades from top to bottom, then unmounts. */}
      {showWalkConfetti ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Session 167 — reduced from 90 -> 40 particles to eliminate
              the noticeable JS-thread lag users reported after tutorial
              completion. */}
          <Confetti count={40} />
        </View>
      ) : null}
    </View>
    )}
    </TradingPasswordGate>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingHorizontal: 8,
    borderTopWidth: 1,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  centerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    ...Platform.select({
      ios: { shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8 },
      android: { elevation: 6 },
      default: {},
    }),
  },
  cancelOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  cancelCard: {
    borderRadius: 20, padding: 28, width: '100%', maxWidth: 380,
    borderWidth: 1, alignItems: 'center',
  },
  cancelIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  cancelTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  cancelSubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  cancelRejoin: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 24, fontStyle: 'italic' },
  cancelBtn: {
    width: '100%', height: 50, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  walkOverlay: {
    ...StyleSheet.absoluteFillObject,
    // Session 149 — slightly stronger backdrop while the walkthrough is
    // running so the underlying tab content is dimmed enough that any
    // accidental focus effects can't grab the user's attention. Still
    // light enough that the tab visuals are visible through it.
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 20,
    paddingBottom: 110,
    zIndex: 9999,
  },
  walkCard: {
    // Session 146 — compact card sized like the add-stock tooltip so
    // most of the tab remains visible while the tutorial explains it.
    width: '100%',
    maxWidth: 320,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: 'flex-start',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.32, shadowRadius: 12 },
      android: { elevation: 10 },
      default: {},
    }),
  },
  walkHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    marginBottom: 10,
  },
  walkIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walkTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2, marginBottom: 3 },
  walkBody: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  walkProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  walkDot: { height: 5, borderRadius: 3 },
  walkCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    alignSelf: 'stretch', height: 36, borderRadius: 8, gap: 6,
  },
  walkCtaText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  // Session 161 — Skip for Now button on the Camera step.
  walkSkip: {
    alignSelf: 'stretch',
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  walkSkipText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
});
