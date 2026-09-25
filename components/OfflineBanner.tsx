import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';

const BANNER_HEIGHT = 36;
const MESSAGES = [
  'You are offline',
  'Data shown is from your last session',
  'Some features require internet',
  'Connect to update stock prices',
];

interface OfflineBannerProps {
  onStatusChange?: (isOffline: boolean) => void;
}

export function useNetworkStatus() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
    });
    // Initial check
    NetInfo.fetch().then(state => {
      const offline = !(state.isConnected && state.isInternetReachable !== false);
      setIsOffline(offline);
    });
    return () => unsubscribe();
  }, []);

  return isOffline;
}

export function OfflineBanner({ onStatusChange }: OfflineBannerProps) {
  const isOffline = useNetworkStatus();
  const slideAnim = useRef(new Animated.Value(-BANNER_HEIGHT)).current;
  const scrollX = useRef(new Animated.Value(0)).current;
  const [screenWidth, setScreenWidth] = useState(Dimensions.get('window').width);

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setScreenWidth(window.width));
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    onStatusChange?.(isOffline);
  }, [isOffline, onStatusChange]);

  // Slide in/out
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isOffline ? 0 : -BANNER_HEIGHT,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isOffline]);

  // Scrolling carousel animation
  useEffect(() => {
    if (!isOffline) return;
    const totalWidth = MESSAGES.length * screenWidth;
    const anim = Animated.loop(
      Animated.timing(scrollX, {
        toValue: -totalWidth,
        duration: MESSAGES.length * 6000,
        useNativeDriver: true,
      })
    );
    scrollX.setValue(0);
    anim.start();
    return () => anim.stop();
  }, [isOffline, screenWidth]);

  if (!isOffline) return null;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.inner}>
        <MaterialIcons name="wifi-off" size={14} color="#FFF" style={{ marginRight: 6 }} />
        <View style={styles.carouselMask}>
          <Animated.View
            style={[
              styles.carouselTrack,
              {
                width: MESSAGES.length * screenWidth,
                transform: [{ translateX: scrollX }],
              },
            ]}
          >
            {MESSAGES.map((msg, i) => (
              <View key={i} style={[styles.messageSlot, { width: screenWidth - 60 }]}>
                <Text style={styles.messageText} numberOfLines={1}>{msg}</Text>
              </View>
            ))}
            {/* Repeat first few for seamless loop */}
            {MESSAGES.slice(0, 2).map((msg, i) => (
              <View key={`dup-${i}`} style={[styles.messageSlot, { width: screenWidth - 60 }]}>
                <Text style={styles.messageText} numberOfLines={1}>{msg}</Text>
              </View>
            ))}
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BANNER_HEIGHT,
    backgroundColor: '#DC2626',
    zIndex: 10000,
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  carouselMask: {
    flex: 1,
    overflow: 'hidden',
    height: BANNER_HEIGHT,
    justifyContent: 'center',
  },
  carouselTrack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  messageSlot: {
    justifyContent: 'center',
  },
  messageText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
