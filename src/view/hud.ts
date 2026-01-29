/**
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QuotaSnapshot, DashboardConfig, WebviewMessage } from '../shared/types';
import { logger } from '../shared/log_service';
import { configService } from '../shared/config_service';
import { i18n, t, localeDisplayNames } from '../shared/i18n';

/**
 */
export class CockpitHUD {
    public static readonly viewType = 'antigravity.cockpit';
    
    private panel: vscode.WebviewPanel | undefined;
    private cachedTelemetry?: QuotaSnapshot;
    private messageRouter?: (message: WebviewMessage) => void;
    private readonly extensionUri: vscode.Uri;
    private readonly context: vscode.ExtensionContext;

    constructor(
        extensionUri: vscode.Uri, 
        context: vscode.ExtensionContext,
    ) {
        this.extensionUri = extensionUri;
        this.context = context;
    }

    /**
     */
    public registerSerializer(): vscode.Disposable {
        return vscode.window.registerWebviewPanelSerializer(CockpitHUD.viewType, {
            deserializeWebviewPanel: async (webviewPanel: vscode.WebviewPanel, _state: unknown) => {
                logger.info('[CockpitHUD] Restoring webview panel after reload');
                
                if (this.panel) {
                    logger.info('[CockpitHUD] Disposing old panel before restoration');
                    this.panel.dispose();
                }
                
                this.panel = webviewPanel;

                webviewPanel.webview.options = {
                    enableScripts: true,
                    localResourceRoots: [this.extensionUri],
                };

                i18n.applyLanguageSetting(configService.getConfig().language);
                webviewPanel.webview.html = this.generateHtml(webviewPanel.webview);
                
                webviewPanel.onDidDispose(() => {
                    this.panel = undefined;
                });
                
                webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
                    if (this.messageRouter) {
                        this.messageRouter(message);
                    }
                });
                
                if (this.cachedTelemetry) {
                    await this.refreshWithCachedData();
                }
            },
        });
    }

    /**
     */
    public async revealHud(initialTab?: string): Promise<boolean> {
        const localeChanged = i18n.applyLanguageSetting(configService.getConfig().language);
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (this.panel) {
            if (localeChanged) {
                this.panel.webview.html = this.generateHtml(this.panel.webview);
            }
            this.panel.reveal(column);
            await this.refreshWithCachedData();
            if (initialTab) {
                setTimeout(() => {
                    this.panel?.webview.postMessage({ type: 'switchTab', tab: initialTab });
                }, 100);
            }
            return true;
        }

        await this.closeOrphanTabs();

        try {
            const panel = vscode.window.createWebviewPanel(
                CockpitHUD.viewType,
                t('dashboard.title'),
                column || vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    localResourceRoots: [this.extensionUri],
                    retainContextWhenHidden: true,
                },
            );

            this.panel = panel;

            panel.onDidDispose(() => {
                this.panel = undefined;
            });

            panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
                if (this.messageRouter) {
                    this.messageRouter(message);
                }
            });

            panel.webview.html = this.generateHtml(panel.webview);

            if (this.cachedTelemetry) {
                await this.refreshWithCachedData();
            }

            if (initialTab) {
                setTimeout(() => {
                    panel.webview.postMessage({ type: 'switchTab', tab: initialTab });
                }, 500);
            }

            return true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(`Failed to create Webview panel: ${err.message}`);
            return false;
        }
    }

    /**
     */
    private async closeOrphanTabs(): Promise<void> {
        try {
            const tabsToClose: vscode.Tab[] = [];
            
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputWebview) {
                        const tabViewType = tab.input.viewType;
                        if (tabViewType === CockpitHUD.viewType || 
                            tabViewType.includes(CockpitHUD.viewType) ||
                            tabViewType.endsWith(CockpitHUD.viewType)) {
                            tabsToClose.push(tab);
                        }
                    }
                }
            }

            if (tabsToClose.length > 0) {
                logger.info(`[CockpitHUD] Closing ${tabsToClose.length} orphan webview tab(s)`);
                await vscode.window.tabGroups.close(tabsToClose);
            }
        } catch (error) {
            logger.debug(`[CockpitHUD] Failed to close orphan tabs: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     */
    private async refreshWithCachedData(): Promise<void> {
        if (!this.cachedTelemetry) {
            return;
        }
        const config = configService.getConfig();

        this.refreshView(this.cachedTelemetry, {
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
            statusBarFormat: config.statusBarFormat,
            profileHidden: config.profileHidden,
            displayMode: config.displayMode,
            dataMasked: config.dataMasked,
            groupMappings: config.groupMappings,
            language: config.language,
        });
    }

    /**
     */
    public async rehydrate(): Promise<void> {
        await this.refreshWithCachedData();
    }

    /**
     */
    public onSignal(handler: (message: WebviewMessage) => void): void {
        this.messageRouter = handler;
    }

    /**
     */
    public sendMessage(message: object): void {
        if (this.panel) {
            this.panel.webview.postMessage(message);
        }
    }

    /**
     */
    public isVisible(): boolean {
        return this.panel?.visible === true;
    }

    /**
     */
    public refreshView(snapshot: QuotaSnapshot, config: DashboardConfig): void {
        this.cachedTelemetry = snapshot;
        
        if (this.panel) {
            const localeChanged = i18n.applyLanguageSetting(configService.getConfig().language);
            if (localeChanged) {
                this.panel.webview.html = this.generateHtml(this.panel.webview);
            }

            const webviewData = this.convertToWebviewFormat(snapshot);

            this.panel.webview.postMessage({
                type: 'telemetry_update',
                data: webviewData,
                config,
            });
        }
    }

    /**
     */
    private convertToWebviewFormat(snapshot: QuotaSnapshot): object {
        return {
            timestamp: snapshot.timestamp,
            isConnected: snapshot.isConnected,
            errorMessage: snapshot.errorMessage,
            prompt_credits: snapshot.promptCredits ? {
                available: snapshot.promptCredits.available,
                monthly: snapshot.promptCredits.monthly,
                remainingPercentage: snapshot.promptCredits.remainingPercentage,
                usedPercentage: snapshot.promptCredits.usedPercentage,
            } : undefined,
            userInfo: snapshot.userInfo ? {
                name: snapshot.userInfo.name,
                email: snapshot.userInfo.email,
                planName: snapshot.userInfo.planName,
                tier: snapshot.userInfo.tier,
                browserEnabled: snapshot.userInfo.browserEnabled,
                knowledgeBaseEnabled: snapshot.userInfo.knowledgeBaseEnabled,
                canBuyMoreCredits: snapshot.userInfo.canBuyMoreCredits,
                hasAutocompleteFastMode: snapshot.userInfo.hasAutocompleteFastMode,
                monthlyPromptCredits: snapshot.userInfo.monthlyPromptCredits,
                monthlyFlowCredits: snapshot.userInfo.monthlyFlowCredits,
                availablePromptCredits: snapshot.userInfo.availablePromptCredits,
                availableFlowCredits: snapshot.userInfo.availableFlowCredits,
                cascadeWebSearchEnabled: snapshot.userInfo.cascadeWebSearchEnabled,
                canGenerateCommitMessages: snapshot.userInfo.canGenerateCommitMessages,
                allowMcpServers: snapshot.userInfo.allowMcpServers,
                maxNumChatInputTokens: snapshot.userInfo.maxNumChatInputTokens,
                tierDescription: snapshot.userInfo.tierDescription,
                upgradeUri: snapshot.userInfo.upgradeUri,
                upgradeText: snapshot.userInfo.upgradeText,
                // New fields
                teamsTier: snapshot.userInfo.teamsTier,
                hasTabToJump: snapshot.userInfo.hasTabToJump,
                allowStickyPremiumModels: snapshot.userInfo.allowStickyPremiumModels,
                allowPremiumCommandModels: snapshot.userInfo.allowPremiumCommandModels,
                maxNumPremiumChatMessages: snapshot.userInfo.maxNumPremiumChatMessages,
                maxCustomChatInstructionCharacters: snapshot.userInfo.maxCustomChatInstructionCharacters,
                maxNumPinnedContextItems: snapshot.userInfo.maxNumPinnedContextItems,
                maxLocalIndexSize: snapshot.userInfo.maxLocalIndexSize,
                monthlyFlexCreditPurchaseAmount: snapshot.userInfo.monthlyFlexCreditPurchaseAmount,
                canCustomizeAppIcon: snapshot.userInfo.canCustomizeAppIcon,
                cascadeCanAutoRunCommands: snapshot.userInfo.cascadeCanAutoRunCommands,
                canAllowCascadeInBackground: snapshot.userInfo.canAllowCascadeInBackground,
                allowAutoRunCommands: snapshot.userInfo.allowAutoRunCommands,
                allowBrowserExperimentalFeatures: snapshot.userInfo.allowBrowserExperimentalFeatures,
                acceptedLatestTermsOfService: snapshot.userInfo.acceptedLatestTermsOfService,
                userTierId: snapshot.userInfo.userTierId,
            } : undefined,
            models: snapshot.models.map(m => ({
                label: m.label,
                modelId: m.modelId,
                remainingPercentage: m.remainingPercentage,
                isExhausted: m.isExhausted,
                timeUntilResetFormatted: m.timeUntilResetFormatted,
                resetTimeDisplay: m.resetTimeDisplay,
                supportsImages: m.supportsImages,
                isRecommended: m.isRecommended,
                tagTitle: m.tagTitle,
                supportedMimeTypes: m.supportedMimeTypes,
            })),
            allModels: snapshot.allModels?.map(m => ({
                label: m.label,
                modelId: m.modelId,
                remainingPercentage: m.remainingPercentage,
                isExhausted: m.isExhausted,
                timeUntilResetFormatted: m.timeUntilResetFormatted,
                resetTimeDisplay: m.resetTimeDisplay,
                supportsImages: m.supportsImages,
                isRecommended: m.isRecommended,
                tagTitle: m.tagTitle,
                supportedMimeTypes: m.supportedMimeTypes,
            })),
            groups: snapshot.groups?.map(g => ({
                groupId: g.groupId,
                groupName: g.groupName,
                remainingPercentage: g.remainingPercentage,
                resetTimeDisplay: g.resetTimeDisplay,
                timeUntilResetFormatted: g.timeUntilResetFormatted,
                isExhausted: g.isExhausted,
                models: g.models.map(m => ({
                    label: m.label,
                    modelId: m.modelId,
                    supportsImages: m.supportsImages,
                    isRecommended: m.isRecommended,
                    tagTitle: m.tagTitle,
                    supportedMimeTypes: m.supportedMimeTypes,
                })),
            })),
            localAccountEmail: snapshot.localAccountEmail,
        };
    }

    /**
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    /**
     */
    private getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
        return webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, ...pathSegments),
        );
    }

    /**
     */
    private readResourceFile(...pathSegments: string[]): string {
        try {
            const filePath = path.join(this.extensionUri.fsPath, ...pathSegments);
            return fs.readFileSync(filePath, 'utf8');
        } catch (e) {
            logger.error(`Failed to read resource file: ${pathSegments.join('/')}`, e);
            return '';
        }
    }

    /**
     */
    private generateHtml(webview: vscode.Webview): string {
        const styleUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'dashboard.css');
        const sharedModalStyleUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'shared_modals.css');
        const scriptUri = this.getWebviewUri(webview, 'out', 'view', 'webview', 'dashboard.js');

        const translations = i18n.getAllTranslations();
        const translationsJson = JSON.stringify(translations);

        // CSP nonce
        const nonce = this.generateNonce();

        return `<!DOCTYPE html>
<html lang="${i18n.getLocale()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
    <title>${t('dashboard.title')}</title>
    <link rel="stylesheet" href="${styleUri}">
    <link rel="stylesheet" href="${sharedModalStyleUri}">
</head>
<body>
    <header class="header">
        <div class="header-title">
            <span class="icon">🚀</span>
            <span>${t('dashboard.title')}</span>
        </div>
        <div class="controls">
            <button id="refresh-btn" class="refresh-btn" title="${t('statusBarFormat.manualRefresh')}">
                ${t('dashboard.refresh')}
            </button>
            <button id="reset-order-btn" class="refresh-btn" title="${t('statusBarFormat.resetOrderTooltip')}">
                ${t('dashboard.resetOrder')}
            </button>
            <button id="manage-models-btn" class="refresh-btn" title="${t('models.manageTitle')}">
                ${t('models.manage')}
            </button>
            <button id="toggle-grouping-btn" class="refresh-btn" title="${t('grouping.toggleHint')}">
                ${t('grouping.title')}
            </button>
            <!-- Plan button hidden -->
            <button id="toggle-profile-btn" class="refresh-btn hidden" title="${t('profile.togglePlan')}">
                ${t('profile.planDetails')}
            </button>
            <button id="settings-btn" class="refresh-btn icon-only" title="${t('threshold.settings')}">
                ⚙️
            </button>
        </div>
    </header>

    <!-- Tab Navigation -->
    <nav class="tab-nav">
        <button class="tab-btn active" data-tab="quota">📊 ${t('dashboard.title')}</button>
        <button class="tab-btn" data-tab="history">📈 ${t('history.tabTitle')}</button>
        <div class="tab-spacer"></div>
    </nav>

    <!-- Quota Tab Content -->
    <div id="tab-quota" class="tab-content active">
        <div id="status" class="status-connecting">
            <span class="spinner"></span>
            <span>${t('dashboard.connecting')}</span>
        </div>

        <div id="dashboard">
            <!-- Injected via JS -->
        </div>
    </div>
    <!-- History Tab Content -->
    <div id="tab-history" class="tab-content">
        <div class="history-card">
            <div class="history-header">
                <div class="history-title">📈 ${t('history.title')}</div>
                <div class="history-controls">
                    <label class="history-label" for="history-account-select">${t('history.accountLabel')}</label>
                    <select id="history-account-select" class="history-select"></select>
                    <label class="history-label" for="history-model-select">${t('history.modelLabel')}</label>
                    <select id="history-model-select" class="history-select"></select>
                    <div class="history-range">
                        <button class="history-range-btn" data-range="1">${t('history.range24h')}</button>
                        <button class="history-range-btn" data-range="7">${t('history.range7d')}</button>
                        <button class="history-range-btn" data-range="30">${t('history.range30d')}</button>
                        <button id="history-clear-btn" class="history-range-btn icon-only" title="${t('history.clearTooltip') || 'Clear History'}" style="margin-left: 8px;">🗑️</button>
                    </div>
                </div>
            </div>
            <div class="history-body">
                <canvas id="history-chart" class="history-canvas"></canvas>
                <div id="history-empty" class="history-empty hidden">${t('history.noData')}</div>
            </div>
            <div class="history-details">
                <div class="history-details-title">${t('history.tableTitle')}</div>
                <div class="history-table-wrapper">
                    <table class="history-table">
                        <thead>
                            <tr>
                                <th>${t('history.tableTime')}</th>
                                <th>${t('history.tablePercent')}</th>
                                <th>${t('history.tableDelta')}</th>
                                <th>${t('history.tableResetTime')}</th>
                                <th>${t('history.tableCountdown')}</th>
                            </tr>
                        </thead>
                        <tbody id="history-table-body"></tbody>
                    </table>
                    <div id="history-table-empty" class="history-table-empty hidden">${t('history.tableEmpty')}</div>
                </div>
                <div class="history-pagination">
                    <button id="history-prev" class="history-page-btn">${t('history.paginationPrev')}</button>
                    <span id="history-page-info" class="history-page-info"></span>
                    <button id="history-next" class="history-page-btn">${t('history.paginationNext')}</button>
                </div>
            </div>
            <div class="history-footer">
                <div id="history-metric-label" class="history-metric"></div>
                <div id="history-summary" class="history-summary"></div>
            </div>
        </div>
    </div>

    <!-- History Clear Confirm Modal -->
    <div id="history-clear-modal" class="modal hidden">
        <div class="modal-content modal-content-small">
            <div class="modal-header">
                <h3>⚠️ ${t('history.clearTitle')}</h3>
                <button id="history-clear-close" class="close-btn">×</button>
            </div>
            <div class="modal-body" style="text-align: center; padding: 20px;">
                <p id="history-clear-message" style="margin-bottom: 20px;">${t('history.clearConfirmDefault') || 'Are you sure you want to clear quota history?'}</p>
            </div>
            <div class="modal-footer" style="flex-direction: column; gap: 8px;">
                <button id="history-clear-this-btn" class="btn-primary" style="background: var(--vscode-errorForeground); width: 100%;">🗑️ ${t('history.clearThis') || 'Clear This Account'}</button>
                <button id="history-clear-all-btn" class="btn-secondary" style="width: 100%; color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground);">🗑️ ${t('history.clearAll') || 'Clear All Accounts'}</button>
                <button id="history-clear-cancel" class="btn-secondary" style="width: 100%; margin-top: 4px;">${t('common.cancel')}</button>
            </div>
        </div>
    </div>



    <!-- Model Manager Modal -->
    <div id="model-manager-modal" class="modal hidden">
        <div class="modal-content modal-content-wide">
            <div class="modal-header">
                <h3>🧩 ${t('models.manageTitle')}</h3>
                <button id="model-manager-close" class="close-btn">×</button>
            </div>
            <div class="modal-body model-manager-body">
                <div class="model-manager-hint">${t('models.hint')}</div>
                <div class="model-manager-toolbar">
                    <button id="model-manager-select-all" class="btn-secondary">${t('models.selectAll')}</button>
                    <button id="model-manager-clear" class="btn-secondary">${t('models.clearAll')}</button>
                    <span id="model-manager-count" class="model-manager-count"></span>
                </div>
                <div id="model-manager-list" class="model-manager-list"></div>
            </div>
            <div class="modal-footer">
                <button id="model-manager-cancel" class="btn-secondary">${t('common.cancel')}</button>
                <button id="model-manager-save" class="btn-primary">${t('models.save')}</button>
            </div>
        </div>
    </div>

    <div id="settings-modal" class="modal hidden">
        <div class="modal-content modal-content-wide">
            <div class="modal-header">
                <h3>⚙️ ${t('threshold.settings')}</h3>
                <button id="close-settings-btn" class="close-btn">×</button>
            </div>
            <div class="modal-body">
                <!-- Language settings -->
                <div class="setting-item">
                    <label for="language-select">🌐 ${t('language.title') || 'Language'}</label>
                    <select id="language-select" class="setting-select">
                        <option value="auto">${t('language.auto') || 'Auto (Follow VS Code)'}</option>
                        ${this.generateLanguageOptions()}
                    </select>
                    <p class="setting-hint">${t('language.hint') || 'Override VS Code language for this extension'}</p>
                </div>

                <hr class="setting-divider">

                <!-- Display Mode and View Mode moved to bottom -->

                <!-- Status bar style selection -->
                <div class="setting-item">
                    <label for="statusbar-format">📊 ${i18n.t('statusBarFormat.title')}</label>
                    <select id="statusbar-format" class="setting-select">
                        <option value="icon">${i18n.t('statusBarFormat.iconDesc')} - ${i18n.t('statusBarFormat.icon')}</option>
                        <option value="dot">${i18n.t('statusBarFormat.dotDesc')} - ${i18n.t('statusBarFormat.dot')}</option>
                        <option value="percent">${i18n.t('statusBarFormat.percentDesc')} - ${i18n.t('statusBarFormat.percent')}</option>
                        <option value="compact">${i18n.t('statusBarFormat.compactDesc')} - ${i18n.t('statusBarFormat.compact')}</option>
                        <option value="namePercent">${i18n.t('statusBarFormat.namePercentDesc')} - ${i18n.t('statusBarFormat.namePercent')}</option>
                        <option value="standard" selected>${i18n.t('statusBarFormat.standardDesc')} - ${i18n.t('statusBarFormat.standard')}</option>
                    </select>
                </div>
                
                <hr class="setting-divider">
                
                <div class="setting-item">
                    <label for="notification-enabled" class="checkbox-label">
                        <input type="checkbox" id="notification-enabled" checked>
                        <span>🔔 ${t('threshold.enableNotification')}</span>
                    </label>
                    <p class="setting-hint">${t('threshold.enableNotificationHint')}</p>
                </div>
                <div class="setting-item">
                    <label for="warning-threshold">🟡 ${t('threshold.warning')}</label>
                    <div class="setting-input-group">
                        <input type="number" id="warning-threshold" min="5" max="80" value="30">
                        <span class="unit">%</span>
                        <span class="range-hint">(5-80)</span>
                    </div>
                    <p class="setting-hint">${t('threshold.warningHint')}</p>
                </div>
                <div class="setting-item">
                    <label for="critical-threshold">🔴 ${t('threshold.critical')}</label>
                    <div class="setting-input-group">
                        <input type="number" id="critical-threshold" min="1" max="50" value="10">
                        <span class="unit">%</span>
                        <span class="range-hint">(1-50)</span>
                    </div>
                    <p class="setting-hint">${t('threshold.criticalHint')}</p>
                </div>

                <hr class="setting-divider">

                <!-- Display mode toggle -->
                <div class="setting-item">
                    <label for="display-mode-select">🖥️ ${t('displayMode.title') || 'Display Mode'}</label>
                    <select id="display-mode-select" class="setting-select">
                        <option value="webview">🎨 ${t('displayMode.webview') || 'Dashboard'}</option>
                        <option value="quickpick">⚡ ${t('displayMode.quickpick') || 'QuickPick'}</option>
                    </select>
                </div>
            </div>
        </div>
    </div>

    <div id="rename-modal" class="modal hidden">
        <div class="modal-content">
            <div class="modal-header">
                <h3>✏️ ${i18n.t('model.renameTitle')}</h3>
                <button id="close-rename-btn" class="close-btn">×</button>
            </div>
            <div class="modal-body">
                <div class="setting-item">
                    <label for="rename-input">${i18n.t('model.newName')}</label>
                    <div class="setting-input-group">
                        <input type="text" id="rename-input" placeholder="${i18n.t('model.namePlaceholder')}" maxlength="30">
                    </div>
                </div>
            </div>
            <div class="modal-footer modal-footer-space-between">
                <button id="reset-name-btn" class="btn-secondary">${i18n.t('model.reset')}</button>
                <button id="save-rename-btn" class="btn-primary">${i18n.t('model.ok')}</button>
            </div>
        </div>
    </div>

    <div id="custom-grouping-modal" class="modal hidden">
        <div class="modal-content modal-content-large">
            <div class="modal-header">
                <h3>⚙️ ${i18n.t('customGrouping.title')}</h3>
                <button id="close-custom-grouping-btn" class="close-btn">×</button>
            </div>
            <div class="modal-body custom-grouping-body">
                <div class="custom-grouping-hint">
                    💡 ${i18n.t('customGrouping.hint')}
                </div>
                <div class="custom-grouping-toolbar">
                    <button id="smart-group-btn" class="btn-accent">
                        <span class="icon">🪄</span>
                        ${i18n.t('customGrouping.smartGroup')}
                    </button>
                    <button id="add-group-btn" class="btn-secondary">
                        <span class="icon">➕</span>
                        ${i18n.t('customGrouping.addGroup')}
                    </button>
                </div>
                <div class="custom-grouping-content">
                    <div class="custom-groups-section">
                        <h4>📦 ${i18n.t('customGrouping.groupList')}</h4>
                        <div id="custom-groups-list" class="custom-groups-list">
                            <!-- Groups will be rendered here -->
                        </div>
                    </div>
                    <div class="ungrouped-section">
                        <h4>🎲 ${i18n.t('customGrouping.ungrouped')}</h4>
                        <p class="ungrouped-hint">${i18n.t('customGrouping.ungroupedHint')}</p>
                        <div id="ungrouped-models-list" class="ungrouped-models-list">
                            <!-- Ungrouped models will be rendered here -->
                        </div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="cancel-custom-grouping-btn" class="btn-secondary">${i18n.t('customGrouping.cancel')}</button>
                <button id="save-custom-grouping-btn" class="btn-primary">💾 ${i18n.t('customGrouping.save')}</button>
            </div>
        </div>
    </div>

    <div id="toast" class="toast hidden"></div>

    <script nonce="${nonce}">
        window.__i18n = ${translationsJson};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     */
    private generateNonce(): string {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i++) {
            nonce += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return nonce;
    }

    /**
     */
    private generateLanguageOptions(): string {
        const locales = i18n.getSupportedLocales();
        return locales.map(locale => {
            const displayName = localeDisplayNames[locale] || locale;
            return `<option value="${locale}">${displayName}</option>`;
        }).join('\n                        ');
    }
}

export { CockpitHUD as hud };
