import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Settings tab — placeholder for slice 1.
 * Slice 15 (Backup) brings the real Settings UI (backup mode toggle,
 * export, restore, etc.). Unit preference lives here too eventually.
 */
export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.heading}>Settings</Text>
        <Text style={styles.placeholder}>
          Backup, units, and preferences land in slice 15.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24 },
  heading: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  placeholder: { fontSize: 15, opacity: 0.6 },
});
