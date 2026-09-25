import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions,
  Animated as RNAnimated, Platform, Keyboard,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export type TutorialStep = 'ADD_BUTTON' | 'SEARCH_BAR' | 'PICK_STOCK' | 'CHOICE_OVERLAY' | 'FILL_FORM' | 'HOME_WATCHLIST' | 'JOURNAL_TAB' | 'UPLOAD_TAB' | 'MOVES_TAB' | 'HOME_RETURN' | 'DONE';

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TooltipConfig {
  text: string;
  subtext?: string;
  position: 'below' | 'above';
  icon: string;
  stepNum: number;
}

const STEP_CONFIGS: Record<Exclude<TutorialStep, 'DONE'>, TooltipConfig> = {
  ADD_BUTTON: {
    text: 'Add your first stock',
    subtext: 'Tap here to start building your watchlist',
    position: 'below',
    icon: 'touch-app',
    stepNum: 1,
  },
  SEARCH_BAR: {
    text: 'Search any stock',
    subtext: 'Try AAPL, Tesla, or your favorite ticker',
    position: 'below',
    icon: 'search',
    stepNum: 2,
  },
  PICK_STOCK: {
    text: 'Pick a stock to add',
    subtext: 'Tap any result to open the trade options',
    position: 'below',
    icon: 'playlist-add',
    stepNum: 3,
  },
  CHOICE_OVERLAY: {
    text: 'Trade or Add to Watchlist',
    subtext: 'Trade places a real order via your broker. Add to Watchlist just tracks the stock — no order is placed.',
    position: 'above',
    icon: 'flash-on',
    stepNum: 4,
  },
  FILL_FORM: {
    text: 'Almost done',
    subtext: 'Add shares and price to finish setup',
    position: 'above',
    icon: 'check-circle',
    stepNum: 4,
  },
  HOME_WATCHLIST: {
    // Session 176 — shown on Home after the user completes the
    // add-stock flow. Highlights the watchlist / stock-list area so the
    // user sees where their stocks will actually appear before Sight
    // transitions into the tab walkthrough.
    text: 'Your stocks will land here',
    subtext: 'Any stock you add is tracked on Home — live prices, P/L, and quick actions.',
    position: 'above',
    icon: 'home',
    stepNum: 5,
  },
  JOURNAL_TAB: {
    text: 'Journal',
    subtext: 'Every closed trade lands here automatically — win, loss, P/L, entry, exit, notes. Your full trading history in one place.',
    position: 'above',
    icon: 'menu-book',
    stepNum: 6,
  },
  UPLOAD_TAB: {
    text: 'Camera',
    subtext: 'Point your phone at any chart to run instant AI pattern detection and get an actionable read.',
    position: 'above',
    icon: 'add-a-photo',
    stepNum: 7,
  },
  MOVES_TAB: {
    text: 'AI Moves',
    subtext: 'High-confidence BUY / SHORT setups from Sight’s dual-model S&P 500 scan, refreshed every few minutes during market hours.',
    position: 'above',
    icon: 'auto-awesome',
    stepNum: 8,
  },
  HOME_RETURN: {
    text: 'You’re all set!',
    subtext: 'Back to Home. Tap Done to start using Sight.',
    position: 'below',
    icon: 'check-circle',
    stepNum: 9,
  },
};

const TOTAL_STEPS = 9;
const OVERLAY_COLOR = 'rgba(0,0,0,0.55)';
const TABLET_BREAKPOINT = 600;

interface Props {
  step: Exclude<TutorialStep, 'DONE'>;
  spotlightRect: SpotlightRect | null;
  onSkip: () => void;
  onNext?: () => void;
  showNext?: boolean;
  nextLabel?: string;
  accentColor?: string;
  textColor?: string;
  surfaceColor?: string;
}

