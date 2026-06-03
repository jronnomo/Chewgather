import { Link, Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import StaticColors from "@/constants/colors";
import { useColors } from "@/context/ThemeContext";
import AppText from "@/components/AppText";

const Colors = StaticColors;

export default function NotFoundScreen() {
  const Colors = useColors();
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: Colors.background }]}>
        <AppText variant="dense" style={styles.emoji}>🍽️</AppText>
        <AppText variant="display" style={[styles.title, { color: Colors.text }]}>Page not found</AppText>
        <AppText variant="body" style={[styles.subtitle, { color: Colors.textSecondary }]}>
          This screen doesn't exist.
        </AppText>
        <Link href="/" style={[styles.link, { backgroundColor: Colors.primary }]}>
          <AppText variant="dense" numberOfLines={1} style={styles.linkText}>Go back home</AppText>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: Colors.background,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: Colors.text,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  link: {
    marginTop: 24,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#FFF",
  },
});
