/**
 * App-wide React error boundary — recovery-robustness audit HIGH finding.
 *
 * Before this existed, a render-time throw anywhere in the tree (a bad cast on
 * a corrupt DB row, `undefined.map`, a hook-order violation from an invalid
 * deep-link `[id]` route) unwound to the root and white-screened the entire
 * app in Release, with force-quit as the only recovery.
 *
 * This class component is the only React API that can catch render-phase
 * errors (`getDerivedStateFromError` + `componentDidCatch` have no hook
 * equivalent). It renders a theme-token-styled fallback with a「重新嘗試」/
 * "Try again" button that clears `hasError`, so a transient error (e.g. a
 * stale prop that's since been corrected upstream) can recover by re-mounting
 * the subtree without a force-quit.
 *
 * ADR-0025 — colors flow from useTheme().tokens. A class can't call hooks, so
 * the fallback UI is a small functional child (`ErrorFallback`) that does.
 */
import React, { Component, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  deriveErrorState,
  resetState,
  type ErrorBoundaryState,
} from '@/components/error-boundary.behavior';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

interface ErrorBoundaryProps {
  children: ReactNode;
}

/**
 * Theme-aware fallback. Kept as a functional child so it can use `useTheme()`
 * — the boundary class above cannot call hooks.
 */
function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{t('common', 'errorTitle')}</Text>
      <Text style={styles.body}>{t('common', 'errorBody')}</Text>
      <TouchableOpacity
        style={styles.retryButton}
        onPress={onRetry}
        accessibilityRole="button"
      >
        <Text style={styles.retryText}>{t('common', 'retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = resetState();

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return deriveErrorState(error);
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Local logging only — match the project's catch-site pattern (bracketed
    // tag). No analytics / network by design.
    console.error('[error-boundary] caught render error:', error, info);
  }

  /** Clear the error so the child subtree re-mounts. Exposed for testing. */
  reset = () => {
    this.setState(resetState());
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: tokens.bg.base,
    },
    title: {
      fontSize: 18,
      fontWeight: '600',
      color: tokens.text.primary,
      marginBottom: 8,
      textAlign: 'center',
    },
    body: {
      fontSize: 14,
      color: tokens.text.secondary,
      textAlign: 'center',
      marginBottom: 24,
    },
    retryButton: {
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: tokens.action.primary,
    },
    retryText: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.action.onPrimary,
    },
  });
}
