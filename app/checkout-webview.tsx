import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated as RNAnimated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { getSupabaseClient } from '@/template';

const supabase = getSupabaseClient();

export default function CheckoutWebViewScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const router = useRouter();
  const { checkSubscription, currentTheme: t } = useApp();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const webViewRef = useRef<WebView>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;

  // Start polling for subscription status immediately for faster detection
  useEffect(() => {
    // Start polling immediately to detect subscription faster
    startPolling();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleLoadEnd = () => {
    // Smooth fade out of loading overlay
    RNAnimated.timing(fadeAnim, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start(() => setLoading(false));
  };

  const startPolling = () => {
    if (pollRef.current) return;
    setPolling(true);
    pollRef.current = setInterval(async () => {
      await checkSubscription();
    }, 3000); // Check every 3 seconds for faster detection
  };

  const handleNavigationChange = async (navState: any) => {
    const currentUrl = navState.url || '';
    // Detect success or cancel redirects
    if (currentUrl.includes('success') && !currentUrl.includes('checkout.stripe.com/c/')) {
      if (pollRef.current) clearInterval(pollRef.current);
      await checkSubscription();
      // Session 142 — welcome-pro removed; route straight to brokerage.
      router.replace('/connect-brokerage?onboarding=1&autoOpen=1' as any);
    } else if (currentUrl.includes('/cancel') && !currentUrl.includes('checkout.stripe.com/c/')) {
      if (pollRef.current) clearInterval(pollRef.current);
      router.back();
    }
  };

  const handleClose = async () => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Check subscription one more time on close - user might have completed payment
    await checkSubscription();
    // If now subscribed, show Welcome Pro screen
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      try {
        const resp = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-subscription`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (resp.ok) {
          const subData = await resp.json();
          if (subData?.subscribed) {
            router.replace('/connect-brokerage?onboarding=1&autoOpen=1' as any);
            return;
          }
        }
      } catch {}
    }
    router.dismiss();
  };

  if (!url) {
    return (
      <View style={[styles.container, { backgroundColor: t.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.errorState}>
          <MaterialIcons name="error-outline" size={48} color={t.bearish} />
          <Text style={[styles.errorText, { color: t.textPrimary }]}>No checkout URL provided</Text>
          <TouchableOpacity activeOpacity={0.7} style={[styles.backBtn, { backgroundColor: t.primary }]} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[styles.header, { borderBottomColor: t.border, backgroundColor: t.backgroundSecondary }]}>
        <TouchableOpacity activeOpacity={0.6} style={[styles.closeBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={handleClose}>
          <MaterialIcons name="close" size={22} color={t.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <MaterialIcons name="lock" size={14} color={t.bullish} />
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Sight Pro</Text>
        </View>
        <TouchableOpacity activeOpacity={0.6} style={[styles.doneBtn, { backgroundColor: t.primary }]}
          onPress={handleClose}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>Done</Text>
        </TouchableOpacity>
      </View>



      <View style={{ flex: 1 }}>
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          style={{ flex: 1 }}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={handleNavigationChange}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState={false}
          scalesPageToFit
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          cacheEnabled
          thirdPartyCookiesEnabled
        />
        {loading ? (
          <RNAnimated.View style={[styles.brandedLoading, { backgroundColor: t.background, opacity: fadeAnim }]}>
            <Image source={require('../assets/images/app-logo.png')} style={{ width: 48, height: 48 }} contentFit="contain" />
            <Text style={[styles.brandedLoadingTitle, { color: t.textPrimary }]}>Loading...</Text>
            <View style={[styles.brandedLoadingBar, { backgroundColor: t.border }]}>
              <View style={[styles.brandedLoadingProgress, { backgroundColor: t.primary }]} />
            </View>
          </RNAnimated.View>
        ) : null}
      </View>

      {polling && !loading ? (
        <View style={[styles.pollingBar, { backgroundColor: t.primary + '10', borderTopColor: t.primary + '20' }]}>
          <MaterialIcons name="info-outline" size={16} color={t.primary} />
          <Text style={{ fontSize: 13, color: t.textPrimary, flex: 1, marginLeft: 8 }}>
            Completed payment? Tap <Text style={{ fontWeight: '700', color: t.primary }}>Done</Text> above to continue.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  doneBtn: { paddingHorizontal: 18, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, fontWeight: '500' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errorText: { fontSize: 16, fontWeight: '600' },
  backBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  backBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  pollingBar: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center' },
  brandedLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 10, gap: 4 },
  brandedLoadingTitle: { fontSize: 17, fontWeight: '700', marginTop: 20 },

  brandedLoadingBar: { width: 160, height: 3, borderRadius: 2, marginTop: 16, overflow: 'hidden' },
  brandedLoadingProgress: { width: '60%', height: '100%', borderRadius: 2 },
});
