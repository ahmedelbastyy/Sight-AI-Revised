import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { WebView } from 'react-native-webview';

const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export default function AppleEulaScreen() {
  const router = useRouter();
  const { currentTheme: t } = useApp();

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable style={[styles.backBtn, { backgroundColor: t.surface, borderColor: t.border }]} onPress={() => router.back()}>
          <MaterialIcons name="close" size={22} color={t.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Apple Standard EULA</Text>
        <View style={{ width: 40 }} />
      </View>
      <WebView
        source={{ uri: APPLE_EULA_URL }}
        style={{ flex: 1, backgroundColor: t.background }}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={t.primary} />
            <Text style={{ marginTop: 12, color: t.textSecondary, fontSize: 14 }}>Loading Apple EULA...</Text>
          </View>
        )}
        bounces={false}
        overScrollMode="never"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
