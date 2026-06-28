import { Image } from 'expo-image';
import { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import type { InfoContent } from './types';

/**
 * 說明視窗 — a centred, scrollable modal with optional screenshot(s) + text
 * sections. Mirrors the `rest-timer-modal` Modal/backdrop/card structure
 * (transparent fade Modal, tap-backdrop-to-dismiss, `accessibilityViewIsModal`
 * card that stops propagation). Content comes from a page's `InfoContent`.
 *
 * For a 'mixed' page, pass `onStartTour` — a「操作教學 →」button appears that
 * hands off to the CoachMarkOverlay (the host closes this modal then opens the
 * tour).
 */
interface InfoModalProps {
  visible: boolean;
  content: InfoContent;
  onClose: () => void;
  /** When set, shows a secondary button that launches the coach tour. */
  onStartTour?: () => void;
}

export function InfoModal({ visible, content, onClose, onStartTour }: InfoModalProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}
          accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {content.title}
          </Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {content.sections.map((s, i) => (
              <View key={`s${i}`} style={styles.section}>
                {s.heading ? <Text style={styles.heading}>{s.heading}</Text> : null}
                <Text style={styles.body}>{s.body}</Text>
              </View>
            ))}

            {content.images?.map((img, i) => (
              <View key={`img${i}`} style={styles.imageBlock}>
                <Image
                  source={img.source}
                  style={[styles.image, { aspectRatio: img.aspectRatio ?? 16 / 9 }]}
                  contentFit="contain"
                  transition={120}
                  accessibilityIgnoresInvertColors
                />
                {img.caption ? <Text style={styles.caption}>{img.caption}</Text> : null}
              </View>
            ))}
          </ScrollView>

          <View style={styles.actions}>
            {onStartTour ? (
              <Pressable
                onPress={onStartTour}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnSecondary,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.btnSecondaryText}>{t('help', 'startTour')} ›</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.btnPrimaryText}>{t('help', 'gotIt')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** ADR-0025 token-driven styles; raw rgba backdrop matches rest-timer-modal. */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '82%',
      backgroundColor: tokens.bg.modal,
      borderRadius: 16,
      paddingTop: 22,
      paddingBottom: 16,
      paddingHorizontal: 20,
    },
    title: {
      fontSize: 19,
      fontWeight: '700',
      color: tokens.text.primary,
      marginBottom: 12,
    },
    scroll: {
      flexGrow: 0,
    },
    scrollContent: {
      paddingBottom: 4,
    },
    section: {
      marginBottom: 14,
    },
    heading: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.text.primary,
      marginBottom: 4,
    },
    body: {
      fontSize: 15,
      lineHeight: 22,
      color: tokens.text.secondary,
    },
    imageBlock: {
      marginBottom: 14,
    },
    image: {
      width: '100%',
      borderRadius: 10,
      backgroundColor: tokens.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.subtle,
    },
    caption: {
      fontSize: 12,
      color: tokens.text.tertiary,
      marginTop: 6,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
    },
    btn: {
      paddingVertical: 10,
      paddingHorizontal: 22,
      borderRadius: 999,
    },
    btnPrimary: {
      backgroundColor: tokens.action.primary,
    },
    btnPrimaryText: {
      color: tokens.action.onPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    btnSecondary: {
      backgroundColor: tokens.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.default,
    },
    btnSecondaryText: {
      color: tokens.action.primary,
      fontSize: 15,
      fontWeight: '600',
    },
    btnPressed: {
      opacity: 0.7,
    },
  });
}
