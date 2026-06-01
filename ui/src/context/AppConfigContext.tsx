'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

interface AppConfig {
    uiVersion: string;
    apiVersion: string;
    deploymentMode: string;
    authProvider: string;
    turnEnabled: boolean;
    forceTurnRelay: boolean;
    hostedServicesEnabled: boolean;
    voiceRuntime: 'pipecat' | 'livekit';
    livekitEnabled: boolean;
}

interface AppConfigContextType {
    config: AppConfig | null;
    loading: boolean;
    refresh: () => Promise<void>;
}

const defaultConfig: AppConfig = {
    uiVersion: 'dev',
    apiVersion: 'unknown',
    deploymentMode: 'oss',
    authProvider: 'local',
    turnEnabled: false,
    forceTurnRelay: false,
    hostedServicesEnabled: false,
    voiceRuntime: 'pipecat',
    livekitEnabled: false,
};

const AppConfigContext = createContext<AppConfigContextType>({
    config: null,
    loading: true,
    refresh: async () => {},
});

export function AppConfigProvider({ children }: { children: ReactNode }) {
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/config/version');
            const data = await res.json();
            setConfig({
                uiVersion: data.ui || 'dev',
                apiVersion: data.api || 'unknown',
                deploymentMode: data.deploymentMode || 'oss',
                authProvider: data.authProvider || 'local',
                turnEnabled: Boolean(data.turnEnabled),
                forceTurnRelay: Boolean(data.forceTurnRelay),
                hostedServicesEnabled: Boolean(data.hostedServicesEnabled),
                voiceRuntime: data.voiceRuntime === 'livekit' ? 'livekit' : 'pipecat',
                livekitEnabled: Boolean(data.livekitEnabled),
            });
        } catch {
            setConfig(defaultConfig);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return (
        <AppConfigContext.Provider value={{ config, loading, refresh }}>
            {children}
        </AppConfigContext.Provider>
    );
}

export function useAppConfig() {
    return useContext(AppConfigContext);
}