export function SpotlightOverlay({ step, spotlightRect, onSkip, onNext, showNext, nextLabel, accentColor = '#3B82F6', textColor = '#FFFFFF', surfaceColor = '#1E293B' }: Props) {
  const fadeAnim = useRef(new RNAnimated.Value(0)).current;
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;
  const tooltipAnim = useRef(new RNAnimated.Value(0)).current;
  const dotAnim = useRef(new RNAnimated.Value(0)).current;
  const [screenDims, setScreenDims] = useState(() => Dimensions.get('window'));
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const isTablet = screenDims.width >= TABLET_BREAKPOINT;

  // Listen for dimension changes
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreenDims(window));
    return () => sub?.remove();
  }, []);

  // Track keyboard state for FILL_FORM step — keyboard pushes form up,
  // so we need to know available screen height to position tooltip correctly
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Premium haptic feedback on each tutorial step transition
  useEffect(() => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [step]);

  useEffect(() => {
    fadeAnim.setValue(0);
    tooltipAnim.setValue(0);
    dotAnim.setValue(0);
    RNAnimated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }).start(() => {
      // Premium spring entrance for tooltip card
      RNAnimated.spring(tooltipAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 7,
        tension: 65,
      }).start();
      // Subtle dot expansion animation
      RNAnimated.timing(dotAnim, { toValue: 1, duration: 420, useNativeDriver: false }).start();
    });
  }, [step, spotlightRect?.y, spotlightRect?.height]);

  // Pulse animation for the spotlight ring
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  if (!spotlightRect) return null;

  // Effective visible area accounting for keyboard
  const visibleHeight = keyboardHeight > 0 ? screenDims.height - keyboardHeight : screenDims.height;

  // Responsive sizing based on screen dimensions — handles phones, tablets, small devices
  const isSmallScreen = screenDims.height < 700 && !isTablet;
  const isVerySmall = screenDims.height < 600 && !isTablet;

  const config = STEP_CONFIGS[step];

  // Tight-fit spotlight — the highlight should hug the actual rendered bounds of
  // the target element, NEVER extend visibly past it. Use a fixed minimal padding
  // (1–2px) so there is just enough breathing room for the rounded mask without
  // making the spotlight feel oversized. The previous implementation scaled padding
  // with element size which made larger targets look hugely over-padded.
  const spotPadding = isSmallScreen ? 1 : 2;

  // Corner radius — derived from the actual element bounds so the cutout matches
  // the visual shape of the target (round buttons stay round, pill-shaped chips
  // stay pill-shaped). Capped to avoid over-rounding very large rectangles.
  const minDimension = Math.min(spotlightRect.width, spotlightRect.height);
  const spotRadius = Math.max(4, Math.min(Math.round(minDimension * 0.5), isTablet ? 28 : 22));

  // Spotlight rect uses the actual measured element bounds + minimal padding.
  const spot = {
    x: Math.max(0, spotlightRect.x - spotPadding),
    y: Math.max(0, spotlightRect.y - spotPadding),
    w: Math.min(screenDims.width, spotlightRect.width + spotPadding * 2),
    h: spotlightRect.height + spotPadding * 2,
  };

  // Session 148 — tooltip is now compact and always docks near the bottom
  // of the screen so the highlighted UI stays fully visible. Only the
  // spotlight cutout hints at where the target is; the tooltip never
  // overlaps it.
  const tooltipHPad = isTablet ? 32 : 16;
  const tooltipWidth = Math.min(screenDims.width - tooltipHPad * 2, isTablet ? 360 : 300);
  let tooltipLeft = screenDims.width / 2 - tooltipWidth / 2;
  tooltipLeft = Math.max(tooltipHPad, Math.min(tooltipLeft, screenDims.width - tooltipWidth - tooltipHPad));

  // Compact tooltip content sizing.
  const tooltipPadding = 12;
  const titleFontSize = isTablet ? 15 : 13;
  const subFontSize = isTablet ? 12 : 11;
  const iconSize = 28;
  // Session 200 — CONTENT-AWARE HEIGHT ESTIMATE.
  //
  // Previously fixed at 96px, which was catastrophically wrong for any
  // step with a subtitle + Continue button (e.g. HOME_WATCHLIST renders
  // ~200px). The undersized estimate placed the top of the card at
  // `visibleHeight - 96 - 110` so the ACTUAL bottom of the card (a
  // further ~104px below) overflowed straight into the tab bar,
  // producing the "shifted down / Continue button touching the tab bar"
  // visual glitch on Home. New behavior derives the estimate from the
  // actual content the step is about to render:
  //   • base (header + title + padding)      ≈ 90
  //   • +60 when a subtitle is present (up to 3 wrapped lines)
  //   • +50 when a Continue / Next button is rendered on this step
  // This keeps every card fully visible above the tab bar on iPhone SE
  // through iPad without touching the underlying page layout — the
  // overlay stays absolutely positioned so nothing on the Home tab is
  // pushed down.
  const hasSubtextEst = !!config.subtext;
  const hasNextEst = !!(showNext && onNext);
  const tooltipEstHeight = 90 + (hasSubtextEst ? 60 : 0) + (hasNextEst ? 50 : 0);

  // Prefer docking below the spotlight when there's room, else above,
  // else at the very bottom of the visible area. Never on top of the
  // spotlight itself.
  const gapFromSpot = 12;
  const spaceBelow = visibleHeight - (spot.y + spot.h + gapFromSpot);
  const spaceAbove = spot.y - gapFromSpot;

  let actualPosition: 'below' | 'above' = 'below';
  if (spaceBelow < tooltipEstHeight + 24 && spaceAbove >= tooltipEstHeight + 24) {
    actualPosition = 'above';
  }

  // Session 195 — HOME_WATCHLIST screen anchor.
  //
  // Root-cause: previously the HOME_WATCHLIST tooltip was positioned
  // relative to the measured spotlight rect. When the custom Enable
  // Notifications prompt or a Market Close banner mounted on Home, the
  // watchlist target moved down, and the tooltip moved with it. On tall
  // iPhones this pushed the tooltip below the tab bar.
  //
  // Fix: for the HOME_WATCHLIST step ONLY, the tooltip has a FIXED
  // screen anchor — a stable offset from the bottom of the visible
  // viewport. Session 203 — HOME_WATCHLIST is now rendered inside a
  // Modal that FULLY covers the tab bar, so the tooltip should visually
  // occupy the bottom portion of the screen INCLUDING the area where
  // the tab bar sits underneath the modal. Bottom offset reduced from
  // 110pt (which sat the card ABOVE the tab bar) to 40pt (which sits
  // the card OVER the tab bar area, since the Modal covers it).
  const isFixedBottomAnchor = step === 'HOME_WATCHLIST';
  const FIXED_BOTTOM_OFFSET = 40; // Tooltip sits over the tab-bar area (Modal covers it)

  let tooltipTop: number;
  if (isFixedBottomAnchor) {
    tooltipTop = Math.max(16, visibleHeight - tooltipEstHeight - FIXED_BOTTOM_OFFSET);
  } else if (actualPosition === 'below') {
    // Prefer bottom of screen when the spotlight is near the top
    // (so the tooltip never crowds the highlighted feature).
    tooltipTop = Math.min(spot.y + spot.h + gapFromSpot, visibleHeight - tooltipEstHeight - 16);
  } else {
    tooltipTop = Math.max(16, spot.y - tooltipEstHeight - gapFromSpot);
  }

  // Arrow positioning
  const arrowLeft = Math.max(tooltipLeft + 12, Math.min(spot.x + spot.w / 2 - 6, tooltipLeft + tooltipWidth - 24));
  const arrowSize = isSmallScreen ? 8 : 10;
  const arrowTop = actualPosition === 'below' ? (tooltipTop - arrowSize + 1) : (tooltipTop + tooltipEstHeight - 8);
  // Hide the pointer arrow when the tooltip is screen-anchored — it
  // would otherwise point at empty space instead of the spotlight.
  const showArrow = !isFixedBottomAnchor;

  // Animated dot width for current step
  const activeDotWidth = dotAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 22] });

  return (
    <RNAnimated.View style={[StyleSheet.absoluteFill, { opacity: fadeAnim, zIndex: 9999 }]} pointerEvents="box-none">
      {/* 4-rect overlay with hole */}
      <View style={[styles.overlayRect, { top: 0, left: 0, right: 0, height: Math.max(0, spot.y) }]} pointerEvents="box-none" />
      <View style={[styles.overlayRect, { top: spot.y, left: 0, width: Math.max(0, spot.x), height: spot.h }]} pointerEvents="box-none" />
      <View style={[styles.overlayRect, { top: spot.y, left: spot.x + spot.w, right: 0, height: spot.h }]} pointerEvents="box-none" />
      <View style={[styles.overlayRect, { top: spot.y + spot.h, left: 0, right: 0, bottom: 0 }]} pointerEvents="box-none" />

      {/* Session 140 — per-request: no circle/ring around target. Just the
          dim overlay with a clean rectangular cutout that lets the actual
          element show through unmodified. No pulse, no glow, no border. */}

      {/* Arrow */}
      {showArrow ? (
        <RNAnimated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: arrowTop,
            left: arrowLeft,
            opacity: tooltipAnim,
          }}
        >
          <View style={[
            styles.arrow,
            actualPosition === 'below'
              ? { borderBottomColor: surfaceColor, borderBottomWidth: arrowSize, borderLeftWidth: arrowSize, borderRightWidth: arrowSize, borderLeftColor: 'transparent', borderRightColor: 'transparent' }
              : { borderTopColor: surfaceColor, borderTopWidth: arrowSize, borderLeftWidth: arrowSize, borderRightWidth: arrowSize, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
          ]} />
        </RNAnimated.View>
      ) : null}

      {/* Premium tooltip card with accent strip and animated progress dots */}
      <RNAnimated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipWidth,
          opacity: tooltipAnim,
          transform: [
            { translateY: tooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [actualPosition === 'below' ? 14 : -14, 0] }) },
            { scale: tooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
        }}
      >
        <View style={[styles.tooltipCard, { backgroundColor: surfaceColor, padding: tooltipPadding, paddingTop: tooltipPadding + 4 }]}>
          {/* Premium accent strip at top of card */}
          <View style={[styles.accentStrip, { backgroundColor: accentColor }]} />

          {/* Header — icon + animated progress dots */}
          <View style={styles.tooltipHeader}>
            <View style={[styles.tooltipIconCircle, {
              backgroundColor: accentColor + '22',
              width: iconSize,
              height: iconSize,
              borderRadius: iconSize / 2,
              borderWidth: 1.5,
              borderColor: accentColor + '40',
            }]}>
              <MaterialIcons name={config.icon as any} size={isSmallScreen ? 16 : 22} color={accentColor} />
            </View>

            {/* Animated progress dots */}
            <View style={styles.progressDots}>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const isActive = i + 1 === config.stepNum;
                const isCompleted = i + 1 < config.stepNum;
                const dotColor = isActive ? accentColor : (isCompleted ? accentColor + '90' : accentColor + '30');
                return (
                  <RNAnimated.View
                    key={i}
                    style={[
                      styles.progressDot,
                      {
                        backgroundColor: dotColor,
                        width: isActive ? activeDotWidth : 6,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>

          {/* Title */}
          <Text style={[styles.tooltipTitle, { color: textColor, fontSize: titleFontSize, lineHeight: titleFontSize + 5, marginTop: isSmallScreen ? 10 : 14 }]}>
            {config.text}
          </Text>

          {/* Subtitle */}
          {config.subtext ? (
            <Text style={[styles.tooltipSub, { color: textColor + 'B0', fontSize: subFontSize, lineHeight: subFontSize + 5, marginTop: 3 }]}>
              {config.subtext}
            </Text>
          ) : null}

          {/* Session 167 — Skip Tutorial button REMOVED per user request.
              The tutorial is mandatory now — users cannot skip it.
              Only the optional Next button (used on multi-step flows)
              remains, and lives on the right side of the footer. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: isSmallScreen ? 10 : 14 }}>
            {showNext && onNext ? (
              <TouchableOpacity
                activeOpacity={0.85}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                onPress={() => { Haptics.selectionAsync(); onNext(); }}
                style={{ backgroundColor: accentColor, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: isSmallScreen ? 12 : 13, fontWeight: '700', letterSpacing: 0.2 }}>
                  {nextLabel ?? 'Next'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </RNAnimated.View>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  overlayRect: {
    position: 'absolute',
    backgroundColor: OVERLAY_COLOR,
  },
  arrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
  },
  tooltipCard: {
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.42, shadowRadius: 18 },
      android: { elevation: 14 },
      default: {},
    }),
  },
  accentStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
  },
  tooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tooltipIconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  progressDot: {
    height: 6,
    borderRadius: 3,
  },
  tooltipTitle: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  tooltipSub: {
    fontWeight: '400',
  },
  skipBtn: {
    alignSelf: 'flex-start',
  },
  skipText: {
    fontWeight: '600',
  },
});
