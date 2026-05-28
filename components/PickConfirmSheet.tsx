import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { Restaurant } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

export interface PickConfirmSheetProps {
  visible: boolean;
  restaurant: Restaurant | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** When provided, renders a "Shuffle again" button. Used by the Curveball flow. */
  onShuffle?: () => void;
  /** Overrides the default body copy. Curveball uses its own messaging. */
  bodyText?: string;
}

export default function PickConfirmSheet({
  visible,
  restaurant,
  onConfirm,
  onCancel,
  onShuffle,
  bodyText,
}: PickConfirmSheetProps) {
  const Colors = useColors();
  if (!restaurant) return null;

  const handleConfirm = () => {
    // Medium impact = decisive click of commitment. Success haptic is fired
    // on results-screen arrival (see swipe.tsx::useEffect[showResults]),
    // which is the actual celebratory moment.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onConfirm();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <Pressable
        style={[styles.overlay, { backgroundColor: Colors.overlay }]}
        onPress={onCancel}
        accessibilityLabel="Dismiss"
      >
        <View style={[styles.sheet, { backgroundColor: Colors.card }]}>
          <View style={[styles.handle, { backgroundColor: Colors.border }]} />

          <Text style={[styles.title, { color: Colors.text }]} numberOfLines={2}>
            {`Going with ${restaurant.name}?`}
          </Text>

          <View style={[styles.preview, { backgroundColor: Colors.background }]}>
            {restaurant.imageUrl ? (
              <Image source={{ uri: restaurant.imageUrl }} style={styles.previewImage} contentFit="cover" />
            ) : (
              <View style={[styles.previewImage, { backgroundColor: Colors.border }]} />
            )}
            <View style={styles.previewMeta}>
              <Text style={[styles.previewName, { color: Colors.text }]} numberOfLines={1}>
                {restaurant.name}
              </Text>
              {restaurant.cuisine ? (
                <Text style={[styles.previewSub, { color: Colors.textSecondary }]} numberOfLines={1}>
                  {restaurant.cuisine}
                </Text>
              ) : null}
            </View>
          </View>

          <Text style={[styles.body, { color: Colors.textSecondary }]}>
            {bodyText ?? "This wraps your session — other spots you liked won't carry over."}
          </Text>

          <Pressable
            style={[styles.primaryBtn, { backgroundColor: Colors.primary }]}
            onPress={handleConfirm}
            accessibilityRole="button"
            accessibilityLabel={`Pick ${restaurant.name} and finish`}
          >
            <Text style={styles.primaryBtnText}>{`Pick ${restaurant.name}`}</Text>
          </Pressable>

          {onShuffle ? (
            <Pressable
              style={[styles.shuffleBtn, { borderColor: Colors.border }]}
              onPress={() => {
                Haptics.selectionAsync();
                onShuffle();
              }}
              accessibilityRole="button"
              accessibilityLabel="Shuffle for a different pick"
            >
              <Text style={[styles.shuffleBtnText, { color: Colors.text }]}>
                🎲 Shuffle again
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            style={styles.secondaryBtn}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Keep nibbling"
          >
            <Text style={[styles.secondaryBtnText, { color: Colors.textSecondary }]}>
              Keep nibbling
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 16,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.background,
    marginBottom: 16,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
  },
  previewMeta: {
    flex: 1,
  },
  previewName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  previewSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  body: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 20,
  },
  primaryBtn: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    marginBottom: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700' as const,
  },
  shuffleBtn: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderColor: Colors.border,
  },
  shuffleBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  secondaryBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
});
