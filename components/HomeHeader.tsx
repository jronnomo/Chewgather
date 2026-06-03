import React from 'react';
import { StyleSheet, View } from 'react-native';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';
import AppText from '@/components/AppText';
import type { Greeting } from '@/lib/homeGreeting';

const Colors = StaticColors;

interface HomeHeaderProps {
  greeting: Greeting;
  testID?: string;
}

export default function HomeHeader({ greeting, testID }: HomeHeaderProps) {
  const Colors = useColors();
  return (
    <View style={styles.container} testID={testID}>
      <AppText
        variant="display"
        style={[styles.primary, { color: Colors.text }]}
        accessibilityRole="header"
        numberOfLines={3}
      >
        {greeting.primary}
      </AppText>
      {greeting.secondary ? (
        <AppText
          variant="dense"
          style={[styles.secondary, { color: Colors.textSecondary }]}
          numberOfLines={2}
        >
          {greeting.secondary}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  primary: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
    color: Colors.text,
  },
  secondary: {
    fontSize: 15,
    marginTop: 4,
    color: Colors.textSecondary,
  },
});
