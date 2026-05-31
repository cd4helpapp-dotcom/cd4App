import React, { createContext, useState, useContext, ReactNode } from 'react';

type AppMode = 'teleconsultation' | 'reversal';

interface AppModeContextType {
    mode: AppMode;
    setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextType | undefined>(undefined);

export function AppModeProvider({ children }: { children: ReactNode }) {
    const [mode, setMode] = useState<AppMode>('teleconsultation');

    return (
        <AppModeContext.Provider value={{ mode, setMode }}>
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
