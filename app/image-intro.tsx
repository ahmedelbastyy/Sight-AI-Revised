import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Dimensions, Pressable,
  NativeScrollEvent, NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';

// Session 143 — post-signup image intro. Placeholder gradient panels stand
// in for the eventual App Store screenshots. The user MUST swipe through
// all 3 slides before the Continue button is revealed. On Continue the
// device-level flag is written and the user is routed back through the
// index gate (which then heads to the paywall).
export const IMAGE_INTRO_KEY = 'sight_image_intro_seen';

const SLIDES = [
  {
    title: 'AI-Powered Signals',
    description: 'See high-confidence Moves generated 24/7 by two independent AI models.',
    icon: 'psychology',
    colors: ['#3B82F6', '#1D4ED8'] as [string, string],
  },
  {
    title: 'Real Brokerage Trading',
    description: 'Connect your broker with SnapTrade and place actual orders from Sight.',
    icon: 'account-balance',
    colors: ['#10B981', '#065F46'] as [string, string],
  },
  {
    title: 'Track Every Trade',
    description: 'Take-profit, stop-loss, P/L, and a full trade journal built in.',
    icon: 'insights',
    colors: ['#F59E0B', '#B45309'] as [string, string],
  },
];

export default function ImageIntroScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentTheme: t } = useApp();
  const [index, setIndex] = useState(0);
  const [maxSeen, setMaxSeen] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const width = Dimensions.get('window').width;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const i = Math.round(x / width);
    if (i !== index) {
      setIndex(i);
      Haptics.selectionAsync().catch(() => {});
    }
    if (i > maxSeen) setMaxSeen(i);
  }, [index, maxSeen, width]);

  const goNext = useCallback(() => {
    if (index < SLIDES.length - 1) {
      const nextI = index + 1;
      scrollRef.current?.scrollTo({ x: nextI * width, animated: true });
      setIndex(nextI);
      if (nextI > maxSeen) setMaxSeen(nextI);
      Haptics.selectionAsync().catch(() => {});
    }
  }, [index, maxSeen, width]);

  const canContinue = maxSeen >= SLIDES.length - 1;

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try { await AsyncStorage.setItem(IMAGE_INTRO_KEY, 'true'); } catch {}
    router.replace('/');
  }, [canContinue, router]);

  return (
    <View style={[styles.container, { backgroundColor: t.background }]}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {SLIDES.map((s, i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <View style={styles.imageWrap}>
                <LinearGradient
                  colors={s.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.image}
                >
                  <View style={styles.imageInner}>
                    <MaterialIcons name={s.icon as any} size={96} color="rgba(255,255,255,0.95)" />
                    <Text style={styles.imageBadge}>PLACEHOLDER</Text>
                  </View>
                </LinearGradient>
              </View>
              <Text style={[styles.slideTitle, { color: t.textPrimary }]}>{s.title}</Text>
              <Text style={[styles.slideDesc, { color: t.textSecondary }]}>{s.description}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === index ? t.primary : t.border,
                  width: i === index ? 22 : 8,
                },
              ]}
            />
          ))}
        </View>

        <View style={[styles.ctaSection, { paddingBottom: insets.bottom + 20 }]}>
          {canContinue ? (
            <Animated.View entering={FadeIn.duration(400)}>
              <Pressable
                onPress={handleContinue}
                style={({ pressed }) => [
                  styles.continueBtn,
                  { backgroundColor: t.primary, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <Text style={styles.continueText}>Continue</Text>
                <MaterialIcons name="arrow-forward" size={20} color="#FFF" />
              </Pressable>
            </Animated.View>
          ) : (
            <Pressable
              onPress={goNext}
              style={({ pressed }) => [
                styles.nextBtn,
                { borderColor: t.border, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text style={[styles.nextText, { color: t.textSecondary }]}>
                Swipe to continue ({index + 1}/{SLIDES.length})
              </Text>
              <MaterialIcons name="chevron-right" size={20} color={t.textSecondary} />
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  imageWrap: {
    width: '100%', aspectRatio: 9 / 12, maxHeight: 460,
    borderRadius: 24, overflow: 'hidden', marginBottom: 36,
  },
  image: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageInner: { alignItems: 'center', justifyContent: 'center', gap: 18 },
  imageBadge: {
    fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.7)',
    letterSpacing: 2, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.25)',
  },
  slideTitle: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 10, letterSpacing: -0.5 },
  slideDesc: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 8 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  dot: { height: 8, borderRadius: 4 },
  ctaSection: { paddingHorizontal: 28, maxWidth: 520, alignSelf: 'center', width: '100%' },
  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, borderRadius: 14, gap: 8,
  },
  continueText: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 56, borderRadius: 14, gap: 8, borderWidth: 1.5,
  },
  nextText: { fontSize: 15, fontWeight: '600' },
});
