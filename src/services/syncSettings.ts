/**
 * 
 * 
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from '../shared/log_service';

const SHARED_DIR = path.join(os.homedir(), '.antigravity_cockpit');

const SYNC_SETTINGS_FILE = 'sync_settings.json';

export type SyncSettingKey = 'language' | 'theme';

export interface SyncSettingValue {
    value: string;
    updated_at: number;
    updated_by: 'plugin' | 'desktop';
}

export interface SyncSettings {
    language?: SyncSettingValue;
    theme?: SyncSettingValue;
}

/**
 */
function getSyncSettingsPath(): string {
    return path.join(SHARED_DIR, SYNC_SETTINGS_FILE);
}

/**
 */
function ensureSharedDir(): void {
    if (!fs.existsSync(SHARED_DIR)) {
        fs.mkdirSync(SHARED_DIR, { recursive: true });
    }
}

/**
 */
export function readSyncSettings(): SyncSettings {
    try {
        const filePath = getSyncSettingsPath();
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content) as SyncSettings;
        }
    } catch (error) {
        logger.warn('[SyncSettings] Failed to read sync settings; returning empty settings:', error);
    }
    return {};
}

/**
 * 
 */
export function writeSyncSetting(key: SyncSettingKey, value: string): void {
    try {
        ensureSharedDir();
        
        const settings = readSyncSettings();
        settings[key] = {
            value,
            updated_at: Date.now(),
            updated_by: 'plugin',
        };
        
        const filePath = getSyncSettingsPath();
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
        
        logger.info(`[SyncSettings] Wrote sync setting: ${key} = ${value}`);
    } catch (error) {
        logger.error('[SyncSettings] Failed to write sync setting:', error);
    }
}

/**
 * 
 */
export function clearSyncSetting(key: SyncSettingKey): void {
    try {
        const settings = readSyncSettings();
        if (settings[key]) {
            delete settings[key];
            
            const filePath = getSyncSettingsPath();
            fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
            
            logger.info(`[SyncSettings] Cleared sync setting: ${key}`);
        }
    } catch (error) {
        logger.error('[SyncSettings] Failed to clear sync setting:', error);
    }
}

/**
 * 
 */
export function getSyncSetting(key: SyncSettingKey): SyncSettingValue | undefined {
    const settings = readSyncSettings();
    return settings[key];
}

/**
 * 
 */
export function mergeSettingOnStartup(
    key: SyncSettingKey,
    localValue: string,
    localUpdatedAt?: number,
): string | undefined {
    const syncSetting = getSyncSetting(key);
    
    if (!syncSetting) {
        return undefined;
    }
    
    if (syncSetting.value === localValue) {
        clearSyncSetting(key);
        return undefined;
    }
    
    if (!localUpdatedAt || syncSetting.updated_at > localUpdatedAt) {
        logger.info(`[SyncSettings] Merged ${key}: shared "${syncSetting.value}" > local "${localValue}"`);
        clearSyncSetting(key);
        return syncSetting.value;
    }
    
    return undefined;
}

export const syncSettings = {
    read: readSyncSettings,
    write: writeSyncSetting,
    clear: clearSyncSetting,
    get: getSyncSetting,
    merge: mergeSettingOnStartup,
};
