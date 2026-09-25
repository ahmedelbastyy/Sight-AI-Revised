
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Pressable, Platform, ScrollView, Dimensions,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOutUp,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Svg, {
  Path,
  Defs,
  LinearGradient as SvgGradient,
  Stop,
  Circle,
  Line,
  Text as SvgText,
} from 'react-native-svg';

const ONBOARDING_KEY = 'onboarding_complete';
const SECURE_ONBOARDING_KEY = 'ts_onboarding_done_device';

async function markOnboardingComplete() {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
  } catch (e) {
    // Optionally log the error: console.error("Error setting AsyncStorage item:", e);
  }
  if (Platform.OS !== 'web') {
    try {
      await SecureStore.setItemAsync(SECURE_ONBOARDING_KEY, 'true');
    } catch (e) {
      // Optionally log the error: console.error("Error setting SecureStore item:", e);
    }
  }
}

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(ONBOARDING_KEY);
    if (val === 'true') return true;
  } catch (e) {
    // Optionally log the error: console.error("Error getting AsyncStorage item:", e);
  }
  if (Platform.OS !== 'web') {
    try {
      const secure = await SecureStore.getItemAsync(SECURE_ONBOARDING_KEY);
      if (secure === 'true') {
        try { await AsyncStorage.setItem(ONBOARDING_KEY, 'true'); } catch (e) { /* silent */ }
        return true;
      }
    } catch (e) {
      // Optionally log the error: console.error("Error getting SecureStore item:", e);
    }
  }
  return false;
}

// =============================================================================
// Session 171 — KEYED ONBOARDING ANSWER MODEL
// =============================================================================
// Answers are stored as { [key]: number } instead of a positional array so
// downstream consumers (snapshot generation + potential projection) read
// them by name and cannot be silently broken by future reordering of
// QUESTIONS. Adding/removing questions is now a one-line change.
//
// For option-based questions, the numeric value is the option index.
// For slider questions, the numeric value is the mapped domain value
// (e.g. age 25 for the age slider, index 0..4 for the enjoyment slider).
// =============================================================================
type AnswerKey =
  | 'stockDiscovery'
  | 'missedMoves'
  | 'tradingEnjoyment'
  | 'analysisTime'
  | 'aiInterest'
  | 'age'
  | 'savings';

interface Question {
  key: AnswerKey;
  heading: string;
  emoji: string;
  options?: string[];
  isSlider?: boolean;
  sliderLeftLabel?: string;
  sliderRightLabel?: string;
  // Slider domain range. Defaults to 0..4 (backwards-compat with the
  // legacy trading-enjoyment slider). Age uses 16..80.
  sliderMin?: number;
  sliderMax?: number;
  // Initial slider position (0..1) inside the track.
  sliderInitial?: number;
  // Optional live display of the currently-selected slider value (e.g.
  // "25 years old" for the age question).
  sliderFormatter?: (mappedValue: number) => string;
}

// Session 171 — Age (Q6) and savings (Q7) are APPENDED after the original
// five so the existing snapshot generation logic that reads
// answers.stockDiscovery / answers.missedMoves is unaffected. Because
// answers are keyed, reordering in the future is also safe.
const QUESTIONS: Question[] = [
  {
    key: 'stockDiscovery',
    heading: 'How do you currently find\nstocks to trade?',
    emoji: '📱',
    options: ['I scroll social media', 'I watch YouTube', 'I use screeners', 'I mostly guess', 'I already have a system'],
  },
  {
    key: 'missedMoves',
    heading: 'How often do you miss a stock\nmove because you found it too late?',
    emoji: '⏰',
    options: ['Almost every day', 'A few times a week', 'Occasionally', 'Rarely'],
  },
  {
    key: 'tradingEnjoyment',
    heading: 'How much do you\nenjoy trading?',
    emoji: '📈',
    isSlider: true,
    sliderLeftLabel: 'Not at all',
    sliderRightLabel: 'I love it',
    sliderMin: 0,
    sliderMax: 4,
    sliderInitial: 0.5,
  },
  {
    key: 'analysisTime',
    heading: 'How much time do you spend\nanalyzing stocks each day?',
    emoji: '🕒',
    options: ['Less than 15 minutes', '15–30 minutes', '30–60 minutes', 'Over an hour'],
  },
  {
    key: 'aiInterest',
    heading: 'If AI could instantly analyze\nthousands of stocks, would you use it?',
    emoji: '🤖',
    options: ['Absolutely', 'Probably', 'Maybe', 'Not really'],
  },
  // NEW — age (slider 16..80 → integer years)
  {
    key: 'age',
    heading: 'How old are you?',
    emoji: '🎂',
    isSlider: true,
    // Session 193 - Minimum age raised from 16 to 18 for legal compliance.
    // Sight is a financial / trading product and cannot be onboarded by
    // under-18 users. The slider physically cannot select below 18, and
    // any previously stored answer below 18 is clamped up to 18 at
    // consumption time (see PotentialProjectionScreen's startingAge below).
    sliderLeftLabel: '18',
    sliderRightLabel: '80',
    sliderMin: 18,
    sliderMax: 80,
    sliderInitial: (25 - 18) / (80 - 18), // starts around age 25
    sliderFormatter: (v) => `${Math.round(v)} years old`,
  },
  // NEW — savings bucket. Maps to a representative starting value via
  // SAVINGS_STARTING_VALUES for the projection screen (see below).
  {
    key: 'savings',
    heading: 'How much money do you\ncurrently have saved?',
    emoji: '💰',
    options: [
      'Under $1,000',
      '$1,000 – $9,999',
      '$10,000 – $24,999',
      '$25,000 – $49,999',
      '$50,000 – $99,999',
      '$100,000+',
    ],
  },
];

