import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Body tab — placeholder for slice 1.
 * Slice 9 (Body Data) brings bodyweight / PBF / SMM tracking.
 */
export default function BodyScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.heading}>Body</Text>
        <Text style={styles.placeholder}>
          Bodyweight / PBF / SMM tracking arrives in slice 9.
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
