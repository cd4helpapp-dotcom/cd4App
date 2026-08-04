import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus, Audio } from 'expo-av';

interface AnimatedSplashProps {
    onAnimationFinish: () => void;
}

export default function AnimatedSplash({ onAnimationFinish }: AnimatedSplashProps) {
    const videoRef = useRef<Video>(null);
    const [isVideoFinished, setIsVideoFinished] = useState(false);

    // Safety timeout: If the video takes too long or fails to load,
    // transition to the main app to avoid locking the user out.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!isVideoFinished) {
                console.log('Splash video safety timeout triggered.');
                onAnimationFinish();
            }
        }, 10000); // 10 seconds fallback

        return () => clearTimeout(timer);
    }, [onAnimationFinish, isVideoFinished]);

    // Set audio mode for iOS silent switch
    useEffect(() => {
        Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
        }).catch(err => {
            console.warn('Could not set silent mode audio preference:', err);
        });
    }, []);

    const handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
        if (!status.isLoaded) return;

        // Check if video has ended
        if (status.didJustFinish && !isVideoFinished) {
            setIsVideoFinished(true);
            onAnimationFinish();
        }
    };

    const handleVideoError = (error: string) => {
        console.error('Splash video playback error:', error);
        onAnimationFinish();
    };

    return (
        <View style={styles.container}>
            <Video
                ref={videoRef}
                source={require('../assets/splash video/splash_video.mp4')}
                style={styles.video}
                resizeMode={ResizeMode.COVER}
                shouldPlay
                isLooping={false}
                onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                onError={handleVideoError}
                isMuted={Platform.OS === 'web'} // Mute on web to bypass autoplay restrictions
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
        backgroundColor: '#ffffff', // Match native splash background to prevent transition flash
        zIndex: 9999, // Ensure it stays on top
    },
    video: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
});
