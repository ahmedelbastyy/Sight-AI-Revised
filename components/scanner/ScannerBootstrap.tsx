/**
 * ScannerBootstrapView — shown while expo-camera is being lazily loaded, or
 * if the load failed. Session 205 — the layout matches PermissionRequestView
 * EXACTLY, including a functional-looking Continue button, so users never
 * see a loading state before the Enable Camera Access page. If the camera
 * module is still loading when the user taps Continue, the button shows a
 * small spinner and the real PermissionRequestView takes over the instant
 * the module finishes loading (which is usually before the user can even
 * tap). Combined with the eager preload in upload.tsx, this makes the
 * camera tab feel instantly interactive.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { scannerStyles as styles } from './scannerStyles';

export function ScannerBootstrapView({
  loading,
  failed,
  insets,
}: {
  loading: boolean;
  failed: boolean;
  insets: any;
}) {
  const [pending, setPending] = useState(false);
  const handleContinue = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    setPending(true);
    // No-op beyond the visual spinner — the camera module load is
    // already in flight. Once it resolves, ScannerContent takes over and
    // renders PermissionRequestView with the real Continue button.
  }, []);
  return (
    <View style={[styles.scannerRoot, { paddingTop: insets.top, backgroundColor: '#0A0E17' }]}>
      <LinearGradient colors={['rgba(59,130,246,0.10)', 'transparent']} style={StyleSheet.absoluteFill} />
      {failed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={[styles.permIconCircle, { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.3)' }]}>
            <MaterialIcons name="camera-alt" size={40} color="#EF4444" />
          </View>
          <Text style={styles.permTitle}>Scanner Unavailable</Text>
          <Text style={styles.permBody}>
            The camera module couldn't be loaded on this device. Please make sure the app is up to date and try restarting.
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={styles.permIconCircle}>
            <MaterialIcons name="photo-camera" size={40} color="#3B82F6" />
          </View>
          <Text style={styles.permTitle}>Enable Camera Access</Text>
          <Text style={styles.permBody}>
            Sight uses your camera to scan and analyze stock charts, trading screens, and financial documents right inside the app.
          </Text>
          <Pressable style={styles.permBtn} onPress={handleContinue} disabled={pending}>
            {pending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.permBtnText}>Continue</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}
