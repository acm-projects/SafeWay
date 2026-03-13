import { Tabs } from 'expo-router';

/**
 * Tab layout - uses GlobalTabBar from root layout for navigation.
 */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{ headerShown: false }}
    >
      {/* Order matters for state.index mapping */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