// =============================================================================
// SAVINGS BUCKET → REPRESENTATIVE STARTING VALUE (Session 171)
// =============================================================================
// This is a deliberate approximation used only to seed the illustrative
// projection graph. We never pretend the user literally entered these
// numbers — the potential screen shows both the bucket copy ("about $X")
// AND the derived starting value separately so the mapping stays honest
// and tunable.
// =============================================================================
const SAVINGS_STARTING_VALUES: Record<number, number> = {
  0: 500,     // Under $1,000
  1: 5000,    // $1,000 – $9,999
  2: 17500,   // $10,000 – $24,999
  3: 37500,   // $25,000 – $49,999
  4: 75000,   // $50,000 – $99,999
  5: 100000,  // $100,000+  (conservative display floor)
};

const SAVINGS_DISPLAY_APPROX: Record<number, string> = {
  0: 'under $1,000',
  1: 'about $5,000',
  2: 'about $17,500',
  3: 'about $37,500',
  4: 'about $75,000',
  5: '$100,000+',
};

function mapSavingsToStartingValue(bucketIndex: number | undefined): number {
  if (bucketIndex == null || !(bucketIndex in SAVINGS_STARTING_VALUES)) return 5000;
  return SAVINGS_STARTING_VALUES[bucketIndex];
}

// Session 171 — Hypothetical compound growth rate used purely for the
// illustrative projection. This is NOT a Sight-guaranteed return and the
// UI states so prominently on the potential screen.
const GROWTH_RATE = 0.1543;

function projectFutureValue(startingValue: number, years: number): number {
  if (years <= 0) return startingValue;
  return startingValue * Math.pow(1 + GROWTH_RATE, years);
}

function formatCurrencyShort(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `$${Math.round(v / 1000)}K`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function formatCurrencyLong(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)} billion`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)} million`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

function generateSnapshot(answers: Record<string, number>): string[] {
  const bullets: string[] = [];

  const q1 = answers.stockDiscovery;
  if (q1 === 0) bullets.push('You rely on social media for stock ideas — Sight cuts through the noise with data-driven picks.');
  else if (q1 === 1) bullets.push('You learn from YouTube — Sight gives you the same analysis in real time, personalized to your watchlist.');
  else if (q1 === 2) bullets.push('You already use screeners — Sight supercharges your workflow with AI-powered signals.');
  else if (q1 === 3) bullets.push('You trade on instinct — Sight replaces guesswork with multi-strategy analysis.');
  else if (q1 === 4) bullets.push('You have a system — Sight adds AI confirmation to validate your setups.');

  const q2 = answers.missedMoves;
  if (q2 === 0) bullets.push('You miss moves daily — real-time alerts ensure you never miss a breakout again.');
  else if (q2 === 1) bullets.push('You miss moves weekly — continuous monitoring catches what you would otherwise miss.');
  else if (q2 === 2) bullets.push('You occasionally miss moves — smart alerts keep you ahead of the market.');
  else if (q2 === 3) bullets.push('You rarely miss moves — Sight helps you stay consistent.');

  bullets.push('Sight makes trading more efficient — spend less time researching and more time acting on opportunities.');

  return bullets;
}

/**
 * Onboarding survey flow (Session 171).
 *
 * ============================================================================
 *   1. survey    — seven keyed questions (5 legacy + age + savings)
 *   2. reveal    — Trading Snapshot bullets from generateSnapshot()
 *   3. potential — NEW interactive compound-growth projection graph
 *                  Only THIS screen marks onboarding complete + routes to
 *                  /login. Killing/reopening the app mid-flow is safe —
 *                  the user restarts the survey from the beginning.
 * ============================================================================
 */
