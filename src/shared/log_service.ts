/**
 */

import * as vscode from 'vscode';
import { LOG_LEVELS } from './constants';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
    [LOG_LEVELS.DEBUG]: LogLevel.DEBUG,
    [LOG_LEVELS.INFO]: LogLevel.INFO,
    [LOG_LEVELS.WARN]: LogLevel.WARN,
    [LOG_LEVELS.ERROR]: LogLevel.ERROR,
};

class Logger {
    private outputChannel: vscode.OutputChannel | null = null;
    private logLevel: LogLevel = LogLevel.INFO;
    private isInitialized = false;
    private configDisposable?: vscode.Disposable;

    /**
     */
    init(): void {
        if (this.isInitialized) {
            return;
        }
        
        this.outputChannel = vscode.window.createOutputChannel('Antigravity Cockpit');
        this.isInitialized = true;

        this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('agCockpit.logLevel')) {
                this.updateLogLevel();
            }
        });

        this.updateLogLevel();
    }

    /**
     */
    private updateLogLevel(): void {
        const config = vscode.workspace.getConfiguration('agCockpit');
        const levelStr = config.get<string>('logLevel', LOG_LEVELS.INFO);
        this.logLevel = LOG_LEVEL_MAP[levelStr] ?? LogLevel.INFO;
    }

    /**
     */
    setLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    /**
     */
    getLevel(): LogLevel {
        return this.logLevel;
    }

    /**
     */
    private getTimestamp(): string {
        const now = new Date();
        return now.toISOString().replace('T', ' ').substring(0, 19);
    }

    /**
     */
    private formatMessage(level: string, message: string, ...args: unknown[]): string {
        const timestamp = this.getTimestamp();
        let formatted = `[${timestamp}] [${level}] ${message}`;

        if (args.length > 0) {
            const argsStr = args.map(arg => {
                if (arg instanceof Error) {
                    return `${arg.message}\n${arg.stack || ''}`;
                }
                if (typeof arg === 'object' && arg !== null) {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');
            formatted += ` ${argsStr}`;
        }

        return formatted;
    }

    /**
     */
    private log(level: LogLevel, levelStr: string, message: string, ...args: unknown[]): void {
        if (level < this.logLevel) {
            return;
        }

        const formatted = this.formatMessage(levelStr, message, ...args);

        if (this.outputChannel) {
            this.outputChannel.appendLine(formatted);
        }

        switch (level) {
            case LogLevel.DEBUG:
                console.log(formatted);
                break;
            case LogLevel.INFO:
                console.info(formatted);
                break;
            case LogLevel.WARN:
                console.warn(formatted);
                break;
            case LogLevel.ERROR:
                console.error(formatted);
                break;
        }
    }

    /**
     */
    debug(message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
    }

    /**
     */
    info(message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, 'INFO', message, ...args);
    }

    /**
     */
    warn(message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARN, 'WARN', message, ...args);
    }

    /**
     */
    error(message: string, ...args: unknown[]): void {
        this.log(LogLevel.ERROR, 'ERROR', message, ...args);
    }

    /**
     */
    show(): void {
        this.outputChannel?.show();
    }

    /**
     */
    hide(): void {
        this.outputChannel?.hide();
    }

    /**
     */
    clear(): void {
        this.outputChannel?.clear();
    }

    /**
     */
    dispose(): void {
        this.configDisposable?.dispose();
        this.configDisposable = undefined;
        this.outputChannel?.dispose();
        this.outputChannel = null;
        this.isInitialized = false;
    }

    /**
     */
    group(label: string): void {
        this.outputChannel?.appendLine(`\n${'='.repeat(50)}`);
        this.outputChannel?.appendLine(`📁 ${label}`);
        this.outputChannel?.appendLine('='.repeat(50));
    }

    /**
     */
    groupEnd(): void {
        this.outputChannel?.appendLine('-'.repeat(50) + '\n');
    }
}

export const logger = new Logger();
