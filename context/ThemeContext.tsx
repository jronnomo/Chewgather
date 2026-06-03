import createContextHook from '@nkzw/create-context-hook';
import { useApp } from './AppContext';

export const LIGHT = {
  primary: '#E85D3A',
  primaryLight: '#FFF0EB',
  primaryDark: '#C94B2E',
  secondary: '#F5A623',
  secondaryLight: '#FFF4E0',
  cautionText: '#C97A1A',  // amber-700 (AA contrast on #FFF and #FFF4E0)
  background: '#F2F0ED',
  surface: '#FFFFFF',
  surfaceElevated: '#FAFAFA',
  card: '#FFFFFF',
  text: '#1A1A1A',
  textSecondary: '#6B6B6B',
  textTertiary: '#9E9E9E',
  textInverse: '#FFFFFF',
  border: '#E8E6E3',
  borderLight: '#F0EEEB',
  divider: '#ECEAE7',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#5AC8FA',
  overlay: 'rgba(0,0,0,0.4)',
  shadowColor: '#000',
  tabBar: '#FFFFFF',
  tabBarInactive: '#B0ADA8',
  tabBarActive: '#E85D3A',
  star: '#FFB800',
  badge: '#FF3B30',
  skeleton: '#E8E6E3',
};

export const DARK = {
  primary: '#FF7A5C',
  primaryLight: '#2A2119',
  primaryDark: '#C94B2E',
  secondary: '#F5A623',
  secondaryLight: '#2A2210',
  cautionText: '#E8A85C',  // amber-300 (AA contrast on #292524 card background)
  background: '#1C1917',
  surface: '#292524',
  surfaceElevated: '#363230',
  card: '#292524',
  text: '#F5F0EB',
  textSecondary: '#A8A29E',
  textTertiary: '#78716C',
  textInverse: '#1C1917',
  border: '#44403C',
  borderLight: '#292524',
  divider: '#292524',
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF453A',
  info: '#5AC8FA',
  overlay: 'rgba(0,0,0,0.6)',
  shadowColor: '#000',
  tabBar: '#292524',
  tabBarInactive: '#78716C',
  tabBarActive: '#FF7A5C',
  star: '#FFB800',
  badge: '#FF453A',
  skeleton: '#44403C',
};

export type AppColors = typeof LIGHT;

export const [ThemeProvider, useColors] = createContextHook(() => {
  const { preferences } = useApp();
  return preferences.isDarkMode ? DARK : LIGHT;
});
