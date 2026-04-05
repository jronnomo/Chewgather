import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Linking } from 'react-native';
import { Utensils, CalendarCheck, Globe, Phone, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Restaurant } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

interface ReservationSheetProps {
  visible: boolean;
  onClose: () => void;
  restaurant: Restaurant;
  userLocation: { latitude: number; longitude: number } | null;
}

function buildOpenTableUrl(
  name: string,
  location: { latitude: number; longitude: number } | null
): string {
  const params = new URLSearchParams({
    term: name,
    covers: '2',
    dateTime: new Date().toISOString(),
  });
  if (location) {
    params.set('latitude', String(location.latitude));
    params.set('longitude', String(location.longitude));
  }
  return `https://www.opentable.com/s?${params.toString()}`;
}

function buildResyUrl(name: string, address: string): string {
  // Extract city from address: "305 Spice Ave, Austin, TX 78701" → "austin"
  const parts = address.split(',').map(s => s.trim());
  const cityPart = parts.length >= 2 ? parts[parts.length - 2] : '';
  const city = cityPart.toLowerCase().replace(/\s+/g, '-');
  const date = new Date().toISOString().slice(0, 10);
  const query = encodeURIComponent(name);
  return city
    ? `https://resy.com/cities/${city}?query=${query}&date=${date}&seats=2`
    : `https://resy.com/cities?query=${query}&date=${date}&seats=2`;
}

export default function ReservationSheet({
  visible,
  onClose,
  restaurant,
  userLocation,
}: ReservationSheetProps) {
  const Colors = useColors();

  const handleAction = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    setTimeout(() => {
      Linking.openURL(url);
    }, 300);
  };

  const openTableUrl = buildOpenTableUrl(restaurant.name, userLocation);
  const resyUrl = buildResyUrl(restaurant.name, restaurant.address);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: Colors.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: Colors.card }]} onPress={() => {}}>
          <View style={[styles.handle, { backgroundColor: Colors.border }]} />

          <Text style={[styles.title, { color: Colors.text }]}>
            {restaurant.hasReservation ? 'Reserve a Table' : 'Contact Restaurant'}
          </Text>
          <Text style={[styles.subtitle, { color: Colors.textSecondary }]} numberOfLines={1}>
            {restaurant.name}
          </Text>

          {/* Row 1 — OpenTable */}
          <Pressable
            style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
            onPress={() => handleAction(openTableUrl)}
          >
            <Utensils size={20} color={Colors.text} />
            <Text style={[styles.actionText, { color: Colors.text }]}>Search on OpenTable</Text>
            <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
          </Pressable>

          {/* Row 2 — Resy */}
          <Pressable
            style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
            onPress={() => handleAction(resyUrl)}
          >
            <CalendarCheck size={20} color={Colors.text} />
            <Text style={[styles.actionText, { color: Colors.text }]}>Search on Resy</Text>
            <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
          </Pressable>

          {/* Row 3 — Website (conditional) */}
          {!!restaurant.websiteUri && (
            <Pressable
              style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
              onPress={() => handleAction(restaurant.websiteUri!)}
            >
              <Globe size={20} color={Colors.text} />
              <Text style={[styles.actionText, { color: Colors.text }]}>Visit website</Text>
              <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
            </Pressable>
          )}

          {/* Row 4 — Phone */}
          <Pressable
            style={[
              styles.actionRow,
              { borderBottomColor: Colors.borderLight },
              !restaurant.phone && styles.actionDisabled,
            ]}
            onPress={restaurant.phone ? () => handleAction(`tel:${restaurant.phone}`) : undefined}
            disabled={!restaurant.phone}
          >
            <Phone size={20} color={restaurant.phone ? Colors.text : Colors.textTertiary} />
            <Text
              style={[
                styles.actionText,
                { color: restaurant.phone ? Colors.text : Colors.textTertiary },
              ]}
            >
              Call restaurant
            </Text>
            <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
          </Pressable>

          {/* Close */}
          <Pressable style={styles.closeRow} onPress={onClose}>
            <Text style={[styles.closeText, { color: Colors.textSecondary }]}>Close</Text>
          </Pressable>
        </Pressable>
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
  actionText: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  actionDisabled: {
    opacity: 0.5,
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
