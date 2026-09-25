import React from 'react';
import { View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { scannerStyles as styles } from './scannerStyles';

export function CaptureButton({
  onPress,
  disabled,
  showLock,
}: {
  onPress: () => void;
  disabled?: boolean;
  showLock?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
      style={({ pressed }) => [
        styles.captureOuter,
        pressed && { transform: [{ scale: 0.94 }] },
        disabled && { opacity: 0.6 },
      ]}
    >
      <View style={styles.captureRing} />
      <View style={styles.captureInner}>
        {showLock ? <MaterialIcons name="lock" size={22} color="#0A0E17" /> : null}
      </View>
    </Pressable>
  );
}
