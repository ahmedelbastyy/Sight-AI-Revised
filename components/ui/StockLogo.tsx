import React, { useState, memo, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { getStockLogoUrl, getAlternateLogoUrl, getTickerColor } from '../../services/logoService';

interface StockLogoProps {
  ticker: string;
  size?: number;
}

// Session 206 — LOCAL LOGO OVERRIDES. When a ticker has a bundled asset
// we always prefer it over the remote Clearbit / Google favicon URLs
// because bundled assets are guaranteed high-quality, correctly branded,
// and never fail to load. Currently used to render Banzai International
// (PARA) with its official "b" mark. Extend this map whenever a bundled
// vector-quality logo is available for a ticker.
const LOCAL_LOGOS: Record<string, any> = {
  PARA: require('../../assets/images/banzai-logo.png'),
};

// Session 214 — Persistent in-memory URL failure cache. When we already
// know a ticker's primary URL 404's from Clearbit this session, we skip
// straight to the alternate URL on subsequent renders — no failed image
// request, no fallback delay. expo-image's memory-disk cache already
// handles resolved images, but this map handles the FAILURE path so
// trending stocks with broken Clearbit domains render instantly on
// second view without any flicker.
const primaryFailedCache = new Set<string>();
const secondaryFailedCache = new Set<string>();

export const StockLogo = memo(function StockLogo({ ticker, size = 36 }: StockLogoProps) {
  const [primaryFailed, setPrimaryFailed] = useState(() => primaryFailedCache.has(ticker));
  const [secondaryFailed, setSecondaryFailed] = useState(() => secondaryFailedCache.has(ticker));
  const localOverride = LOCAL_LOGOS[ticker];
  const primaryUrl = getStockLogoUrl(ticker);
  const secondaryUrl = getAlternateLogoUrl(ticker);
  const fallbackColor = getTickerColor(ticker);

  // Reset local fail state when the ticker prop changes so a recycled
  // component instance (e.g. FlatList recycling) doesn't inherit a stale
  // failed-URL flag from the previous ticker.
  useEffect(() => {
    setPrimaryFailed(primaryFailedCache.has(ticker));
    setSecondaryFailed(secondaryFailedCache.has(ticker));
  }, [ticker]);

  // Session 206 — image now fills the circle almost completely (94%)
  // with a thin white ring so brand marks read at a proper size and no
  // longer look shrunken inside their frame. Combined with contentFit
  // 'cover' below, brand marks perfectly fill their circular container
  // without any awkward blank border on the sides.
  const imgSize = Math.round(size * 0.94);
  const imgRadius = imgSize / 2;

  // Local bundled logo — always renders (no network, no error state).
  // Session 215 — use `contain` so the bundled brand mark preserves its
  // real aspect ratio inside the circle rather than being cropped/stretched.
  if (localOverride) {
    return (
      <View style={[styles.logoContainer, { width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFF' }]}>
        <Image
          source={localOverride}
          style={{ width: imgSize, height: imgSize, borderRadius: imgRadius }}
          contentFit="contain"
          transition={0}
          cachePolicy="memory-disk"
          priority="high"
          recyclingKey={`logo-local-${ticker}`}
        />
      </View>
    );
  }

  // If both sources failed, show letter fallback
  if (primaryFailed && secondaryFailed) {
    return (
      <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: fallbackColor + '20' }]}>
        <Text style={[styles.fallbackText, { fontSize: size * 0.4, color: fallbackColor }]}>
          {ticker.charAt(0)}
        </Text>
      </View>
    );
  }

  // Try secondary URL if primary failed
  if (primaryFailed) {
    return (
      <View style={[styles.logoContainer, { width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFF' }]}>
        <Image
          source={{ uri: secondaryUrl }}
          style={{ width: imgSize, height: imgSize, borderRadius: imgRadius }}
          contentFit="contain"
          onError={() => { secondaryFailedCache.add(ticker); setSecondaryFailed(true); }}
          transition={0}
          cachePolicy="memory-disk"
          priority="high"
          recyclingKey={`logo-alt-${ticker}`}
        />
      </View>
    );
  }

  return (
    <View style={[styles.logoContainer, { width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFF' }]}>
      <Image
        source={{ uri: primaryUrl }}
        style={{ width: imgSize, height: imgSize, borderRadius: imgRadius }}
        contentFit="contain"
        onError={() => { primaryFailedCache.add(ticker); setPrimaryFailed(true); }}
        transition={0}
        cachePolicy="memory-disk"
        priority="high"
        recyclingKey={`logo-${ticker}`}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  logoContainer: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontWeight: '700' },
});
