import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView,
  KeyboardAvoidingView, Platform, Keyboard, findNodeHandle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { useAlert } from '@/template';
import { useAuth } from '@/template';
import { getSupabaseClient } from '@/template';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { login, signup: appSignup, updateUserName, currentTheme: t } = useApp();
  const { sendOTP, verifyOTPAndLogin } = useAuth();
  const { showAlert } = useAlert();

  const [mode, setMode] = useState<'login' | 'signup'>(params.mode === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const verifyingRef = useRef(false);

  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState(['', '', '', '']);
  const [resendLoading, setResendLoading] = useState(false);
  // Verification state machine — drives OTP box styling and status text.
  // Critical: success styling (green) is only applied when the API actually
  // confirms a valid code, never speculatively while the request is in flight.
  const [verifyState, setVerifyState] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  // Hard guards against duplicate / late-firing OTP & signup requests.
  //
  //   verificationCompletedRef — latched true the moment the OTP API confirms a
  //     valid code. Once latched, NOTHING in this screen can ever send another
  //     verification email or run another auth request: the in-flight signup
  //     IIFE bails out, handleResendOTP refuses to fire, and re-entering
  //     handleAuth is rejected. This was the root cause of the duplicate
  //     verification email reported after successful signup — a stale
  //     async request was still in flight or the resend path could re-trigger.
  //
  //   signupSubmittedRef — latched true the first time the signup branch of
  //     handleAuth fires. Prevents double-submission from rapid taps or
  //     re-entry, which would have triggered a second sendOTP. Reset only when
  //     the user explicitly leaves the OTP screen (the back button), so the
  //     happy path locks down completely after submission.
  const verificationCompletedRef = useRef(false);
  const signupSubmittedRef = useRef(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll the focused input above the keyboard
  const scrollToInput = useCallback((inputRef: React.RefObject<TextInput>) => {
    setTimeout(() => {
      if (!inputRef.current || !scrollRef.current) return;
      const handle = findNodeHandle(inputRef.current);
      if (!handle) return;
      // @ts-ignore - getScrollResponder exists at runtime
      const scrollResponder = scrollRef.current.getScrollResponder?.();
      if (scrollResponder?.scrollResponderScrollNativeHandleToKeyboard) {
        scrollResponder.scrollResponderScrollNativeHandleToKeyboard(handle, 120, true);
      } else {
        try {
          inputRef.current.measureInWindow((x, y) => {
            const targetY = Math.max(0, y - 100);
            scrollRef.current?.scrollTo({ y: targetY, animated: true });
          });
        } catch {}
      }
    }, Platform.OS === 'ios' ? 250 : 350);
  }, []);

  const handleAuth = async () => {
    if (!isValid) return;
    // Hard guards: once verification has succeeded for this signup, the screen
    // is effectively done — no further auth calls of any kind are permitted.
    // And once signup has been submitted (OTP requested), don't let it fire
    // a second time.
    if (verificationCompletedRef.current) return;
    if (mode === 'signup' && signupSubmittedRef.current) return;
    setLoading(true);
    Haptics.selectionAsync();

    try {
      if (mode === 'signup') {
        if (!name.trim()) {
          showAlert('Name Required', 'Please enter your first name to create an account.');
          setLoading(false);
          return;
        }
        if (password !== confirmPassword) {
          showAlert('Password Mismatch', 'Passwords do not match. Please try again.');
          setLoading(false);
          return;
        }

        // Latch the submission ref BEFORE any async work so a rapid second
        // tap can't slip past while the IIFE is still in flight.
        signupSubmittedRef.current = true;

        // Show OTP screen IMMEDIATELY for seamless transition
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowOtpStep(true);
        setLoading(false);

        // CRITICAL: Only call sendOTP — do NOT also call appSignup here.
        //
        // The previous flow called BOTH `appSignup` (which calls
        // supabase.auth.signUp) AND `sendOTP` (which calls
        // supabase.auth.signInWithOtp). Each of those Supabase calls dispatches
        // its own verification email, so users were receiving TWO verification
        // emails for a single signup attempt — the duplicate the spec calls out.
        //
        // The OTP-only flow is sufficient and produces ONE email:
        //   1. sendOTP → creates the auth.users row (shouldCreateUser is true by
        //      default) and sends ONE email containing the 4-digit code.
        //   2. verifyOTPAndLogin({ password }) → verifies the code, sets the
        //      password during verification, and signs the user in.
        //   3. updateUserName → persists the display name in the profile.
        //
        // The DB trigger `on_auth_user_created` auto-creates the user_profiles
        // row when sendOTP creates the auth user, so no separate account-
        // creation call is required.
        //
        // Additional guard: if the user has somehow already verified (e.g.,
        // an extremely fast OTP entry while the network call to sendOTP is
        // still pending), don't fire the email at all — verification is
        // complete and any further OTP send would be the duplicate the spec
        // forbids.
        (async () => {
          try {
            if (verificationCompletedRef.current) return;
            const { error: otpError } = await sendOTP(email.trim());
            if (verificationCompletedRef.current) return; // late-arriving response
            if (otpError) {
              // Rate-limit messages are silent — the user can tap Resend Code.
              if (!otpError.includes('security purposes') && !otpError.includes('after') && !otpError.includes('seconds') && !otpError.includes('rate')) {
                setShowOtpStep(false);
                signupSubmittedRef.current = false;
                showAlert('Code Delivery Issue', otpError);
              }
            }
          } catch (e: any) {
            if (verificationCompletedRef.current) return;
            setShowOtpStep(false);
            signupSubmittedRef.current = false;
            showAlert('Error', e.message || 'Could not send verification code. Please try again.');
          }
        })();
        return;
      } else {
        const result = await login(email.trim(), password);
        if (!result.success) {
          const errMsg = result.error || 'Invalid credentials';
          if (errMsg.toLowerCase().includes('email not confirmed') || errMsg.toLowerCase().includes('not confirmed')) {
            showAlert('Email Not Verified', 'Please verify your email first. Check your inbox for the verification code.');
          } else {
            showAlert('Login Failed', errMsg);
          }
          setLoading(false);
          return;
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // Navigate to index which handles the full routing flow
        router.replace('/');
      }
    } catch {
      showAlert('Error', 'Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  // Verify a code (used by both manual press and auto-verify when 4th digit entered)
  const verifyCode = useCallback(async (code: string) => {
    if (code.length < 4 || verifyingRef.current || verificationCompletedRef.current) return;
    verifyingRef.current = true;
    // Mark as verifying — boxes show neutral verifying state (blue), NOT green.
    // Green is reserved exclusively for confirmed successes after the API responds.
    setVerifyState('verifying');
    setLoading(true);
    // Auto-dismiss keyboard so the spinner is fully visible and feels instant
    Keyboard.dismiss();
    Haptics.selectionAsync();
    try {
      const { error, user } = await verifyOTPAndLogin(email.trim(), code, { password });
      if (error) {
        // Real verification failure — flash red, never green. Reset boxes
        // and return focus so the user can re-enter without confusion.
        setVerifyState('error');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showAlert('Verification Failed', error);
        setOtpCode(['', '', '', '']);
        setTimeout(() => {
          setVerifyState('idle');
          otpRefs.current[0]?.focus();
        }, 800);
        verifyingRef.current = false;
        setLoading(false);
        return;
      }
      // Genuine success — latch the completion ref BEFORE any other work so
      // the in-flight signup IIFE (if it's still racing) and any future
      // resend / re-submit attempts immediately bail out. This guarantees
      // ZERO additional verification emails or auth requests can be triggered
      // from this screen after a successful verification.
      verificationCompletedRef.current = true;
      if (user) {
        updateUserName(name.trim());
      }
      setVerifyState('success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // ==================================================================
      // Session 116 ROOT-CAUSE FIX — signup session persistence bug.
      // ==================================================================
      // Symptom: newly-signed-up users completing onboarding + paywall were
      // being kicked back to /login instead of continuing to tutorial/home.
      //
      // Root cause: verifyOTPAndLogin returns immediately, but Supabase's
      // session write to AsyncStorage is async. During the multi-hop
      // onboarding chain (index → disclaimer → welcome → intro-offer →
      // subscription → tabs), if the session isn't fully persisted OR the
      // auth listener transiently emits a null-session (during token
      // refresh), isLoggedIn briefly drops to false and index.tsx routes
      // the user to /login.
      //
      // Fix: BEFORE navigating away from the OTP screen,
      //   1. Poll supabase.auth.getSession() until it returns a valid,
      //      persisted session (up to 8 attempts, 150ms apart = ~1.2s max).
      //   2. Write a recent-signup grace marker with the current timestamp
      //      to AsyncStorage. index.tsx reads this marker and, if fresh
      //      (<60s), never routes to /login on transient auth null — it
      //      waits for the auth listener to rehydrate the session instead.
      // ==================================================================
      try {
        const supabase = getSupabaseClient();
        let confirmedSession = false;
        for (let i = 0; i < 8; i++) {
          try {
            const { data } = await supabase.auth.getSession();
            if (data?.session?.user?.id) {
              confirmedSession = true;
              break;
            }
          } catch {}
          await new Promise(r => setTimeout(r, 150));
        }
        // Grace marker: index.tsx checks this and suppresses /login routing
        // for the next 60 seconds if isLoggedIn appears false. This catches
        // the transient token-refresh window that was the real culprit.
        await AsyncStorage.setItem('ts_recent_signup_at', String(Date.now()));
        // Log once for diagnostics if the session STILL wasn't confirmed —
        // in that case the grace marker still buys index.tsx time to wait
        // for the auth listener.
        if (!confirmedSession) {
          console.log('[AUTH] Session not yet persisted after 8 polls; grace marker set.');
        }
      } catch {}

      // Small visual pause so the user sees the green confirmation.
      setTimeout(() => {
        router.replace('/');
      }, 200);
    } catch {
      setVerifyState('error');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Error', 'Verification failed. Please try again.');
      setOtpCode(['', '', '', '']);
      setTimeout(() => {
        setVerifyState('idle');
        otpRefs.current[0]?.focus();
      }, 800);
      verifyingRef.current = false;
      setLoading(false);
    }
  }, [email, password, name, verifyOTPAndLogin, updateUserName, showAlert, router]);

  const handleVerifyOTP = () => {
    const code = otpCode.join('');
    if (code.length < 4) {
      showAlert('Incomplete Code', 'Please enter the full 4-digit verification code.');
      return;
    }
    verifyCode(code);
  };

  const handleResendOTP = async () => {
    // Once verification has completed, NEVER send another email — even if
    // the user somehow taps the (disabled) resend button. This is the final
    // line of defense against the duplicate-email-after-success bug.
    if (verificationCompletedRef.current) return;
    if (resendLoading) return;
    setResendLoading(true);
    Haptics.selectionAsync();
    const { error } = await sendOTP(email.trim());
    // Re-check after the network call returns — if verification finished
    // while the resend was in flight, suppress all UI changes.
    if (verificationCompletedRef.current) {
      setResendLoading(false);
      return;
    }
    if (error) {
      showAlert('Resend Failed', error);
    } else {
      showAlert('Code Sent', 'A new verification code has been sent to your email.');
      setOtpCode(['', '', '', '']);
      setVerifyState('idle');
      verifyingRef.current = false;
      otpRefs.current[0]?.focus();
    }
    setResendLoading(false);
  };

  const handleOtpChange = (text: string, index: number) => {
    // Allow paste-handling: if multiple chars entered (paste), distribute across boxes
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned.length > 1) {
      const newOtp = [...otpCode];
      for (let i = 0; i < 4; i++) {
        newOtp[i] = cleaned[i] ?? '';
      }
      setOtpCode(newOtp);
      const filled = newOtp.join('');
      if (filled.length === 4) {
        // Auto-verify on full paste
        verifyCode(filled);
      } else {
        otpRefs.current[Math.min(cleaned.length, 3)]?.focus();
      }
      return;
    }

    const newOtp = [...otpCode];
    newOtp[index] = cleaned;
    setOtpCode(newOtp);
    if (cleaned && index < 3) {
      otpRefs.current[index + 1]?.focus();
    }
    // Auto-verify the moment the final digit is entered (any index resulting in a complete code)
    const fullCode = newOtp.join('');
    if (fullCode.length === 4 && !verifyingRef.current) {
      verifyCode(fullCode);
    }
  };

  const handleOtpKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !otpCode[index] && index > 0) {
      const newOtp = [...otpCode];
      newOtp[index - 1] = '';
      setOtpCode(newOtp);
      otpRefs.current[index - 1]?.focus();
    }
  };

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const isValid = mode === 'login'
    ? isEmailValid && password.length >= 6
    : isEmailValid && password.length >= 6 && name.trim().length > 0 && password === confirmPassword;

  // OTP Verification Screen
  if (showOtpStep) {
    const fullCode = otpCode.join('');
    return (
      <View style={[styles.container, { backgroundColor: '#0A0E17' }]}>
        <LinearGradient
          colors={['rgba(59,130,246,0.06)', 'rgba(10,14,23,1)']}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={0}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag">
              <Pressable style={styles.backBtn} onPress={() => { Keyboard.dismiss(); setShowOtpStep(false); setOtpCode(['', '', '', '']); setVerifyState('idle'); verifyingRef.current = false; signupSubmittedRef.current = false; }}>
                <MaterialIcons name="arrow-back" size={22} color="#FFF" />
              </Pressable>

              {/* Logo intentionally removed — cleaner, less cluttered onboarding */}
              <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: 'center', marginTop: 32 }}>
                <View style={styles.otpIconCircle}>
                  <MaterialIcons name="email" size={36} color="#3B82F6" />
                </View>
                <Text style={styles.otpTitle}>Verify Your Email</Text>
                <Text style={styles.otpSubtitle}>
                  We sent a 4-digit code to{'\n'}
                  <Text style={{ fontWeight: '700', color: '#FFF' }}>{email.trim()}</Text>
                </Text>
              </Animated.View>

              <Animated.View entering={FadeInDown.duration(500).delay(200)} style={styles.otpInputRow}>
                {[0, 1, 2, 3].map(i => (
                  <TextInput
                    key={i}
                    ref={ref => { otpRefs.current[i] = ref; }}
                    style={[
                      styles.otpInput,
                      // Filled (idle) — neutral blue tint while user is entering
                      otpCode[i] && verifyState === 'idle' ? styles.otpInputFilled : null,
                      // Verifying — slightly stronger blue but never green
                      verifyState === 'verifying' && otpCode[i] ? styles.otpInputVerifying : null,
                      // Success — green, applied only after the API confirms a valid code
                      verifyState === 'success' ? styles.otpInputSuccess : null,
                      // Error — red, applied only after the API rejects the code
                      verifyState === 'error' ? styles.otpInputError : null,
                    ]}
                    value={otpCode[i]}
                    onChangeText={text => handleOtpChange(text, i)}
                    onKeyPress={({ nativeEvent }) => handleOtpKeyPress(nativeEvent.key, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    autoFocus={i === 0}
                    selectTextOnFocus
                    editable={!loading && verifyState !== 'success'}
                    textContentType="oneTimeCode"
                  />
                ))}
              </Animated.View>

              {/* Resend Code sits immediately under the OTP boxes — occupies the
                  space that previously felt wasted between the inputs and lower
                  content. Tight grouping makes the relationship between the
                  code entry and the resend action obvious. */}
              <Animated.View entering={FadeInDown.duration(500).delay(300)} style={styles.resendRow}>
                <Pressable
                  onPress={handleResendOTP}
                  disabled={resendLoading || loading || verifyState === 'verifying' || verifyState === 'success' || verificationCompletedRef.current}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={[styles.resendText, (resendLoading || loading || verifyState === 'verifying' || verifyState === 'success') && { opacity: 0.5 }]}>
                    {resendLoading ? 'Sending...' : 'Resend Code'}
                  </Text>
                </Pressable>
              </Animated.View>

              {/* Status row — only renders for verifying or error states. A
                  successful verification instantly turns the boxes green and
                  navigates forward, so a separate "Verified" label would be
                  redundant clutter. */}
              {(verifyState === 'verifying' || verifyState === 'error') ? (
                <Animated.View entering={FadeIn.duration(180)} style={styles.otpStatusRow}>
                  {verifyState === 'verifying' ? (
                    <Text style={styles.otpStatusVerifying}>Verifying...</Text>
                  ) : (
                    <Text style={styles.otpStatusError}>Invalid code. Try again.</Text>
                  )}
                </Animated.View>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  // Main Auth Form Screen
  return (
    <View style={[styles.container, { backgroundColor: '#0A0E17' }]}>
      <LinearGradient
        colors={['rgba(59,130,246,0.06)', 'rgba(10,14,23,1)']}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={0}>
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag">
            {/* Top Bar: Back + Logo — Session 208: eye logo removed per user
                request. The back button stays anchored on the left and a
                matching-width spacer on the right keeps the layout balanced. */}
            <View style={styles.topBar}>
              <Pressable style={styles.backBtn} onPress={() => { Keyboard.dismiss(); router.replace('/login'); }}>
                <MaterialIcons name="arrow-back" size={22} color="#FFF" />
              </Pressable>
              <View style={{ width: 40 }} />
            </View>

            {/* Heading */}
            <Animated.View entering={FadeIn.duration(500)} style={styles.headingSection}>
              <Text style={styles.heading}>
                {mode === 'login' ? 'Welcome Back' : 'Create Account'}
              </Text>
              <Text style={styles.headingSub}>
                {mode === 'login' ? 'Sign in to continue trading' : 'Start your AI-powered trading journey'}
              </Text>
            </Animated.View>

            {/* Tab Switcher */}
            <View style={styles.formSection}>
              <View style={styles.tabSwitcher}>
                <Pressable style={[styles.tab, mode === 'login' && styles.tabActive]}
                  onPress={() => { setMode('login'); Haptics.selectionAsync(); }}>
                  <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>Log In</Text>
                </Pressable>
                <Pressable style={[styles.tab, mode === 'signup' && styles.tabActive]}
                  onPress={() => { setMode('signup'); Haptics.selectionAsync(); }}>
                  <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Sign Up</Text>
                </Pressable>
              </View>

              {mode === 'signup' ? (
                <Animated.View entering={FadeInDown.duration(300)}>
                  <Text style={styles.inputLabel}>First Name</Text>
                  <View style={styles.inputContainer}>
                    <MaterialIcons name="person" size={18} color="#6B7280" />
                    <TextInput ref={nameRef} style={styles.input} placeholder="John" placeholderTextColor="#6B7280"
                      value={name} onChangeText={(text) => setName(text.replace(/\s/g, ''))} autoCapitalize="words"
                      returnKeyType="next" blurOnSubmit={false}
                      onFocus={() => scrollToInput(nameRef)}
                      onSubmitEditing={() => emailRef.current?.focus()}
                      tintColor="#3B82F6" selectionColor="#3B82F6" />
                  </View>
                </Animated.View>
              ) : null}

              <Text style={styles.inputLabel}>Email Address</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons name="email" size={18} color="#6B7280" />
                <TextInput ref={emailRef} style={styles.input} placeholder="you@example.com" placeholderTextColor="#6B7280"
                  value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
                  returnKeyType="next" blurOnSubmit={false}
                  onFocus={() => scrollToInput(emailRef)}
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  tintColor="#3B82F6" selectionColor="#3B82F6" />
              </View>

              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons name="lock" size={18} color="#6B7280" />
                <TextInput ref={passwordRef} style={styles.input} placeholder="Min 6 characters" placeholderTextColor="#6B7280"
                  value={password} onChangeText={setPassword} secureTextEntry={!showPassword}
                  returnKeyType={mode === 'signup' ? 'next' : 'go'} blurOnSubmit={mode !== 'signup'}
                  onFocus={() => scrollToInput(passwordRef)}
                  onSubmitEditing={mode === 'login' ? handleAuth : () => confirmPasswordRef.current?.focus()}
                  tintColor="#3B82F6" selectionColor="#3B82F6" />
                <Pressable onPress={() => setShowPassword(!showPassword)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <MaterialIcons name={showPassword ? 'visibility' : 'visibility-off'} size={18} color="#6B7280" />
                </Pressable>
              </View>

              {mode === 'signup' ? (
                <Animated.View entering={FadeInDown.duration(300)}>
                  <Text style={styles.inputLabel}>Confirm Password</Text>
                  <View style={styles.inputContainer}>
                    <MaterialIcons name="lock-outline" size={18} color="#6B7280" />
                    <TextInput ref={confirmPasswordRef} style={styles.input} placeholder="Re-enter password" placeholderTextColor="#6B7280"
                      value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showPassword}
                      returnKeyType="go" onSubmitEditing={handleAuth}
                      onFocus={() => scrollToInput(confirmPasswordRef)}
                      tintColor="#3B82F6" selectionColor="#3B82F6" />
                    {confirmPassword.length > 0 ? (
                      <MaterialIcons name={password === confirmPassword ? 'check-circle' : 'cancel'} size={18}
                        color={password === confirmPassword ? '#10B981' : '#EF4444'} />
                    ) : null}
                  </View>
                </Animated.View>
              ) : null}

              <Pressable
                style={[styles.submitBtn, (!isValid || loading) && styles.submitBtnDisabled]}
                onPress={handleAuth} disabled={!isValid || loading}>
                <Text style={styles.submitText}>
                  {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Send Verification Code'}
                </Text>
                {!loading ? <MaterialIcons name="arrow-forward" size={18} color="#FFF" /> : null}
              </Pressable>
            </View>

            <Text style={styles.legalText}>
              By continuing, you agree to our Terms of Service and Privacy Policy
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 8, marginBottom: 8,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  smallLogoCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.15)',
  },
  otpLogoRow: { alignItems: 'center', marginTop: 12 },
  headingSection: { alignItems: 'center', marginTop: 20, marginBottom: 28 },
  heading: { fontSize: 28, fontWeight: '700', color: '#FFF', letterSpacing: -0.3 },
  headingSub: { fontSize: 15, color: '#9CA3AF', marginTop: 6 },
  formSection: {},
  tabSwitcher: {
    flexDirection: 'row', backgroundColor: 'rgba(21,28,44,0.8)', borderRadius: 12, padding: 4,
    marginBottom: 22, borderWidth: 1, borderColor: '#1F2937',
  },
  tab: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#3B82F6' },
  tabText: { fontSize: 15, fontWeight: '600', color: '#9CA3AF' },
  tabTextActive: { color: '#FFF' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#9CA3AF', marginBottom: 6, marginTop: 14 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(21,28,44,0.8)',
    borderRadius: 12, paddingHorizontal: 14, height: 50,
    borderWidth: 1, borderColor: '#1F2937', gap: 10,
  },
  input: { flex: 1, fontSize: 16, color: '#FFF' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, backgroundColor: '#3B82F6', borderRadius: 12, marginTop: 24, gap: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  legalText: { fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 16, marginTop: 16 },
  otpIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  otpTitle: { fontSize: 26, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  otpSubtitle: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  // Tight gap below OTP boxes so Resend Code sits visually close, not stranded.
  otpInputRow: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginBottom: 8 },
  otpInput: {
    width: 60, height: 64, borderRadius: 14, backgroundColor: 'rgba(21,28,44,0.8)',
    borderWidth: 2, borderColor: '#1F2937', textAlign: 'center',
    fontSize: 28, fontWeight: '700', color: '#FFF',
  },
  otpInputFilled: { borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.08)' },
  otpInputVerifying: { borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.14)' },
  otpInputSuccess: { borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.12)' },
  otpInputError: { borderColor: '#EF4444', backgroundColor: 'rgba(239,68,68,0.12)' },
  // Status row only renders for verifying/error states (success no longer
  // displays a label), so it can sit below resend without bloating layout.
  otpStatusRow: { alignItems: 'center', justifyContent: 'center', height: 28, marginTop: 8 },
  otpStatusVerifying: { fontSize: 14, fontWeight: '700', color: '#3B82F6' },
  otpStatusSuccess: { fontSize: 14, fontWeight: '700', color: '#10B981' },
  otpStatusError: { fontSize: 14, fontWeight: '700', color: '#EF4444' },
  // Resend Code anchored close to the OTP boxes (no large top margin).
  resendRow: { alignItems: 'center', marginTop: 0 },
  resendText: { fontSize: 14, fontWeight: '700', color: '#3B82F6' },
});
