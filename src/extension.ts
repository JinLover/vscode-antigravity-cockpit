/**
 */

import * as vscode from 'vscode';
import { ProcessHunter } from './engine/hunter';
import { ReactorCore } from './engine/reactor';
import { logger } from './shared/log_service';
import { configService, CockpitConfig } from './shared/config_service';
import { t, i18n } from './shared/i18n';
import { CockpitHUD } from './view/hud';
import { QuickPickView } from './view/quickpick_view';

// Controllers
import { StatusBarController } from './controller/status_bar_controller';
import { CommandController } from './controller/command_controller';
import { MessageController } from './controller/message_controller';
import { TelemetryController } from './controller/telemetry_controller';

let hunter: ProcessHunter;
let reactor: ReactorCore;
let hud: CockpitHUD;
let quickPickView: QuickPickView;

// Controllers
let statusBar: StatusBarController;
let _commandController: CommandController;
let _messageController: MessageController;
let _telemetryController: TelemetryController;

let systemOnline = false;

let autoRetryCount = 0;
const MAX_AUTO_RETRY = 3;
const AUTO_RETRY_DELAY_MS = 5000;

/**
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    logger.init();
    await configService.initialize(context);

    const savedLanguage = configService.getConfig().language;
    if (savedLanguage) {
        i18n.applyLanguageSetting(savedLanguage);
    }

    try {
        const { mergeSettingOnStartup } = await import('./services/syncSettings');
        const mergedLanguage = mergeSettingOnStartup('language', savedLanguage || 'auto');
        if (mergedLanguage) {
            logger.info(`[SyncSettings] Merged language on startup: ${savedLanguage} -> ${mergedLanguage}`);
            await configService.updateConfig('language', mergedLanguage);
            i18n.applyLanguageSetting(mergedLanguage);
        }
    } catch (err) {
        logger.debug(`[SyncSettings] Startup sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const packageJson = await import('../package.json');
    const version = packageJson.version || 'unknown';

    logger.info(`Antigravity Cockpit v${version} - Systems Online`);

    hunter = new ProcessHunter();
    reactor = new ReactorCore();
    hud = new CockpitHUD(context.extensionUri, context);
    quickPickView = new QuickPickView();

    context.subscriptions.push(hud.registerSerializer());

    quickPickView.onRefresh(() => {
        reactor.syncTelemetry();
    });

    statusBar = new StatusBarController(context);

    const onRetry = async () => {
        systemOnline = false;
        await bootSystems();
    };

    _telemetryController = new TelemetryController(reactor, statusBar, hud, quickPickView, onRetry);
    _messageController = new MessageController(context, hud, reactor, onRetry);
    _commandController = new CommandController(context, hud, quickPickView, reactor, onRetry);

    context.subscriptions.push(
        configService.onConfigChange(handleConfigChange),
    );

    await bootSystems();

    logger.info('Antigravity Cockpit Fully Operational');
}

/**
 */
async function handleConfigChange(config: CockpitConfig): Promise<void> {
    logger.debug('Configuration changed', config);

    const newInterval = configService.getRefreshIntervalMs();

    if (systemOnline && reactor.currentInterval !== newInterval) {
        logger.info(`Refresh interval changed from ${reactor.currentInterval}ms to ${newInterval}ms. Restarting Reactor.`);
        reactor.startReactor(newInterval);
    }

    reactor.reprocess();
}

/**
 */
async function bootSystems(): Promise<void> {
    if (systemOnline) {
        return;
    }

    statusBar.setLoading();

    try {
        const info = await hunter.scanEnvironment(3);

        if (info) {
            reactor.engage(info.connectPort, info.csrfToken, hunter.getLastDiagnostics());
            reactor.startReactor(configService.getRefreshIntervalMs());
            systemOnline = true;
            autoRetryCount = 0;
            statusBar.setReady();
            logger.info('System boot successful');
        } else {
            if (autoRetryCount < MAX_AUTO_RETRY) {
                autoRetryCount++;
                logger.info(`Auto-retry ${autoRetryCount}/${MAX_AUTO_RETRY} in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
                statusBar.setLoading(`(${autoRetryCount}/${MAX_AUTO_RETRY})`);

                setTimeout(() => {
                    bootSystems();
                }, AUTO_RETRY_DELAY_MS);
            } else {
                autoRetryCount = 0;
                handleOfflineState();
            }
        }
    } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        logger.error('Boot Error', error);

        if (autoRetryCount < MAX_AUTO_RETRY) {
            autoRetryCount++;
            logger.info(`Auto-retry ${autoRetryCount}/${MAX_AUTO_RETRY} after error in ${AUTO_RETRY_DELAY_MS / 1000}s...`);
            statusBar.setLoading(`(${autoRetryCount}/${MAX_AUTO_RETRY})`);

            setTimeout(() => {
                bootSystems();
            }, AUTO_RETRY_DELAY_MS);
        } else {
            autoRetryCount = 0;
            statusBar.setError(error.message);

            vscode.window.showErrorMessage(
                `${t('notify.bootFailed')}: ${error.message}`,
                t('help.retry'),
                t('help.openLogs'),
            ).then(selection => {
                if (selection === t('help.retry')) {
                    vscode.commands.executeCommand('agCockpit.retry');
                } else if (selection === t('help.openLogs')) {
                    logger.show();
                }
            });
        }
    }
}

/**
 */
function handleOfflineState(): void {
    statusBar.setOffline();

    vscode.window.showErrorMessage(
        t('notify.offline'),
        t('help.retry'),
        t('help.openLogs'),
    ).then(selection => {
        if (selection === t('help.retry')) {
            vscode.commands.executeCommand('agCockpit.retry');
        } else if (selection === t('help.openLogs')) {
            logger.show();
        }
    });

    hud.refreshView(ReactorCore.createOfflineSnapshot(t('notify.offline')), {
        showPromptCredits: false,
        pinnedModels: [],
        modelOrder: [],
        groupingEnabled: false,
        groupCustomNames: {},
        groupingShowInStatusBar: false,
        pinnedGroups: [],
        groupOrder: [],
        refreshInterval: 120,
        notificationEnabled: false,
        language: configService.getConfig().language,
    });
}

/**
 */
export async function deactivate(): Promise<void> {
    logger.info('Antigravity Cockpit: Shutting down...');

    reactor?.shutdown();
    hud?.dispose();
    logger.dispose();
}
