
import * as vscode from 'vscode';
import { ReactorCore } from '../engine/reactor';
import { StatusBarController } from './status_bar_controller';
import { CockpitHUD } from '../view/hud';
import { QuickPickView } from '../view/quickpick_view';
import { configService, CockpitConfig } from '../shared/config_service';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';
import { QuotaSnapshot } from '../shared/types';
import { QUOTA_THRESHOLDS, TIMING } from '../shared/constants';
import { recordQuotaHistory } from '../services/quota_history';


export class TelemetryController {
    private notifiedModels: Set<string> = new Set();
    private lastSuccessfulUpdate: Date | null = null;
    private consecutiveFailures: number = 0;

    constructor(
        private reactor: ReactorCore,
        private statusBar: StatusBarController,
        private hud: CockpitHUD,
        private quickPickView: QuickPickView,
        private onRetry: () => Promise<void>,
    ) {
        this.setupTelemetryHandling();
    }

    public resetNotifications(): void {
        this.notifiedModels.clear();
    }

    private setupTelemetryHandling(): void {
        this.reactor.onTelemetry(async (snapshot: QuotaSnapshot) => {
            let config = configService.getConfig();

            this.lastSuccessfulUpdate = new Date();
            this.consecutiveFailures = 0;

            this.statusBar.reset();

            this.checkAndNotifyQuota(snapshot, config);

            if (config.groupingEnabled && Object.keys(config.groupMappings).length === 0 && snapshot.models.length > 0) {
                const newMappings = ReactorCore.calculateGroupMappings(snapshot.models);
                await configService.updateGroupMappings(newMappings);
                logger.info(`Auto-grouped on first run: ${Object.keys(newMappings).length} models`);
                this.reactor.reprocess();
                return;
            }

            if (config.groupingEnabled && snapshot.groups && snapshot.groups.length > 0) {
                const currentPinnedGroups = config.pinnedGroups;
                const allGroupIds = snapshot.groups.map(g => g.groupId);

                if (currentPinnedGroups.length === 0) {
                    logger.info(`Auto-pinning all ${allGroupIds.length} groups to status bar`);
                    await configService.updateConfig('pinnedGroups', allGroupIds);
                    config = configService.getConfig();
                }
            }

            this.hud.refreshView(snapshot, {
                showPromptCredits: config.showPromptCredits,
                pinnedModels: config.pinnedModels,
                modelOrder: config.modelOrder,
                modelCustomNames: config.modelCustomNames,
                visibleModels: config.visibleModels,
                groupingEnabled: config.groupingEnabled,
                groupCustomNames: config.groupingCustomNames,
                groupingShowInStatusBar: config.groupingShowInStatusBar,
                pinnedGroups: config.pinnedGroups,
                groupOrder: config.groupOrder,
                refreshInterval: config.refreshInterval,
                notificationEnabled: config.notificationEnabled,
                warningThreshold: config.warningThreshold,
                criticalThreshold: config.criticalThreshold,
                lastSuccessfulUpdate: this.lastSuccessfulUpdate,
                statusBarFormat: config.statusBarFormat,
                profileHidden: config.profileHidden,
                displayMode: config.displayMode,
                dataMasked: config.dataMasked,
                groupMappings: config.groupMappings,
                language: config.language,
            });

            const snapshotEmail = snapshot.userInfo?.email;
            const localEmail = snapshot.localAccountEmail;
            let historyEmail = (snapshotEmail && snapshotEmail.includes('@')) ? snapshotEmail : null;
            if (!historyEmail && localEmail && localEmail.includes('@')) {
                historyEmail = localEmail;
            }
            if (historyEmail) {
                void recordQuotaHistory(historyEmail, snapshot).then(changed => {
                    if (changed && this.hud.isVisible()) {
                        this.hud.sendMessage({
                            type: 'quotaHistoryUpdated',
                            data: { email: historyEmail },
                        });
                    }
                });
            }

            this.quickPickView.updateSnapshot(snapshot);

            this.statusBar.update(snapshot, config);
        });

        this.reactor.onMalfunction(async (err: Error) => {
            const source = (err as Error & { source?: string }).source;
            const sourceInfo = source ? ` (source=${source})` : '';
            logger.error(`Reactor Malfunction${sourceInfo}: ${err.message}`);

            if (err.message.includes('ECONNREFUSED') || 
                err.message.includes('Signal Lost') || 
                err.message.includes('Signal Corrupted')) {
                
                this.consecutiveFailures++;
                
                if (this.consecutiveFailures <= TIMING.MAX_CONSECUTIVE_RETRY) {
                    logger.warn(`Connection issue detected (attempt ${this.consecutiveFailures}/${TIMING.MAX_CONSECUTIVE_RETRY}), initiating immediate re-scan protocol...`);
                    await this.onRetry();
                    return;
                } else {
                    logger.error(`Connection failed after ${this.consecutiveFailures} consecutive attempts. Stopping auto-retry.`);
                }
            }


            this.statusBar.setError(err.message);

            vscode.window.showErrorMessage(
                `${t('notify.bootFailed')}: ${err.message}`,
                t('help.retry'),
                t('help.openLogs'),
            ).then(selection => {
                if (selection === t('help.retry')) {
                    vscode.commands.executeCommand('agCockpit.retry');
                } else if (selection === t('help.openLogs')) {
                    logger.show();
                }
            });
        });
    }

