import React from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
// expo-router's own Tabs passes these props (state, descriptors, emitter, navigateToTab, insets) — there is no
// `navigation` object any more, so tab presses go through emitter + navigateToTab like its built-in tab bar.
import type { BottomTabBarProps } from 'expo-router/build/layouts/Tabs';
import { useAppTheme } from '../../hooks/useAppTheme';

type RouteWithIndex = BottomTabBarProps['state']['routes'][number] & {
  originalIndex: number;
};

type SmoothTabBarProps = BottomTabBarProps & {
  visibleRouteNames?: readonly string[];
  // Optional per-role override (hospital passes its own); otherwise the app theme is used.
  themeColors?: { background: string; border: string; active: string; inactive: string };
};

const DEFAULT_HEIGHT = 64;
const PILL_WIDTH = 60;
const PILL_HEIGHT = 32;
const ICON_SLOT = 25;
const useNativeDriver = Platform.OS !== 'web';

const getRouteLabel = (options: any, routeName: string, focused: boolean, color: string) => {
  const label = options.tabBarLabel ?? options.title ?? routeName;
  if (typeof label === 'function') {
    return label({ focused, color, position: 'below-icon', children: routeName });
  }
  return String(label);
};

const getVisibleRoutes = (props: SmoothTabBarProps): RouteWithIndex[] => {
  const allowedRoutes = props.visibleRouteNames?.length ? new Set(props.visibleRouteNames) : null;
  return props.state.routes
    .map((route, originalIndex) => ({ ...route, originalIndex }))
    .filter((route) => {
      if (allowedRoutes) return allowedRoutes.has(route.name);
      const options = props.descriptors[route.key]?.options as any;
      return options?.href !== null && options?.tabBarButton !== null;
    });
};

const getFlattenedTabBarStyle = (props: BottomTabBarProps) => {
  const focusedRoute = props.state.routes[props.state.index];
  const options = focusedRoute ? props.descriptors[focusedRoute.key]?.options : undefined;
  return StyleSheet.flatten((options as any)?.tabBarStyle) || {};
};

// One tab. The icon springs up when the tab becomes selected and the label fades to full strength.
function TabItem({
  focused,
  width,
  icon,
  label,
  color,
  labelStyle,
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
}: {
  focused: boolean;
  width: number;
  icon: React.ReactNode;
  label: React.ReactNode;
  color: string;
  labelStyle: { fontSize: number; lineHeight: number };
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const progress = React.useRef(new Animated.Value(focused ? 1 : 0)).current;
  const wasFocused = React.useRef(focused);

  React.useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      friction: 5,
      tension: 160,
      useNativeDriver,
    }).start();
    wasFocused.current = focused;
  }, [focused, progress]);

  // Overshoot then settle (spring) gives the "pop" of a real selected tab.
  const iconScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const iconLift = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : undefined}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: 'transparent' }}
      style={({ pressed }) => [styles.item, { width, opacity: pressed ? 0.75 : 1 }]}
    >
      <Animated.View style={[styles.iconWrap, { transform: [{ translateY: iconLift }, { scale: iconScale }] }]}>{icon}</Animated.View>
      {typeof label === 'string' ? (
        <Text
          numberOfLines={1}
          style={[styles.label, { color, fontSize: labelStyle.fontSize, lineHeight: labelStyle.lineHeight, fontWeight: focused ? '700' : '500' }]}
        >
          {label}
        </Text>
      ) : (
        label
      )}
    </Pressable>
  );
}

export default function SmoothTabBar(props: SmoothTabBarProps) {
  const { state, descriptors, emitter, navigateToTab, insets } = props;
  const { theme: appTheme } = useAppTheme();
  const override = props.themeColors;
  const theme = override
    ? { ...appTheme, cardBackground: override.background, divider: override.border, primary: override.active, textTertiary: override.inactive }
    : appTheme;
  const { width: windowWidth } = useWindowDimensions();
  const visibleRoutes = React.useMemo(() => getVisibleRoutes(props), [props]);
  const tabBarStyle = getFlattenedTabBarStyle(props) as any;
  const tabCount = Math.max(1, visibleRoutes.length);
  const itemWidth = windowWidth / tabCount;
  const focusedVisibleIndex = Math.max(
    0,
    visibleRoutes.findIndex((route) => route.originalIndex === state.index)
  );
  const hasFocusedVisibleRoute = visibleRoutes.some((route) => route.originalIndex === state.index);

  // The pill and the top indicator slide between tabs.
  const slide = React.useRef(new Animated.Value(focusedVisibleIndex)).current;
  // The pill squashes on arrival and springs back, like a droplet landing on the new tab.
  const pillPop = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    pillPop.setValue(0.72);
    Animated.spring(pillPop, { toValue: 1, friction: 4, tension: 170, useNativeDriver }).start();
    Animated.timing(slide, {
      toValue: focusedVisibleIndex,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    }).start();
  }, [focusedVisibleIndex, pillPop, slide]);

  if (!visibleRoutes.length || tabBarStyle?.display === 'none') return null;

  const containerHeight = typeof tabBarStyle?.height === 'number' ? tabBarStyle.height : DEFAULT_HEIGHT + insets.bottom;
  const paddingTop = Math.max(Number(tabBarStyle?.paddingTop) || 0, 9);
  const inputRange = visibleRoutes.map((_, i) => i);
  const pillX = slide.interpolate({
    inputRange: inputRange.length > 1 ? inputRange : [0, 1],
    outputRange: (inputRange.length > 1 ? inputRange : [0, 1]).map((i) => i * itemWidth + (itemWidth - PILL_WIDTH) / 2),
  });
  const barX = slide.interpolate({
    inputRange: inputRange.length > 1 ? inputRange : [0, 1],
    outputRange: (inputRange.length > 1 ? inputRange : [0, 1]).map((i) => i * itemWidth + (itemWidth - 28) / 2),
  });

  return (
    <View
      style={[
        styles.container,
        {
          height: containerHeight,
          paddingBottom: Math.max(insets.bottom, Number(tabBarStyle?.paddingBottom) || 4),
          paddingTop,
          backgroundColor: theme.cardBackground,
          borderTopColor: theme.divider,
          shadowColor: theme.shadow,
        },
      ]}
    >
      {hasFocusedVisibleRoute ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.topBar, { backgroundColor: theme.primary, transform: [{ translateX: barX }] }]} />
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { top: paddingTop + ICON_SLOT / 2 - PILL_HEIGHT / 2 + 1, backgroundColor: theme.primarySoft, shadowColor: theme.primary, transform: [{ translateX: pillX }, { scaleX: pillPop }] }]}
          />
        </>
      ) : null}

      {visibleRoutes.map((route) => {
        const options = descriptors[route.key].options as any;
        const focused = state.index === route.originalIndex;
        const color = focused ? theme.primary : theme.textTertiary;
        const flattenedLabelStyle = StyleSheet.flatten(options.tabBarLabelStyle) || {};

        return (
          <TabItem
            key={route.key}
            focused={focused}
            width={itemWidth}
            color={color}
            icon={options.tabBarIcon?.({ focused, color, size: 22 })}
            label={getRouteLabel(options, route.name, focused, color)}
            labelStyle={{ fontSize: Number(flattenedLabelStyle.fontSize) || 11, lineHeight: Number(flattenedLabelStyle.lineHeight) || 14 }}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarButtonTestID}
            onPress={() => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }}
            onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    position: 'relative',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  iconWrap: {
    height: ICON_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 2,
    textAlign: 'center',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  pill: {
    position: 'absolute',
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  topBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 28,
    height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
});
