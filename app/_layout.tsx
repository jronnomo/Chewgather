import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProvider } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ThemeTransitionProvider } from "@/context/ThemeTransitionContext";
import ChompOverlay from "@/components/ChompOverlay";
import { configurePushHandler } from "@/services/notifications";
import Colors from "@/constants/colors";

SplashScreen.preventAutoHideAsync();
configurePushHandler();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

class ErrorBoundaryFallback extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.emoji}>😵</Text>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.subtitle}>
            Please restart the app and try again.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: Colors.background,
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: Colors.text,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 8,
    textAlign: "center",
  },
});

function NotificationHandler() {
  const router = useRouter();

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        if (!data?.type) return;

        const type = data.type as string;
        switch (type) {
          case "plan_invite":
          case "rsvp_response":
          case "group_swipe_result":
          case "swipe_completed":
          case "plan_reminder":
            if (data.planId) router.push(`/(tabs)/plans?planId=${data.planId}` as never);
            break;
          case "group_swipe_invite":
            router.push("/group-session" as never);
            break;
          case "friend_request":
            router.push("/(tabs)/friends?tab=requests" as never);
            break;
          case "friend_accepted":
            router.push("/(tabs)/friends" as never);
            break;
        }
      }
    );
    return () => subscription.remove();
  }, [router]);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="onboarding"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="auth"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="review-picks"
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="friends"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="restaurant/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="plan-event"
        options={{
          presentation: "modal",
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="swipe"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="group-session"
        options={{
          headerShown: false,
          animation: 'slide_from_bottom',
        }}
      />
      <Stack.Screen
        name="notifications"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
      <Stack.Screen
        name="filtered-restaurants"
        options={{
          headerShown: false,
          animation: 'slide_from_right',
        }}
      />
    </Stack>
  );
}

function SplashGate({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView>
        <ErrorBoundaryFallback>
          <AuthProvider>
            <SplashGate>
              <AppProvider>
                <ThemeProvider>
                  <ThemeTransitionProvider>
                    <NotificationHandler />
                    <RootLayoutNav />
                    <ChompOverlay />
                  </ThemeTransitionProvider>
                </ThemeProvider>
              </AppProvider>
            </SplashGate>
          </AuthProvider>
        </ErrorBoundaryFallback>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