type Screen = 'survey' | 'reveal' | 'potential';

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Responsive dimensions — updates live on rotation / iPad multi-tasking.
  const [dims, setDims] = useState(() => Dimensions.get('window'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => (sub as any)?.remove?.();
  }, []);
  const screenHeight = dims.height;
  const screenWidth = dims.width;

  // Respect Reduce Motion for the potential screen animations.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => (sub as any)?.remove?.();
  }, []);

  const [screen, setScreen] = useState<Screen>('survey');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [questionVisible, setQuestionVisible] = useState(true);
  const [sliderInteracted, setSliderInteracted] = useState(false);

  // Session 171 — progress derives from QUESTIONS.length. No more
  // hardcoded 20% or (idx + 2) * 20 magic numbers. Adding/removing
  // questions correctly updates the bar and the "N of M" counter.
  const totalQuestions = QUESTIONS.length;
  const initialProgressPct = 100 / totalQuestions;
  const progressWidth = useSharedValue(initialProgressPct);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progressWidth.value}%` }));

  const currentQuestion = QUESTIONS[questionIndex];
  const currentSliderInitial = currentQuestion?.isSlider
    ? (currentQuestion.sliderInitial ?? 0.5)
    : 0.5;

  const sliderPosition = useSharedValue(currentSliderInitial);
  const sliderDragStart = useSharedValue(currentSliderInitial);
  const sliderAnimStyle = useAnimatedStyle(() => ({ left: `${sliderPosition.value * 100}%` }));
  const sliderTrackFillStyle = useAnimatedStyle(() => ({ width: `${sliderPosition.value * 100}%` }));

  // JS-side mirror of the slider value so we can render the live
  // formatted display (e.g. "25 years old") on the slider question.
  const [sliderDisplayPos, setSliderDisplayPos] = useState(currentSliderInitial);
  useEffect(() => {
    if (currentQuestion?.isSlider) {
      const init = currentQuestion.sliderInitial ?? 0.5;
      sliderPosition.value = init;
      sliderDragStart.value = init;
      setSliderDisplayPos(init);
    }
  }, [questionIndex, currentQuestion?.isSlider, currentQuestion?.sliderInitial, sliderPosition, sliderDragStart]); // Added sliderPosition, sliderDragStart to deps

  const advanceToNextQuestion = useCallback(() => {
    if (questionIndex < QUESTIONS.length - 1) {
      setQuestionVisible(false);
      setTimeout(() => {
        const nextIdx = questionIndex + 1;
        setQuestionIndex(nextIdx);
        setSelectedAnswer(null);
        setSliderInteracted(false);
        progressWidth.value = withTiming(
          ((nextIdx + 1) / totalQuestions) * 100,
          { duration: 300, easing: Easing.out(Easing.cubic) },
        );
        setQuestionVisible(true); // Ensure next question becomes visible after state update
      }, 150);
    } else {
      setQuestionVisible(false);
      setTimeout(() => {
        setScreen('reveal');
        progressWidth.value = withTiming(100, { duration: 300, easing: Easing.out(Easing.cubic) });
      }, 150);
    }
  }, [questionIndex, totalQuestions, progressWidth]);

  const handleAnswer = useCallback((index: number) => {
    if (selectedAnswer !== null) return;
    Haptics.selectionAsync();
    setSelectedAnswer(index);
    const key = QUESTIONS[questionIndex].key;
    setAnswers(prev => ({ ...prev, [key]: index }));
    setTimeout(() => { advanceToNextQuestion(); }, 200);
  }, [selectedAnswer, questionIndex, advanceToNextQuestion]); // Added selectedAnswer as a dependency

  const handleSliderNext = useCallback(() => {
    Haptics.selectionAsync();
    const q = QUESTIONS[questionIndex];
    const min = q.sliderMin ?? 0;
    const max = q.sliderMax ?? 4;
    const raw = min + sliderPosition.value * (max - min);
    const mapped = Math.round(raw); // integer years for age, 0..4 index for enjoyment
    setAnswers(prev => ({ ...prev, [q.key]: mapped }));
    advanceToNextQuestion();
  }, [questionIndex, sliderPosition.value, advanceToNextQuestion]);

  // Session 171 — CTA on Trading Snapshot is now "View My Potential".
  // It NO LONGER marks onboarding complete — it transitions to the new
  // potential-projection screen inside this same onboarding flow.
  const handleViewPotential = useCallback(() => {
    Haptics.selectionAsync();
    setScreen('potential');
  }, []);

  // Session 171 — ONLY point where onboarding is actually marked
  // complete. Moved out of the Trading Snapshot CTA so killing/reopening
  // the app during the potential screen cannot skip it.
  const handleReadyToBuildWealth = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await markOnboardingComplete();
    router.replace('/login');
  }, [router]);

  // Slider pan — starts from the current position (not always 0.5) so
  // sliders that begin off-center (like the age slider starting at 25)
  // drag naturally from their initial thumb position.
  const sliderGesture = Gesture.Pan()
    .onBegin(() => {
      sliderDragStart.value = sliderPosition.value;
    })
    .onUpdate((e) => {
      const trackWidth = Math.max(1, screenWidth - 96);
      const newPos = Math.max(0, Math.min(1, sliderDragStart.value + e.translationX / trackWidth));
      sliderPosition.value = newPos;
      runOnJS(setSliderInteracted)(true);
      runOnJS(setSliderDisplayPos)(newPos);
    })
    .onEnd(() => {
      runOnJS(Haptics.selectionAsync)();
    });

  // Responsive sizing
  const isSmall = screenHeight < 700;
  const emojiSize = isSmall ? 44 : 56;
  const headingSize = isSmall ? 20 : 24;
  const optionPaddingV = isSmall ? 13 : 16;

  // ============================================================
  // POTENTIAL PROJECTION SCREEN (Session 171)
  // ============================================================
  if (screen === 'potential') {
    return (
      <PotentialProjectionScreen
        answers={answers}
        insets={insets}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        reduceMotion={reduceMotion}
        onFinish={handleReadyToBuildWealth}
      />
    );
  }

  // ============================================================
  // REVEAL SCREEN — Trading Snapshot
  // ============================================================
  if (screen === 'reveal') {
    const bullets = generateSnapshot(answers);
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, progressStyle]} />
            </View>
          </View>
          <Animated.ScrollView
            entering={FadeIn.duration(500)}
            style={{ flex: 1 }}
            contentContainerStyle={[styles.revealContent, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.revealTitle}>Your Trading Snapshot</Text>
            <Text style={styles.revealSubtitle}>Based on your answers:</Text>

            <View style={styles.bulletsContainer}>
              {bullets.map((bullet, i) => (
                <Animated.View key={i} entering={FadeInUp.duration(400).delay(i * 150)} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>{bullet}</Text>
                </Animated.View>
              ))}
            </View>

            <View style={styles.divider} />

            <View style={styles.valuePropSection}>
              {[
                'AI-powered market scanning',
                'Real-time trade opportunities',
                'Faster research and analysis',
                'Personalized market insights',
              ].map((item, i) => (
                <Animated.View key={i} entering={FadeInUp.duration(300).delay(400 + i * 100)} style={styles.checkRow}>
                  <MaterialIcons name="check-circle" size={20} color="#3B82F6" />
                  <Text style={styles.checkText}>{item}</Text>
                </Animated.View>
              ))}
            </View>
          </Animated.ScrollView>

          <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
            {/* Session 171 — CTA renamed from "Get Started" to
                "View My Potential". Does NOT mark onboarding complete
                anymore — that happens on the potential screen. */}
            <Pressable style={styles.ctaButton} onPress={handleViewPotential}>
              <Text style={styles.ctaText}>View My Potential</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#FFF" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ============================================================
  // SURVEY SCREEN
  // ============================================================
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
          <Text style={styles.questionCount}>{questionIndex + 1} of {totalQuestions}</Text>
        </View>

        {questionVisible ? (
          <Animated.View
            key={questionIndex}
            entering={FadeInUp.duration(350)}
            exiting={FadeOutUp.duration(250)}
            style={styles.surveyWrapper}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.surveyContent, { paddingBottom: insets.bottom + 24 }]}
              showsVerticalScrollIndicator={false}
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={[styles.questionEmoji, { fontSize: emojiSize }]}>{currentQuestion.emoji}</Text>
              <Text style={[styles.questionHeading, { fontSize: headingSize }]}>{currentQuestion.heading}</Text>

              {currentQuestion.isSlider ? (
                <View style={styles.sliderContainer}>
                  {currentQuestion.sliderFormatter ? (
                    <Text style={styles.sliderCurrentValue}>
                      {currentQuestion.sliderFormatter(
                        (currentQuestion.sliderMin ?? 0) +
                        sliderDisplayPos *
                          ((currentQuestion.sliderMax ?? 4) - (currentQuestion.sliderMin ?? 0))
                      )}
                    </Text>
                  ) : null}
                  <View style={styles.sliderTrack}>
                    <Animated.View style={[styles.sliderTrackFill, sliderTrackFillStyle]} />
                    <GestureDetector gesture={sliderGesture}>
                      <Animated.View style={[styles.sliderThumb, sliderAnimStyle]} />
                    </GestureDetector>
                  </View>
                  <View style={styles.sliderLabels}>
                    <Text style={styles.sliderLabel}>{currentQuestion.sliderLeftLabel}</Text>
                    <Text style={styles.sliderLabel}>{currentQuestion.sliderRightLabel}</Text>
                  </View>
                  {sliderInteracted ? (
                    <Animated.View entering={FadeIn.duration(300)}>
                      <Pressable style={styles.sliderNextBtn} onPress={handleSliderNext}>
                        <Text style={styles.sliderNextText}>Next</Text>
                        <MaterialIcons name="arrow-forward" size={18} color="#FFF" />
                      </Pressable>
                    </Animated.View>
                  ) : (
                    <Text style={styles.sliderHint}>Drag the slider to answer</Text>
                  )}
                </View>
              ) : (
                <View style={styles.optionsContainer}>
                  {currentQuestion.options?.map((option, i) => {
                    const isSelected = selectedAnswer === i;
                    return (
                      <Pressable
                        key={i}
                        style={[styles.optionCard, { paddingVertical: optionPaddingV }, isSelected && styles.optionCardSelected]}
                        onPress={() => handleAnswer(i)}
                        disabled={selectedAnswer !== null}
                      >
                        <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{option}</Text>
                        {isSelected ? (
                          <MaterialIcons name="check-circle" size={20} color="#3B82F6" />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
          </Animated.View>
        ) : null}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// =============================================================================
// POTENTIAL PROJECTION SCREEN (Session 171)
// =============================================================================
// Interactive compound-growth illustration. The user drags a marker along
// the growth curve; the age + projected balance readouts update live.
//
// - Uses actual survey answers (answers.age + answers.savings)
// - Growth calc: futureValue = startingValue * (1 + 0.1543)^years
// - X-axis: user's current age → max(65, currentAge + 30)
// - Draggable marker snaps to integer years; haptic ONLY fires on year change
// - PanGesture is contained inside its own View so it cannot bubble up and
//   scroll the parent ScrollView
// - Prev / Next year buttons provide a non-drag accessibility fallback
// - Uses react-native-svg (already used by components/ui/MiniChart.tsx)
// - Chart is clamped to max-width 520 so it renders as a centered card on
//   iPad rather than stretching awkwardly across the full width
// =============================================================================
interface PotentialProps {
  answers: Record<string, number>;
  insets: any;
  screenWidth: number;
  screenHeight: number;
  reduceMotion: boolean;
  onFinish: () => void;
}

function PotentialProjectionScreen({
  answers, insets, screenWidth, screenHeight, reduceMotion, onFinish,
}: PotentialProps) {
  // Derive starting values from the real survey answers, with safe fallbacks.
  // Session 193 - Any stored age below 18 (from an older survey run that
  // previously allowed 16+) is clamped UP to 18 rather than silently
  // being accepted. New answers cannot be below 18 because the age
  // slider's sliderMin is now 18 as well.
  const rawAge = answers.age;
  const startingAge = (() => {
    if (!Number.isFinite(rawAge) || typeof rawAge !== 'number') return 25;
    if (rawAge > 0 && rawAge < 18) return 18; // clamp legacy under-18 answers
    if (rawAge >= 18 && rawAge <= 80) return rawAge;
    return 25;
  })();

  const savingsBucket = answers.savings ?? 1;
  const startingValue = mapSavingsToStartingValue(savingsBucket);
  const savingsDisplay = SAVINGS_DISPLAY_APPROX[savingsBucket] ?? 'about $5,000';

  // Age range: at least to 65, and at least +30 years ahead of current age.
  const endAge = Math.max(65, startingAge + 30);
  const totalYears = Math.max(1, endAge - startingAge);

  // Pre-compute the year-by-year data set once per input change.
  const dataPoints = useMemo(() => {
    const pts: { age: number; value: number }[] = [];
    for (let year = 0; year <= totalYears; year++) {
      pts.push({ age: startingAge + year, value: projectFutureValue(startingValue, year) });
    }
    return pts;
  }, [startingAge, startingValue, totalYears]);

  const maxValue = dataPoints[dataPoints.length - 1].value;
  const minValue = 0; // honest baseline for exponential growth

  // Chart geometry — max-width 520 so it never stretches awkwardly on iPad.
  const chartOuterWidth = Math.min(Math.max(280, screenWidth - 32), 520);
  const isCompactHeight = screenHeight < 720;
  const CHART_HEIGHT = isCompactHeight ? 200 : 240;
  const PAD_LEFT = 46;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 30;
  const plotWidth = Math.max(1, chartOuterWidth - PAD_LEFT - PAD_RIGHT);
  const plotHeight = Math.max(1, CHART_HEIGHT - PAD_TOP - PAD_BOTTOM);

  const yearToX = useCallback(
    (yearIdx: number) => PAD_LEFT + (yearIdx / totalYears) * plotWidth,
    [totalYears, plotWidth],
  );
  const valueToY = useCallback(
    (v: number) => {
      if (maxValue <= minValue) return PAD_TOP + plotHeight;
      return PAD_TOP + ((maxValue - v) / (maxValue - minValue)) * plotHeight;
    },
    [maxValue, minValue, plotHeight, PAD_TOP], // Added PAD_TOP to deps
  );

  // Smooth growth line + shaded area beneath it.
  const linePath = useMemo(() => {
    if (dataPoints.length < 2) return '';
    const pts = dataPoints.map((p, i) => ({ x: yearToX(i), y: valueToY(p.value) }));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const cp1x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) / 3;
      const cp1y = pts[i - 1].y;
      const cp2x = pts[i].x - (pts[i].x - pts[i - 1].x) / 3;
      const cp2y = pts[i].y;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${pts[i].x} ${pts[i].y}`;
    }
    return d;
  }, [dataPoints, yearToX, valueToY]);

  const areaPath = useMemo(() => {
    if (!linePath) return '';
    return `${linePath} L ${yearToX(totalYears)} ${PAD_TOP + plotHeight} L ${yearToX(0)} ${PAD_TOP + plotHeight} Z`;
  }, [linePath, yearToX, totalYears, plotHeight, PAD_TOP]); // Added PAD_TOP to deps

  // 5 horizontal gridlines with Y-axis dollar labels.
  const gridLines = useMemo(() => {
    const lines: { y: number; value: number }[] = [];
    for (let i = 0; i <= 4; i++) {
      const y = PAD_TOP + (i / 4) * plotHeight;
      const val = maxValue - (i / 4) * (maxValue - minValue);
      lines.push({ y, value: val });
    }
    return lines;
  }, [plotHeight, maxValue, minValue, PAD_TOP]); // Added PAD_TOP to deps

  // 5 age tick marks on the X-axis.
  const ageTicks = useMemo(() => {
    const ticks: { x: number; age: number }[] = [];
    for (let i = 0; i <= 4; i++) {
      const yearIdx = Math.round((i / 4) * totalYears);
      ticks.push({ x: yearToX(yearIdx), age: startingAge + yearIdx });
    }
    return ticks;
  }, [totalYears, startingAge, yearToX]);

  // Marker state — start ~10 years ahead where possible so the user
  // opens the screen with a meaningful projected number, not $0-added.
  const initialYearIdx = Math.min(10, Math.max(1, Math.floor(totalYears / 2)));
  const [currentYearIdx, setCurrentYearIdx] = useState(initialYearIdx);
  const lastHapticYearRef = useRef(initialYearIdx);

  const currentAge = startingAge + currentYearIdx;
  const currentValue = projectFutureValue(startingValue, currentYearIdx);
  const markerX = yearToX(currentYearIdx);
  const markerY = valueToY(currentValue);

  // Convert a pointer X (relative to the SVG) into a snapped year index.
  const setYearFromX = useCallback((xRel: number) => {
    const clampedX = Math.max(PAD_LEFT, Math.min(PAD_LEFT + plotWidth, xRel));
    const frac = (clampedX - PAD_LEFT) / plotWidth;
    const yearIdx = Math.round(frac * totalYears);
    const clamped = Math.max(0, Math.min(totalYears, yearIdx));
    setCurrentYearIdx(prev => {
      if (prev !== clamped) {
        if (lastHapticYearRef.current !== clamped) {
          lastHapticYearRef.current = clamped;
          // Only fire haptics on year change — never per frame.
          try { Haptics.selectionAsync(); } catch (e) { /* silent */ }
        }
      }
      return clamped;
    });
  }, [plotWidth, totalYears, PAD_LEFT]); // Added PAD_LEFT to deps

  // Chart gestures live INSIDE their own View wrapper so they never
  // bubble to the parent ScrollView. Pan drives smooth scrubbing; Tap
  // jumps the marker to the tapped position.
  const chartPanGesture = Gesture.Pan()
    .onBegin((e) => { runOnJS(setYearFromX)(e.x); })
    .onUpdate((e) => { runOnJS(setYearFromX)(e.x); });

  const chartTapGesture = Gesture.Tap()
    .onEnd((e) => { runOnJS(setYearFromX)(e.x); });

  const chartGesture = Gesture.Simultaneous(chartPanGesture, chartTapGesture);

  // Accessibility fallback for users who cannot precisely drag.
  const stepYear = useCallback((delta: number) => {
    setCurrentYearIdx(prev => {
      const next = Math.max(0, Math.min(totalYears, prev + delta));
      if (next !== prev) {
        lastHapticYearRef.current = next;
        try { Haptics.selectionAsync(); } catch (e) { /* silent */ }
      }
      return next;
    });
  }, [totalYears]);

  // Intentional brief pause before the final CTA fades in so the user
  // has a moment to explore the chart before the button appears. Reduce
  // Motion shortens the delay AND swaps the entering animation for a
  // gentle fade.
  const [ctaVisible, setCtaVisible] = useState(false);
  useEffect(() => {
    const delay = reduceMotion ? 250 : 1100;
    const t = setTimeout(() => setCtaVisible(true), delay);
    return () => clearTimeout(t);
  }, [reduceMotion]);

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        {/* Progress bar (full at this stage) */}
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: '100%' }]} />
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 24,
            alignItems: 'center',
          }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.potentialInner}>
            {/* Header */}
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(400)}>
              <Text style={styles.potentialTitle}>See Your Potential</Text>
              <Text style={styles.potentialSubtitle}>
                Starting around age {startingAge} with {savingsDisplay} saved, here is a hypothetical illustration of long-term compound growth.
              </Text>
            </Animated.View>

            {/* Live results card */}
            <Animated.View
              entering={reduceMotion ? undefined : FadeInUp.duration(400).delay(100)}
              style={styles.resultsCard}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.resultsLabel}>AGE</Text>
                <Text style={styles.resultsValue}>{currentAge}</Text>
              </View>
              <View style={styles.resultsDivider} />
              <View style={{ flex: 1.6 }}>
                <Text style={styles.resultsLabel}>PROJECTED BALANCE</Text>
                <Text
                  style={[styles.resultsValue, { color: '#3B82F6' }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                >
                  {formatCurrencyLong(currentValue)}
                </Text>
              </View>
            </Animated.View>

            {/* Chart card — gestures contained inside its own View */}
            <Animated.View
              entering={reduceMotion ? undefined : FadeInUp.duration(500).delay(200)}
              style={[styles.chartCard, { width: chartOuterWidth }]}
              accessible
              accessibilityLabel={`Growth projection chart. Currently showing age ${currentAge} with projected balance ${formatCurrencyLong(currentValue)}. Total range age ${startingAge} to age ${endAge}.`}
            >
              <GestureDetector gesture={chartGesture}>
                <View style={{ width: chartOuterWidth, height: CHART_HEIGHT }}>
                  <Svg width={chartOuterWidth} height={CHART_HEIGHT}>
                    <Defs>
                      <SvgGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#3B82F6" stopOpacity="0.35" />
                        <Stop offset="1" stopColor="#3B82F6" stopOpacity="0" />
                      </SvgGradient>
                    </Defs>

                    {/* Gridlines + Y-axis dollar labels */}
                    {gridLines.map((g, i) => (
                      <React.Fragment key={`g-${i}`}>
                        <Line
                          x1={PAD_LEFT} y1={g.y}
                          x2={chartOuterWidth - PAD_RIGHT} y2={g.y}
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth={1}
                          strokeDasharray="3,4"
                        />
                        <SvgText
                          x={PAD_LEFT - 6} y={g.y + 3}
                          fill="#6B7280" fontSize={10}
                          textAnchor="end" fontWeight="500"
                        >
                          {formatCurrencyShort(g.value)}
                        </SvgText>
                      </React.Fragment>
                    ))}

                    {/* X-axis age tick labels */}
                    {ageTicks.map((t, i) => (
                      <SvgText
                        key={`t-${i}`}
                        x={t.x} y={CHART_HEIGHT - 10}
                        fill="#6B7280" fontSize={10}
                        textAnchor="middle" fontWeight="500"
                      >
                        {t.age}
                      </SvgText>
                    ))}

                    {/* Growth area + line */}
                    <Path d={areaPath} fill="url(#growthGrad)" />
                    <Path d={linePath} stroke="#3B82F6" strokeWidth={2.5} fill="none" />

                    {/* Starting-point marker */}
                    <Circle
                      cx={yearToX(0)} cy={valueToY(startingValue)}
                      r={4} fill="#FFF" stroke="#3B82F6" strokeWidth={2}
                    />

                    {/* Draggable marker crosshair */}
                    <Line
                      x1={markerX} y1={PAD_TOP}
                      x2={markerX} y2={PAD_TOP + plotHeight}
                      stroke="rgba(59,130,246,0.4)"
                      strokeWidth={1.5}
                      strokeDasharray="4,4"
                    />
                    <Circle cx={markerX} cy={markerY} r={10} fill="#FFF" />
                    <Circle cx={markerX} cy={markerY} r={6} fill="#3B82F6" />
                  </Svg>
                </View>
              </GestureDetector>

              <Text style={styles.chartHint}>Drag the marker to explore different ages</Text>
            </Animated.View>

            {/* Accessibility fallback — prev/next year controls */}
            <View style={styles.stepRow}>
              <Pressable
                style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.7 }]}
                onPress={() => stepYear(-1)}
                accessibilityRole="button"
                accessibilityLabel="Previous year"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialIcons name="chevron-left" size={22} color="#9CA3AF" />
                <Text style={styles.stepBtnText}>Prev year</Text>
              </Pressable>
              <View style={styles.stepMiddle}>
                <Text style={styles.stepMiddleText}>
                  {currentYearIdx === 0 ? 'Today' : `${currentYearIdx} year${currentYearIdx === 1 ? '' : 's'} from now`}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.7 }]}
                onPress={() => stepYear(1)}
                accessibilityRole="button"
                accessibilityLabel="Next year"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.stepBtnText}>Next year</Text>
                <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
              </Pressable>
            </View>

            {/* Disclosure — visible, not hidden in fine print */}
            <View style={styles.disclosureCard}>
              <MaterialIcons
                name="info-outline" size={16} color="#9CA3AF"
                style={{ marginTop: 2 }}
              />
              <Text style={styles.disclosureText}>
                Hypothetical illustration based on a 15.43% annual growth assumption. Actual returns vary and losses are possible. Sight does not guarantee any specific rate of return.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Final CTA — fades in after brief delay. ONLY this button
            marks onboarding complete + routes to /login. */}
        <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + 16 }]}>
          {ctaVisible ? (
            <Animated.View entering={reduceMotion ? FadeIn.duration(200) : FadeInUp.duration(500)}>
              <Pressable style={styles.ctaButton} onPress={onFinish}>
                <Text style={styles.ctaText}>Continue to Sight</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#FFF" />
              </Pressable>
            </Animated.View>
          ) : (
            // Reserve the slot so the layout doesn't jump when CTA fades in.
            <View style={{ height: 56 }} />
          )}
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E17' },
  safeArea: { flex: 1 },
  // Progress
  progressContainer: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 2 },
  questionCount: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  // Survey
  surveyWrapper: { flex: 1 },
  surveyContent: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center', minHeight: '100%' },
  questionEmoji: { marginBottom: 20 },
  questionHeading: { fontWeight: '700', color: '#FFFFFF', lineHeight: 34, marginBottom: 28, textAlign: 'center' },
  optionsContainer: { gap: 10, width: '100%', maxWidth: 480 },
  optionCard: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 20,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  optionCardSelected: { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3B82F6' },
  optionText: { fontSize: 16, color: '#D1D5DB', fontWeight: '500', flex: 1 },
  optionTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  // Slider
  sliderContainer: { width: '100%', maxWidth: 480, alignItems: 'center', marginTop: 8 },
  sliderCurrentValue: { fontSize: 20, fontWeight: '800', color: '#3B82F6', marginBottom: 20, letterSpacing: -0.3 },
  sliderTrack: { width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, justifyContent: 'center', position: 'relative' },
  sliderTrackFill: { position: 'absolute', left: 0, top: 0, height: 6, backgroundColor: '#3B82F6', borderRadius: 3 },
  sliderThumb: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#3B82F6', marginLeft: -14, top: -11, shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 4 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 16 },
  sliderLabel: { fontSize: 13, color: '#9CA3AF', fontWeight: '500' },
  sliderHint: { fontSize: 14, color: '#6B7280', marginTop: 32 },
  sliderNextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, backgroundColor: '#3B82F6', borderRadius: 12, paddingHorizontal: 32, gap: 8, marginTop: 32 },
  sliderNextText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  // Reveal
  revealContent: { paddingHorizontal: 24, paddingTop: 32, maxWidth: 640, alignSelf: 'center', width: '100%' },
  revealTitle: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  revealSubtitle: { fontSize: 15, color: '#9CA3AF', marginBottom: 24 },
  bulletsContainer: { gap: 16, marginBottom: 24 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bulletDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3B82F6', marginTop: 7 },
  bulletText: { fontSize: 15, color: '#D1D5DB', lineHeight: 22, flex: 1 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginVertical: 24 },
  valuePropSection: { gap: 14 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkText: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  ctaContainer: { paddingHorizontal: 24, maxWidth: 520, alignSelf: 'center', width: '100%' },
  ctaButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, backgroundColor: '#3B82F6', borderRadius: 14, gap: 8,
  },
  ctaText: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  // Potential projection screen
  potentialInner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingTop: 12 },
  potentialTitle: { fontSize: 28, fontWeight: '800', color: '#FFF', letterSpacing: -0.5, marginBottom: 8, textAlign: 'center' },
  potentialSubtitle: { fontSize: 14, color: '#9CA3AF', lineHeight: 20, textAlign: 'center', marginBottom: 20, paddingHorizontal: 8 },
  resultsCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 16, marginBottom: 16, gap: 16, width: '100%',
  },
  resultsLabel: { fontSize: 10, fontWeight: '700', color: '#6B7280', letterSpacing: 1, marginBottom: 4 },
  resultsValue: { fontSize: 26, fontWeight: '800', color: '#FFF', letterSpacing: -0.5 },
  resultsDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.1)' },
  chartCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16, padding: 8, marginBottom: 8, alignSelf: 'center', alignItems: 'center',
  },
  chartHint: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 6, marginBottom: 4 },
  stepRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', marginTop: 8, marginBottom: 12, gap: 8,
  },
  stepBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 10, paddingHorizontal: 6, minHeight: 44 },
  stepBtnText: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },
  stepMiddle: { flex: 1, alignItems: 'center' },
  stepMiddleText: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  disclosureCard: {
    flexDirection: 'row', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12, padding: 12, width: '100%', marginTop: 4, marginBottom: 4,
  },
  disclosureText: { flex: 1, fontSize: 11, color: '#9CA3AF', lineHeight: 16 },
});
