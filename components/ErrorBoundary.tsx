import React, { Component, ErrorInfo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Session 192 - Only surface internal error text to the console in
    // __DEV__ so shipping production builds never expose raw exception
    // messages / component stacks to third-party log collectors, and
    // never render them to end users (see render() below).
    if (__DEV__) {
      console.error('[ErrorBoundary] Caught error:', error.message);
      console.error('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    } else {
      // Production: single non-sensitive marker only.
      console.log('[ErrorBoundary] Recoverable UI error handled.');
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <View style={styles.container}>
          <View style={styles.content}>
            <View style={styles.iconCircle}>
              <MaterialIcons name="error-outline" size={40} color="#EF4444" />
            </View>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              {__DEV__
                ? (this.state.error?.message || 'An unexpected error occurred')
                : 'Something went wrong on this screen. You can retry or return to the previous page.'}
            </Text>
            <TouchableOpacity activeOpacity={0.7} style={styles.retryBtn} onPress={this.handleRetry}>
              <MaterialIcons name="refresh" size={20} color="#FFF" />
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E17',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    maxWidth: 320,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(239,68,68,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    height: 48,
    borderRadius: 12,
    paddingHorizontal: 24,
    gap: 8,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
});
