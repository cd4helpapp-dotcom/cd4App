import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Theme } from '../../constants/Colors';
import FindDoctorView from '../teleconsultation/FindDoctorView';

interface TeleConsultationViewProps {
    theme: Theme;
}

export default function TeleConsultationView({ theme }: TeleConsultationViewProps) {
    return (
        <View style={styles.container}>
            <FindDoctorView theme={theme} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
});
