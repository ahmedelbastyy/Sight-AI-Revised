import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated as RNAnimated, Share, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../contexts/AppContext';

export default function NewsWebViewScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title?: string }>();
  const router = useRouter();
  const { currentTheme: t } = useApp();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;

  // Determine if this is dark mode for status bar styling
  const isDark = t.background === '#0A0E17' || t.background === '#000000' || t.background === '#111827';

  if (!url) {
    return (
      <View style={[styles.container, { backgroundColor: t.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={t.background} />
        <View style={styles.errorState}>
          <MaterialIcons name="error-outline" size={48} color={t.bearish} />
          <Text style={[styles.errorText, { color: t.textPrimary }]}>No URL provided</Text>
          <Pressable style={[styles.backBtn, { backgroundColor: t.primary }]} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={t.background} />
      <View style={[styles.header, { borderBottomColor: t.border, backgroundColor: t.background }]}>
        <Pressable style={[styles.closeBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color={t.textSecondary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]} numberOfLines={1}>
            {title || 'Article'}
          </Text>
        </View>
        <Pressable style={[styles.closeBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={async () => {
            try {
              const isTradesight = url.includes('tradesightt.app');
              if (isTradesight) {
                const msg = '\ud83d\udcca Sight \u2014 Smarter Stock Insights Powered by AI';
                await Share.share(
                  Platform.OS === 'ios'
                    ? { message: msg, url: 'https://tradesightt.app' }
                    : { message: `${msg}\nhttps://tradesightt.app` }
                );
              } else {
                const msg = `${title || 'Check out this article'}`;
                await Share.share(
                  Platform.OS === 'ios'
                    ? { message: msg, url }
                    : { message: `${msg} - ${url}` }
                );
              }
            } catch {}
          }}>
          <MaterialIcons name="share" size={20} color={t.textSecondary} />
        </Pressable>
      </View>

      {/* WebView container — solid background prevents white flash on iOS during slide-in */}
      <View style={{ flex: 1, backgroundColor: t.background }}>
        <WebView
          source={{ uri: url }}
          // Solid backgroundColor on WebView prevents the native white flash on iOS
          // before HTML content paints. This is the key fix for the modal slide-in flash.
          style={{ flex: 1, backgroundColor: t.background }}
          containerStyle={{ backgroundColor: t.background }}
          opaque={true}
          onLoadEnd={() => {
            RNAnimated.timing(fadeAnim, {
              toValue: 0,
              duration: 280,
              useNativeDriver: true,
            }).start(() => setLoading(false));
          }}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState={false}
          scalesPageToFit
          cacheEnabled
          thirdPartyCookiesEnabled
          bounces={false}
          scrollEnabled={true}
          pullToRefreshEnabled={false}
          allowsBackForwardNavigationGestures={false}
          androidLayerType="hardware"
        />
        {loading ? (
          <RNAnimated.View style={[styles.loadingOverlay, { backgroundColor: t.background, opacity: fadeAnim }]}>
            <ActivityIndicator size="large" color={t.primary} style={{ marginBottom: 12 }} />
            <Text style={[styles.loadingText, { color: t.textSecondary }]}>Loading...</Text>
          </RNAnimated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  closeBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerTitle: { fontSize: 15, fontWeight: '600' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: 14, fontWeight: '500' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  errorText: { fontSize: 16, fontWeight: '600' },
  backBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  backBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});
