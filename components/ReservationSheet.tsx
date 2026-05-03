import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Linking } from 'react-native';
import { MapPin, Utensils, CalendarCheck, Globe, Phone, ChevronRight } from 'lucide-react-native';
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
  reservationDate?: string;   // YYYY-MM-DD
  reservationTime?: string;   // "7:00 PM" format
  partySize?: number;         // e.g. 4
}

function parseDateTimeForUrl(date?: string, time?: string): { dateStr: string; hours: number; minutes: number } {
  const now = new Date();
  const dateStr = date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let hours = 19, minutes = 0; // default 7:00 PM
  if (time) {
    const match = time.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (match) {
      hours = parseInt(match[1], 10);
      const ampm = match[3].toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      minutes = parseInt(match[2], 10);
    }
  }
  return { dateStr, hours, minutes };
}

function buildOpenTableUrl(
  name: string,
  location: { latitude: number; longitude: number } | null,
  date?: string,
  time?: string,
  partySize?: number,
): string {
  const { dateStr, hours, minutes } = parseDateTimeForUrl(date, time);
  const dateTime = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const params = new URLSearchParams({
    covers: String(partySize || 2),
    dateTime,
    term: name,
  });
  if (location) {
    params.set('latitude', String(location.latitude));
    params.set('longitude', String(location.longitude));
  }
  return `https://www.opentable.com/s?${params.toString()}`;
}

function buildResyUrl(
  name: string,
  date?: string,
  partySize?: number,
): string {
  const dateStr = date || new Date().toISOString().slice(0, 10);
  const seats = String(partySize || 2);
  const query = encodeURIComponent(name);
  return `https://resy.com/cities?query=${query}&date=${dateStr}&seats=${seats}`;
}

function buildGoogleMapsUrl(name: string, placeId?: string): string {
  const query = encodeURIComponent(name);
  return placeId
    ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${placeId}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export default function ReservationSheet({
  visible,
  onClose,
  restaurant,
  userLocation,
  reservationDate,
  reservationTime,
  partySize,
}: ReservationSheetProps) {
  const Colors = useColors();

  const handleAction = (url: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    setTimeout(() => {
      Linking.openURL(url);
    }, 300);
  };

  const googleMapsUrl = buildGoogleMapsUrl(restaurant.name, restaurant.placeId);
  const openTableUrl = buildOpenTableUrl(restaurant.name, userLocation, reservationDate, reservationTime, partySize);
  const resyUrl = buildResyUrl(restaurant.name, reservationDate, partySize);

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

          {/* Row 1 — Google Maps (primary — has Reserve with Google integration) */}
          <Pressable
            style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
            onPress={() => handleAction(googleMapsUrl)}
          >
            <MapPin size={20} color={Colors.primary} />
            <View>
              <Text style={[styles.actionText, { color: Colors.text }]}>Reserve on Google Maps</Text>
              <Text style={[styles.actionHint, { color: Colors.textTertiary }]}>Opens restaurant with booking options</Text>
            </View>
            <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
          </Pressable>

          {/* Row 2 — OpenTable */}
          <Pressable
            style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
            onPress={() => handleAction(openTableUrl)}
          >
            <Utensils size={20} color={Colors.text} />
            <Text style={[styles.actionText, { color: Colors.text }]}>Search on OpenTable</Text>
            <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
          </Pressable>

          {/* Row 3 — Resy */}
          <Pressable
            style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
            onPress={() => handleAction(resyUrl)}
          >
            <CalendarCheck size={20} color={Colors.text} />
            <Text style={[styles.actionText, { color: Colors.text }]}>Search on Resy</Text>
            <ChevronRight size={18} color={Colors.textTertiary} style={styles.chevron} />
          </Pressable>

          {/* Row 4 — Website (conditional) */}
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

          {/* Row 5 — Phone */}
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
  actionHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
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
