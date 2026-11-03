import React, { createContext, useEffect, useState, useContext, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AppMode = 'teleconsultation' | 'reversal';

interface AppModeContextType {
    mode: AppMode;
    setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextType | undefined>(undefined);
const APP_MODE_STORAGE_KEY = 'cd4_app_mode_v1';

export function AppModeProvider({ children }: { children: ReactNode }) {
    const [mode, setMode] = useState<AppMode>('teleconsultation');

    useEffect(() => {
        void AsyncStorage.getItem(APP_MODE_STORAGE_KEY).then((saved) => {
            if (saved === 'teleconsultation' || saved === 'reversal') setMode(saved);
        }).catch(() => {});
    }, []);

    const updateMode = (nextMode: AppMode) => {
        setMode(nextMode);
        void AsyncStorage.setItem(APP_MODE_STORAGE_KEY, nextMode).catch(() => {});
    };

    return (
        <AppModeContext.Provider value={{ mode, setMode: updateMode }}>
            {children}
        </AppModeContext.Provider>
    );
}

export function useAppMode() {
    const context = useContext(AppModeContext);
    if (context === undefined) {
        throw new Error('useAppMode must be used within an AppModeProvider');
    }
    return context;
}
