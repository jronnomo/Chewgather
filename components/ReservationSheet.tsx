import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Linking, Animated, Easing, Dimensions } from 'react-native';
import { MapPin, Globe, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Restaurant } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

interface ReservationSheetProps {
  visible: boolean;
  onClose: () => void;
  restaurant: Restaurant;
}

function buildGoogleMapsUrl(name: string, placeId?: string): string {
  const query = encodeURIComponent(name);
  return placeId
    ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

const SHEET_OFFSCREEN = Dimensions.get('window').height;

export default function ReservationSheet({
  visible,
  onClose,
  restaurant,
}: ReservationSheetProps) {
  const Colors = useColors();

  // Animated values
  const sheetTranslateY = useRef(new Animated.Value(SHEET_OFFSCREEN)).current;
  const handleScale = useRef(new Animated.Value(1)).current;
  const row1Opacity = useRef(new Animated.Value(0)).current;
  const row1Y = useRef(new Animated.Value(4)).current;
  const row2Opacity = useRef(new Animated.Value(0)).current;
  const row2Y = useRef(new Animated.Value(4)).current;

  // `visible` is the caller's intent; `isMounted` keeps the Modal alive long
  // enough to play the slide-out before unmounting. Without this split the
  // Modal disappears the instant the caller sets visible=false, and the
  // animation has nowhere to play.
  const [isMounted, setIsMounted] = useState(false);
  const prevVisibleRef = useRef(false);

  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;

    if (visible && !wasVisible) {
      // false → true: mount, reset to start positions, play enter sequence.
      setIsMounted(true);

      sheetTranslateY.setValue(SHEET_OFFSCREEN);
      handleScale.setValue(1);
      row1Opacity.setValue(0);
      row1Y.setValue(4);
      row2Opacity.setValue(0);
      row2Y.setValue(4);

      const rowAnim = (op: Animated.Value, y: Animated.Value) =>
        Animated.parallel([
          Animated.timing(op, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(y, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]);

      Animated.sequence([
        // 1. Sheet slide (300ms, cubic-out)
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        // 2. 40ms breath, then handle bounce + row stagger in parallel
        Animated.delay(40),
        Animated.parallel([
          Animated.sequence([
            Animated.spring(handleScale, {
              toValue: 1.08,
              tension: 80,
              friction: 6,
              useNativeDriver: true,
            }),
            Animated.spring(handleScale, {
              toValue: 1,
              tension: 80,
              friction: 6,
              useNativeDriver: true,
            }),
          ]),
          Animated.stagger(60, [
            rowAnim(row1Opacity, row1Y),
            rowAnim(row2Opacity, row2Y),
          ]),
        ]),
      ]).start();
    } else if (!visible && wasVisible) {
      // true → false: play the reverse slide, then unmount. Mirrors the open
      // — same 300ms duration, cubic-in (matches cubic-out on the open) so
      // entry and exit feel like the same gesture in opposite directions.
      Animated.timing(sheetTranslateY, {
        toValue: SHEET_OFFSCREEN,
        duration: 300,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setIsMounted(false);
        }
      });
    }
  }, [visible, sheetTranslateY, handleScale, row1Opacity, row1Y, row2Opacity, row2Y]);

  const handleAction = (url: string, haptic: 'success' | 'medium' = 'medium') => {
    if (haptic === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onClose();
    setTimeout(() => {
      Linking.openURL(url);
    }, 300);
  };

  const googleMapsUrl = buildGoogleMapsUrl(restaurant.name, restaurant.placeId);

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: Colors.overlay }]} onPress={onClose}>
        <Animated.View
          style={{ transform: [{ translateY: sheetTranslateY }] }}
        >
          <Pressable
            style={[styles.sheet, { backgroundColor: Colors.card }]}
            onPress={() => {}}
            accessibilityViewIsModal
            testID="reservation-sheet"
          >
            <Animated.View
              style={[
                styles.handle,
                { backgroundColor: Colors.border, transform: [{ scale: handleScale }] },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />

            <Text
              style={[styles.title, { color: Colors.text }]}
              accessibilityRole="header"
            >
              {restaurant.hasReservation ? 'Reserve a Table' : 'Contact Restaurant'}
            </Text>
            <Text style={[styles.subtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
              {restaurant.name}
            </Text>

            {/* Row 1 — Find a table (Google Maps) — single-orange-anchor lead row */}
            <Animated.View
              style={{
                opacity: row1Opacity,
                transform: [{ translateY: row1Y }],
              }}
            >
              <Pressable
                style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
                onPress={() => handleAction(googleMapsUrl, 'success')}
                accessibilityRole="button"
                accessibilityLabel="Find a table"
                accessibilityHint="Opens Google Maps to book through OpenTable, Resy, or the restaurant's own system"
                testID="reservation-sheet-find-table"
              >
                <MapPin size={20} color={Colors.primary} />
                <View style={styles.actionTextWrap}>
                  <Text style={[styles.actionText, { color: Colors.primary }]}>Find a table</Text>
                  <Text style={[styles.actionHint, { color: Colors.textTertiary }]}>
                    Opens Google Maps with reservations from OpenTable, Resy and more
                  </Text>
                </View>
                <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
              </Pressable>
            </Animated.View>

            {/* Row 2 — Website (conditional) */}
            {!!restaurant.websiteUri && (
              <Animated.View
                style={{
                  opacity: row2Opacity,
                  transform: [{ translateY: row2Y }],
                }}
              >
                <Pressable
                  style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
                  onPress={() => handleAction(restaurant.websiteUri!, 'medium')}
                  accessibilityRole="button"
                  accessibilityLabel="Visit website"
                  accessibilityHint="Opens the restaurant's website in your browser"
                  testID="reservation-sheet-website"
                >
                  <Globe size={20} color={Colors.text} />
                  <Text style={[styles.actionText, { color: Colors.text }]}>Visit website</Text>
                  <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
                </Pressable>
              </Animated.View>
            )}

            {/* Close */}
            <Pressable
              style={styles.closeRow}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              accessibilityHint="Dismiss this sheet"
              testID="reservation-sheet-close"
            >
              <Text style={[styles.closeText, { color: Colors.textSecondary }]}>Close</Text>
            </Pressable>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    paddingTop: 12,
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
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  actionHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  chevron: {
    marginLeft: 'auto' as const,
  },
  closeRow: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
});
