import {
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import type { ReusableSuperset } from '@/src/domain/superset/types';
import {
  getReusableSupersetWithExercises,
  updateReusableSupersetName,
} from '@/src/adapters/sqlite/supersetRepository';
import { t, tSaveOrSaving } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * Reusable Superset edit page (ADR-0017 Q10 / slice 9.8a).
 *
 * Per ADR Q10「動作組合鎖死」(L150), the 2-exercise pair is immutable —
 * to change exercises, user must delete + recreate. So this page only
 * exposes rename. Delete lives on the detail-page footer (one button to
 * avoid duplicating the destructive action across two screens).
 *
 * Color picker is intentionally NOT shown (per Q4 grill: align Custom
 * Exercise idiom — color stays NULL and the grid card uses hashColor
 * fallback).
 */
export default function EditSupersetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const navigation = useNavigation();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [original, setOriginal] = useState<ReusableSuperset | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('button', 'editSuperset'),
      // Modal presentation has no native back arrow on iOS — surface an
      // explicit「取消」on the left so user can dismiss without learning
      // the swipe-down gesture.
      headerLeft: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common', 'cancel')}
          onPress={() => router.back()}>
          <Text style={styles.headerCancel}>{t('common', 'cancel')}</Text>
        </Pressable>
      ),
    });
  }, [navigation, router, styles.headerCancel]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const d = await getReusableSupersetWithExercises(db, id);
      if (d) {
        setOriginal(d.superset);
        setName(d.superset.name);
      }
    })();
  }, [db, id]);

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length === 0
      ? t('page', 'enterSupersetName')
      : trimmedName.length > 60
        ? t('alert', 'supersetNameMaxLen')
        : null;
  const isDirty = original ? trimmedName !== original.name : false;
  const canSave = nameError === null && isDirty && !saving;

  const onSave = async () => {
    if (!canSave || !original) return;
    setSaving(true);
    try {
      await updateReusableSupersetName(db, original.id, trimmedName, () =>
        Date.now()
      );
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!original) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Text style={styles.placeholder}>{t('alert', 'supersetNotFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.section}>
          <Text style={styles.label}>{t('domain', 'supersetName')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('page', 'enterSupersetNameShort')}
            placeholderTextColor={tokens.text.tertiary}
            style={styles.input}
            maxLength={60}
            autoCorrect={false}
          />
          {nameError && <Text style={styles.errorText}>{nameError}</Text>}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common', 'save')}
          onPress={onSave}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.saveBtn,
            !canSave && styles.saveBtnDisabled,
            pressed && canSave && styles.pressed,
          ]}>
          <Text style={styles.saveBtnText}>{tSaveOrSaving(saving)}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    body: { padding: 20, gap: 16 },
    section: { gap: 8 },
    label: {
      fontSize: 14,
      color: tokens.text.secondary,
      fontWeight: '500',
    },
    input: {
      borderWidth: 1,
      borderColor: tokens.border.default,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: tokens.text.primary,
      backgroundColor: tokens.bg.surface,
    },
    errorText: { fontSize: 13, color: tokens.action.destructive },
    placeholder: { fontSize: 14, color: tokens.text.secondary, padding: 24 },
    saveBtn: {
      height: 48,
      borderRadius: 12,
      backgroundColor: tokens.action.success,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 12,
    },
    saveBtnDisabled: { backgroundColor: tokens.bg.elevated },
    saveBtnText: {
      color: tokens.action.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    pressed: { opacity: 0.7 },
    headerCancel: {
      fontSize: 16,
      color: tokens.action.primary,
      paddingHorizontal: 12,
    },
  });
}
