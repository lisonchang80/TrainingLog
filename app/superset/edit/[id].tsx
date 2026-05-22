import {
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
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
  }, [navigation, router]);

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
            placeholderTextColor="rgba(127,127,127,0.6)"
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 16 },
  section: { gap: 8 },
  label: { fontSize: 14, opacity: 0.7, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(127,127,127,0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  errorText: { fontSize: 13, color: '#DC2626' },
  placeholder: { fontSize: 14, opacity: 0.6, padding: 24 },
  saveBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  saveBtnDisabled: { backgroundColor: 'rgba(127,127,127,0.3)' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  headerCancel: { fontSize: 16, color: '#007AFF', paddingHorizontal: 12 },
});
