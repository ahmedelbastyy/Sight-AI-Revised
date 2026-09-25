import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, Platform, Linking, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { scannerStyles as styles } from './scannerStyles';

export function PermissionRequestView({
  canAskAgain,
  onRequest,
  insets,
  isSubscribed,
}: {
  canAskAgain: boolean;
  onRequest: () => Promise<any>;
  insets: any;
  isSubscribed: boolean;
}) {
  const [requesting, setRequesting] = useState(false);
  const openSettings = useCallback(() => {
    if (Platform.OS === 'ios') Linking.openURL('app-settings:').catch(() => {});
    else Linking.openSettings().catch(() => {});
  }, []);
  const handlePress = useCallback(async () => {
    Haptics.selectionAsync();
    if (!canAskAgain) {
      openSettings();
      return;
    }
    setRequesting(true);
    try { await onRequest(); } catch {}
    setRequesting(false);
  }, [canAskAgain, onRequest, openSettings]);

  return (
    <View style={[styles.scannerRoot, { paddingTop: insets.top, backgroundColor: '#0A0E17' }]}>
      <LinearGradient colors={['rgba(59,130,246,0.10)', 'transparent']} style={StyleSheet.absoluteFill} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <View style={styles.permIconCircle}>
          <MaterialIcons name="photo-camera" size={40} color="#3B82F6" />
        </View>
        <Text style={styles.permTitle}>Enable Camera Access</Text>
        <Text style={styles.permBody}>
          {isSubscribed
            ? 'Sight uses your camera to scan and analyze stock charts, trading screens, and financial documents right inside the app.'
            : 'Sight uses your camera to preview the intelligent chart scanner. Point your phone at a trading screen to see the AI detection outline in action.'}
        </Text>
        <Pressable style={styles.permBtn} onPress={handlePress} disabled={requesting}>
          {requesting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.permBtnText}>{canAskAgain ? 'Continue' : 'Open Settings'}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
