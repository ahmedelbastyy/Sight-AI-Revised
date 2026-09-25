import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated as RNAnimated, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { purchasePackage, purchaseWithPromoOffer, getOfferings } from '../services/revenueCatService';

import AsyncStorage from '@react-native-async-storage/async-storage';

const supabase = getSupabaseClient();

const DEVICE_INTRO_KEY = 'ts_device_intro_offer_used';
const DEVICE_TRIAL_KEY = 'ts_device_trial_used';

export default function IntroOfferScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { currentTheme: t, setHasSeenIntroOffer, checkSubscription, setJustUpgradedToPro } = useApp();
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [regularPrice, setRegularPrice] = useState('');
  const [trialDays, setTrialDays] = useState(0);
  const [pkgId, setPkgId] = useState('$rc_monthly');
  const [promoOfferId, setPromoOfferId] = useState('7.99_offer');
  const [offeringsLoaded, setOfferingsLoaded] = useState(false);

  const saveIntroOfferToDB = async () => {
    try {
      await AsyncStorage.setItem(DEVICE_INTRO_KEY, 'true');
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('user_profiles').update({ intro_offer_seen: true }).eq('id', session.user.id);
      }
    } catch {}
  };

  const [hasPromoOffer, setHasPromoOffer] = useState<boolean | null>(null); // null = loading

  // IMMEDIATELY mark device as having seen the intro offer on page mount
  useEffect(() => {
    AsyncStorage.setItem(DEVICE_INTRO_KEY, 'true').catch(() => {});
    // Load offerings to get live pricing
    (async () => {
      try {
        const o = await getOfferings();
        if (o.monthly) {
          setPkgId(o.monthly.identifier);
          setRegularPrice(o.monthly.priceString);
          // Check for a PROMOTIONAL discount offer (not a free trial)
          // A promo offer is a discounted price that is > $0 but < regular price
          // Free trials (price = 0) do NOT count as a gift box promo
          if (o.introOffer?.introPrice && 
              o.introOffer.introPrice.price > 0 && 
              o.introOffer.introPrice.price < o.monthly.price &&
              o.introOffer.introPrice.priceString !== o.monthly.priceString) {
            setOfferPrice(o.introOffer.introPrice.priceString);
            setHasPromoOffer(true);
          } else {
            // No promotional discount configured - skip the gift box entirely
            // Free trials are handled by the normal subscription flow
            setOfferPrice(o.monthly.priceString);
            setHasPromoOffer(false);
          }
        } else {
          // No offerings available (RC not initialized) - skip gift box
          setHasPromoOffer(false);
        }
        setOfferingsLoaded(true);
      } catch {
        setHasPromoOffer(false);
        setOfferingsLoaded(true);
      }
    })();
  }, []);

  // If no promo offer is configured, skip the gift box entirely and move on
  useEffect(() => {
    if (hasPromoOffer === false && offeringsLoaded) {
      // No special promo - skip this screen as if it never existed
      setHasSeenIntroOffer(true);
      saveIntroOfferToDB();
      router.replace('/');
    }
  }, [hasPromoOffer, offeringsLoaded]);

  // If still loading offerings, show a loading screen
  // If no promo, the useEffect above will auto-skip
  // Use native Animated for stable fade-in
  const giftFade = useRef(new RNAnimated.Value(0)).current;
  const revealFade = useRef(new RNAnimated.Value(0)).current;
  const revealSlide = useRef(new RNAnimated.Value(30)).current;
  const tapFade = useRef(new RNAnimated.Value(0)).current;
  const hasAnimatedGift = useRef(false);
  const hasAnimatedReveal = useRef(false);

  useEffect(() => {
    if (hasAnimatedGift.current) return;
    hasAnimatedGift.current = true;
    RNAnimated.sequence([
      RNAnimated.timing(giftFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      RNAnimated.timing(tapFade, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!revealed || hasAnimatedReveal.current) return;
    hasAnimatedReveal.current = true;
    RNAnimated.parallel([
      RNAnimated.timing(revealFade, { toValue: 1, duration: 500, useNativeDriver: true }),
      RNAnimated.timing(revealSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [revealed]);

  const shakeRotation = useSharedValue(0);
  useEffect(() => {
    shakeRotation.value = withDelay(
      1000,
      withRepeat(
        withSequence(
          withTiming(-12, { duration: 80, easing: Easing.inOut(Easing.ease) }),
          withTiming(12, { duration: 80, easing: Easing.inOut(Easing.ease) }),
          withTiming(-10, { duration: 70, easing: Easing.inOut(Easing.ease) }),
          withTiming(10, { duration: 70, easing: Easing.inOut(Easing.ease) }),
          withTiming(-6, { duration: 60, easing: Easing.inOut(Easing.ease) }),
          withTiming(6, { duration: 60, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 60, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 1200 }),
        ),
        -1,
        false
      )
    );
  }, []);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ rotateZ: `${shakeRotation.value}deg` }],
  }));

  const handleTapToReveal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRevealed(true);
  };

  const handleClaim = async () => {
    setLoading(true);
    Haptics.selectionAsync();
    try {
      // Try to purchase with promotional offer for $7.99
      let result = await purchaseWithPromoOffer(pkgId, promoOfferId);
      
      // If promo purchase not available, fall back to normal purchase
      if (result.error && result.error.includes('not available')) {
        result = await purchasePackage(pkgId);
      }
      
      if (result.cancelled) {
        setLoading(false);
        return;
      }
      
      if (result.success) {
        setHasSeenIntroOffer(true);
        saveIntroOfferToDB();
        await checkSubscription();
        setJustUpgradedToPro(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Session 142 — welcome-pro removed; route straight to brokerage.
        router.replace('/connect-brokerage?onboarding=1&autoOpen=1' as any);
      } else if (result.error) {
        showAlert('Purchase Failed', result.error);
      }
    } catch (e: any) {
      showAlert('Error', e.message || 'Failed to complete purchase');
    }
    setLoading(false);
  };

  const handleSkip = () => {
    Haptics.selectionAsync();
    setHasSeenIntroOffer(true);
    saveIntroOfferToDB();
    router.replace('/');
  };

  // Phase 1: Tap to reveal
  if (!revealed) {
    return (
      <Pressable style={[styles.container, { backgroundColor: '#0A0E17' }]} onPress={handleTapToReveal}>
        <LinearGradient
          colors={['rgba(59,130,246,0.08)', 'rgba(59,130,246,0.04)', 'rgba(10,14,23,1)']}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top', 'bottom']} style={styles.centeredSafe}>
          <RNAnimated.View style={[styles.giftSection, { opacity: giftFade }]}>
            <Animated.View style={[styles.giftIconWrap, shakeStyle]}>
              <LinearGradient
                colors={['#FFD700', '#FF8C00', '#FFD700']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.giftGradient}
              >
                <View style={styles.giftInner}>
                  <MaterialIcons name="card-giftcard" size={48} color="#FFD700" />
                </View>
              </LinearGradient>
            </Animated.View>

            <View style={{ alignItems: 'center' }}>
              <Text style={styles.giftTitle}>You have a special gift!</Text>
              <Text style={styles.giftSub}>Tap anywhere to reveal your exclusive offer</Text>
            </View>

            <RNAnimated.View style={{ opacity: tapFade }}>
              <View style={styles.tapIndicator}>
                <MaterialIcons name="touch-app" size={24} color="rgba(255,255,255,0.5)" />
                <Text style={styles.tapText}>Tap to reveal</Text>
              </View>
            </RNAnimated.View>
          </RNAnimated.View>
        </SafeAreaView>
      </Pressable>
    );
  }

  // Phase 2: Offer revealed - native IAP
  return (
    <View style={[styles.container, { backgroundColor: '#0A0E17' }]}>
      <LinearGradient
        colors={['rgba(255,215,0,0.06)', 'rgba(255,140,0,0.04)', 'rgba(10,14,23,1)']}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={['top', 'bottom']} style={styles.revealedSafe}>
        <RNAnimated.View style={[styles.revealedContent, { opacity: revealFade, transform: [{ translateY: revealSlide }] }]}>
          <View style={{ alignItems: 'center' }}>
            <LinearGradient
              colors={['#FFD700', '#FF8C00']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.offerBadge}
            >
              <MaterialIcons name="workspace-premium" size={18} color="#FFF" />
              <Text style={styles.offerBadgeText}>EXCLUSIVE OFFER</Text>
            </LinearGradient>
          </View>

          <View style={{ alignItems: 'center' }}>
            <Text style={styles.offerPrice}>{offerPrice || '...'}</Text>
            <Text style={styles.offerPeriod}>for your first month</Text>
            {regularPrice && offerPrice && regularPrice !== offerPrice ? (
              <View style={styles.savingsRow}>
                <Text style={styles.originalPrice}>{regularPrice}/month</Text>
                <View style={styles.savingsBadge}>
                  <Text style={styles.savingsText}>SPECIAL OFFER</Text>
                </View>
              </View>
            ) : null}
          </View>

          <View style={styles.offerFeatures}>
            {[
              { icon: 'psychology', text: 'AI Buy/Sell/Hold Signals' },
              { icon: 'analytics', text: 'Technical Indicators & Charts' },
              { icon: 'gps-fixed', text: 'Smart Trade Targets' },
              { icon: 'add-a-photo', text: 'Chart Upload Analysis' },
            ].map((f, i) => (
              <View key={i} style={styles.offerFeatureRow}>
                <MaterialIcons name="check-circle" size={18} color="#10B981" />
                <Text style={styles.offerFeatureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <View style={{ alignItems: 'center' }}>
            <Text style={styles.offerNote}>
              {offerPrice && regularPrice && offerPrice !== regularPrice
                ? `Pay ${offerPrice} for your first month, then ${regularPrice}/month.`
                : `${regularPrice || offerPrice || ''}/month after any trial period.`
              }{'\n'}Cancel anytime via App Store.
            </Text>
          </View>
        </RNAnimated.View>

        <RNAnimated.View style={[styles.offerActions, { paddingBottom: insets.bottom + 16, opacity: revealFade }]}>
          <Pressable
            style={[styles.claimBtn, loading && { opacity: 0.6 }]}
            onPress={handleClaim}
            disabled={loading}
          >
            <LinearGradient
              colors={['#FFD700', '#FF8C00']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.claimGradient}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MaterialIcons name="local-offer" size={20} color="#FFF" />
                  <Text style={styles.claimText}>{offerPrice && regularPrice && offerPrice !== regularPrice ? `Claim ${offerPrice} Offer` : 'Start Pro'}</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          <Pressable style={styles.skipBtn} onPress={handleSkip}>
            <Text style={styles.skipText}>No thanks, continue free</Text>
          </Pressable>
        </RNAnimated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centeredSafe: { flex: 1, justifyContent: 'center', alignItems: 'center', maxWidth: 520, alignSelf: 'center', width: '100%' },
  giftSection: { alignItems: 'center', gap: 28 },
  giftIconWrap: { marginBottom: 8 },
  giftGradient: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  giftInner: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(10,14,23,0.9)', alignItems: 'center', justifyContent: 'center' },
  giftTitle: { fontSize: 26, fontWeight: '700', color: '#FFF', textAlign: 'center', marginBottom: 8 },
  giftSub: { fontSize: 15, color: '#9CA3AF', textAlign: 'center' },
  tapIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, opacity: 0.6 },
  tapText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  revealedSafe: { flex: 1, justifyContent: 'space-between', maxWidth: 520, alignSelf: 'center', width: '100%' },
  revealedContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, gap: 24 },
  offerBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9999 },
  offerBadgeText: { fontSize: 13, fontWeight: '800', color: '#FFF', letterSpacing: 1 },
  offerPrice: { fontSize: 56, fontWeight: '700', color: '#FFD700', letterSpacing: -2 },
  offerPeriod: { fontSize: 16, color: '#9CA3AF', marginTop: -4, fontWeight: '500' },
  savingsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  originalPrice: { fontSize: 18, color: '#6B7280', textDecorationLine: 'line-through', fontWeight: '500' },
  savingsBadge: { backgroundColor: 'rgba(16,185,129,0.15)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  savingsText: { fontSize: 12, fontWeight: '800', color: '#10B981', letterSpacing: 0.5 },
  offerFeatures: { gap: 12, width: '100%', paddingHorizontal: 12 },
  offerFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offerFeatureText: { fontSize: 15, color: '#D1D5DB', fontWeight: '500' },
  offerNote: { fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 18 },
  offerActions: { paddingHorizontal: 28, maxWidth: 520, alignSelf: 'center', width: '100%' },
  claimBtn: { borderRadius: 14, overflow: 'hidden', marginBottom: 12 },
  claimGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, gap: 8 },
  claimText: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipText: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
});
