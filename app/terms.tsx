import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';

export default function TermsScreen() {
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
        <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Terms of Use</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.lastUpdated, { color: t.textTertiary }]}>Last Updated: August 25, 2026</Text>

        <Text style={[styles.body, { color: t.textSecondary }]}>
          These Terms of Use ("Terms") form a binding agreement between you and TradeSight (also branded as "Sight", "we", "us", or "our") and govern your use of the TradeSight/Sight mobile application, related websites, notifications, and any related services (collectively, the "Service"). Please read them carefully. By downloading, installing, opening, or otherwise using the Service, you agree to be bound by these Terms. If you do not agree, do not use the Service.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>1. Who We Are and What the Service Is</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          TradeSight/Sight is an informational, technology-only mobile application that provides AI-assisted market analysis, price and chart data, chart-pattern detection, journaling tools, watchlists, and optional connectivity to third-party brokerages for read and trade access.{'\n\n'}
          TradeSight/Sight is NOT a broker-dealer, investment adviser, financial adviser, tax adviser, custodian, exchange, alternative trading system, transfer agent, or clearing firm, and does not hold, custody, or route customer funds, securities, or crypto-assets. TradeSight/Sight does not provide personalized investment advice, and nothing in the Service is a solicitation or offer to buy or sell any security.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>2. Informational Use Only – No Financial, Legal, or Tax Advice</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          All content in the Service — including AI-generated "AI Moves", chart interpretations, trend commentary, notifications, journal entries, watchlist prompts, price levels, screening ideas, videos, images, and text (collectively, "Content") — is provided for informational and educational purposes only. It is NOT a recommendation to buy, sell, hold, or refrain from trading any security, derivative, crypto-asset, or other financial instrument, and it is NOT financial, legal, tax, or accounting advice.{'\n\n'}
          You are solely responsible for evaluating any Content and for any decisions you make. You should consult a qualified, licensed professional before acting on any information you see in the Service.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>3. AI Content – Reliability Disclaimer</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          TradeSight/Sight uses artificial intelligence models (including large language models and technical-screening algorithms) provided by third parties to generate market analysis, "AI Moves", chart interpretations, and other outputs. AI output can be inaccurate, incomplete, out-of-date, biased, or otherwise unreliable. No AI system is 100% accurate.{'\n\n'}
          TradeSight/Sight does NOT guarantee the accuracy, completeness, timeliness, fitness for a particular purpose, or reliability of any AI output, and does NOT guarantee any specific trading, investment, or financial outcome from using the Service. Historical performance, hypothetical performance, and AI predictions do not guarantee future results.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>4. Trading Risk Disclosure</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Trading and investing involve substantial risk of loss and are not suitable for every person. You can lose some or all of your capital. Short selling, leverage, margin, options, futures, and crypto-assets can involve unlimited or amplified loss. Market data may be delayed, incorrect, or unavailable at any time. Push notifications, price levels, and Take Profit / Stop Loss indicators may not arrive in real time and are not guaranteed to trigger any particular broker action. You accept full responsibility for any decision you make while using the Service.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>5. Brokerage Connectivity via SnapTrade</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          The Service offers optional brokerage connectivity through SnapTrade, a third-party account-aggregation and order-routing service operated by Passiv Technologies Inc. and its affiliates ("SnapTrade"). When you connect a brokerage account:{'\n\n'}
          (a) Your brokerage account remains at your brokerage. TradeSight/Sight does not hold or custody your assets and does not become a party to your brokerage relationship.{'\n'}
          (b) SnapTrade handles the login flow and authorization with your brokerage. TradeSight/Sight does not receive, store, or transmit your brokerage password.{'\n'}
          (c) TradeSight/Sight receives normalized, read-only snapshots of your accounts, positions, balances, and (when you authorize a trading connection) the ability to submit orders on your behalf.{'\n'}
          (d) Order execution, trade settlement, custody, margin, tax reporting, corporate actions, dividends, statements, and account access are all handled by your brokerage — not TradeSight/Sight and not SnapTrade.{'\n'}
          (e) Your use of SnapTrade is governed by SnapTrade's own terms and privacy policy. Your brokerage relationship is governed by your brokerage's account agreement. TradeSight/Sight is not responsible for any acts, omissions, downtime, restrictions, connection failures, revoked authorizations, or errors of SnapTrade, your brokerage, or any of their upstream providers.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>6. Orders, Fills, and Sight-Managed Exits</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Any order you submit through the Service is transmitted through SnapTrade to the brokerage account you selected. TradeSight/Sight does not execute or match orders itself. Orders are not guaranteed to be accepted, filled, filled at any particular price, or unrejected by your broker or the applicable market. Take Profit and Stop Loss levels stored in the Service are monitored by TradeSight/Sight and are not broker-native bracket orders unless your broker explicitly supports them; any Sight-managed exit is best-effort and depends on TradeSight/Sight, SnapTrade, your device, your network, market data, and your broker all functioning correctly at the moment the level is reached.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>7. Third-Party Services and Data</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          The Service relies on multiple third-party providers. TradeSight/Sight does not control these providers and is not responsible for their acts, omissions, outages, restrictions, or content, including any errors, delays, or inaccuracies in the data or services they provide. These providers include, among others:{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Apple Inc.</Text> — App Store distribution, In-App Purchase billing, push notification delivery via APNs, and the operating system your device runs. Your use of the Service is also subject to Apple's own terms and policies, including Apple's Standard End-User License Agreement.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>SnapTrade</Text> — brokerage connectivity, account snapshots, and order routing (see Section 5).{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Market-data and financial-information providers</Text> (such as Yahoo Finance, Finnhub, and similar services) — quotes, charts, fundamentals, and news headlines. These providers may impose their own delays, restrictions, and data-quality limitations. TradeSight/Sight makes no warranty as to the accuracy, timeliness, or completeness of any market data displayed.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>AI and machine-learning providers</Text> (such as OpenAI, Google Gemini, and similar large-language-model / vision-model providers) — power AI Moves and chart-pattern analysis. TradeSight/Sight relies on their outputs "as delivered" and does not independently verify every response.{'\n\n'}
          <Text style={{ fontWeight: '600' }}>Backend, storage, and analytics providers</Text> (such as Supabase, RevenueCat, and Expo Push Service) — power authentication, entitlement management, and notification delivery.{'\n\n'}
          Your reliance on any third-party service or data is at your own risk. TradeSight/Sight expressly disclaims liability for any decision you make based on third-party data or third-party services.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>8. Subscriptions, Trials, Renewals, and Cancellation</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Access to the Service requires a paid subscription purchased through Apple In-App Purchase. As of the "Last Updated" date, the plans are Sight Weekly ($2.99 per week) and Sight Pro ($17.99 per month). Where offered and where you are eligible, Apple may present an introductory 3-day free trial for Sight Pro. Eligibility for any introductory offer is determined by Apple. Sight Weekly does not include a free trial. Prices displayed inside the app are the localized prices returned by the App Store at the time you view the paywall; the price the App Store presents at checkout controls.{'\n\n'}
          Subscriptions renew automatically at the then-current price at the end of each billing period (weekly for Sight Weekly, monthly for Sight Pro) unless cancelled at least 24 hours before the end of the current period. You can cancel at any time in Settings &gt; Apple ID &gt; Subscriptions on your iOS device. Refunds are handled by Apple; TradeSight/Sight cannot issue refunds. Restoring purchases via the "Restore Purchases" option requires signing in with the Apple ID used to make the original purchase. Prices, plans, and offering names may change; the price shown at time of purchase controls.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>9. Notifications and Reviews</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          The Service may send push notifications for AI Moves, market events, daily summaries, price movements, and account activity. Notifications are informational only, not investment advice, and are not guaranteed to arrive in real time or at all. Delivery is subject to Apple, your operating system, your network, and third-party push infrastructure. You may control notifications from your device settings. The Service may also, at Apple's discretion and rate limits, request that you rate the app; you may decline at any time.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>10. Acceptable Use</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          You agree not to (a) use the Service in any way that violates applicable law or another person's rights; (b) copy, sell, distribute, or reverse-engineer the Service; (c) attempt to bypass authentication, subscription, or security controls; (d) use the Service to conduct market manipulation, spoofing, layering, or any illegal trading; or (e) misuse or overload the Service's infrastructure. We may suspend or terminate your access at any time if we believe you have violated these Terms.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>11. Warranty Disclaimer</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          THE SERVICE AND ALL CONTENT ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY, COMPLETENESS, TIMELINESS, RELIABILITY, TITLE, OR NON-INFRINGEMENT. TRADESIGHT/SIGHT MAKES NO WARRANTY THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR VIRUS-FREE. USE OF THE SERVICE IS AT YOUR SOLE RISK.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>12. Limitation of Liability</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, TRADESIGHT/SIGHT AND ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, LICENSORS, AND SUPPLIERS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES, INCLUDING WITHOUT LIMITATION LOST PROFITS, LOST TRADING OR INVESTMENT OPPORTUNITIES, TRADING OR INVESTMENT LOSSES, LOSS OF DATA, LOSS OF GOODWILL, OR ANY DAMAGES ARISING FROM (a) your use of or inability to use the Service; (b) reliance on any Content or AI output; (c) any act, omission, outage, or error of Apple, SnapTrade, your brokerage, any market-data provider, any AI provider, any push provider, or any other third party; (d) delayed, missing, incorrect, or unavailable market data, quotes, or notifications; or (e) any trading, investment, or financial decision you make while using the Service. TO THE EXTENT LIABILITY CANNOT BE FULLY DISCLAIMED, IT IS LIMITED TO THE GREATER OF (i) THE AMOUNT YOU PAID TRADESIGHT/SIGHT IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (ii) US $50. Nothing in these Terms limits liability that cannot lawfully be limited under applicable law.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>13. Indemnification</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          You agree to defend, indemnify, and hold harmless TradeSight/Sight, its affiliates, and their respective officers, directors, employees, agents, and licensors from and against any and all claims, damages, obligations, losses, liabilities, costs, or debt, and expenses (including but not limited to attorney's fees) arising from (a) your use of and access to the Service; (b) your violation of these Terms; (c) your violation of any third-party right, including any right of privacy or intellectual property; or (d) any trading or financial decision you make while using the Service.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>14. Intellectual Property</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          The Service, including all software, design, branding, logos, and Content generated by TradeSight/Sight, is owned by TradeSight/Sight or its licensors and is protected by copyright, trademark, and other laws. You are granted a limited, revocable, non-exclusive, non-transferable license to use the Service for your personal, non-commercial use, subject to these Terms.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>15. Account, Termination, and Data</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          You may delete your TradeSight/Sight account from within the app. Deleting your account terminates your access, removes your TradeSight/Sight profile data, and disconnects and deletes any linked SnapTrade user record so no orphaned brokerage authorization remains on the aggregator side. Retention and processing of personal data is described in our Privacy Policy.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>16. Governing Law and Disputes</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          These Terms are governed by the laws of the United States and, where applicable, the state in which TradeSight/Sight is headquartered, without regard to conflict-of-laws rules. Any dispute arising out of or relating to these Terms or the Service will be resolved through binding individual arbitration on a non-class basis, unless prohibited by applicable law. You waive any right to a jury trial or to participate in a class action to the extent permitted by law.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>17. Apple-Specific Terms</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          You acknowledge that these Terms are between you and TradeSight/Sight, not with Apple. Apple has no obligation to furnish maintenance or support for the Service. Apple is not responsible for addressing any claims relating to the Service or your possession or use of it, including product-liability claims, claims that the Service fails to conform to any applicable legal or regulatory requirement, and claims arising under consumer-protection or similar legislation. In the event of any third-party claim that the Service or your use of it infringes intellectual-property rights, Apple is not responsible for the investigation, defense, settlement, or discharge of that claim. Apple and Apple's subsidiaries are third-party beneficiaries of these Terms and may enforce them against you.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>18. Changes to These Terms</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          TradeSight/Sight may modify these Terms at any time. Material changes will be reflected by updating the "Last Updated" date at the top of this document. Continued use of the Service after changes take effect constitutes acceptance of the updated Terms.
        </Text>

        <Text style={[styles.sectionTitle, { color: t.textPrimary }]}>19. Contact</Text>
        <Text style={[styles.body, { color: t.textSecondary }]}>
          Questions or requests regarding these Terms can be sent to:
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
});
