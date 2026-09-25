import React, { useState, useRef } from 'react';
import { View, StyleSheet, Platform, Animated as RNAnimated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TouchableOpacity, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import * as Haptics from 'expo-haptics';

export default function TradingViewScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const router = useRouter();
  const { currentTheme: t, themeMode } = useApp();
  const [loading, setLoading] = useState(true);
  const fadeAnim = useRef(new RNAnimated.Value(1)).current;

  const tvTheme = themeMode === 'dark' ? 'dark' : 'light';
  const bgColor = themeMode === 'dark' ? '#0A0E17' : '#F8F9FB';
  // Sanitize symbol for TradingView: BRK.B → BRK-B, ensure uppercase
  const tvSymbol = (symbol || 'AAPL').replace(/\./g, '-').toUpperCase();
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; background: ${bgColor}; }
        .tradingview-widget-container { width: 100%; height: 100%; }
        #tradingview_widget { width: 100%; height: 100%; }
      </style>
    </head>
    <body>
      <div class="tradingview-widget-container">
        <div id="tradingview_widget" style="width:100%;height:100%"></div>
      </div>
      <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
      <script type="text/javascript">
        new TradingView.widget({
          "autosize": true,
          "symbol": "${tvSymbol}",
          "interval": "D",
          "timezone": "America/New_York",
          "theme": "${tvTheme}",
          "style": "1",
          "locale": "en",
          "toolbar_bg": "${bgColor}",
          "enable_publishing": false,
          "allow_symbol_change": true,
          "container_id": "tradingview_widget",
          "hide_side_toolbar": false,
          "studies": ["RSI@tv-basicstudies", "MACD@tv-basicstudies"],
          "show_popup_button": false,
          "width": "100%",
          "height": "100%"
        });
      </script>
    </body>
    </html>
  `;

  const handleLoadEnd = () => {
    RNAnimated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setLoading(false));
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <TouchableOpacity activeOpacity={0.6} style={[styles.backBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => { Haptics.selectionAsync(); router.back(); }}>
          <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: t.textPrimary }]}>{symbol} - Advanced Chart</Text>
          <Text style={[styles.headerSub, { color: t.textSecondary }]}>TradingView</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <View style={{ flex: 1 }}>
        <WebView
          source={{ html: htmlContent }}
          style={{ flex: 1, backgroundColor: bgColor }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={['*']}
          scalesPageToFit={Platform.OS === 'android'}
          scrollEnabled={false}
          nestedScrollEnabled={true}
          onLoadEnd={handleLoadEnd}
          cacheEnabled
        />
        {loading ? (
          <RNAnimated.View style={[styles.loadingOverlay, { backgroundColor: bgColor, opacity: fadeAnim }]}>
            <Image source={require('../assets/images/app-logo.png')} style={{ width: 40, height: 40 }} contentFit="contain" />
            <Text style={[styles.loadingText, { color: t.textSecondary }]}>Loading chart...</Text>
          </RNAnimated.View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 12, marginTop: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 10, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { fontSize: 14, fontWeight: '500', marginTop: 8 },
});
