import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useApp } from '../../../context/AppContext';
import {
  CUISINES,
  BUDGET_OPTIONS,
  DIETARY_OPTIONS,
  DISTANCE_OPTIONS,
  ATMOSPHERE_OPTIONS,
  GROUP_SIZE_OPTIONS,
} from '../../../mocks/restaurants';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';

const Colors = StaticColors;

export default function EditPreferencesScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { preferences, updatePreferences } = useApp();

  const [cuisines, setCuisines] = useState<string[]>(preferences.cuisines);
  const [budget, setBudget] = useState<string[]>(preferences.budget);
  const [dietary, setDietary] = useState<string[]>(preferences.dietary);
  const [atmosphere, setAtmosphere] = useState<string[]>(preferences.atmosphere);
  const [groupSize, setGroupSize] = useState<string[]>(preferences.groupSize);
  const [distance, setDistance] = useState(preferences.distance);
  const [saving, setSaving] = useState(false);

  const hasChanges = useMemo(() => {
    return (
      JSON.stringify(cuisines) !== JSON.stringify(preferences.cuisines) ||
      JSON.stringify(budget) !== JSON.stringify(preferences.budget) ||
      JSON.stringify(dietary) !== JSON.stringify(preferences.dietary) ||
      JSON.stringify(atmosphere) !== JSON.stringify(preferences.atmosphere) ||
      JSON.stringify(groupSize) !== JSON.stringify(preferences.groupSize) ||
      distance !== preferences.distance
    );
  }, [cuisines, budget, dietary, atmosphere, groupSize, distance, preferences]);

  const toggleCuisine = useCallback((c: string) => {
    Haptics.selectionAsync();
    setCuisines(prev =>
      prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]
    );
  }, []);

  const handleSelectAllCuisines = useCallback(() => {
    Haptics.selectionAsync();
    setCuisines(prev => prev.length === CUISINES.length ? [] : [...CUISINES]);
  }, []);

  const toggleDietary = useCallback((d: string) => {
    Haptics.selectionAsync();
    setDietary(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    );
  }, []);

  const handleSave = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);
    try {
      await updatePreferences.mutateAsync({
        ...preferences,
        cuisines,
        budget,
        dietary,
        atmosphere,
        groupSize,
        distance,
      });
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [preferences, cuisines, budget, dietary, atmosphere, groupSize, distance, updatePreferences, router]);

  const handleBack = useCallback(() => {
    if (hasChanges) {
      Alert.alert(
        'Discard Changes?',
        'You have unsaved changes. Are you sure you want to go back?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  }, [hasChanges, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <View style={styles.header}>
        <Pressable style={[styles.backBtn, { backgroundColor: Colors.card, borderColor: Colors.border }]} onPress={handleBack}>
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: Colors.text }]}>Edit Preferences</Text>
        <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Check size={18} color="#FFF" />
              <Text style={styles.saveBtnText}>Save</Text>
            </>
          )}
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        <Section
          title="Cuisines"
          subtitle="Select all you enjoy"
          action={
            <Pressable onPress={handleSelectAllCuisines}>
              <Text style={[styles.sectionActionText, { color: Colors.primary }]}>
                {cuisines.length === CUISINES.length ? 'Clear All' : 'Select All'}
              </Text>
            </Pressable>
          }
        >
          <View style={styles.wrapRow}>
            {CUISINES.map(c => (
              <Pressable
                key={c}
                style={[
                  styles.chip,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  cuisines.includes(c) && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => toggleCuisine(c)}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  cuisines.includes(c) && styles.chipTextActive,
                ]}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Budget">
          <View style={styles.chipRow}>
            {BUDGET_OPTIONS.map(b => (
              <Pressable
                key={b}
                style={[
                  styles.chip,
                  styles.chipFlex,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  budget.includes(b) && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => { Haptics.selectionAsync(); setBudget(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]); }}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  budget.includes(b) && styles.chipTextActive,
                ]}>{b}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Dietary Restrictions">
          <View style={styles.wrapRow}>
            {(DIETARY_OPTIONS as string[]).map(d => (
              <Pressable
                key={d}
                style={[
                  styles.chip,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  dietary.includes(d) && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => toggleDietary(d)}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  dietary.includes(d) && styles.chipTextActive,
                ]}>{d}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Atmosphere">
          <View style={styles.chipRow}>
            {ATMOSPHERE_OPTIONS.map(a => (
              <Pressable
                key={a}
                style={[
                  styles.chip,
                  styles.chipFlex,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  atmosphere.includes(a) && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => { Haptics.selectionAsync(); setAtmosphere(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]); }}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  atmosphere.includes(a) && styles.chipTextActive,
                ]}>{a}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Group Size">
          <View style={styles.chipRow}>
            {GROUP_SIZE_OPTIONS.map(g => (
              <Pressable
                key={g}
                style={[
                  styles.chip,
                  styles.chipFlex,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  groupSize.includes(g) && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => { Haptics.selectionAsync(); setGroupSize(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]); }}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  groupSize.includes(g) && styles.chipTextActive,
                ]}>{g}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section title="Max Distance">
          <View style={styles.chipRow}>
            {DISTANCE_OPTIONS.map(d => (
              <Pressable
                key={d}
                style={[
                  styles.chip,
                  styles.chipFlex,
                  { backgroundColor: Colors.card, borderColor: Colors.border },
                  distance === d && { backgroundColor: Colors.primary, borderColor: Colors.primary },
                ]}
                onPress={() => { Haptics.selectionAsync(); setDistance(d); }}
              >
                <Text style={[
                  styles.chipText,
                  { color: Colors.text },
                  distance === d && styles.chipTextActive,
                ]}>{d} mi</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const Colors = useColors();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={[styles.sectionTitle, { color: Colors.text }]}>{title}</Text>
          {subtitle && <Text style={[styles.sectionSubtitle, { color: Colors.textSecondary }]}>{subtitle}</Text>}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sectionActionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    paddingTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 10,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  chipFlex: {
    flex: 1,
    alignItems: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  chipTextActive: {
    color: '#FFF',
  },
});
