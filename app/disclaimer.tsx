import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { config } from '../constants/config';

export default function DisclaimerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { acceptDisclaimer, hasAcceptedDisclaimer, dontShowDisclaimer, currentTheme: t, userFlagsLoaded } = useApp();

  // Session 151 — disclaimer text is ~50% bigger for readability. Sizes
  // still scale to the device height (baseline 780) so the content fits
  // without scrolling on every screen size. Paddings shrink proportionally
  // so the larger typography doesn't overflow.
  const [dims, setDims] = useState(Dimensions.get('window'));
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDims(window));
    return () => sub?.remove();
  }, []);
  const scale = Math.max(0.9, Math.min(1.3, dims.height / 780));
  const cardPad = Math.round(11 * scale);
  const cardGap = Math.round(9 * scale);
  const titleSize = Math.round(22 * scale);
  const cardTitleSize = Math.round(17 * scale);
  const bodySize = Math.max(16, Math.round(18 * scale));
  const bodyLine = Math.round(bodySize * 1.35);
  const bulletSize = Math.max(15, Math.round(17 * scale));
  const btnHeight = Math.round(50 * scale);
  const btnText = Math.round(16 * scale);
  const headerPad = Math.round(9 * scale);
  const footerPad = Math.round(8 * scale);

  // Safety: if disclaimer already accepted, redirect back to index
  const alreadyAccepted = hasAcceptedDisclaimer || dontShowDisclaimer;

  React.useEffect(() => {
    if (userFlagsLoaded && alreadyAccepted) {
      router.replace('/');
    }
  }, [alreadyAccepted, userFlagsLoaded]);

  if (alreadyAccepted) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
        <Image source={require('../assets/images/app-icon-splash.png')} style={{ width: 180, height: 180, borderRadius: 36 }} contentFit="contain" />
      </View>
    );
  }

  if (!userFlagsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000000' }}>
        <Image source={require('../assets/images/app-icon-splash.png')} style={{ width: 180, height: 180, borderRadius: 36 }} contentFit="contain" />
      </View>
    );
  }

  const handleAccept = () => {
    Haptics.selectionAsync();
    acceptDisclaimer(true);
    // Session 145 — smoother transition: route DIRECTLY to the next step
    // in the onboarding chain (paywall) via the index gate. The
    // image-intro carousel has been removed from the mandatory onboarding
    // flow (deferred for later use).
    router.replace('/' as any);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { paddingVertical: headerPad }]}>
        <MaterialIcons name="gavel" size={Math.round(22 * scale)} color={t.primary} />
        <Text style={[styles.title, { color: t.textPrimary, fontSize: titleSize }]}>Legal Disclaimer</Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 20, gap: cardGap }}>
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, padding: cardPad }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Math.round(8 * scale) }}>
            <MaterialIcons name="warning" size={Math.round(18 * scale)} color="#F59E0B" />
            <Text style={[styles.warningText, { color: '#F59E0B', fontSize: bodySize }]}>Important Information</Text>
          </View>
          <Text style={[styles.disclaimerText, { color: t.textSecondary, fontSize: bodySize, lineHeight: bodyLine }]}>{config.disclaimer}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border, padding: cardPad }]}>
          <Text style={[styles.cardTitle, { color: t.textPrimary, fontSize: cardTitleSize, marginBottom: Math.round(6 * scale) }]}>By using this app, you acknowledge:</Text>
          {[
            'This is not financial advice',
            'Past performance does not guarantee future results',
            'You may lose money on investments',
            'Always consult a qualified financial advisor',
            'AI predictions are not guaranteed',
          ].map((item, i) => (
            <View key={i} style={[styles.bulletRow, { marginBottom: Math.round(5 * scale) }]}>
              <MaterialIcons name="check-circle" size={Math.round(15 * scale)} color={t.primary} />
              <Text style={[styles.bulletText, { color: t.textSecondary, fontSize: bulletSize, lineHeight: Math.round(bulletSize * 1.35) }]}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + footerPad, paddingTop: footerPad }]}>
        <TouchableOpacity activeOpacity={0.7} style={[styles.acceptBtn, { backgroundColor: t.primary, height: btnHeight }]} onPress={handleAccept}>
          <Text style={[styles.acceptBtnText, { fontSize: btnText }]}>I Understand & Accept</Text>
          <MaterialIcons name="arrow-forward" size={Math.round(18 * scale)} color="#FFF" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 10 },
  title: { fontSize: 18, fontWeight: '700' },
  card: { borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 10, maxWidth: 560, alignSelf: 'center', width: '100%' },
  cardTitle: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  warningText: { fontSize: 12, fontWeight: '700' },
  disclaimerText: { fontSize: 12, lineHeight: 17 },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  bulletText: { fontSize: 12, flex: 1, lineHeight: 16 },

  footer: { paddingHorizontal: 20, paddingTop: 8, maxWidth: 560, alignSelf: 'center', width: '100%' },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 12, gap: 8 },
  acceptBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});
