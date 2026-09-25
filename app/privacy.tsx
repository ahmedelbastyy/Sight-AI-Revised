import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentTheme: t } = useApp();

  const safeTop = insets.top > 0
    ? insets.top
    : (Platform.OS === 'ios' ? 47 : (StatusBar.currentHeight ?? 24));

  return (
    <View style={[styles.container, { backgroundColor: t.background, paddingTop: safeTop }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable style={[styles.backBtn, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color={t.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.lastUpdated, { color: t.textTertiary }]}>Last Updated: August 25, 2026</Text>

        <Text style={[styles.body, { color: t.textSecondary }]}>
          This Privacy Policy explains what personal data TradeSight (also branded as "Sight", "we", "us", or "our") collects when you use the TradeSight/Sight mobile application, related websites, notifications, and services (the "Service"), why we collect it, how we use it, and who we share it with. By using the Service, you consent to the practices described here.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>1. Who We Are</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          TradeSight/Sight is a technology-only informational app. TradeSight/Sight is not a broker-dealer, custodian, or registered investment adviser. TradeSight/Sight does not custody funds or securities.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>2. Information We Collect</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          <Text style={{ fontWeight: '600' }}>Account information:</Text> your email address, authentication tokens, subscription/entitlement state, profile settings, trading-password hash (if you set one), and app flags such as onboarding completion.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>App content you create:</Text> your watchlist, journal entries, active trades, Take Profit / Stop Loss levels, and notes. Chart images captured by the Chart Scanner are described separately below under "Chart Scanner images."{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Chart Scanner images:</Text> when you use the Chart Scanner, the image is uploaded to our secured backend and transmitted to third-party AI providers (currently OpenAI and Google Gemini) strictly to generate the on-screen analysis for that scan. Chart images are NOT used for advertising or profiling and are NOT retained beyond the processing needed to return the analysis. Do not scan images that contain personal information you do not want processed by these providers.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Brokerage connectivity data (via SnapTrade):</Text> when you connect a brokerage through SnapTrade, we receive from SnapTrade normalized snapshots of the accounts, positions, cash balances, and orders that SnapTrade returns to us. We NEVER receive or store your brokerage password or MFA codes. We store a SnapTrade "userSecret" that lets us fetch those snapshots on your behalf; this secret never leaves our secured backend and is not exposed to the mobile app.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Trading activity:</Text> orders you submit through the Service, order status returned by SnapTrade and your broker, and Sight-managed Take Profit / Stop Loss levels you configure. Order execution, fills, and settlement are handled by your brokerage — not by Sight and not by SnapTrade.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>AI analysis inputs:</Text> the ticker, current price context, and any images you submit are passed to third-party AI providers (currently OpenAI and Google Gemini) strictly to generate analysis. These inputs are not used by TradeSight/Sight for advertising or profiling.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Push notification tokens:</Text> your Expo push token so we can deliver AI Move alerts, price alerts, market-open / market-close alerts, and daily summaries even when the app is closed. Tokens are tied to the currently signed-in account and removed when you sign out or delete your account.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Device and diagnostic information:</Text> device type, OS version, app version, anonymous device identifier, and crash / diagnostic logs used only to keep the Service working.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Payments:</Text> subscription payments are processed by Apple through In-App Purchase. We do NOT receive your card number, bank details, or full billing information. RevenueCat provides us with entitlement and subscription state derived from Apple's receipts.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>3. How We Use Information</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          (a) Operate the Service and its features (charts, watchlist, AI Moves, notifications);{'\n'}
          (b) Authenticate you and manage your account and subscription entitlements;{'\n'}
          (c) Retrieve your brokerage snapshots through SnapTrade and display them inside the app;{'\n'}
          (d) Submit orders you initiate to your brokerage through SnapTrade;{'\n'}
          (e) Generate AI-assisted market analysis via third-party AI providers;{'\n'}
          (f) Deliver push notifications you have opted into;{'\n'}
          (g) Diagnose and fix problems, prevent abuse, and comply with legal obligations.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>4. Third Parties We Rely On</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          We share the minimum information necessary with the following third parties. Each provider has its own privacy policy which governs how they handle your data. TradeSight/Sight is not responsible for their acts or omissions.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Apple Inc.</Text> — App Store distribution, subscription billing via In-App Purchase, and push notification delivery via APNs. Apple's terms and privacy policy apply to those services.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>RevenueCat</Text> — subscription entitlement and receipt management.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>SnapTrade (Passiv Technologies Inc.)</Text> — brokerage connectivity, account snapshots, and order routing. SnapTrade handles the login flow with your brokerage; TradeSight/Sight never receives your broker password.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Your Brokerage</Text> — your account, orders, funds, and holdings stay at your brokerage. Your brokerage's privacy policy and account agreement govern that relationship.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Supabase</Text> — backend hosting, authentication, and encrypted storage of app data.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Expo Push Service</Text> — push notification delivery infrastructure.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Market-data and financial-information providers</Text> (such as Yahoo Finance, Finnhub, and similar services) — quotes, charts, and reference data. Data may be delayed, incomplete, or subject to third-party restrictions.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>AI and machine-learning providers</Text> (such as OpenAI, Google Gemini, and similar large-language-model / vision-model providers) — process ticker, price, and optional chart images you submit to generate AI Moves and chart-pattern analysis. TradeSight/Sight does not authorize these providers to use your inputs for model training.{'\n\n'}
          We do NOT sell your personal information, do NOT use it for third-party targeted advertising, and do NOT combine it with data from data brokers.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>5. Data We Do Not Collect</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          We do not collect your brokerage password, your bank details, your government ID, your location (unless you explicitly submit it in content), your contacts, your photo library, or arbitrary files from your device. Chart images you voluntarily submit for AI analysis are the only images we process, and they are not retained after processing.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>6. Notifications</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Push notifications are delivered on a best-effort basis via Apple Push Notification service through Expo. Delivery is subject to Apple, your operating system, your network, and third-party push infrastructure. Notifications are informational only and are not investment advice. You can disable notifications from your device settings at any time.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>7. Data Retention & Account Deletion</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          We retain account and app-content data for as long as your account is active. You can permanently delete your Sight account at any time from Settings › Delete Account. When you delete your account, TradeSight/Sight erases your profile, watchlist, journal, active trades, notification preferences, push tokens, and brokerage connection metadata, and revokes and deletes your SnapTrade user record so no orphaned brokerage authorization remains on the aggregator side. Deletion does NOT close, sell, or otherwise affect any position, cash, or account at your brokerage — Sight only removes its own access. Deletion also does NOT cancel any auto-renewing App Store subscription — Apple controls subscription billing and you must cancel it separately from Settings › Apple ID › Subscriptions on your device. Some aggregated or anonymized information may be retained for analytics, security, and legal-compliance purposes.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>8. Your Rights</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Depending on your jurisdiction, you may have the right to access, correct, delete, port, or restrict processing of your personal data, and to object to certain processing. You can delete your account and associated data from within the app. To exercise any other right, contact us at tradesightt@gmail.com.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>9. Security</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Data is stored on secured infrastructure with encryption in transit and at rest. Access to sensitive credentials such as your SnapTrade userSecret is restricted to server-side edge functions. No system is 100% secure and we cannot guarantee absolute security.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>10. Children</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          The Service is not intended for individuals under 18. We do not knowingly collect personal information from anyone under 18. If you believe we have collected such information, contact us at tradesightt@gmail.com and we will promptly delete it.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>11. International Data Transfers</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Your information may be processed in countries other than your country of residence, including the United States. By using the Service you consent to such transfers, subject to appropriate safeguards where required by law.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>12. Third-Party Reliability Disclaimer</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Financial and market information displayed by the Service, including AI-generated analysis, is provided for informational purposes only and is not guaranteed to be accurate, complete, timely, or free of errors. Third-party providers — including brokerages, SnapTrade, AI providers, and market-data providers — can experience outages, incorrect data, and other issues that may affect the Service. TradeSight/Sight makes no representation or warranty regarding third-party services and disclaims responsibility for their acts, omissions, and content to the fullest extent permitted by law.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>13. Changes to This Policy</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          We may update this Privacy Policy from time to time. Material updates will be reflected by changing the "Last Updated" date at the top of this document. Continued use of the Service after changes take effect constitutes acceptance of the updated Policy.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>14. Apple Licensed Application End User License Agreement</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          This application is licensed to you under Apple's Standard End-User License Agreement (EULA). You can review the full terms here:
        </Text>
        <Pressable
          style={[styles.eulaLink, { backgroundColor: t.primary + '12', borderColor: t.primary + '30' }]}
          onPress={() => router.push('/apple-eula' as any)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <MaterialIcons name="description" size={18} color={t.primary} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: t.primary }}>View Apple Standard EULA</Text>
          <MaterialIcons name="arrow-forward-ios" size={14} color={t.primary} />
        </Pressable>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>15. Contact Us</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Questions, concerns, or requests regarding this Privacy Policy can be sent to:
        </Text>
        <Text style={[styles.body, { color: t.textSecondary, marginTop: 8 }]}>
          Email: tradesightt@gmail.com
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  lastUpdated: { fontSize: 13, marginBottom: 20, fontWeight: '500' },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: 24, marginBottom: 10 },
  body: { fontSize: 14, lineHeight: 22 },
  eulaLink: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 14, borderWidth: 1, marginTop: 12, marginBottom: 8 },
});
