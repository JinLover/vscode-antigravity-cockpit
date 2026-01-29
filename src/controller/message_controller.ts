import * as vscode from 'vscode';
import { CockpitHUD } from '../view/hud';
import { ReactorCore } from '../engine/reactor';
import { configService } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { i18n, normalizeLocaleInput, t } from '../shared/i18n';
import { WebviewMessage } from '../shared/types';
import { DISPLAY_MODE } from '../shared/constants';
import { getQuotaHistory, clearHistory, clearAllHistory } from '../services/quota_history';

export class MessageController {
    private context: vscode.ExtensionContext;

    constructor(
        context: vscode.ExtensionContext,
        private hud: CockpitHUD,
        private reactor: ReactorCore,
        private onRetry: () => Promise<void>,
    ) {
        this.context = context;
        this.setupMessageHandling();
    }

    private setupMessageHandling(): void {
        this.hud.onSignal(async (msg: WebviewMessage) => {
            const message = msg;
            switch (message.command) {
                case 'togglePin':
                    if (message.modelId) {
                        await configService.togglePinnedModel(message.modelId);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('togglePin signal missing modelId');
                    }
                    break;

                case 'toggleCredits':
                    await configService.toggleShowPromptCredits();
                    this.reactor.reprocess();
                    break;

                case 'updateOrder':
                    if (message.order) {
                        await configService.updateModelOrder(message.order);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateOrder signal missing order data');
                    }
                    break;

                case 'updateVisibleModels':
                    if (Array.isArray(message.visibleModels)) {
                        await configService.updateVisibleModels(message.visibleModels);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateVisibleModels signal missing visibleModels');
                    }
                    break;

                case 'resetOrder': {
                    const currentConfig = configService.getConfig();
                    if (currentConfig.groupingEnabled) {
                        await configService.resetGroupOrder();
                    } else {
                        await configService.resetModelOrder();
                    }
                    this.reactor.reprocess();
                    break;
                }

                case 'refresh':
                    this.reactor.syncTelemetry();
                    break;

                case 'init':
                    if (this.reactor.hasCache) {
                        this.reactor.reprocess();
                    } else {
                        this.reactor.syncTelemetry();
                    }
                    break;

                case 'retry':
                    await this.onRetry();
                    break;

                case 'openLogs':
                    logger.show();
                    break;

                case 'rerender':
                    this.reactor.reprocess();
                    break;

                case 'toggleGrouping': {
                    const enabled = await configService.toggleGroupingEnabled();
                    if (enabled) {
                        const config = configService.getConfig();
                        if (!config.groupingShowInStatusBar) {
                            await configService.updateConfig('groupingShowInStatusBar', true);
                        }
                        if (Object.keys(config.groupMappings).length === 0) {
                            const latestSnapshot = this.reactor.getLatestSnapshot();
                            if (latestSnapshot && latestSnapshot.models.length > 0) {
                                const newMappings = ReactorCore.calculateGroupMappings(latestSnapshot.models);
                                await configService.updateGroupMappings(newMappings);
                            }
                        }
                    }
                    this.reactor.reprocess();
                    break;
                }

                case 'renameGroup':
                    if (message.modelIds && message.groupName) {
                        await configService.updateGroupName(message.modelIds, message.groupName);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('renameGroup signal missing required data');
                    }
                    break;

                case 'promptRenameGroup':
                    if (message.modelIds && message.currentName) {
                        const newName = await vscode.window.showInputBox({
                            prompt: t('grouping.renamePrompt'),
                            value: message.currentName,
                            placeHolder: t('grouping.rename'),
                        });
                        if (newName && newName.trim() && newName !== message.currentName) {
                            await configService.updateGroupName(message.modelIds, newName.trim());
                            this.reactor.reprocess();
                        }
                    } else {
                        logger.warn('promptRenameGroup signal missing required data');
                    }
                    break;

                case 'renameModel':
                    if (message.modelId && message.groupName) {
                        await configService.updateModelName(message.modelId, message.groupName);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('renameModel signal missing required data');
                    }
                    break;

                case 'toggleGroupPin':
                    if (message.groupId) {
                        await configService.togglePinnedGroup(message.groupId);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('toggleGroupPin signal missing groupId');
                    }
                    break;

                case 'updateGroupOrder':
                    if (message.order) {
                        await configService.updateGroupOrder(message.order);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateGroupOrder signal missing order');
                    }
                    break;

                case 'saveCustomGrouping': {
                    const { customGroupMappings, customGroupNames } = message as { customGroupMappings?: Record<string, string>; customGroupNames?: Record<string, string> };
                    if (customGroupMappings) {
                        await configService.updateGroupMappings(customGroupMappings);
                        await configService.updateConfig('pinnedGroups', []);
                        if (customGroupNames) {
                            await configService.updateConfig('groupingCustomNames', customGroupNames);
                        }
                        this.reactor.reprocess();
                    }
                    break;
                }

                case 'updateStatusBarFormat':
                    if (message.statusBarFormat) {
                        await configService.updateConfig('statusBarFormat', message.statusBarFormat);
                        this.reactor.reprocess();
                    } else {
                        logger.warn('updateStatusBarFormat signal missing statusBarFormat');
                    }
                    break;

                case 'toggleProfile': {
                    const currentConfig = configService.getConfig();
                    await configService.updateConfig('profileHidden', !currentConfig.profileHidden);
                    this.reactor.reprocess();
                    break;
                }

                case 'updateDisplayMode':
                    if (message.displayMode) {
                        await configService.updateConfig('displayMode', message.displayMode);
                        if (message.displayMode === DISPLAY_MODE.QUICKPICK) {
                            this.hud.dispose();
                            this.reactor.reprocess();
                            vscode.commands.executeCommand('agCockpit.open');
                        } else {
                            this.reactor.reprocess();
                        }
                    }
                    break;

                case 'updateNotificationEnabled':
                    if (message.notificationEnabled !== undefined) {
                        await configService.updateConfig('notificationEnabled', Boolean(message.notificationEnabled));
                        this.reactor.reprocess();
                    }
                    break;

                case 'updateThresholds':
                    if (message.warningThreshold !== undefined && message.criticalThreshold !== undefined) {
                        await configService.updateConfig('warningThreshold', Number(message.warningThreshold));
                        await configService.updateConfig('criticalThreshold', Number(message.criticalThreshold));
                        this.reactor.reprocess();
                    }
                    break;

                case 'updateDataMasked':
                    if (message.dataMasked !== undefined) {
                        await configService.updateConfig('dataMasked', message.dataMasked);
                        this.reactor.reprocess();
                    }
                    break;

                case 'updateLanguage':
                    if (message.language !== undefined) {
                        const rawLanguage = String(message.language);
                        const newLanguage = normalizeLocaleInput(rawLanguage);
                        await configService.updateConfig('language', newLanguage);
                        i18n.applyLanguageSetting(newLanguage);
                        this.hud.dispose();
                        setTimeout(() => {
                            vscode.commands.executeCommand('agCockpit.open');
                        }, 100);
                    }
                    break;

                case 'quotaHistory.get': {
                    const { email, modelId, rangeDays } = message as { email?: string; modelId?: string; rangeDays?: number };
                    const data = await getQuotaHistory(email, rangeDays, modelId);
                    this.hud.sendMessage({ type: 'quotaHistoryData', data });
                    break;
                }

                case 'quotaHistory.clear':
                    if (message.email) {
                        await clearHistory(String(message.email));
                        this.hud.sendMessage({ type: 'quotaHistoryCleared' });
                    }
                    break;

                case 'quotaHistory.clearAll':
                    await clearAllHistory();
                    this.hud.sendMessage({ type: 'quotaHistoryCleared' });
                    break;

                default:
                    logger.debug(`Unhandled webview command: ${message.command}`);
            }
        });
    }
}
