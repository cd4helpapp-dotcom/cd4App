import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import ScreenWrapper from '../common/ScreenWrapper';

type DoctorSafeScreenProps = {
  children: React.ReactNode;
  backgroundColor: string;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
  panHandlers?: any;
};

export default function DoctorSafeScreen({
  children,
  backgroundColor,
  edges = [],
  style,
  panHandlers,
}: DoctorSafeScreenProps) {
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor }, style]} edges={edges}>
      <ScreenWrapper
        withScrollView={false}
        keyboardAvoiding={false}
        applyTopInset={false}
        applyBottomInset={false}
        style={{ flex: 1, backgroundColor }}
      >
        <View style={{ flex: 1 }} {...panHandlers}>
          {children}
        </View>
      </ScreenWrapper>
    </SafeAreaView>
  );
}