    private checkAndNotifyQuota(snapshot: QuotaSnapshot, config: CockpitConfig): void {
        if (!config.notificationEnabled) {
            return;
        }

        const warningThreshold = config.warningThreshold ?? QUOTA_THRESHOLDS.WARNING_DEFAULT;
        const criticalThreshold = config.criticalThreshold ?? QUOTA_THRESHOLDS.CRITICAL_DEFAULT;

        const useGroups = config.groupingEnabled && Array.isArray(snapshot.groups) && snapshot.groups.length > 0;
        if (useGroups) {
            for (const group of snapshot.groups!) {
                const pct = group.remainingPercentage ?? 0;
                const keyBase = `group:${group.groupId}`;
                const notifyKey = `${keyBase}-${pct <= criticalThreshold ? 'critical' : 'warning'}`;

                if (this.notifiedModels.has(notifyKey)) {
                    continue;
                }

                if (pct <= criticalThreshold && pct > 0) {
                    this.notifiedModels.delete(`${keyBase}-warning`);
                    this.notifiedModels.add(notifyKey);

                    vscode.window.showWarningMessage(
                        t('threshold.notifyCritical', { model: group.groupName, percent: pct.toFixed(1) }),
                        t('dashboard.refresh'),
                    ).then(selection => {
                        if (selection === t('dashboard.refresh')) {
                            this.reactor.syncTelemetry();
                        }
                    });
                    logger.info(`Critical threshold notification sent for ${group.groupName}: ${pct}%`);
                }
                else if (pct <= warningThreshold && pct > criticalThreshold) {
                    this.notifiedModels.add(notifyKey);

                    vscode.window.showInformationMessage(
                        t('threshold.notifyWarning', { model: group.groupName, percent: pct.toFixed(1) }),
                    );
                    logger.info(`Warning threshold notification sent for ${group.groupName}: ${pct}%`);
                }
                else if (pct > warningThreshold) {
                    this.notifiedModels.delete(`${keyBase}-warning`);
                    this.notifiedModels.delete(`${keyBase}-critical`);
                }
            }
            return;
        }

        for (const model of snapshot.models) {
            const pct = model.remainingPercentage ?? 0;
            const notifyKey = `${model.modelId}-${pct <= criticalThreshold ? 'critical' : 'warning'}`;

            if (this.notifiedModels.has(notifyKey)) {
                continue;
            }

            if (pct <= criticalThreshold && pct > 0) {
                this.notifiedModels.delete(`${model.modelId}-warning`);
                this.notifiedModels.add(notifyKey);

                vscode.window.showWarningMessage(
                    t('threshold.notifyCritical', { model: model.label, percent: pct.toFixed(1) }),
                    t('dashboard.refresh'),
                ).then(selection => {
                    if (selection === t('dashboard.refresh')) {
                        this.reactor.syncTelemetry();
                    }
                });
                logger.info(`Critical threshold notification sent for ${model.label}: ${pct}%`);
            }
            else if (pct <= warningThreshold && pct > criticalThreshold) {
                this.notifiedModels.add(notifyKey);

                vscode.window.showInformationMessage(
                    t('threshold.notifyWarning', { model: model.label, percent: pct.toFixed(1) }),
                );
                logger.info(`Warning threshold notification sent for ${model.label}: ${pct}%`);
            }
            else if (pct > warningThreshold) {
                this.notifiedModels.delete(`${model.modelId}-warning`);
                this.notifiedModels.delete(`${model.modelId}-critical`);
            }
        }
    }

    // External account sync removed in hardened mode.
}
