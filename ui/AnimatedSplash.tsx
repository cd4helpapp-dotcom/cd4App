import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, useColorScheme, useWindowDimensions } from 'react-native';
import { useEventListener } from 'expo';
import { Asset } from 'expo-asset';
import { useVideoPlayer, VideoView } from 'expo-video';
import Colors from '../constants/Colors';

interface AnimatedSplashProps {
    onAnimationFinish: () => void;
}

const SPLASH_VIDEO = require('../assets/splash video/splash_video.mp4');
// The splash video is 1080×1920 (9:16). Fill phone screens; letterbox on tablets / desktop so nothing is cut.
const VIDEO_ASPECT = 9 / 16;
const SAFETY_TIMEOUT_MS = 8000;
const FADE_OUT_MS = 280;

export default function AnimatedSplash({ onAnimationFinish }: AnimatedSplashProps) {
    const colorScheme = useColorScheme();
    const { width, height } = useWindowDimensions();
    const opacity = useRef(new Animated.Value(1)).current;
    const hasFinishedRef = useRef(false);

    const shouldCover = width / height <= VIDEO_ASPECT + 0.05;
    const backgroundColor = colorScheme === 'dark' ? Colors.dark.background : '#FFFFFF';

    // Fade out instead of hard-cutting to the app. Guarded so error/timeout/end can't fire twice.
    const finish = useCallback(() => {
        if (hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        Animated.timing(opacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            useNativeDriver: Platform.OS !== 'web',
        }).start(() => onAnimationFinish());
    }, [onAnimationFinish, opacity]);

    // Safety net: never keep the user on the splash if the video stalls or can't load.
    useEffect(() => {
        const timer = setTimeout(finish, SAFETY_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [finish]);

    // Native player (web uses a plain <video> below). Muted: the splash is decorative and must not
    // interrupt the user's music.
    const player = useVideoPlayer(Platform.OS === 'web' ? null : SPLASH_VIDEO, (instance) => {
        instance.loop = false;
        instance.muted = true;
        instance.play();
    });
    useEventListener(player, 'playToEnd', () => finish());
    useEventListener(player, 'statusChange', ({ status, error }) => {
        if (status === 'error') handleVideoError(error);
    });

    function handleVideoError(error: unknown) {
        // The video is decorative; continue into the app immediately.
        if (__DEV__) console.warn('Splash video playback error:', error);
        finish();
    }

    return (
        <Animated.View style={[styles.container, { backgroundColor, opacity }]}>
            {Platform.OS === 'web' ? (
                // A plain element with object-fit scales the 1080×1920 video to the viewport correctly on web.
                React.createElement('video', {
                    // On SDK 58 web the required video is an asset id, not a URL; Asset resolves it to the served file.
                    src: Asset.fromModule(SPLASH_VIDEO).uri,
                    autoPlay: true,
                    muted: true,
                    playsInline: true,
                    onEnded: finish,
                    onError: handleVideoError,
                    style: {
                        width: '100%',
                        height: '100%',
                        objectFit: shouldCover ? 'cover' : 'contain',
                        backgroundColor,
                        display: 'block',
                    },
                })
            ) : (
                <VideoView
                    player={player}
                    style={StyleSheet.absoluteFill}
                    contentFit={shouldCover ? 'cover' : 'contain'}
                    nativeControls={false}
                />
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFill,
        zIndex: 9999,
    },
});
