import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView, Keyboard, Pressable,
  findNodeHandle, InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/template';
import { useAlert } from '@/template';
import { useLaunchState } from '../contexts/LaunchContext';

const supabase = getSupabaseClient();

interface TradingPasswordGateProps {
  children: React.ReactNode;
  userEmail: string;
  userId: string;
  isUnlocked: boolean;
  onUnlock: () => void;
}

export function TradingPasswordGate({ children, userEmail, userId, isUnlocked, onUnlock }: TradingPasswordGateProps) {
  const { showAlert } = useAlert();
  const { sendOTP, verifyOTPAndLogin } = useAuth();
  // Session 172 — reads launchSequenceComplete from the root LaunchContext
  // so autofocus / keyboard reveal is deferred until the animated
  // WelcomeLaunch overlay has actually dismissed. Prevents the keyboard
  // from flashing behind the launch on fast devices or being visible
  // through a partially rendered destination.
  const { launchSequenceComplete } = useLaunchState();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [storedPassword, setStoredPassword] = useState<string | null>(null);

  // Reset mode
  const [resetMode, setResetMode] = useState(false);
  const [resetStep, setResetStep] = useState<'sendCode' | 'verifyCode' | 'newPassword'>('sendCode');
  const [otpCode, setOtpCode] = useState(['', '', '', '']);
  const [resetNewPw, setResetNewPw] = useState('');
  const [resetConfirmPw, setResetConfirmPw] = useState('');
  const [canResend, setCanResend] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  // Refs for keyboard-aware scroll behavior. When any input is focused,
  // we measure its position and scroll the containing ScrollView so the
  // input stays comfortably above the keyboard on every device size.
  const passwordInputRef = useRef<TextInput | null>(null);
  const newPwInputRef = useRef<TextInput | null>(null);
  const confirmPwInputRef = useRef<TextInput | null>(null);
  const unlockScrollRef = useRef<ScrollView | null>(null);
  const resetScrollRef = useRef<ScrollView | null>(null);

  // Session 172 — autofocus is EVENT-DRIVEN, not timer-driven.
  //
  // Waits for launchSequenceComplete to flip true (fired by the root
  // when WelcomeLaunch dismisses), then uses InteractionManager to let
  // any in-flight animations settle, then a single requestAnimationFrame
  // ensures focus happens on the very next paint. No 450ms guess, no
  // race with the launch overlay, keyboard cannot flash behind splash.
  useEffect(() => {
    if (isUnlocked) return;
    if (hasPassword !== true) return;
    if (!launchSequenceComplete) return;
    const task = InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        try { passwordInputRef.current?.focus(); } catch { /* swallow */ }
      });
    });
    return () => {
      try { task.cancel(); } catch { /* swallow */ }
    };
  }, [isUnlocked, hasPassword, launchSequenceComplete]);

  // Generic keyboard-aware scroll-to-input. Used for trading password,
  // new password, confirm password — and is the canonical pattern that
  // should be reused by any future text input in the app.
  //
  // The offset (3rd arg to scrollResponderScrollNativeHandleToKeyboard) is
  // intentionally large (200px) so the focused input is pushed well above
  // the keyboard with comfortable breathing room on every device size. The
  // value is dynamic: the OS already knows the keyboard height, this offset
  // tells the responder "reserve N pts of space between the input and the
  // keyboard top". 200px guarantees the entire input + label is visible
  // even on devices with smaller keyboards (iPhone SE) and larger ones (Pro Max).
  const scrollInputIntoView = useCallback((
    inputRef: React.RefObject<TextInput | null>,
    scrollRefToUse: React.RefObject<ScrollView | null>,
  ) => {
    setTimeout(() => {
      if (!inputRef.current || !scrollRefToUse.current) return;
      const handle = findNodeHandle(inputRef.current);
      if (!handle) return;
      // Native scroll responder can position the input above the keyboard
      // with a configurable offset — preferred path on iOS.
      // @ts-ignore — getScrollResponder exists at runtime
      const sr = scrollRefToUse.current.getScrollResponder?.();
      if (sr?.scrollResponderScrollNativeHandleToKeyboard) {
        sr.scrollResponderScrollNativeHandleToKeyboard(handle, 200, true);
        return;
      }
      // Fallback: measure the input's screen position and scroll so it
      // sits ~80px from the top, leaving comfortable room above the keyboard.
      try {
        inputRef.current.measureInWindow((x, y) => {
          const targetY = Math.max(0, y - 80);
          scrollRefToUse.current?.scrollTo({ y: targetY, animated: true });
        });
      } catch {}
    }, Platform.OS === 'ios' ? 250 : 350);
  }, []);

  // Session 170 — fail-CLOSED design. This is a real-money app: if we cannot
  // reach the backend to determine whether a trading password exists we do
  // NOT auto-unlock. The user is shown a Retry button and the gate stays
  // locked. Previously the code called onUnlock() after 3 failed retries,
  // which was a fail-OPEN vulnerability — anyone with network interference
  // could bypass the trading password. That path has been removed.
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 3;

    const check = async () => {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select('trading_password')
          .eq('id', userId)
          .single();
        if (cancelled) return;
        if (error) throw error;
        if (data?.trading_password) {
          setStoredPassword(data.trading_password);
          setHasPassword(true);
          setLookupError(null);
          // Do NOT call onUnlock - user must enter password
        } else {
          setHasPassword(false);
          setLookupError(null);
          onUnlock(); // Confirmed no password set — safe to unlock
        }
      } catch (e: any) {
        if (cancelled) return;
        retryCount++;
        if (retryCount < maxRetries) {
          setTimeout(check, 2000);
        } else {
          // FAIL-CLOSED. Surface a retryable error state and keep the
          // gate locked. NEVER call onUnlock() on lookup failure.
          setLookupError(e?.message ?? 'Unable to verify your trading password. Please check your connection and try again.');
        }
      }
    };
    check();
    return () => { cancelled = true; };
  }, [userId, retryToken]);

  // Resend timer
  useEffect(() => {
    if (!resetMode || resetStep !== 'verifyCode' || canResend) return;
    if (resendTimer <= 0) { setCanResend(true); return; }
    const timer = setTimeout(() => setResendTimer(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendTimer, resetMode, resetStep, canResend]);

  // Fail-closed error state — shows Retry button, never auto-unlocks.
  if (lookupError && hasPassword === null) {
    return (
      <View style={[styles.container, { backgroundColor: '#050B1F' }]}>
        <LinearGradient colors={['rgba(59,130,246,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={styles.lockCircle}>
            <MaterialIcons name="wifi-off" size={36} color="#EF4444" />
          </View>
          <Text style={styles.title}>Cannot Verify</Text>
          <Text style={[styles.subtitle, { paddingHorizontal: 16 }]}>{lookupError}</Text>
          <TouchableOpacity activeOpacity={0.7}
            style={[styles.primaryBtn, { maxWidth: 360 }]}
            onPress={() => { setLookupError(null); setRetryToken(v => v + 1); Haptics.selectionAsync(); }}>
            <Text style={styles.primaryBtnText}>Retry</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  if (hasPassword === null) {
    // Still checking — render nothing. Root layout has already handed off
    // from native splash to WelcomeLaunch, so users see the animated
    // splash background instead of a flash.
    return null;
  }

  // If no password is set OR already unlocked, pass through.
  if (isUnlocked || hasPassword === false) {
    return <>{children}</>;
  }

  const handleUnlock = async () => {
    if (!password.trim()) return;
    Keyboard.dismiss();
    setLoading(true);
    if (storedPassword === password) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onUnlock();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Incorrect Password', 'The trading password you entered is incorrect.');
      setPassword('');
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setResetMode(true);
    setResetStep('sendCode');
  };

  const handleSendResetCode = async () => {
    if (!userEmail) {
      showAlert('No Email', 'No email associated with your account.');
      return;
    }
    setLoading(true);
    const { error } = await sendOTP(userEmail);
    if (error) {
      showAlert('Failed', error);
    } else {
      setResetStep('verifyCode');
      setCanResend(false);
      setResendTimer(30);
    }
    setLoading(false);
  };

  const handleVerifyResetCode = async () => {
    const code = otpCode.join('');
    if (code.length < 4) {
      showAlert('Incomplete', 'Enter the full 4-digit code.');
      return;
    }
    setLoading(true);
    // Verify OTP with password to maintain session without disrupting trading password gate
    // Pass the existing password so the session stays valid but gate remains locked
    const { error } = await verifyOTPAndLogin(userEmail, code, { password: storedPassword || undefined });
    if (error) {
      showAlert('Invalid Code', error);
      setOtpCode(['', '', '', '']);
      otpRefs.current[0]?.focus();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResetStep('newPassword');
    }
    setLoading(false);
  };

  const handleSetNewResetPassword = async () => {
    if (resetNewPw.length < 4) {
      showAlert('Too Short', 'Password must be at least 4 characters.');
      return;
    }
    if (resetNewPw !== resetConfirmPw) {
      showAlert('Mismatch', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    await supabase.from('user_profiles').update({ trading_password: resetNewPw }).eq('id', userId);
    setStoredPassword(resetNewPw);
    setLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Password Updated', 'Your trading password has been reset. Please enter your new password to continue.');
    // After resetting, go back to unlock mode - user must enter new password
    setResetMode(false);
    setResetStep('sendCode');
    setOtpCode(['', '', '', '']);
    setResetNewPw('');
    setResetConfirmPw('');
    setPassword('');
    // Do NOT call onUnlock() - user must still enter the new password to get in
  };

  const handleRemovePassword = async () => {
    showAlert('Remove Trading Password', 'Are you sure? This will remove the password and unlock the app.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setLoading(true);
          await supabase.from('user_profiles').update({ trading_password: null }).eq('id', userId);
          setStoredPassword(null);
          setHasPassword(false);
          setLoading(false);
          onUnlock();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
      },
    ]);
  };

  const handleResendCode = async () => {
    if (!canResend) return;
    setLoading(true);
    const { error } = await sendOTP(userEmail);
    if (error) {
      showAlert('Resend Failed', error);
    } else {
      showAlert('Code Sent', 'A new code has been sent to your email.');
      setCanResend(false);
      setResendTimer(30);
      setOtpCode(['', '', '', '']);
      otpRefs.current[0]?.focus();
    }
    setLoading(false);
  };

  const handleOtpChange = (text: string, index: number) => {
    const newOtp = [...otpCode];
    newOtp[index] = text;
    setOtpCode(newOtp);
    if (text && index < 3) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otpCode[index] && index > 0) {
      const newOtp = [...otpCode];
      newOtp[index - 1] = '';
      setOtpCode(newOtp);
      otpRefs.current[index - 1]?.focus();
    }
  };

  // --- RESET MODE ---
  if (resetMode) {
    return (
      <View style={[styles.container, { backgroundColor: '#050B1F' }]}>
        <LinearGradient colors={['rgba(59,130,246,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <ScrollView ref={resetScrollRef} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' }}
              showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag">
              <TouchableOpacity activeOpacity={0.7} style={styles.backRow}
                onPress={() => { setResetMode(false); setResetStep('sendCode'); setOtpCode(['', '', '', '']); }}>
                <MaterialIcons name="arrow-back" size={20} color="#9CA3AF" />
                <Text style={{ color: '#9CA3AF', fontSize: 14, fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>

              {resetStep === 'sendCode' ? (
                <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: 'center' }}>
                  <View style={styles.lockCircle}>
                    <MaterialIcons name="email" size={36} color="#3B82F6" />
                  </View>
                  <Text style={styles.title}>Reset Trading Password</Text>
                  <Text style={styles.subtitle}>We will send a verification code to{'\n'}{userEmail}</Text>
                  <TouchableOpacity activeOpacity={0.7}
                    style={[styles.primaryBtn, loading && { opacity: 0.5 }]}
                    onPress={handleSendResetCode} disabled={loading}>
                    <Text style={styles.primaryBtnText}>{loading ? 'Sending...' : 'Send Verification Code'}</Text>
                  </TouchableOpacity>
                </Animated.View>
              ) : resetStep === 'verifyCode' ? (
                <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: 'center' }}>
                  <View style={styles.lockCircle}>
                    <MaterialIcons name="verified" size={36} color="#3B82F6" />
                  </View>
                  <Text style={styles.title}>Enter Verification Code</Text>
                  <Text style={styles.subtitle}>Code sent to {userEmail}</Text>
                  <View style={styles.otpRow}>
                    {[0, 1, 2, 3].map(i => (
                      <TextInput key={i} ref={ref => { otpRefs.current[i] = ref; }}
                        style={[styles.otpInput, otpCode[i] ? styles.otpFilled : null]}
                        value={otpCode[i]}
                        onChangeText={text => handleOtpChange(text.replace(/[^0-9]/g, ''), i)}
                        onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, i)}
                        keyboardType="number-pad" maxLength={1} autoFocus={i === 0} selectTextOnFocus
                      />
                    ))}
                  </View>
                  <TouchableOpacity activeOpacity={0.7}
                    style={[styles.primaryBtn, (otpCode.join('').length < 4 || loading) && { opacity: 0.5 }]}
                    onPress={handleVerifyResetCode} disabled={otpCode.join('').length < 4 || loading}>
                    <Text style={styles.primaryBtnText}>{loading ? 'Verifying...' : 'Verify Code'}</Text>
                  </TouchableOpacity>
                  <View style={{ marginTop: 16 }}>
                    {canResend ? (
                      <TouchableOpacity activeOpacity={0.7} onPress={handleResendCode}>
                        <Text style={{ color: '#3B82F6', fontWeight: '700', fontSize: 14 }}>Resend Code</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={{ color: '#9CA3AF', fontSize: 14 }}>
                        Resend in <Text style={{ color: '#3B82F6', fontWeight: '700' }}>{resendTimer}s</Text>
                      </Text>
                    )}
                  </View>
                </Animated.View>
              ) : (
                <Animated.View entering={FadeIn.duration(400)} style={{ alignItems: 'center' }}>
                  <View style={styles.lockCircle}>
                    <MaterialIcons name="lock-reset" size={36} color="#10B981" />
                  </View>
                  <Text style={styles.title}>Set New Password</Text>
                  <Text style={styles.subtitle}>Create a new trading password</Text>
                  <TextInput
                    ref={newPwInputRef}
                    style={styles.passwordInput}
                    placeholder="New trading password"
                    placeholderTextColor="#6B7280"
                    value={resetNewPw}
                    onChangeText={setResetNewPw}
                    secureTextEntry autoCapitalize="none"
                    onFocus={() => scrollInputIntoView(newPwInputRef, resetScrollRef)}
                  />
                  <TextInput
                    ref={confirmPwInputRef}
                    style={styles.passwordInput}
                    placeholder="Confirm new password"
                    placeholderTextColor="#6B7280"
                    value={resetConfirmPw}
                    onChangeText={setResetConfirmPw}
                    secureTextEntry autoCapitalize="none"
                    onFocus={() => scrollInputIntoView(confirmPwInputRef, resetScrollRef)}
                  />
                  <TouchableOpacity activeOpacity={0.7}
                    style={[styles.primaryBtn, (!resetNewPw || !resetConfirmPw) && { opacity: 0.5 }]}
                    onPress={handleSetNewResetPassword} disabled={!resetNewPw || !resetConfirmPw}>
                    <Text style={styles.primaryBtnText}>Save New Password</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.7} style={{ marginTop: 16 }}
                    onPress={handleRemovePassword}>
                    <Text style={{ color: '#EF4444', fontSize: 14, fontWeight: '600' }}>Remove Password Instead</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  // --- UNLOCK MODE ---
  return (
    <View style={[styles.container, { backgroundColor: '#050B1F' }]}>
      <LinearGradient colors={['rgba(59,130,246,0.06)', 'transparent']} style={StyleSheet.absoluteFill} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView ref={unlockScrollRef} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 32, justifyContent: 'center' }}
            showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag">
            <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: 'center' }}>
              <View style={styles.lockCircle}>
                <MaterialIcons name="lock" size={40} color="#3B82F6" />
              </View>
              <Text style={styles.brandName}>Sight AI</Text>
              <Text style={styles.title}>Enter Trading Password</Text>
              <TextInput
                ref={passwordInputRef}
                style={styles.passwordInput}
                placeholder="Trading password"
                placeholderTextColor="#6B7280"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                onFocus={() => scrollInputIntoView(passwordInputRef, unlockScrollRef)}
                onSubmitEditing={handleUnlock}
                returnKeyType="go"
              />
              <TouchableOpacity activeOpacity={0.7}
                style={[styles.primaryBtn, (!password || loading) && { opacity: 0.5 }]}
                onPress={handleUnlock} disabled={!password || loading}>
                <Text style={styles.primaryBtnText}>{loading ? 'Verifying...' : 'Unlock'}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} style={{ marginTop: 20 }}
                onPress={handleForgotPassword}>
                <Text style={{ color: '#3B82F6', fontSize: 14, fontWeight: '600' }}>Forgot Password?</Text>
              </TouchableOpacity>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  lockCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(59,130,246,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  brandName: { fontSize: 14, fontWeight: '700', color: '#3B82F6', letterSpacing: 1, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#FFF', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22, marginBottom: 28, paddingHorizontal: 8 },
  passwordInput: {
    width: '100%', height: 52, borderRadius: 12,
    backgroundColor: '#151C2C', borderWidth: 1, borderColor: '#1F2937',
    paddingHorizontal: 16, fontSize: 17, color: '#FFF',
    marginBottom: 12,
  },
  primaryBtn: {
    width: '100%', height: 52, borderRadius: 12,
    backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  backRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginBottom: 24,
  },
  otpRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 24 },
  otpInput: {
    width: 56, height: 60, borderRadius: 14, backgroundColor: '#151C2C',
    borderWidth: 2, borderColor: '#1F2937', textAlign: 'center',
    fontSize: 28, fontWeight: '700', color: '#FFF',
  },
  otpFilled: { borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.08)' },
});
