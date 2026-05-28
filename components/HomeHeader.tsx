import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';
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
      <Text
        style={[styles.primary, { color: Colors.text }]}
        accessibilityRole="header"
        numberOfLines={2}
      >
        {greeting.primary}
      </Text>
      {greeting.secondary ? (
        <Text
          style={[styles.secondary, { color: Colors.textSecondary }]}
          numberOfLines={2}
        >
          {greeting.secondary}
        </Text>
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
