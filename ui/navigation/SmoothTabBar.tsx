import React from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

type RouteWithIndex = BottomTabBarProps['state']['routes'][number] & {
  originalIndex: number;
};

type SmoothTabBarProps = BottomTabBarProps & {
  visibleRouteNames?: readonly string[];
  themeColors?: {
    background: string;
    border: string;
    active: string;
    inactive: string;
  };
};

const DEFAULT_HEIGHT = 64;

const getRouteLabel = (options: any, routeName: string, focused: boolean, color: string) => {
  const label = options.tabBarLabel ?? options.title ?? routeName;
  if (typeof label === 'function') {
    return label({
      focused,
      color,
      position: 'below-icon',
      children: routeName,
    });
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

export default function SmoothTabBar(props: SmoothTabBarProps) {
  const { state, descriptors, navigation, insets } = props;
  const { width: windowWidth } = useWindowDimensions();
  const visibleRoutes = React.useMemo(() => getVisibleRoutes(props), [props]);
  const tabBarStyle = getFlattenedTabBarStyle(props) as any;
  const focusedRoute = state.routes[state.index];
  const activeTint = String(props.themeColors?.active || tabBarStyle?.tintColor || descriptors[focusedRoute?.key || '']?.options?.tabBarActiveTintColor || '#0F8F5F');
  const inactiveTint = String(props.themeColors?.inactive || descriptors[focusedRoute?.key || '']?.options?.tabBarInactiveTintColor || '#94A3B8');

  if (!visibleRoutes.length || tabBarStyle?.display === 'none') {
    return null;
  }

  const tabCount = Math.max(1, visibleRoutes.length);
  const barWidth = windowWidth;
  const itemWidth = barWidth / tabCount;
  const containerHeight =
    typeof tabBarStyle?.height === 'number'
      ? tabBarStyle.height
      : DEFAULT_HEIGHT + insets.bottom;

  return (
    <View
      style={[
        styles.container,
        {
          height: containerHeight,
          paddingBottom: Math.max(insets.bottom, Number(tabBarStyle?.paddingBottom) || 4),
          paddingTop: Number(tabBarStyle?.paddingTop) || 6,
          backgroundColor: props.themeColors?.background || tabBarStyle?.backgroundColor || '#FFFFFF',
          borderTopColor: props.themeColors?.border || tabBarStyle?.borderTopColor || 'rgba(15, 23, 42, 0.10)',
        },
      ]}
    >
      {visibleRoutes.map((route) => {
        const descriptor = descriptors[route.key];
        const options = descriptor.options as any;
        const focused = state.index === route.originalIndex;
        const color = focused ? activeTint : inactiveTint;
        const icon = options.tabBarIcon?.({
          focused,
          color,
          size: 22,
        });
        const label = getRouteLabel(options, route.name, focused, color);

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : undefined}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarButtonTestID}
            onPress={onPress}
            onLongPress={onLongPress}
            android_ripple={{ color: 'transparent' }}
            style={({ pressed }) => [
              styles.item,
              {
                width: itemWidth,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <Animated.View style={[styles.iconWrap, focused && styles.activeIconWrap]}>
              {icon}
            </Animated.View>
            {typeof label === 'string' ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  {
                    color,
                    fontSize: Number(StyleSheet.flatten(options.tabBarLabelStyle)?.fontSize) || 10,
                    lineHeight: Number(StyleSheet.flatten(options.tabBarLabelStyle)?.lineHeight) || 12,
                  },
                ]}
              >
                {label}
              </Text>
            ) : (
              label
            )}
          </Pressable>
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
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 0,
  },
  iconWrap: {
    height: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeIconWrap: {
    transform: [{ translateY: -1 }],
  },
  label: {
    marginTop: 1,
    textAlign: 'center',
    fontWeight: '600',
    letterSpacing: 0,
    includeFontPadding: false,
  },
});
