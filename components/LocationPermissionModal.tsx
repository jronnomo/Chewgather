import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { MapPin, X } from 'lucide-react-native';
import * as Location from 'expo-location';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

const SCREEN_WIDTH = Dimensions.get('window').width;

interface LocationPermissionModalProps {
  visible: boolean;
  onClose: () => void;
  onLocationGranted: (coords: { latitude: number; longitude: number }, label?: string) => void;
  onRequestLocation: () => Promise<void>;
  locationPermission: 'undetermined' | 'granted' | 'denied';
  initialZipCode?: string;
}

export default function LocationPermissionModal({
  visible,
  onClose,
  onLocationGranted,
  onRequestLocation,
  locationPermission,
  initialZipCode,
}: LocationPermissionModalProps) {
  const Colors = useColors();

  const [zipCode, setZipCode] = useState(initialZipCode || '');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [permissionDeniedMsg, setPermissionDeniedMsg] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setZipCode(initialZipCode || '');
      setIsGeocoding(false);
      setGeocodeError(null);
      setPermissionDeniedMsg(false);
    }
  }, [visible, initialZipCode]);

  // Watch for permission becoming granted while modal is open
  useEffect(() => {
    if (visible && locationPermission === 'granted') {
      onClose();
    }
  }, [visible, locationPermission, onClose]);

  // Show denied message when locationPermission changes to 'denied' while modal is open
  const prevPermissionRef = React.useRef(locationPermission);
  useEffect(() => {
    if (visible && prevPermissionRef.current !== 'denied' && locationPermission === 'denied') {
      setPermissionDeniedMsg(true);
    }
    prevPermissionRef.current = locationPermission;
  }, [visible, locationPermission]);

  const handleRequestLocation = async () => {
    setPermissionDeniedMsg(false);
    await onRequestLocation();
    // The useEffects above handle both outcomes:
    // - 'granted' → closes modal
    // - 'denied' → shows denied message
  };

  const handleUseZipCode = async () => {
    setIsGeocoding(true);
    setGeocodeError(null);
    try {
      const results = await Location.geocodeAsync(zipCode);
      if (results.length > 0) {
        onLocationGranted({ latitude: results[0].latitude, longitude: results[0].longitude }, zipCode);
        onClose();
      } else {
        setGeocodeError("Couldn't find that zip code — please try another.");
      }
    } catch {
      setGeocodeError('Something went wrong — please try again.');
    } finally {
      setIsGeocoding(false);
    }
  };

  const isZipComplete = zipCode.length === 5;
  const cardWidth = Math.min(SCREEN_WIDTH - 48, 400);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <Pressable style={[styles.overlay, { backgroundColor: Colors.overlay }]} onPress={onClose}>
          {/* Inner Pressable prevents backdrop dismiss when tapping the card */}
          <Pressable
            onPress={() => {}}
            style={[styles.modalCard, { backgroundColor: Colors.card, width: cardWidth }]}
          >
            {/* Close button */}
            <Pressable style={styles.closeButton} onPress={onClose} hitSlop={12}>
              <X size={22} color={Colors.textTertiary} />
            </Pressable>

            {/* MapPin icon */}
            <View style={styles.iconContainer}>
              <MapPin size={40} color={Colors.primary} />
            </View>

            {/* Title */}
            <Text style={[styles.title, { color: Colors.text }]}>Set Your Location</Text>

            {/* Description */}
            <Text style={[styles.description, { color: Colors.textSecondary }]}>
              Enable location services or enter a zip code to find restaurants near you.
            </Text>

            {/* Enable Location button */}
            <Pressable
              style={[styles.primaryButton, { backgroundColor: Colors.primary }]}
              onPress={handleRequestLocation}
            >
              <Text style={styles.primaryButtonText}>Enable Location</Text>
            </Pressable>

            {/* Permission denied message */}
            {permissionDeniedMsg && (
              <Text style={[styles.feedbackText, { color: Colors.textSecondary }]}>
                Location access was denied. You can enter a zip code below, or enable it in
                Settings.
              </Text>
            )}

            {/* Divider */}
            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: Colors.border }]} />
              <Text style={[styles.dividerText, { color: Colors.textTertiary }]}>
                or enter zip code
              </Text>
              <View style={[styles.dividerLine, { backgroundColor: Colors.border }]} />
            </View>

            {/* Zip code input */}
            <TextInput
              style={[
                styles.zipInput,
                {
                  backgroundColor: Colors.surface,
                  borderColor: Colors.border,
                  color: Colors.text,
                },
              ]}
              value={zipCode}
              onChangeText={setZipCode}
              keyboardType="number-pad"
              maxLength={5}
              placeholder="e.g. 90210"
              placeholderTextColor={Colors.textTertiary}
              textAlign="center"
            />

            {/* Use Zip Code button */}
            <Pressable
              style={[
                styles.secondaryButton,
                {
                  backgroundColor: Colors.surface,
                  borderColor: Colors.primary,
                },
                !isZipComplete && styles.disabledButton,
              ]}
              onPress={handleUseZipCode}
              disabled={!isZipComplete || isGeocoding}
            >
              {isGeocoding ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={[styles.secondaryButtonText, { color: Colors.primary }]}>
                  Use Zip Code
                </Text>
              )}
            </Pressable>

            {/* Geocode error */}
            {geocodeError != null && (
              <Text style={[styles.errorText, { color: Colors.error }]}>{geocodeError}</Text>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    borderRadius: 20,
    padding: 24,
    alignSelf: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  iconContainer: {
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    color: Colors.text,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  primaryButton: {
    width: '100%',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 24,
    backgroundColor: Colors.primary,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  feedbackText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
  zipInput: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    textAlign: 'center',
    width: '100%',
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    color: Colors.text,
  },
  secondaryButton: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderColor: Colors.primary,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  disabledButton: {
    opacity: 0.5,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    color: Colors.error,
  },
});
