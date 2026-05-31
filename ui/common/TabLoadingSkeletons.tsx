import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Theme } from '../../constants/Colors';
import ShimmerBlock from './ShimmerSkeleton';

type SkeletonProps = {
    theme: Theme;
};

const getPalette = (theme: Theme) => ({
    base: theme.background.toLowerCase() === '#121212'
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(15,23,42,0.08)',
    glow: theme.background.toLowerCase() === '#121212'
        ? 'rgba(255,255,255,0.20)'
        : 'rgba(255,255,255,0.72)',
});

export function HomeTabSkeleton({ theme }: SkeletonProps) {
    const palette = getPalette(theme);
    return (
        <View style={styles.screenPad}>
            <View style={[styles.homeShellCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <View style={styles.homeHeaderRow}>
                    <View style={styles.flex1}>
                        <ShimmerBlock width="62%" height={20} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.gap8} />
                        <ShimmerBlock width="88%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                    </View>
                    <ShimmerBlock width={58} height={26} borderRadius={13} baseColor={palette.base} highlightColor={palette.glow} />
                </View>
                <View style={styles.gap14} />
                <ShimmerBlock width="100%" height={112} borderRadius={16} baseColor={palette.base} highlightColor={palette.glow} />
                <View style={styles.gap12} />
                <View style={styles.homeInputRow}>
                    <ShimmerBlock width="78%" height={40} borderRadius={12} baseColor={palette.base} highlightColor={palette.glow} />
                    <ShimmerBlock width={40} height={40} borderRadius={12} baseColor={palette.base} highlightColor={palette.glow} />
                </View>
            </View>

            <View style={styles.gap16} />
            <ShimmerBlock width="46%" height={18} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
            <View style={styles.gap12} />
            <View style={styles.homeChipRow}>
                <ShimmerBlock width="31%" height={34} borderRadius={17} baseColor={palette.base} highlightColor={palette.glow} />
                <ShimmerBlock width="31%" height={34} borderRadius={17} baseColor={palette.base} highlightColor={palette.glow} />
                <ShimmerBlock width="31%" height={34} borderRadius={17} baseColor={palette.base} highlightColor={palette.glow} />
            </View>

            <View style={styles.gap16} />
            <View style={[styles.homeShellCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                <ShimmerBlock width="32%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                <View style={styles.gap8} />
                <ShimmerBlock width="78%" height={18} borderRadius={9} baseColor={palette.base} highlightColor={palette.glow} />
                <View style={styles.gap8} />
                <ShimmerBlock width="94%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                <View style={styles.gap12} />
                <ShimmerBlock width="52%" height={34} borderRadius={17} baseColor={palette.base} highlightColor={palette.glow} />
            </View>

            <View style={styles.gap16} />
            {Array.from({ length: 2 }).map((_, index) => (
                <View key={`home-doctor-skel-${index}`} style={[styles.cardShell, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                    <View style={styles.rowTop}>
                        <ShimmerBlock width={62} height={62} borderRadius={12} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.flex1}>
                            <ShimmerBlock width="66%" height={14} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                            <View style={styles.gap8} />
                            <ShimmerBlock width="45%" height={11} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                            <View style={styles.gap8} />
                            <ShimmerBlock width="58%" height={11} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                        </View>
                    </View>
                    <View style={styles.gap12} />
                    <ShimmerBlock width="100%" height={40} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
                </View>
            ))}
        </View>
    );
}

export function AppointmentsTabSkeleton({ theme }: SkeletonProps) {
    const palette = getPalette(theme);
    return (
        <View style={styles.listOnlyPad}>
            {Array.from({ length: 3 }).map((_, index) => (
                <View
                    key={`appointments-skel-${index}`}
                    style={[styles.cardShell, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                >
                    <View style={styles.rowTop}>
                        <ShimmerBlock width={62} height={62} borderRadius={12} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.flex1}>
                            <ShimmerBlock width="64%" height={14} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                            <View style={styles.gap8} />
                            <ShimmerBlock width="48%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                            <View style={styles.gap8} />
                            <ShimmerBlock width="38%" height={11} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                        </View>
                    </View>
                    <View style={styles.gap12} />
                    <ShimmerBlock width="100%" height={46} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
                </View>
            ))}
        </View>
    );
}

export function RecordsTabSkeleton({ theme }: SkeletonProps) {
    const palette = getPalette(theme);
    return (
        <View style={styles.screenPad}>
            <ShimmerBlock width="100%" height={48} borderRadius={12} baseColor={palette.base} highlightColor={palette.glow} />
            <View style={styles.gap16} />
            <View style={styles.tabsRow}>
                <ShimmerBlock width="24%" height={28} borderRadius={14} baseColor={palette.base} highlightColor={palette.glow} />
                <ShimmerBlock width="24%" height={28} borderRadius={14} baseColor={palette.base} highlightColor={palette.glow} />
                <ShimmerBlock width="24%" height={28} borderRadius={14} baseColor={palette.base} highlightColor={palette.glow} />
                <ShimmerBlock width="24%" height={28} borderRadius={14} baseColor={palette.base} highlightColor={palette.glow} />
            </View>
            <View style={styles.gap16} />
            {Array.from({ length: 3 }).map((_, index) => (
                <View
                    key={`records-skel-${index}`}
                    style={[styles.recordCardShell, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                >
                    <ShimmerBlock width={42} height={42} borderRadius={10} baseColor={palette.base} highlightColor={palette.glow} />
                    <View style={styles.flex1}>
                        <ShimmerBlock width="62%" height={13} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.gap8} />
                        <ShimmerBlock width="38%" height={11} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.gap8} />
                        <ShimmerBlock width="86%" height={11} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                    </View>
                </View>
            ))}
        </View>
    );
}

export function ChatTabSkeleton({ theme }: SkeletonProps) {
    const palette = getPalette(theme);
    const chatBorderColor = `${theme.borderColor}40`;
    return (
        <View style={styles.chatListPad}>
            {Array.from({ length: 6 }).map((_, index) => (
                <View key={`chat-skel-${index}`} style={[styles.chatRow, { borderBottomColor: chatBorderColor }]}>
                    <ShimmerBlock width={50} height={50} borderRadius={25} baseColor={palette.base} highlightColor={palette.glow} />
                    <View style={styles.flex1}>
                        <ShimmerBlock width="48%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.gap8} />
                        <ShimmerBlock width="76%" height={11} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                    </View>
                </View>
            ))}
        </View>
    );
}

export function CommunityTabSkeleton({ theme }: SkeletonProps) {
    const palette = getPalette(theme);
    return (
        <View style={styles.listOnlyPad}>
            {Array.from({ length: 3 }).map((_, index) => (
                <View
                    key={`community-skel-${index}`}
                    style={[styles.communityCardShell, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}
                >
                    <View style={styles.rowTop}>
                        <ShimmerBlock width={34} height={34} borderRadius={17} baseColor={palette.base} highlightColor={palette.glow} />
                        <View style={styles.flex1}>
                            <ShimmerBlock width="44%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                            <View style={styles.gap8} />
                            <ShimmerBlock width="30%" height={10} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                        </View>
                    </View>
                    <View style={styles.gap12} />
                    <ShimmerBlock width="100%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                    <View style={styles.gap8} />
                    <ShimmerBlock width="92%" height={12} borderRadius={8} baseColor={palette.base} highlightColor={palette.glow} />
                    <View style={styles.gap12} />
                    <ShimmerBlock width="100%" height={150} borderRadius={12} baseColor={palette.base} highlightColor={palette.glow} />
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    screenPad: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 20,
    },
    listOnlyPad: {
        paddingBottom: 18,
    },
    chatListPad: {
        paddingHorizontal: 16,
        paddingTop: 2,
        paddingBottom: 18,
    },
    cardShell: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        marginBottom: 12,
    },
    recordCardShell: {
        borderWidth: 1,
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    communityCardShell: {
        borderWidth: 1,
        borderRadius: 16,
        padding: 12,
        marginBottom: 12,
    },
    rowTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    gridRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    tabsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    chatRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    flex1: {
        flex: 1,
    },
    gap8: {
        height: 8,
    },
    gap12: {
        height: 12,
    },
    gap14: {
        height: 14,
    },
    gap16: {
        height: 16,
    },
    homeShellCard: {
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
    },
    homeHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    homeInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    homeChipRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
});
