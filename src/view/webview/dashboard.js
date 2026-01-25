/**
 * Antigravity Cockpit - Dashboard 脚本
 * 处理 Webview 交互逻辑
 */

import { AUTH_RECOMMENDED_LABELS, AUTH_RECOMMENDED_MODEL_IDS } from '../../shared/recommended_models';

(function () {
    'use strict';

    // 获取 VS Code API（保存到全局供其他模块复用）
    const vscode = window.__vscodeApi || (window.__vscodeApi = acquireVsCodeApi());

    // DOM 元素
    const dashboard = document.getElementById('dashboard');
    const statusDiv = document.getElementById('status');
    const refreshBtn = document.getElementById('refresh-btn');
    const resetOrderBtn = document.getElementById('reset-order-btn');
    const toast = document.getElementById('toast');
    const settingsModal = document.getElementById('settings-modal');
    const renameModal = document.getElementById('rename-modal');
    const modelManagerModal = document.getElementById('model-manager-modal');
    const modelManagerList = document.getElementById('model-manager-list');
    const modelManagerCount = document.getElementById('model-manager-count');
    const quotaSourceInfo = document.getElementById('quota-source-info');
    const historyAccountSelect = document.getElementById('history-account-select');
    const historyModelSelect = document.getElementById('history-model-select');
    const historyRangeButtons = document.querySelectorAll('.history-range-btn');
    const historyCanvas = document.getElementById('history-chart');
    const historyEmpty = document.getElementById('history-empty');
    const historyMetricLabel = document.getElementById('history-metric-label');
    const historySummary = document.getElementById('history-summary');
    const historyTableBody = document.getElementById('history-table-body');
    const historyTableEmpty = document.getElementById('history-table-empty');
    const historyPrevBtn = document.getElementById('history-prev');
    const historyNextBtn = document.getElementById('history-next');
    const historyPageInfo = document.getElementById('history-page-info');

    // 国际化文本
    const i18n = window.__i18n || {};
    const authUi = window.AntigravityAuthUI
        ? (window.__authUi || (window.__authUi = new window.AntigravityAuthUI(vscode)))
        : null;

    // 状态
    let isRefreshing = false;
    let dragSrcEl = null;
    let currentConfig = {};
    let lastSnapshot = null; // Store last snapshot for re-renders
    let renameGroupId = null; // 当前正在重命名的分组 ID
    let renameModelIds = [];  // 当前分组包含的模型 ID
    let renameModelId = null; // 当前正在重命名的模型 ID（非分组模式）
    let isRenamingModel = false; // 标记是否正在重命名模型（而非分组）
    let currentQuotaSource = 'local';
    let isQuotaSourceSwitching = false;
    let pendingQuotaSource = null;
    let authorizedAvailable = false;
    let authorizationStatus = null;
    let antigravityToolsSyncEnabled = false;
    let antigravityToolsAutoSwitchEnabled = true;
    let visibleModelIds = [];
    let renameOriginalName = ''; // 原始名称（用于重置）
    let isProfileHidden = false;  // 控制整个计划详情卡片的显示/隐藏
    let isDataMasked = false;     // 控制数据是否显示为 ***
    let modelManagerSelection = new Set();
    let modelManagerModels = [];
    const historyState = {
        rangeDays: 7,
        selectedEmail: null,
        selectedModelId: null,
        accounts: [],
        models: [],
        points: [],
        page: 1,
        pageSize: 20,
        needsRender: false,
    };

    // 刷新冷却时间（秒）
    let refreshCooldown = 10;

    const normalizeRecommendedKey = value => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const AUTH_RECOMMENDED_LABEL_RANK = new Map(
        AUTH_RECOMMENDED_LABELS.map((label, index) => [label, index])
    );
    const AUTH_RECOMMENDED_ID_RANK = new Map(
        AUTH_RECOMMENDED_MODEL_IDS.map((id, index) => [id, index])
    );
    const AUTH_RECOMMENDED_LABEL_KEY_RANK = new Map(
        AUTH_RECOMMENDED_LABELS.map((label, index) => [normalizeRecommendedKey(label), index])
    );
    const AUTH_RECOMMENDED_ID_KEY_RANK = new Map(
        AUTH_RECOMMENDED_MODEL_IDS.map((id, index) => [normalizeRecommendedKey(id), index])
    );

    // 自定义分组弹框状态
    const customGroupingModal = document.getElementById('custom-grouping-modal');
    let customGroupingState = {
        groups: [],       // { id: string, name: string, modelIds: string[] }
        allModels: [],    // 所有模型数据（从 snapshot 获取）
        groupMappings: {} // 原始分组映射（用于保存）
    };



    // ============ 初始化 ============

    function init() {
        // 恢复状态
        const state = vscode.getState() || {};
        if (state.lastRefresh && state.refreshCooldown) {
            const now = Date.now();
            const diff = Math.floor((now - state.lastRefresh) / 1000);
            if (diff < state.refreshCooldown) {
                startCooldown(state.refreshCooldown - diff);
            }
        }
        if (state.quotaSource) {
            currentQuotaSource = state.quotaSource;
        }

        // isProfileHidden and isDataMasked are now loaded from config in handleMessage

        // 绑定事件
        refreshBtn.addEventListener('click', handleRefresh);

        // 初始化富文本 Tooltip
        initRichTooltip();
        if (resetOrderBtn) {
            resetOrderBtn.addEventListener('click', handleResetOrder);
        }

        const manageModelsBtn = document.getElementById('manage-models-btn');
        if (manageModelsBtn) {
            manageModelsBtn.addEventListener('click', openModelManagerModal);
        }

        // 计划详情开关按钮
        const toggleProfileBtn = document.getElementById('toggle-profile-btn');
        if (toggleProfileBtn) {
            toggleProfileBtn.addEventListener('click', handleToggleProfile);
        }

        // 分组开关按钮
        const toggleGroupingBtn = document.getElementById('toggle-grouping-btn');
        if (toggleGroupingBtn) {
            toggleGroupingBtn.addEventListener('click', handleToggleGrouping);
        }

        // 设置按钮
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', openSettingsModal);
        }

        // 配额来源切换
        const quotaSourceButtons = document.querySelectorAll('.quota-source-btn');
        quotaSourceButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const source = btn.dataset.source;
                requestQuotaSourceChange(source);
            });
        });

        // 关闭设置模态框
        const closeSettingsBtn = document.getElementById('close-settings-btn');
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', closeSettingsModal);
        }

        // 重命名模态框 - 关闭按钮
        const closeRenameBtn = document.getElementById('close-rename-btn');
        if (closeRenameBtn) {
            closeRenameBtn.addEventListener('click', closeRenameModal);
        }

        // 重命名模态框 - 确定按钮
        const saveRenameBtn = document.getElementById('save-rename-btn');
        if (saveRenameBtn) {
            saveRenameBtn.addEventListener('click', saveRename);
        }

        // 重命名输入框 - 回车键确认
        const renameInput = document.getElementById('rename-input');
        if (renameInput) {
            renameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveRename();
                }
            });
        }

        document.getElementById('model-manager-close')?.addEventListener('click', closeModelManagerModal);
        document.getElementById('model-manager-cancel')?.addEventListener('click', closeModelManagerModal);
        document.getElementById('model-manager-save')?.addEventListener('click', saveModelManagerSelection);
        document.getElementById('model-manager-select-all')?.addEventListener('click', () => {
            updateModelManagerSelection('all');
        });
        document.getElementById('model-manager-clear')?.addEventListener('click', () => {
            updateModelManagerSelection('none');
        });

        // 重置名称按钮
        const resetNameBtn = document.getElementById('reset-name-btn');
        if (resetNameBtn) {
            resetNameBtn.addEventListener('click', resetName);
        }

        // 自定义分组弹框事件绑定
        const closeCustomGroupingBtn = document.getElementById('close-custom-grouping-btn');
        if (closeCustomGroupingBtn) {
            closeCustomGroupingBtn.addEventListener('click', closeCustomGroupingModal);
        }
        const cancelCustomGroupingBtn = document.getElementById('cancel-custom-grouping-btn');
        if (cancelCustomGroupingBtn) {
            cancelCustomGroupingBtn.addEventListener('click', closeCustomGroupingModal);
        }
        const saveCustomGroupingBtn = document.getElementById('save-custom-grouping-btn');
        if (saveCustomGroupingBtn) {
            saveCustomGroupingBtn.addEventListener('click', saveCustomGrouping);
        }
        const smartGroupBtn = document.getElementById('smart-group-btn');
        if (smartGroupBtn) {
            smartGroupBtn.addEventListener('click', handleSmartGroup);
        }
        const addGroupBtn = document.getElementById('add-group-btn');
        if (addGroupBtn) {
            addGroupBtn.addEventListener('click', handleAddGroup);
        }



        // Announcement Events
        const announcementBtn = document.getElementById('announcement-btn');
        if (announcementBtn) announcementBtn.addEventListener('click', openAnnouncementList);

        const announcementListClose = document.getElementById('announcement-list-close');
        if (announcementListClose) announcementListClose.addEventListener('click', closeAnnouncementList);

        const announcementMarkAllRead = document.getElementById('announcement-mark-all-read');
        if (announcementMarkAllRead) announcementMarkAllRead.addEventListener('click', markAllAnnouncementsRead);

        const announcementPopupLater = document.getElementById('announcement-popup-later');
        if (announcementPopupLater) announcementPopupLater.addEventListener('click', closeAnnouncementPopup);

        const announcementPopupGotIt = document.getElementById('announcement-popup-got-it');
        if (announcementPopupGotIt) announcementPopupGotIt.addEventListener('click', handleAnnouncementGotIt);

        const announcementPopupAction = document.getElementById('announcement-popup-action');
        if (announcementPopupAction) announcementPopupAction.addEventListener('click', handleAnnouncementAction);

        // 事件委托：处理置顶开关
        dashboard.addEventListener('change', (e) => {
            if (e.target.classList.contains('pin-toggle')) {
                const modelId = e.target.getAttribute('data-model-id');
                if (modelId) {
                    togglePin(modelId);
                }
            }
        });

        // 监听消息
        window.addEventListener('message', handleMessage);

        // Tab 导航切换
        initTabNavigation();
        initHistoryTab();
        window.addEventListener('resize', handleHistoryResize);

        renderLoadingCard(currentQuotaSource);

        // 通知扩展已准备就绪
        vscode.postMessage({ command: 'init' });
    }

    // ============ Tab 导航 ============

    function initTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');

                // 更新按钮状态
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 更新内容显示
                tabContents.forEach(content => {
                    if (content.id === `tab-${targetTab}`) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });

                // 通知扩展 Tab 切换（可用于状态同步）
                vscode.postMessage({ command: 'tabChanged', tab: targetTab });
                if (targetTab === 'history') {
                    activateHistoryTab();
                }
            });
        });
    }

    // ============ 历史记录 Tab ============

    function initHistoryTab() {
        if (historyAccountSelect) {
            historyAccountSelect.addEventListener('change', () => {
                historyState.selectedEmail = historyAccountSelect.value || null;
                historyState.page = 1;
                requestQuotaHistory();
            });
        }

        if (historyModelSelect) {
            historyModelSelect.addEventListener('change', () => {
                historyState.selectedModelId = historyModelSelect.value || null;
                historyState.page = 1;
                requestQuotaHistory();
            });
        }

        historyRangeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const range = normalizeHistoryRange(parseInt(btn.dataset.range || '', 10));
                if (historyState.rangeDays === range) {
                    return;
                }
                historyState.rangeDays = range;
                updateHistoryRangeButtons();
                historyState.page = 1;
                requestQuotaHistory();
            });
        });

        if (historyPrevBtn) {
            historyPrevBtn.addEventListener('click', () => {
                if (historyState.page > 1) {
                    historyState.page -= 1;
                    renderHistoryDetails();
                }
            });
        }

        if (historyNextBtn) {
            historyNextBtn.addEventListener('click', () => {
                historyState.page += 1;
                renderHistoryDetails();
            });
        }

        updateHistoryRangeButtons();
    }

    function handleHistoryResize() {
        if (!isHistoryTabActive()) {
            historyState.needsRender = true;
            return;
        }
        renderHistoryChart();
    }

    function normalizeHistoryRange(rangeDays) {
        if (typeof rangeDays !== 'number' || !Number.isFinite(rangeDays) || rangeDays <= 0) {
            return 7;
        }
        if (rangeDays <= 1) {
            return 1;
        }
        if (rangeDays <= 7) {
            return 7;
        }
        return 30;
    }

    function isHistoryTabActive() {
        const tab = document.getElementById('tab-history');
        return Boolean(tab && tab.classList.contains('active'));
    }

    function activateHistoryTab() {
        updateHistoryRangeButtons();
        updateHistoryAccountSelect();
        updateHistoryModelSelect();
        requestQuotaHistory();
        if (historyState.needsRender) {
            renderHistoryChart();
            renderHistoryDetails();
        }
    }

    function requestQuotaHistory() {
        if (!historyCanvas || !isHistoryTabActive()) {
            return;
        }
        const rangeDays = normalizeHistoryRange(historyState.rangeDays);
        historyState.rangeDays = rangeDays;
        vscode.postMessage({
            command: 'quotaHistory.get',
            email: historyState.selectedEmail || undefined,
            modelId: historyState.selectedModelId || undefined,
            rangeDays,
        });
    }

    function handleQuotaHistoryData(payload) {
        const data = payload || {};
        const accounts = Array.isArray(data.accounts) ? data.accounts : [];
        historyState.accounts = accounts;
        historyState.models = Array.isArray(data.models) ? data.models : [];
        if (typeof data.rangeDays === 'number') {
            historyState.rangeDays = normalizeHistoryRange(data.rangeDays);
        }
        if (typeof data.email === 'string' && data.email.includes('@')) {
            historyState.selectedEmail = data.email;
        }
        if (typeof data.modelId === 'string') {
            historyState.selectedModelId = data.modelId;
        }
        historyState.points = Array.isArray(data.points) ? data.points : [];
        historyState.page = 1;

        updateHistoryAccountSelect();
        updateHistoryModelSelect();
        updateHistoryRangeButtons();
        updateHistoryFooter();
        if (isHistoryTabActive()) {
            renderHistoryChart();
            renderHistoryDetails();
        } else {
            historyState.needsRender = true;
        }
    }

    function updateHistoryAccountSelect() {
        if (!historyAccountSelect) {
            return;
        }
        historyAccountSelect.innerHTML = '';

        const accounts = Array.isArray(historyState.accounts) ? historyState.accounts : [];
        if (accounts.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = i18n['history.noAccounts'] || 'No accounts';
            historyAccountSelect.appendChild(option);
            historyAccountSelect.disabled = true;
            historyState.selectedEmail = null;
            return;
        }

        historyAccountSelect.disabled = false;
        accounts.forEach(email => {
            const option = document.createElement('option');
            option.value = email;
            option.textContent = email;
            historyAccountSelect.appendChild(option);
        });

        if (!historyState.selectedEmail || !accounts.includes(historyState.selectedEmail)) {
            historyState.selectedEmail = accounts[0];
        }
        historyAccountSelect.value = historyState.selectedEmail || '';
    }

    function updateHistoryModelSelect() {
        if (!historyModelSelect) {
            return;
        }
        historyModelSelect.innerHTML = '';

        const models = Array.isArray(historyState.models) ? historyState.models : [];
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = i18n['history.noModels'] || (i18n['models.empty'] || 'No models');
            historyModelSelect.appendChild(option);
            historyModelSelect.disabled = true;
            historyState.selectedModelId = null;
            return;
        }

        historyModelSelect.disabled = false;
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.modelId;
            option.textContent = model.label || model.modelId;
            historyModelSelect.appendChild(option);
        });

        const modelIds = models.map(model => model.modelId);
        if (!historyState.selectedModelId || !modelIds.includes(historyState.selectedModelId)) {
            historyState.selectedModelId = models[0].modelId;
        }
        historyModelSelect.value = historyState.selectedModelId || '';
    }

    function updateHistoryRangeButtons() {
        historyRangeButtons.forEach(btn => {
            const range = normalizeHistoryRange(parseInt(btn.dataset.range || '', 10));
            if (range === historyState.rangeDays) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function getSelectedModelLabel() {
        const models = Array.isArray(historyState.models) ? historyState.models : [];
        const selected = models.find(model => model.modelId === historyState.selectedModelId);
        return selected?.label || selected?.modelId || '';
    }

    function getHistoryPoints() {
        if (!Array.isArray(historyState.points)) {
            return [];
        }
        return historyState.points
            .filter(point =>
                point
                && typeof point.timestamp === 'number'
                && Number.isFinite(point.timestamp)
                && typeof point.remainingPercentage === 'number'
                && Number.isFinite(point.remainingPercentage),
            )
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    function updateHistoryFooter() {
        if (!historyMetricLabel || !historySummary) {
            return;
        }
        const modelLabel = getSelectedModelLabel();
        if (modelLabel) {
            historyMetricLabel.textContent = `${i18n['history.modelLabel'] || 'Model'}: ${modelLabel}`;
        } else {
            historyMetricLabel.textContent = '';
        }

        const points = getHistoryPoints();
        if (points.length === 0) {
            historySummary.textContent = '';
            return;
        }

        const latest = points[points.length - 1];
        const summaryParts = [];
        summaryParts.push(`${i18n['history.currentValue'] || 'Current'}: ${formatHistoryPercent(latest.remainingPercentage)}`);
        if (typeof latest.resetTime === 'number' && Number.isFinite(latest.resetTime)) {
            summaryParts.push(`${i18n['history.resetTime'] || 'Reset'}: ${formatHistoryTimestamp(latest.resetTime)}`);
        }
        if (typeof latest.countdownSeconds === 'number' && Number.isFinite(latest.countdownSeconds)) {
            summaryParts.push(`${i18n['history.countdown'] || 'Countdown'}: ${formatHistoryCountdown(latest.countdownSeconds)}`);
        }
        summaryParts.push(`${i18n['history.updatedAt'] || 'Updated'}: ${formatHistoryTimestamp(latest.timestamp)}`);
        historySummary.textContent = summaryParts.join(' · ');
    }

    function renderHistoryChart() {
        if (!historyCanvas) {
            return;
        }
        if (!isHistoryTabActive()) {
            historyState.needsRender = true;
            return;
        }

        const rect = historyCanvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            historyState.needsRender = true;
            return;
        }
        historyState.needsRender = false;

        const ctx = historyCanvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        historyCanvas.width = Math.max(1, Math.round(rect.width * dpr));
        historyCanvas.height = Math.max(1, Math.round(rect.height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const points = getHistoryPoints();
        const hasPoints = points.length > 0;
        if (historyEmpty) {
            const emptyMessage = historyState.accounts.length === 0
                ? (i18n['history.noAccounts'] || 'No accounts')
                : (historyState.models.length === 0
                    ? (i18n['history.noModels'] || 'No models')
                    : (i18n['history.noData'] || 'No history yet.'));
            historyEmpty.textContent = emptyMessage;
            historyEmpty.classList.toggle('hidden', hasPoints);
        }
        if (!hasPoints) {
            return;
        }

        const width = rect.width;
        const height = rect.height;
        const padding = {
            left: 52,
            right: 20,
            top: 20,
            bottom: 24,
        };
        const chartWidth = Math.max(1, width - padding.left - padding.right);
        const chartHeight = Math.max(1, height - padding.top - padding.bottom);
        const now = Date.now();
        const rangeMs = normalizeHistoryRange(historyState.rangeDays) * 24 * 60 * 60 * 1000;
        const startTime = now - rangeMs;
        const endTime = now;

        const accent = getCssVar('--accent', '#2f81f7');
        const gridColor = getCssVar('--border-color', 'rgba(255,255,255,0.08)');
        const textSecondary = getCssVar('--text-secondary', '#8b949e');

        ctx.save();
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = textSecondary;
        ctx.font = `11px ${getCssVar('--font-family', 'sans-serif')}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const labelX = Math.max(12, padding.left - 8);
        for (let i = 0; i <= 5; i++) {
            const value = 100 - i * 20;
            const y = padding.top + (chartHeight / 5) * i;
            ctx.fillText(`${value}%`, labelX, y);
        }
        ctx.restore();

        const coords = points.map(point => {
            const clamped = Math.min(100, Math.max(0, point.remainingPercentage));
            const ratio = (point.timestamp - startTime) / (endTime - startTime);
            const x = padding.left + Math.min(1, Math.max(0, ratio)) * chartWidth;
            const y = padding.top + (1 - clamped / 100) * chartHeight;
            return { x, y, raw: point };
        });

        if (coords.length === 1) {
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.arc(coords[0].x, coords[0].y, 3, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(coords[0].x, coords[0].y);
        coords.forEach(point => ctx.lineTo(point.x, point.y));
        ctx.lineTo(coords[coords.length - 1].x, padding.top + chartHeight);
        ctx.lineTo(coords[0].x, padding.top + chartHeight);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        coords.forEach((point, index) => {
            if (index === 0) {
                ctx.moveTo(point.x, point.y);
            } else {
                ctx.lineTo(point.x, point.y);
            }
        });
        ctx.stroke();

        ctx.fillStyle = accent;
        coords.forEach(point => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
            ctx.fill();
        });

        const last = coords[coords.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
    }

    function renderHistoryDetails() {
        if (!historyTableBody || !historyPageInfo || !historyPrevBtn || !historyNextBtn) {
            return;
        }

        const pointsDesc = getHistoryPoints().slice().sort((a, b) => b.timestamp - a.timestamp);
        const total = pointsDesc.length;
        const pageSize = historyState.pageSize;
        const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

        if (total === 0) {
            historyTableBody.innerHTML = '';
            if (historyTableEmpty) {
                historyTableEmpty.textContent = i18n['history.tableEmpty'] || (i18n['history.noData'] || 'No data');
                historyTableEmpty.classList.remove('hidden');
            }
            historyPageInfo.textContent = '';
            historyPrevBtn.disabled = true;
            historyNextBtn.disabled = true;
            return;
        }

        if (historyTableEmpty) {
            historyTableEmpty.classList.add('hidden');
        }

        historyState.page = Math.min(Math.max(historyState.page, 1), totalPages);
        const start = (historyState.page - 1) * pageSize;
        const pagePoints = pointsDesc.slice(start, start + pageSize);

        historyTableBody.innerHTML = pagePoints.map((point, index) => {
            const nextPoint = pointsDesc[start + index + 1];
            const delta = nextPoint
                ? point.remainingPercentage - nextPoint.remainingPercentage
                : null;
            const deltaText = delta === null ? '--' : formatHistoryDelta(delta);
            const deltaClass = delta === null
                ? 'neutral'
                : (delta > 0 ? 'positive' : (delta < 0 ? 'negative' : 'neutral'));

            return `
                <tr>
                    <td>${formatHistoryTimestamp(point.timestamp)}</td>
                    <td>${formatHistoryPercent(point.remainingPercentage)}</td>
                    <td class="history-delta ${deltaClass}">${deltaText}</td>
                    <td>${formatHistoryTimestamp(point.resetTime)}</td>
                    <td>${formatHistoryCountdownLabel(point.countdownSeconds, point.isStart)}</td>
                </tr>
            `;
        }).join('');

        const pageInfo = i18n['history.pageInfo'] || 'Page {current} / {total}';
        historyPageInfo.textContent = pageInfo
            .replace('{current}', String(historyState.page))
            .replace('{total}', String(totalPages));
        historyPrevBtn.disabled = historyState.page <= 1;
        historyNextBtn.disabled = historyState.page >= totalPages;
    }

    function formatHistoryPercent(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return '--';
        }
        const rounded = Math.round(value * 10) / 10;
        return `${rounded}%`;
    }

    function formatHistoryDelta(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return '--';
        }
        const rounded = Math.round(value * 10) / 10;
        const sign = rounded > 0 ? '+' : '';
        return `${sign}${rounded}%`;
    }

    function formatHistoryCountdown(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
            return '--';
        }
        if (seconds <= 0) {
            return i18n['dashboard.online'] || 'Restoring Soon';
        }
        const totalMinutes = Math.ceil(seconds / 60);
        if (totalMinutes < 60) {
            return `${totalMinutes}m`;
        }
        const totalHours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        if (totalHours < 24) {
            return `${totalHours}h ${remainingMinutes}m`;
        }
        const days = Math.floor(totalHours / 24);
        const remainingHours = totalHours % 24;
        return `${days}d ${remainingHours}h ${remainingMinutes}m`;
    }

    function formatHistoryCountdownLabel(seconds, isStart) {
        const text = formatHistoryCountdown(seconds);
        if (!isStart) {
            return text;
        }
        if (text === '--') {
            return 'START';
        }
        return `START ${text}`;
    }

    function formatHistoryTimestamp(timestamp) {
        if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
            return '--';
        }
        return new Date(timestamp).toLocaleString();
    }

    function getCssVar(name, fallback) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name);
        const trimmed = value ? value.trim() : '';
        return trimmed || fallback;
    }

    // ============ 设置模态框 ============

    function openSettingsModal() {
        if (settingsModal) {
            // 从当前配置填充值
            const notificationCheckbox = document.getElementById('notification-enabled');
            const warningInput = document.getElementById('warning-threshold');
            const criticalInput = document.getElementById('critical-threshold');
            if (notificationCheckbox) notificationCheckbox.checked = currentConfig.notificationEnabled !== false;
            if (warningInput) warningInput.value = currentConfig.warningThreshold || 30;
            if (criticalInput) criticalInput.value = currentConfig.criticalThreshold || 10;

            // Display Mode Select Logic (Webview vs QuickPick)
            const displayModeSelect = document.getElementById('display-mode-select');
            if (displayModeSelect) {
                const currentDisplayMode = currentConfig.displayMode || 'webview';
                displayModeSelect.value = currentDisplayMode;

                displayModeSelect.onchange = () => {
                    const newMode = displayModeSelect.value;
                    if (newMode === 'quickpick') {
                        // Switching to QuickPick should close Webview
                        vscode.postMessage({ command: 'updateDisplayMode', displayMode: 'quickpick' });
                    }
                };
            }

            // 初始化语言选择器
            initLanguageSelector();

            // 初始化状态栏格式选择器
            initStatusBarFormatSelector();

            // 初始化即时保存事件
            initSettingsAutoSave();

            settingsModal.classList.remove('hidden');
        }
    }

    /**
     * 初始化状态栏格式选择器（下拉框）
     */
    function initStatusBarFormatSelector() {
        const formatSelect = document.getElementById('statusbar-format');
        if (!formatSelect) return;

        const currentFormat = currentConfig.statusBarFormat || 'standard';
        formatSelect.value = currentFormat;

        // 绑定 change 事件
        formatSelect.onchange = null;
        formatSelect.addEventListener('change', () => {
            const format = formatSelect.value;

            // 发送消息到扩展，立即更新状态栏
            vscode.postMessage({
                command: 'updateStatusBarFormat',
                statusBarFormat: format
            });
        });
    }

    /**
     * 初始化语言选择器
     */
    function initLanguageSelector() {
        const languageSelect = document.getElementById('language-select');
        if (!languageSelect) return;

        // 设置当前语言
        const currentLanguage = currentConfig.language || 'auto';
        languageSelect.value = currentLanguage;

        // 绑定 change 事件
        languageSelect.onchange = null;
        languageSelect.addEventListener('change', () => {
            const newLanguage = languageSelect.value;

            // 发送消息到扩展
            vscode.postMessage({
                command: 'updateLanguage',
                language: newLanguage
            });

            // 显示提示需要重新打开面板
            showToast(i18n['language.changed'] || 'Language changed. Reopen panel to apply.', 'info');
        });
    }

    /**
     * 初始化设置自动保存（即时生效）
     */
    function initSettingsAutoSave() {
        const notificationCheckbox = document.getElementById('notification-enabled');
        const warningInput = document.getElementById('warning-threshold');
        const criticalInput = document.getElementById('critical-threshold');

        // 通知开关即时保存
        if (notificationCheckbox) {
            notificationCheckbox.onchange = null;
            notificationCheckbox.addEventListener('change', () => {
                vscode.postMessage({
                    command: 'updateNotificationEnabled',
                    notificationEnabled: notificationCheckbox.checked
                });
            });
        }

        // 阈值输入框失焦时自动钳位并保存
        if (warningInput) {
            warningInput.onblur = null;
            warningInput.addEventListener('blur', () => {
                clampAndSaveThresholds();
            });
        }

        if (criticalInput) {
            criticalInput.onblur = null;
            criticalInput.addEventListener('blur', () => {
                clampAndSaveThresholds();
            });
        }
    }

    /**
     * 钳位阈值并保存
     */
    function clampAndSaveThresholds() {
        const warningInput = document.getElementById('warning-threshold');
        const criticalInput = document.getElementById('critical-threshold');

        let warningValue = parseInt(warningInput?.value, 10) || 30;
        let criticalValue = parseInt(criticalInput?.value, 10) || 10;

        // 自动钳制到有效范围
        if (warningValue < 5) warningValue = 5;
        if (warningValue > 80) warningValue = 80;
        if (criticalValue < 1) criticalValue = 1;
        if (criticalValue > 50) criticalValue = 50;

        // 确保 critical < warning
        if (criticalValue >= warningValue) {
            criticalValue = warningValue - 1;
            if (criticalValue < 1) criticalValue = 1;
        }

        // 更新输入框显示钳制后的值
        if (warningInput) warningInput.value = warningValue;
        if (criticalInput) criticalInput.value = criticalValue;

        saveThresholds();
    }

    /**
     * 保存阈值设置
     */
    function saveThresholds() {
        const notificationCheckbox = document.getElementById('notification-enabled');
        const warningInput = document.getElementById('warning-threshold');
        const criticalInput = document.getElementById('critical-threshold');

        const notificationEnabled = notificationCheckbox?.checked ?? true;
        const warningValue = parseInt(warningInput?.value, 10) || 30;
        const criticalValue = parseInt(criticalInput?.value, 10) || 10;

        // 发送到扩展保存
        vscode.postMessage({
            command: 'updateThresholds',
            notificationEnabled: notificationEnabled,
            warningThreshold: warningValue,
            criticalThreshold: criticalValue
        });
    }

    function closeSettingsModal() {
        if (settingsModal) {
            settingsModal.classList.add('hidden');
        }
    }

    // ============ 重命名模态框 ============

    function openRenameModal(groupId, currentName, modelIds) {
        if (renameModal) {
            renameGroupId = groupId;
            renameModelIds = modelIds || [];
            isRenamingModel = false; // 分组重命名模式
            renameModelId = null;

            const renameInput = document.getElementById('rename-input');
            if (renameInput) {
                renameInput.value = currentName || '';
                renameInput.focus();
                renameInput.select();
            }

            renameModal.classList.remove('hidden');
        }
    }

    /**
     * 打开模型重命名模态框（非分组模式）
     * @param {string} modelId 模型 ID
     * @param {string} currentName 当前名称
     */
    function openModelRenameModal(modelId, currentName, originalName) {
        if (renameModal) {
            isRenamingModel = true; // 模型重命名模式
            renameModelId = modelId;
            renameGroupId = null;
            renameModelIds = [];
            renameOriginalName = originalName || currentName || ''; // 保存原始名称

            const renameInput = document.getElementById('rename-input');
            if (renameInput) {
                renameInput.value = currentName || '';
                renameInput.focus();
                renameInput.select();
            }

            renameModal.classList.remove('hidden');
        }
    }

    function closeRenameModal() {
        if (renameModal) {
            renameModal.classList.add('hidden');
            renameGroupId = null;
            renameModelIds = [];
            renameModelId = null;
            isRenamingModel = false;
            renameOriginalName = '';
        }
    }

    function saveRename() {
        const renameInput = document.getElementById('rename-input');
        const newName = renameInput?.value?.trim();

        if (!newName) {
            showToast(i18n['model.nameEmpty'] || i18n['grouping.nameEmpty'] || 'Name cannot be empty', 'error');
            return;
        }

        if (isRenamingModel && renameModelId) {
            // 模型重命名模式
            vscode.postMessage({
                command: 'renameModel',
                modelId: renameModelId,
                groupName: newName  // 复用 groupName 字段
            });

            showToast((i18n['model.renamed'] || 'Model renamed to {name}').replace('{name}', newName), 'success');
        } else if (renameGroupId && renameModelIds.length > 0) {
            // 分组重命名模式
            // 乐观更新：立即在前端更新 UI
            updateGroupNameOptimistically(renameGroupId, newName);

            vscode.postMessage({
                command: 'renameGroup',
                groupId: renameGroupId,
                groupName: newName,
                modelIds: renameModelIds
            });

            showToast((i18n['grouping.renamed'] || 'Renamed to {name}').replace('{name}', newName), 'success');
        }

        closeRenameModal();
    }

    /**
     * 乐观更新分组名称（直接更新 DOM 和缓存）
     * @param {string} groupId 分组 ID
     * @param {string} newName 新名称
     */
    function updateGroupNameOptimistically(groupId, newName) {
        // 1. 更新 DOM
        const card = document.querySelector(`.group-card[data-group-id="${groupId}"]`);
        if (card) {
            const nameSpan = card.querySelector('.group-name');
            if (nameSpan) {
                nameSpan.textContent = newName;
            }
        }
        
        // 2. 更新缓存 (lastSnapshot)
        if (lastSnapshot && lastSnapshot.groups) {
            const group = lastSnapshot.groups.find(g => g.groupId === groupId);
            if (group) {
                group.groupName = newName;
            }
        }
    }
    /**
     * 重置名称为默认值（填入输入框，不直接提交）
     */
    function resetName() {
        const renameInput = document.getElementById('rename-input');
        if (!renameInput) return;

        if (isRenamingModel && renameModelId && renameOriginalName) {
            // 模型重置模式：将原始名称填入输入框
            renameInput.value = renameOriginalName;
            renameInput.focus();
        }
        // 分组重置暂不支持
    }

    function handleToggleProfile() {
        // Send command to extension to toggle and persist in VS Code config
        vscode.postMessage({ command: 'toggleProfile' });
    }

    function updateToggleProfileButton() {
        const btn = document.getElementById('toggle-profile-btn');
        if (btn) {
            if (isProfileHidden) {
                btn.textContent = (i18n['profile.planDetails'] || 'Plan') + ' ▼';
                btn.classList.add('toggle-off');
            } else {
                btn.textContent = (i18n['profile.planDetails'] || 'Plan') + ' ▲';
                btn.classList.remove('toggle-off');
            }
        }
    }

    function handleToggleGrouping() {
        // 发送切换分组的消息给扩展
        vscode.postMessage({ command: 'toggleGrouping' });
    }

    function updateToggleGroupingButton(enabled) {
        const btn = document.getElementById('toggle-grouping-btn');
        if (btn) {
            if (enabled) {
                btn.textContent = (i18n['grouping.title'] || 'Groups') + ' ▲';
                btn.classList.remove('toggle-off');
            } else {
                btn.textContent = (i18n['grouping.title'] || 'Groups') + ' ▼';
                btn.classList.add('toggle-off');
            }
        }
    }

    // ============ 事件处理 ============

    function handleRefresh() {
        if (refreshBtn.disabled) return;

        isRefreshing = true;
        updateRefreshButton();
        showToast(i18n['notify.refreshing'] || 'Refreshing quota data...', 'info');

        vscode.postMessage({ command: 'refresh' });

        const now = Date.now();
        vscode.setState({ ...vscode.getState(), lastRefresh: now, refreshCooldown: refreshCooldown });
        startCooldown(refreshCooldown);
    }



    function handleResetOrder() {
        vscode.postMessage({ command: 'resetOrder' });
        showToast(i18n['dashboard.resetOrder'] || 'Reset Order', 'success');
    }

    // handleAutoGroup 已移除，功能已整合到其他模块



    function handleMessage(event) {
        const message = event.data;

        // 处理标签页切换消息
        if (message.type === 'switchTab' && message.tab) {
            switchToTab(message.tab);
            return;
        }

        if (message.type === 'telemetry_update') {
            isRefreshing = false;
            updateRefreshButton();

            // 保存配置
            if (message.config) {
                currentConfig = message.config;

                // 从配置读取 profileHidden（持久化存储）
                if (message.config.profileHidden !== undefined) {
                    isProfileHidden = message.config.profileHidden;
                    updateToggleProfileButton();
                }
                if (message.config.quotaSource) {
                    if (!isQuotaSourceSwitching || message.config.quotaSource === pendingQuotaSource) {
                        currentQuotaSource = message.config.quotaSource;
                        vscode.setState({ ...vscode.getState(), quotaSource: currentQuotaSource });
                    }
                }
                if (message.config.authorizedAvailable !== undefined) {
                    authorizedAvailable = message.config.authorizedAvailable;
                }
                if (message.config.authorizationStatus !== undefined) {
                    authorizationStatus = message.config.authorizationStatus;
                }
                if (Array.isArray(message.config.visibleModels)) {
                    visibleModelIds = message.config.visibleModels;
                }
                // 从配置读取 dataMasked 状态（持久化存储）
                if (message.config.dataMasked !== undefined) {
                    isDataMasked = message.config.dataMasked;
                }
                if (message.config.antigravityToolsSyncEnabled !== undefined) {
                    antigravityToolsSyncEnabled = message.config.antigravityToolsSyncEnabled;
                }
                if (message.config.antigravityToolsAutoSwitchEnabled !== undefined) {
                    antigravityToolsAutoSwitchEnabled = message.config.antigravityToolsAutoSwitchEnabled;
                }


            }
            if (isQuotaSourceSwitching) {
                if (message.config?.quotaSource !== pendingQuotaSource) {
                    updateQuotaSourceUI(message.data?.isConnected);
                    return;
                }
                setQuotaSourceSwitching(false);
            }
            render(message.data, message.config);
            lastSnapshot = message.data; // Update global snapshot
            updateQuotaSourceUI(message.data?.isConnected);
            if (isHistoryTabActive()) {
                requestQuotaHistory();
            }

            // 自动同步已移至后端 TelemetryController 处理，前端不再主动触发
        }

        if (message.type === 'quotaHistoryData') {
            handleQuotaHistoryData(message.data);
        }
        if (message.type === 'quotaHistoryUpdated') {
            const updatedEmail = message.data?.email;
            if (isHistoryTabActive()) {
                if (updatedEmail && historyState.selectedEmail && updatedEmail !== historyState.selectedEmail) {
                    return;
                }
                requestQuotaHistory();
            }
        }

        if (message.type === 'autoTriggerState') {
            if (message.data?.authorization !== undefined) {
                authorizationStatus = message.data.authorization;
                authorizedAvailable = Boolean(message.data.authorization?.isAuthorized);
                updateQuotaAuthUI();
                const modal = document.getElementById('account-manage-modal');
                if (modal && !modal.classList.contains('hidden')) {
                    const accounts = authorizationStatus?.accounts || [];
                    if (accounts.length === 0) {
                        if (authUi) {
                            modal.classList.add('hidden');
                        } else {
                            closeAccountManageModal();
                        }
                    } else {
                        if (authUi) {
                            authUi.renderAccountManageList();
                        } else {
                            renderAccountManageList();
                        }
                    }
                }
            }
        }

        // 处理公告状态更新
        if (message.type === 'announcementState') {
            handleAnnouncementState(message.data);
        }

        if (message.type === 'quotaSourceError') {
            if (isQuotaSourceSwitching) {
                setQuotaSourceSwitching(false);
                updateQuotaSourceUI(lastSnapshot?.isConnected);
            }
            showToast(message.message || (i18n['quotaSource.authorizedMissing'] || 'Authorize auto wake-up first'), 'warning');
        }

        if (message.type === 'antigravityToolsSyncStatus') {
            if (message.data?.enabled !== undefined) {
                antigravityToolsSyncEnabled = message.data.enabled;
            }
            if (message.data?.autoSyncEnabled !== undefined) {
                antigravityToolsSyncEnabled = message.data.autoSyncEnabled;
            }
            if (message.data?.autoSwitchEnabled !== undefined) {
                antigravityToolsAutoSwitchEnabled = message.data.autoSwitchEnabled;
            }
            updateQuotaAuthUI();
        }

        if (message.type === 'antigravityToolsSyncPrompt') {
            const data = message.data || {};
            showAntigravityToolsSyncPrompt(data);
        }

        if (message.type === 'localAuthImportPrompt') {
            const data = message.data || {};
            showLocalAuthImportPrompt(data);
        }
        if (message.type === 'localAuthImportError') {
            closeLocalAuthImportPrompt();
        }

        // 处理导入进度消息
        if (message.type === 'antigravityToolsSyncProgress') {
            const { current, total, email } = message.data || {};
            updateAntigravityToolsSyncProgress(current, total, email);
        }

        // 处理导入完成消息
        if (message.type === 'antigravityToolsSyncComplete') {
            handleAntigravityToolsSyncComplete(message.data?.success, message.data?.error);
        }
        
        // 处理 Cockpit Tools 数据同步消息
        if (message.type === 'refreshAccounts') {
            // Cockpit Tools 数据变更，刷新授权状态和账号列表
            vscode.postMessage({ command: 'getAutoTriggerState' });
            showToast(i18n['cockpitTools.dataChanged'] || '账号数据已更新', 'info');
        }
        
        if (message.type === 'accountSwitched') {
            // 账号切换完成
            vscode.postMessage({ command: 'getAutoTriggerState' });
            showToast((i18n['cockpitTools.accountSwitched'] || '已切换至 {email}').replace('{email}', message.email || ''), 'success');
        }
    }

    function setQuotaSourceSwitching(isSwitching, source) {
        isQuotaSourceSwitching = isSwitching;
        if (isSwitching) {
            pendingQuotaSource = source || pendingQuotaSource;
            renderLoadingCard(pendingQuotaSource);
        } else {
            pendingQuotaSource = null;
            statusDiv.style.display = 'none';
        }

        const buttons = document.querySelectorAll('.quota-source-btn');
        buttons.forEach(btn => {
            const sourceKey = btn.dataset.source;
            btn.disabled = isSwitching && sourceKey === pendingQuotaSource;
        });
    }

    function requestQuotaSourceChange(source, options = {}) {
        if (!source) {
            return;
        }
        const force = options.force === true;
        if (!force) {
            if (!isQuotaSourceSwitching && source === currentQuotaSource) {
                return;
            }
            if (isQuotaSourceSwitching && source === pendingQuotaSource) {
                return;
            }
        }
        const command = options.command || 'updateQuotaSource';
        setQuotaSourceSwitching(true, source);
        currentQuotaSource = source;
        updateQuotaSourceUI(lastSnapshot?.isConnected);
        vscode.postMessage({ command, quotaSource: source });
    }

    // attachAntigravityToolsSyncActions 保留但需要在某处调用
    // 当前由 authUi 模块处理，此函数作为兼容备用
    function _attachAntigravityToolsSyncActions() {
        const checkbox = document.getElementById('antigravityTools-sync-checkbox');
        const importBtn = document.getElementById('antigravityTools-import-btn');

        checkbox?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            antigravityToolsSyncEnabled = enabled;
            vscode.postMessage({ command: 'antigravityToolsSync.toggle', enabled });
        });

        importBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'antigravityToolsSync.import' });
        });
    }

    // ============ 账号同步配置弹框 ============

    function openATSyncConfigModal() {
        let modal = document.getElementById('at-sync-config-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'at-sync-config-modal';
            modal.className = 'modal hidden';
            modal.innerHTML = `
                <div class="modal-content at-sync-config-content">
                    <div class="modal-header">
                        <h3>⚙ ${i18n['atSyncConfig.title'] || '账号同步配置'}</h3>
                        <button class="close-btn" id="close-at-sync-config-modal">×</button>
                    </div>
                    <div class="modal-body at-sync-config-body">
                        <!-- 数据访问说明 -->
                        <div class="at-sync-section at-sync-info-section">
                            <details class="at-sync-details at-sync-info-details">
                                <summary class="at-sync-details-summary">
                                    <div class="at-sync-section-title-row">
                                        <div class="at-sync-section-title">ℹ️ ${i18n['atSyncConfig.featureTitle'] || '功能说明'}</div>
                                        <span class="at-sync-details-link">
                                            ${i18n['atSyncConfig.dataAccessDetails'] || '展开详情说明'}
                                        </span>
                                    </div>
                                    <div class="at-sync-description at-sync-info-summary">
                                        ${i18n['atSyncConfig.featureSummary'] || '查看数据访问与同步/导入规则。'}
                                    </div>
                                </summary>
                                <div class="at-sync-details-body">
                                    <div class="at-sync-info-block">
                                        <div class="at-sync-info-subtitle">🛡️ ${i18n['atSyncConfig.dataAccessTitle'] || '数据访问说明'}</div>
                                        <div class="at-sync-description">
                                            ${i18n['atSyncConfig.dataAccessDesc'] || '本功能会读取您本地 Antigravity Tools 与 Antigravity 客户端的账户信息，仅用于本插件授权/切换。'}
                                        </div>
                                        <div class="at-sync-path-info">
                                            <span class="at-sync-path-label">${i18n['atSyncConfig.readPathTools'] || 'Antigravity Tools 路径'}:</span>
                                            <code class="at-sync-path">~/.antigravity_tools/</code>
                                        </div>
                                        <div class="at-sync-path-info">
                                            <span class="at-sync-path-label">${i18n['atSyncConfig.readPathLocal'] || 'Antigravity 客户端路径'}:</span>
                                            <code class="at-sync-path">.../Antigravity/User/globalStorage/state.vscdb</code>
                                        </div>
                                        <div class="at-sync-data-list">
                                            <span class="at-sync-data-label">${i18n['atSyncConfig.readData'] || '读取内容'}:</span>
                                            <span class="at-sync-data-items">${i18n['atSyncConfig.readDataItems'] || '账户邮箱、Refresh Token（本地读取）'}</span>
                                        </div>
                                    </div>
                                    <div class="at-sync-info-block">
                                        <div class="at-sync-info-line">
                                            <span class="at-sync-info-label">${i18n['atSyncConfig.autoSyncTitle'] || '自动同步'}：</span>
                                            <span class="at-sync-info-text">${i18n['atSyncConfig.autoSyncDesc'] || '启用后检测到 Antigravity Tools 新账号时自动导入（是否切换由“自动切换”控制）。'}</span>
                                        </div>
                                        <div class="at-sync-info-line">
                                            <span class="at-sync-info-label">${i18n['atSyncConfig.manualImportTitle'] || '手动导入'}：</span>
                                            <span class="at-sync-info-text">${i18n['atSyncConfig.manualImportDesc'] || '分别导入本地账户或 Antigravity Tools 账户，仅执行一次。'}</span>
                                        </div>
                                    </div>
                                </div>
                            </details>
                        </div>
                        
                        <!-- 自动同步 / 自动切换 -->
                        <div class="at-sync-section">
                            <div class="at-sync-toggle-grid">
                                <div class="at-sync-toggle-card">
                                    <label class="at-sync-toggle-label">
                                        <input type="checkbox" id="at-sync-modal-checkbox" ${antigravityToolsSyncEnabled ? 'checked' : ''}>
                                        <span>${i18n['atSyncConfig.enableAutoSync'] || '自动同步Antigravity Tools账户'}</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 手动导入 -->
                        <div class="at-sync-section">
                            <div class="at-sync-section-title">📥 ${i18n['atSyncConfig.manualImportTitle'] || '手动导入'}</div>
                            <div class="at-sync-import-actions">
                                <button id="at-sync-modal-import-local-btn" class="at-btn at-btn-primary at-sync-import-btn">
                                    ${i18n['atSyncConfig.importLocal'] || '导入本地账户'}
                                </button>
                                <button id="at-sync-modal-import-tools-btn" class="at-btn at-btn-primary at-sync-import-btn">
                                    ${i18n['atSyncConfig.importTools'] || '导入 Antigravity Tools 账户'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // 绑定关闭按钮
            document.getElementById('close-at-sync-config-modal')?.addEventListener('click', closeATSyncConfigModal);
            
            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeATSyncConfigModal();
            });
        }

        // 更新 checkbox 状态
        const syncCheckbox = modal.querySelector('#at-sync-modal-checkbox');
        if (syncCheckbox) {
            syncCheckbox.checked = antigravityToolsSyncEnabled;
        }


        modal.querySelectorAll('.at-sync-details').forEach((detail) => {
            detail.removeAttribute('open');
        });

        // 绑定事件（每次打开都重新绑定以确保状态正确）
        const newCheckbox = modal.querySelector('#at-sync-modal-checkbox');
        const importLocalBtn = modal.querySelector('#at-sync-modal-import-local-btn');
        const importToolsBtn = modal.querySelector('#at-sync-modal-import-tools-btn');

        // 移除旧的事件监听器
        const newCheckboxClone = newCheckbox.cloneNode(true);
        newCheckbox.parentNode.replaceChild(newCheckboxClone, newCheckbox);
        const importLocalBtnClone = importLocalBtn.cloneNode(true);
        importLocalBtn.parentNode.replaceChild(importLocalBtnClone, importLocalBtn);
        const importToolsBtnClone = importToolsBtn.cloneNode(true);
        importToolsBtn.parentNode.replaceChild(importToolsBtnClone, importToolsBtn);

        // 绑定新的事件监听器
        modal.querySelector('#at-sync-modal-checkbox')?.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            antigravityToolsSyncEnabled = enabled;
            vscode.postMessage({ command: 'antigravityToolsSync.toggle', enabled });
        });

        modal.querySelector('#at-sync-modal-import-local-btn')?.addEventListener('click', () => {
            showLocalAuthImportLoading();
            vscode.postMessage({ command: 'autoTrigger.importLocal' });
            closeATSyncConfigModal();
        });
        modal.querySelector('#at-sync-modal-import-tools-btn')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'antigravityToolsSync.import' });
            closeATSyncConfigModal();
        });

        modal.classList.remove('hidden');
    }

    function closeATSyncConfigModal() {
        const modal = document.getElementById('at-sync-config-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function formatMaskedEmail(email) {
        if (!email || typeof email !== 'string') {
            return '';
        }
        return email;
    }

    function ensureLocalAuthImportModal() {
        let modal = document.getElementById('local-auth-import-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'local-auth-import-modal';
            modal.className = 'modal hidden';
            document.body.appendChild(modal);
        }
        return modal;
    }

    function bindLocalAuthImportModalClose(modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closeLocalAuthImportPrompt();
        };
        modal.querySelector('#close-local-import-modal')?.addEventListener('click', closeLocalAuthImportPrompt);
    }

    function showLocalAuthImportLoading() {
        const modal = ensureLocalAuthImportModal();
        modal.innerHTML = `
            <div class="modal-content local-import-content">
                <div class="modal-header">
                    <h3>${i18n['localImportPrompt.loadingTitle'] || '正在检测本地授权'}</h3>
                    <button class="close-btn" id="close-local-import-modal">×</button>
                </div>
                <div class="modal-body local-import-body">
                    <div class="local-import-panel">
                        <div class="local-import-desc">${i18n['localImportPrompt.loadingDesc'] || '正在读取本地已授权账号信息，请稍候…'}</div>
                        <div class="local-import-loading">
                            <span class="local-import-spinner"></span>
                            <span>${i18n['localImportPrompt.loadingHint'] || '正在检测本地授权账号'}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        bindLocalAuthImportModalClose(modal);
        modal.classList.remove('hidden');
    }

    function showLocalAuthImportPrompt(data) {
        const email = typeof data.email === 'string' ? data.email : '';
        const exists = data.exists === true;
        const displayEmail = formatMaskedEmail(email);
        const modal = ensureLocalAuthImportModal();

        modal.innerHTML = `
            <div class="modal-content local-import-content">
                <div class="modal-header">
                    <h3>${i18n['localImportPrompt.title'] || '确认同步本地授权'}</h3>
                    <button class="close-btn" id="close-local-import-modal">×</button>
                </div>
                <div class="modal-body local-import-body">
                    <div class="local-import-panel">
                        <div class="local-import-desc">${i18n['localImportPrompt.desc'] || '已检测到本地已授权账号，是否同步到插件中？'}</div>
                        <div class="local-import-summary">
                            <div class="local-import-label">${i18n['localImportPrompt.foundLabel'] || '检测到账号'}</div>
                            <div class="local-import-email" id="local-import-email"></div>
                            <span class="local-import-tag" id="local-import-tag">${i18n['localImportPrompt.existsTag'] || '已存在'}</span>
                        </div>
                        <div class="local-import-note" id="local-import-note"></div>
                    </div>
                    <div class="local-import-actions">
                        <button id="local-import-cancel-btn" class="at-btn at-btn-outline">${i18n['localImportPrompt.cancel'] || '取消'}</button>
                        <button id="local-import-confirm-btn" class="at-btn at-btn-primary"></button>
                    </div>
                </div>
            </div>
        `;

        bindLocalAuthImportModalClose(modal);

        const emailEl = modal.querySelector('#local-import-email');
        const tagEl = modal.querySelector('#local-import-tag');
        const noteEl = modal.querySelector('#local-import-note');
        const confirmBtn = modal.querySelector('#local-import-confirm-btn');
        const cancelBtn = modal.querySelector('#local-import-cancel-btn');

        if (emailEl) {
            emailEl.textContent = displayEmail || i18n['localImportPrompt.unknownEmail'] || '未知账号';
        }
        if (tagEl) {
            tagEl.style.display = exists ? 'inline-flex' : 'none';
        }
        if (noteEl) {
            noteEl.textContent = exists
                ? (i18n['localImportPrompt.existsDesc'] || '该账号已存在，继续将覆盖本地保存的授权信息。')
                : (i18n['localImportPrompt.newDesc'] || '将导入并切换为该账号。');
        }

        const confirmLabel = exists
            ? (i18n['localImportPrompt.overwrite'] || '覆盖并同步')
            : (i18n['localImportPrompt.confirm'] || '确认同步');
        if (confirmBtn) {
            confirmBtn.textContent = confirmLabel;
        }

        if (confirmBtn && confirmBtn.parentNode && cancelBtn && cancelBtn.parentNode) {
            const confirmBtnClone = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(confirmBtnClone, confirmBtn);
            const cancelBtnClone = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(cancelBtnClone, cancelBtn);

            modal.querySelector('#local-import-confirm-btn')?.addEventListener('click', () => {
                vscode.postMessage({ command: 'autoTrigger.importLocalConfirm', overwrite: exists });
                closeLocalAuthImportPrompt();
            });
            modal.querySelector('#local-import-cancel-btn')?.addEventListener('click', () => {
                closeLocalAuthImportPrompt();
            });
        }

        modal.classList.remove('hidden');
    }

    function closeLocalAuthImportPrompt() {
        const modal = document.getElementById('local-auth-import-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    /**
     * 显示 AntigravityTools Sync 弹框
     * @param {Object} data - 弹框数据
     * @param {string} data.promptType - 弹框类型: 'new_accounts' | 'switch_only' | 'not_found'
     * @param {string[]} data.newEmails - 新账户列表（new_accounts 场景）
     * @param {string} data.currentEmail - AntigravityTools 当前账户
     * @param {string} data.localEmail - 本地当前账户（switch_only 场景）
     * @param {boolean} data.autoConfirm - 是否自动确认（自动同步模式）
     */
    function showAntigravityToolsSyncPrompt(data) {
        const promptType = data.promptType || 'new_accounts';
        const newEmails = data.newEmails || [];
        const currentEmail = data.currentEmail || '';
        const localEmail = data.localEmail || '';
        const autoConfirm = data.autoConfirm === true;
        const autoConfirmImportOnly = data.autoConfirmImportOnly === true;

        let modal = document.getElementById('antigravityTools-sync-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'antigravityTools-sync-modal';
            modal.className = 'modal hidden';
            document.body.appendChild(modal);
        }

        // 根据场景渲染不同内容
        if (promptType === 'not_found') {
            // 场景：未检测到 AntigravityTools 账户
            modal.innerHTML = `
                <div class="modal-content antigravityTools-sync-content">
                    <div class="modal-header antigravityTools-sync-header">
                        <div class="antigravityTools-sync-title">
                            <h3>${i18n['antigravityToolsSync.notFoundTitle']}</h3>
                        </div>
                        <button class="close-btn" id="antigravityTools-sync-close">×</button>
                    </div>
                    <div class="modal-body antigravityTools-sync-body">
                        <div class="antigravityTools-sync-section">
                            <p class="antigravityTools-sync-notice">${i18n['antigravityToolsSync.notFoundDesc']}</p>
                        </div>
                    </div>
                    <div class="modal-footer antigravityTools-sync-footer">
                        <button id="antigravityTools-sync-manual-import" class="at-btn at-btn-primary">
                            ${i18n['antigravityToolsSync.manualImportBtn'] || '手动导入 JSON'}
                        </button>
                        <button id="antigravityTools-sync-ok" class="at-btn at-btn-secondary">${i18n['common.gotIt']}</button>
                    </div>
                </div>
            `;
            modal.classList.remove('hidden');
            
            modal.querySelector('#antigravityTools-sync-close')?.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
            modal.querySelector('#antigravityTools-sync-ok')?.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
            modal.querySelector('#antigravityTools-sync-manual-import')?.addEventListener('click', () => {
                modal.classList.add('hidden');
                showAntigravityToolsJsonImportModal();
            });
            return;
        }

        if (promptType === 'switch_only') {
            // 场景：账户不一致，询问是否切换
            modal.innerHTML = `
                <div class="modal-content antigravityTools-sync-content">
                    <div class="modal-header antigravityTools-sync-header">
                        <div class="antigravityTools-sync-title">
                            <h3>${i18n['antigravityToolsSync.switchTitle']}</h3>
                        </div>
                        <button class="close-btn" id="antigravityTools-sync-close">×</button>
                    </div>
                    <div class="modal-body antigravityTools-sync-body">
                        <div class="antigravityTools-sync-section">
                            <div class="antigravityTools-sync-label">${i18n['antigravityToolsSync.localAccount']}</div>
                             <div class="antigravityTools-sync-current">${localEmail || i18n['common.none']}</div>
                        </div>
                        <div class="antigravityTools-sync-section">
                            <div class="antigravityTools-sync-label">${i18n['autoTrigger.antigravityToolsSyncTarget']}</div>
                            <div class="antigravityTools-sync-current antigravityTools-sync-highlight">${currentEmail}</div>
                        </div>
                    </div>
                    <div class="modal-footer antigravityTools-sync-footer">
                        <button id="antigravityTools-sync-cancel" class="at-btn at-btn-secondary">${i18n['common.cancel']}</button>
                        <button id="antigravityTools-sync-switch" class="at-btn at-btn-primary">${i18n['antigravityToolsSync.switchBtn']}</button>
                    </div>
                </div>
            `;
            modal.classList.remove('hidden');

            let autoSwitchTimer = null;

            const closeBtn = modal.querySelector('#antigravityTools-sync-close');
            const cancelBtn = modal.querySelector('#antigravityTools-sync-cancel');
            const switchBtn = modal.querySelector('#antigravityTools-sync-switch');

            function clearAutoTimer() {
                if (autoSwitchTimer) {
                    clearTimeout(autoSwitchTimer);
                    autoSwitchTimer = null;
                }
            }

            function doSwitch() {
                clearAutoTimer();
                switchBtn.disabled = true;
                cancelBtn.disabled = true;
                closeBtn.disabled = true;
                switchBtn.textContent = i18n['autoTrigger.switching'];
                // switchOnly: true 告诉后端这是纯切换场景，无需导入
                vscode.postMessage({ command: 'antigravityToolsSync.importConfirm', importOnly: false, switchOnly: true, targetEmail: currentEmail });
            }

            closeBtn?.addEventListener('click', () => {
                clearAutoTimer();
                modal.classList.add('hidden');
            });
            cancelBtn?.addEventListener('click', () => {
                clearAutoTimer();
                modal.classList.add('hidden');
            });
            switchBtn?.addEventListener('click', doSwitch);

            // 自动确认模式：延迟一小段时间后自动执行切换
            if (autoConfirm) {
                autoSwitchTimer = setTimeout(() => doSwitch(), 300);
            }
            return;
        }

        // 场景：有新账户（默认，原有逻辑）
        modal.innerHTML = `
            <div class="modal-content antigravityTools-sync-content">
                <div class="modal-header antigravityTools-sync-header">
                    <div class="antigravityTools-sync-title">
                        <h3>${i18n['autoTrigger.antigravityToolsSyncTitle']}</h3>
                        <span class="antigravityTools-sync-count" id="antigravityTools-sync-count">+${newEmails.length}</span>
                    </div>
                    <button class="close-btn" id="antigravityTools-sync-close">×</button>
                </div>
                <div class="modal-body antigravityTools-sync-body">
                    <div class="antigravityTools-sync-section">
                        <div class="antigravityTools-sync-label">${i18n['autoTrigger.antigravityToolsSyncNew']}</div>
                        <div class="antigravityTools-sync-chips">${newEmails.map(e => `<span class="antigravityTools-sync-chip">${e}</span>`).join('')}</div>
                    </div>
                    <div class="antigravityTools-sync-section">
                        <div class="antigravityTools-sync-label">${i18n['autoTrigger.antigravityToolsSyncTarget']}</div>
                        <div class="antigravityTools-sync-current">${currentEmail || i18n['common.unknown']}</div>
                    </div>
                </div>
                <div class="modal-footer antigravityTools-sync-footer">
                    <button id="antigravityTools-sync-cancel" class="at-btn at-btn-secondary">${i18n['common.cancel']}</button>
                    <div class="antigravityTools-sync-action-group">
                        <button id="antigravityTools-sync-import-only" class="at-btn at-btn-secondary">${i18n['autoTrigger.importOnly']}</button>
                        <button id="antigravityTools-sync-import-switch" class="at-btn at-btn-primary">${i18n['autoTrigger.importAndSwitch']}</button>
                    </div>
                </div>
            </div>
        `;
        modal.classList.remove('hidden');

        let autoConfirmTimer = null;

        const closeBtn = modal.querySelector('#antigravityTools-sync-close');
        const cancelBtn = modal.querySelector('#antigravityTools-sync-cancel');
        const importOnlyBtn = modal.querySelector('#antigravityTools-sync-import-only');
        const importSwitchBtn = modal.querySelector('#antigravityTools-sync-import-switch');

        function clearAutoTimer() {
            if (autoConfirmTimer) {
                clearTimeout(autoConfirmTimer);
                autoConfirmTimer = null;
            }
        }

        function setLoading(clickedBtn) {
            clearAutoTimer();
            if (importOnlyBtn) importOnlyBtn.disabled = true;
            if (importSwitchBtn) importSwitchBtn.disabled = true;
            if (cancelBtn) cancelBtn.disabled = true;
            if (closeBtn) closeBtn.disabled = true;
            if (clickedBtn) {
                clickedBtn.textContent = i18n['autoTrigger.importing'];
            }
        }

        function doImportOnly() {
            setLoading(importOnlyBtn);
            vscode.postMessage({ command: 'antigravityToolsSync.importConfirm', importOnly: true });
        }

        function doImportAndSwitch() {
            setLoading(importSwitchBtn);
            vscode.postMessage({ command: 'antigravityToolsSync.importConfirm', importOnly: false });
        }

        closeBtn?.addEventListener('click', () => {
            clearAutoTimer();
            modal.classList.add('hidden');
        });
        cancelBtn?.addEventListener('click', () => {
            clearAutoTimer();
            modal.classList.add('hidden');
        });
        importOnlyBtn?.addEventListener('click', doImportOnly);
        importSwitchBtn?.addEventListener('click', doImportAndSwitch);

        // 自动确认模式：延迟一小段时间后自动执行"导入并切换"
        if (autoConfirm) {
            autoConfirmTimer = setTimeout(() => {
                if (autoConfirmImportOnly) {
                    doImportOnly();
                } else {
                    doImportAndSwitch();
                }
            }, 300);
        }
    }

    function showAntigravityToolsJsonImportModal() {
        let modal = document.getElementById('antigravityTools-json-import-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'antigravityTools-json-import-modal';
            modal.className = 'modal hidden';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-content antigravityTools-json-content">
                <div class="modal-header antigravityTools-sync-header">
                    <div class="antigravityTools-sync-title">
                        <h3>${i18n['antigravityToolsSync.manualImportTitle'] || '手动导入 JSON'}</h3>
                    </div>
                    <button class="close-btn" id="antigravityTools-json-close">×</button>
                </div>
                <div class="modal-body antigravityTools-json-body">
                    <div class="antigravityTools-sync-section">
                        <p class="antigravityTools-sync-notice">
                            ${i18n['antigravityToolsSync.manualImportDesc'] || '未检测到本地 Antigravity Tools 账户，可通过 JSON 文件或粘贴内容导入。'}
                        </p>
                    </div>
                    <div class="at-json-import-panel">
                        <div class="at-json-import-actions">
                            <input type="file" id="antigravityTools-json-file-input" accept=".json,application/json" class="hidden">
                            <button id="antigravityTools-json-file-btn" class="at-btn at-btn-secondary">
                                ${i18n['antigravityToolsSync.manualImportFile'] || '选择 JSON 文件'}
                            </button>
                            <span class="at-json-import-file-name" id="antigravityTools-json-file-name">
                                ${i18n['common.none'] || '未选择文件'}
                            </span>
                        </div>
                        <textarea id="antigravityTools-json-textarea" class="at-json-import-textarea" spellcheck="false" placeholder='${i18n['antigravityToolsSync.manualImportPlaceholder'] || '粘贴 JSON 数组，例如: [{"email":"a@b.com","refresh_token":"..."}]'}'></textarea>
                        <div class="at-json-import-status" id="antigravityTools-json-status"></div>
                        <div class="antigravityTools-sync-chips at-json-import-preview" id="antigravityTools-json-preview"></div>
                        <div class="antigravityTools-sync-note">
                            ${i18n['antigravityToolsSync.manualImportHint'] || '内容仅在本地解析，不会上传。'}
                        </div>
                    </div>
                </div>
                <div class="modal-footer antigravityTools-sync-footer">
                    <button id="antigravityTools-json-cancel" class="at-btn at-btn-secondary">${i18n['common.cancel']}</button>
                    <button id="antigravityTools-json-import" class="at-btn at-btn-primary" disabled>
                        ${i18n['autoTrigger.importOnly'] || '仅导入'}
                    </button>
                </div>
            </div>
        `;

        modal.classList.remove('hidden');

        const fileInput = modal.querySelector('#antigravityTools-json-file-input');
        const fileBtn = modal.querySelector('#antigravityTools-json-file-btn');
        const fileNameEl = modal.querySelector('#antigravityTools-json-file-name');
        const textarea = modal.querySelector('#antigravityTools-json-textarea');
        const statusEl = modal.querySelector('#antigravityTools-json-status');
        const previewEl = modal.querySelector('#antigravityTools-json-preview');
        const importBtn = modal.querySelector('#antigravityTools-json-import');
        const closeBtn = modal.querySelector('#antigravityTools-json-close');
        const cancelBtn = modal.querySelector('#antigravityTools-json-cancel');

        let currentText = '';

        function parseJson(text) {
            const trimmed = (text || '').trim();
            if (!trimmed) {
                return { entries: [], invalid: 0, error: '' };
            }

            let data;
            try {
                data = JSON.parse(trimmed);
            } catch {
                return { entries: [], invalid: 0, error: i18n['antigravityToolsSync.manualImportJsonError'] || 'JSON 解析失败' };
            }

            if (!Array.isArray(data)) {
                return { entries: [], invalid: 0, error: i18n['antigravityToolsSync.manualImportJsonArray'] || 'JSON must be an array' };
            }

            const entries = [];
            let invalid = 0;
            const seen = new Set();

            for (const item of data) {
                if (!item || typeof item !== 'object') {
                    invalid += 1;
                    continue;
                }

                const email = typeof item.email === 'string' ? item.email.trim() : '';
                const refreshToken = typeof item.refresh_token === 'string'
                    ? item.refresh_token.trim()
                    : (typeof item.refreshToken === 'string' ? item.refreshToken.trim() : '');

                if (!email || !refreshToken) {
                    invalid += 1;
                    continue;
                }

                const key = email.toLowerCase();
                if (seen.has(key)) {
                    invalid += 1;
                    continue;
                }

                seen.add(key);
                entries.push({ email, refreshToken });
            }

            return { entries, invalid, error: '' };
        }

        function updatePreview(entries, invalid, error) {
            if (statusEl) {
                statusEl.classList.toggle('is-error', Boolean(error));
            }

            if (error) {
                if (statusEl) statusEl.textContent = error;
                if (previewEl) previewEl.innerHTML = '';
                if (importBtn) importBtn.disabled = true;
                return;
            }

            if (entries.length === 0) {
                if (statusEl) {
                    statusEl.textContent = i18n['antigravityToolsSync.manualImportEmpty'] || '请粘贴或选择 JSON 文件';
                }
                if (previewEl) previewEl.innerHTML = '';
                if (importBtn) importBtn.disabled = true;
                return;
            }

            const invalidSuffix = invalid > 0
                ? ` · ${(i18n['antigravityToolsSync.manualImportInvalid'] || '无效条目')} ${invalid}`
                : '';
            if (statusEl) {
                statusEl.textContent = `${i18n['antigravityToolsSync.manualImportPreview'] || '将导入'} ${entries.length} ${i18n['antigravityToolsSync.manualImportCountSuffix'] || '个账号'}${invalidSuffix}`;
            }

            if (previewEl) {
                const maxPreview = 6;
                const chips = entries.slice(0, maxPreview).map(item => (
                    `<span class="antigravityTools-sync-chip">${escapeHtml(item.email)}</span>`
                ));
                if (entries.length > maxPreview) {
                    chips.push(`<span class="antigravityTools-sync-chip">+${entries.length - maxPreview}</span>`);
                }
                previewEl.innerHTML = chips.join('');
            }

            if (importBtn) importBtn.disabled = false;
        }

        function handleTextChange(text) {
            currentText = text;
            const result = parseJson(text);
            updatePreview(result.entries, result.invalid, result.error);
        }

        fileBtn?.addEventListener('click', () => {
            fileInput?.click();
        });

        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                return;
            }
            const text = await file.text();
            if (textarea) textarea.value = text;
            if (fileNameEl) fileNameEl.textContent = file.name;
            handleTextChange(text);
        });

        textarea?.addEventListener('input', (e) => {
            if (fileNameEl) {
                fileNameEl.textContent = i18n['antigravityToolsSync.manualImportPaste'] || '粘贴 JSON';
            }
            handleTextChange(e.target.value);
        });

        importBtn?.addEventListener('click', () => {
            const result = parseJson(currentText);
            if (result.error || result.entries.length === 0) {
                showToast(result.error || (i18n['antigravityToolsSync.manualImportEmpty'] || '请提供有效 JSON'), 'warning');
                return;
            }
            importBtn.disabled = true;
            importBtn.textContent = i18n['autoTrigger.importing'] || 'Importing...';
            vscode.postMessage({ command: 'antigravityToolsSync.importJson', jsonText: currentText });
        });

        closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
        cancelBtn?.addEventListener('click', () => modal.classList.add('hidden'));

        updatePreview([], 0, '');
    }

    /**
     * 更新导入进度显示，并添加取消按钮
     */
    function updateAntigravityToolsSyncProgress(current, total, email) {
        const cancelText = i18n['common.cancel'] || '取消';
        const progressText = `${i18n['autoTrigger.importing'] || 'Importing...'} ${current}/${total}`;
        
        // 更新 antigravityTools-sync-modal 中的按钮
        const syncModal = document.getElementById('antigravityTools-sync-modal');
        if (syncModal) {
            const importOnlyBtn = syncModal.querySelector('#antigravityTools-sync-import-only');
            const importSwitchBtn = syncModal.querySelector('#antigravityTools-sync-import-switch');
            const cancelBtn = syncModal.querySelector('#antigravityTools-sync-cancel');
            
            // 显示进度
            if (importOnlyBtn && importOnlyBtn.disabled) {
                importOnlyBtn.textContent = progressText;
            }
            if (importSwitchBtn && importSwitchBtn.disabled) {
                importSwitchBtn.textContent = progressText;
            }
            
            // 启用取消按钮
            if (cancelBtn) {
                cancelBtn.disabled = false;
                cancelBtn.textContent = cancelText;
                cancelBtn.onclick = () => {
                    vscode.postMessage({ command: 'antigravityToolsSync.cancel' });
                    cancelBtn.disabled = true;
                    cancelBtn.textContent = i18n['common.cancelling'] || '取消中...';
                };
            }
        }

        // 更新 antigravityTools-json-import-modal 中的按钮
        const jsonModal = document.getElementById('antigravityTools-json-import-modal');
        if (jsonModal) {
            const importBtn = jsonModal.querySelector('#antigravityTools-json-import');
            const cancelBtn = jsonModal.querySelector('#antigravityTools-json-cancel');
            
            if (importBtn && importBtn.disabled) {
                importBtn.textContent = progressText;
            }
            
            // 启用取消按钮
            if (cancelBtn) {
                cancelBtn.disabled = false;
                cancelBtn.textContent = cancelText;
                cancelBtn.onclick = () => {
                    vscode.postMessage({ command: 'antigravityToolsSync.cancel' });
                    cancelBtn.disabled = true;
                    cancelBtn.textContent = i18n['common.cancelling'] || '取消中...';
                };
            }
        }

        // 可选：在控制台输出进度日志
        console.log(`[AntigravityToolsSync] Progress: ${current}/${total} - ${email}`);
    }

    /**
     * 处理导入完成消息
     */
    function handleAntigravityToolsSyncComplete(_success, _error) {
        const modal = document.getElementById('antigravityTools-sync-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
        const jsonModal = document.getElementById('antigravityTools-json-import-modal');
        if (jsonModal) {
            jsonModal.classList.add('hidden');
        }
        // Toast 提示由后端的 vscode.window.showInformationMessage 处理
    }

    function updateQuotaSourceUI(isConnected) {
        const statusEl = document.querySelector('.quota-source-status');
        const buttons = document.querySelectorAll('.quota-source-btn');

        buttons.forEach(btn => {
            const source = btn.dataset.source;
            btn.classList.toggle('active', source === currentQuotaSource);
        });

        if (statusEl) {
            const authorizedReady = currentQuotaSource !== 'authorized' || authorizedAvailable;
            const ok = isConnected !== false && authorizedReady;
            statusEl.dataset.state = ok ? 'ok' : 'error';
        }

        updateQuotaAuthUI();
        updateQuotaSourceInfo();
    }

    function updateQuotaAuthUI() {
        const card = document.getElementById('quota-auth-card');
        const row = document.getElementById('quota-auth-row');
        if (!card || !row) {
            return;
        }

        // Local 模式下显示本地账户信息（只读）
        if (currentQuotaSource !== 'authorized') {
            const localEmail = lastSnapshot?.localAccountEmail;
            if (localEmail) {
                // 使用远端 API + 本地账户
                card.classList.remove('hidden');
                // 切换至当前登录账户按钮
                const switchToClientBtn = `<button class="quota-account-manage-btn at-switch-to-client-btn-local" title="${i18n['autoTrigger.switchToClientAccount'] || '切换至当前登录账户'}">${i18n['autoTrigger.switchToClientAccount'] || '切换至当前登录账户'}</button>`;
                row.innerHTML = `
                    <div class="quota-auth-info">
                        <span class="quota-auth-icon">👤</span>
                        <span class="quota-auth-text">${i18n['quotaSource.localAccountLabel'] || '当前账户'}</span>
                        <span class="quota-auth-email">${localEmail}</span>
                        ${switchToClientBtn}
                    </div>
                `;
                // 绑定切换按钮事件
                row.querySelector('.at-switch-to-client-btn-local')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'antigravityToolsSync.switchToClient' });
                });
            } else {
                // 使用本地进程 API
                card.classList.add('hidden');
            }
            return;
        }

        card.classList.remove('hidden');
        const auth = authorizationStatus;
        const accounts = auth?.accounts || [];
        const hasAccounts = accounts.length > 0;
        const activeAccount = auth?.activeAccount;
        const activeEmail = activeAccount || (accounts.length > 0 ? accounts[0].email : null);

        if (authUi) {
            authUi.updateState(auth, antigravityToolsSyncEnabled, antigravityToolsAutoSwitchEnabled);
            authUi.renderAuthRow(row, {
                showSyncToggleInline: false,
            });
            return;
        }
        // 账号同步配置按钮
        const atSyncConfigBtn = `<button id="at-sync-config-btn" class="at-btn at-btn-primary" title="${i18n['atSyncConfig.title'] || '账号同步配置'}">⚙ ${i18n['atSyncConfig.btnText'] || '账号同步配置'}</button>`;

        if (hasAccounts && activeEmail) {
            // 保持原有的单行布局，增加下拉箭头用于管理多账号
            const _hasMultipleAccounts = accounts.length > 1;
            const extraCount = Math.max(accounts.length - 1, 0);
            const accountCountBadge = extraCount > 0
                ? `<span class="account-count-badge" title="${i18n['autoTrigger.manageAccounts'] || 'Manage Accounts'}">+${extraCount}</span>`
                : '';
            const manageBtn = `<button id="quota-account-manage-btn" class="quota-account-manage-btn" title="${i18n['autoTrigger.manageAccounts']}">${i18n['autoTrigger.manageAccounts']}</button>`;
            
            row.innerHTML = `
                <div class="quota-auth-info quota-auth-info-clickable" title="${i18n['autoTrigger.manageAccounts']}">
                    <span class="quota-auth-icon">✅</span>
                    <span class="quota-auth-text">${i18n['autoTrigger.authorized']}</span>
                    <span class="quota-auth-email">${activeEmail}</span>
                    ${accountCountBadge}
                    ${manageBtn}
                </div>
                <div class="quota-auth-actions">
                    ${atSyncConfigBtn}
                </div>
            `;

            // 点击授权信息区域打开账号管理弹框
            row.querySelector('.quota-auth-info')?.addEventListener('click', () => {
                openAccountManageModal();
            });

            // 管理账号按钮
            document.getElementById('quota-account-manage-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                openAccountManageModal();
            });

            // 账号同步配置按钮
            document.getElementById('at-sync-config-btn')?.addEventListener('click', () => {
                openATSyncConfigModal();
            });
        } else {
            // No accounts - show authorize button (on the right)
            row.innerHTML = `
                <div class="quota-auth-info">
                    <span class="quota-auth-icon">⚠️</span>
                    <span class="quota-auth-text">${i18n['autoTrigger.unauthorized'] || 'Unauthorized'}</span>
                </div>
                <div class="quota-auth-actions">
                    ${atSyncConfigBtn}
                    <button id="quota-auth-btn" class="at-btn at-btn-primary">${i18n['autoTrigger.authorizeBtn'] || 'Authorize'}</button>
                </div>
            `;
            document.getElementById('quota-auth-btn')?.addEventListener('click', () => {
                openAuthChoiceModal();
            });
            document.getElementById('at-sync-config-btn')?.addEventListener('click', () => {
                openATSyncConfigModal();
            });
        }
    }

    // ============ 账号管理弹框 ============

    function openAccountManageModal() {
        let modal = document.getElementById('account-manage-modal');
        if (!modal) {
            // 动态创建弹框
            modal = document.createElement('div');
            modal.id = 'account-manage-modal';
            modal.className = 'modal hidden';
            modal.innerHTML = `
                <div class="modal-content account-manage-content">
                    <div class="modal-header">
                        <h3>${i18n['autoTrigger.manageAccounts'] || 'Manage Accounts'}</h3>
                        <button class="close-btn" id="close-account-manage-modal">×</button>
                    </div>
                    <div class="modal-hint" style="padding: 8px 16px; font-size: 12px; color: var(--text-muted); background: var(--bg-secondary); border-bottom: 1px solid var(--border-color);">
                        <span style="margin-right: 12px;">💡 ${i18n['autoTrigger.manageAccountsHintClick'] || '点击邮箱可切换查看配额'}</span>
                        <span>🔄 ${i18n['autoTrigger.manageAccountsHintSwitch'] || '点击"切换登录"可切换客户端登录账户'}</span>
                    </div>
                    <div class="modal-body" id="account-manage-body">
                        <!-- 账号列表将在这里动态渲染 -->
                    </div>
                    <div class="modal-footer">
                        <button id="add-new-account-btn" class="at-btn at-btn-primary">➕ ${i18n['autoTrigger.addAccount'] || 'Add Account'}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // 绑定关闭按钮
            document.getElementById('close-account-manage-modal')?.addEventListener('click', closeAccountManageModal);
            
            // 点击背景关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAccountManageModal();
            });

            // 绑定添加账号按钮
            document.getElementById('add-new-account-btn')?.addEventListener('click', () => {
                vscode.postMessage({ command: 'autoTrigger.addAccount' });
            });
        }

        // 渲染账号列表
        renderAccountManageList();
        modal.classList.remove('hidden');
    }

    function closeAccountManageModal() {
        const modal = document.getElementById('account-manage-modal');
        if (modal) modal.classList.add('hidden');
    }

    function renderAccountManageList() {
        const body = document.getElementById('account-manage-body');
        if (!body) return;

        const auth = authorizationStatus;
        const accounts = auth?.accounts || [];
        const activeAccount = auth?.activeAccount;

        if (accounts.length === 0) {
            body.innerHTML = `<div class="account-manage-empty">${i18n['autoTrigger.noAccounts'] || 'No accounts authorized'}</div>`;
            return;
        }

        const listHtml = accounts.map(acc => {
            const isActive = acc.email === activeAccount;
            // Check if refresh token is invalid (marked by backend when refresh fails)
            const isInvalid = acc.isInvalid === true;
            const invalidClass = isInvalid ? ' expired' : '';
            const icon = isInvalid ? '⚠️' : (isActive ? '✅' : '👤');
            const invalidBadge = isInvalid ? `<span class="account-manage-badge expired">${i18n['autoTrigger.tokenExpired'] || 'Expired'}</span>` : '';
            const activeBadge = isActive && !isInvalid ? `<span class="account-manage-badge">${i18n['autoTrigger.accountActive'] || 'Active'}</span>` : '';
            
            // 切换登录账户按钮（所有账号都显示）
            const switchBtn = `<button class="at-btn at-btn-small at-btn-primary account-switch-login-btn" data-email="${acc.email}">${i18n['autoTrigger.switchLoginBtn'] || '切换登录'}</button>`;
            
            return `
                <div class="account-manage-item ${isActive ? 'active' : ''}${invalidClass}" data-email="${acc.email}">
                    <div class="account-manage-info">
                        <span class="account-manage-icon">${icon}</span>
                        <span class="account-manage-email">${acc.email}</span>
                        ${activeBadge}${invalidBadge}
                    </div>
                    <div class="account-manage-actions">
                        ${switchBtn}
                        <button class="at-btn at-btn-small at-btn-danger account-remove-btn" data-email="${acc.email}">${i18n['autoTrigger.deleteBtn'] || '删除'}</button>
                    </div>
                </div>
            `;
        }).join('');

        body.innerHTML = `<div class="account-manage-list">${listHtml}</div>`;

        // 绑定点击整行切换查看配额
        body.querySelectorAll('.account-manage-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // 如果点击的是按钮，则忽略（按钮已有阻止冒泡，但多一层判断更安全）
                if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
                
                // 如果已激活，不执行操作
                if (item.classList.contains('active')) return;

                const email = item.dataset.email;
                if (email) {
                    vscode.postMessage({ command: 'autoTrigger.switchAccount', email });
                    closeAccountManageModal();
                }
            });
        });

        // 绑定切换登录账户按钮（需确认）
        body.querySelectorAll('.account-switch-login-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const email = btn.dataset.email;
                if (email) {
                    showSwitchLoginConfirmModal(email);
                }
            });
        });

        // 绑定删除按钮
        body.querySelectorAll('.account-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const email = btn.dataset.email;
                if (email && typeof window.openRevokeModalForEmail === 'function') {
                    window.openRevokeModalForEmail(email);
                }
            });
        });
    }

    /**
     * 显示切换登录确认弹窗
     */
    function showSwitchLoginConfirmModal(email) {
        // 创建确认弹窗
        let modal = document.getElementById('switch-login-confirm-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'switch-login-confirm-modal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 400px;">
                    <div class="modal-header">
                        <h3>${i18n['autoTrigger.switchLoginTitle'] || '切换登录账户'}</h3>
                        <button class="modal-close" id="switch-login-confirm-close">×</button>
                    </div>
                    <div class="modal-body" style="padding: 20px;">
                        <p style="margin-bottom: 10px;">${i18n['autoTrigger.switchLoginConfirmText'] || '确定要切换到以下账户吗？'}</p>
                        <p style="font-weight: bold; color: var(--accent-color); margin-bottom: 15px;" id="switch-login-target-email"></p>
                        <p style="color: var(--warning-color); font-size: 0.9em;">⚠️ ${i18n['autoTrigger.switchLoginWarning'] || '此操作将重启 Antigravity 客户端以完成账户切换。'}</p>
                    </div>
                    <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; padding: 15px 20px;">
                        <button class="at-btn at-btn-secondary" id="switch-login-confirm-cancel">${i18n['common.cancel'] || '取消'}</button>
                        <button class="at-btn at-btn-primary" id="switch-login-confirm-ok">${i18n['common.confirm'] || '确认'}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // 绑定关闭按钮
            document.getElementById('switch-login-confirm-close').addEventListener('click', () => {
                modal.classList.add('hidden');
            });
            document.getElementById('switch-login-confirm-cancel').addEventListener('click', () => {
                modal.classList.add('hidden');
            });
            // 点击遮罩关闭
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }

        // 设置目标邮箱
        document.getElementById('switch-login-target-email').textContent = email;

        // 绑定确认按钮
        const okBtn = document.getElementById('switch-login-confirm-ok');
        const newOkBtn = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOkBtn, okBtn);
        newOkBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            // 发送切换登录账户的命令
            vscode.postMessage({ command: 'autoTrigger.switchLoginAccount', email });
            closeAccountManageModal();
        });

        modal.classList.remove('hidden');
    }

    function updateQuotaSourceInfo() {
        if (!quotaSourceInfo) {
            return;
        }
        if (isQuotaSourceSwitching || !lastSnapshot || !lastSnapshot.isConnected) {
            quotaSourceInfo.classList.add('hidden');
            return;
        }
        const isAuthorized = currentQuotaSource === 'authorized';
        const title = isAuthorized
            ? (i18n['quotaSource.authorizedInfoTitle'] || 'Authorized Monitoring')
            : (i18n['quotaSource.localInfoTitle'] || 'Local Monitoring');
        const text = title;
        quotaSourceInfo.classList.remove('hidden');
        quotaSourceInfo.classList.toggle('authorized', isAuthorized);
        quotaSourceInfo.classList.toggle('local', !isAuthorized);
        quotaSourceInfo.innerHTML = `
            <div class="quota-source-info-content">
                <div class="quota-source-info-text">${text}</div>
            </div>
        `;
    }

    function renderLoadingCard(source) {
        statusDiv.style.display = 'none';
        dashboard.innerHTML = '';

        if (source === 'authorized') {
            renderAuthorizedLoadingCard();
        } else {
            renderLocalLoadingCard();
        }
    }

    function renderLocalLoadingCard() {
        const card = document.createElement('div');
        card.className = 'offline-card local-card';
        card.innerHTML = `
            <div class="icon offline-spinner"><span class="spinner"></span></div>
            <h2>${i18n['quotaSource.localLoadingTitle'] || 'Detecting local Antigravity...'}</h2>
            <p>${i18n['quotaSource.localLoadingDesc'] || 'Keep the Antigravity client running. You can switch to authorized monitoring anytime.'}</p>
            <div class="offline-actions">
                <button class="btn-secondary" data-action="switch-authorized">
                    ${i18n['quotaSource.switchToAuthorized'] || 'Switch to Authorized'}
                </button>
            </div>
        `;
        dashboard.appendChild(card);
        const switchBtn = card.querySelector('[data-action="switch-authorized"]');
        switchBtn?.addEventListener('click', () => {
            requestQuotaSourceChange('authorized', { force: true });
        });
    }

    function renderAuthorizedLoadingCard() {
        const card = document.createElement('div');
        card.className = 'offline-card authorized-card';
        card.innerHTML = `
            <div class="icon offline-spinner"><span class="spinner"></span></div>
            <h2>${i18n['quotaSource.authorizedLoadingTitle'] || 'Loading authorized quota...'}</h2>
            <p>${i18n['quotaSource.authorizedLoadingDesc'] || 'Fetching quota data from the remote API.'}</p>
            <div class="offline-actions">
                <button class="btn-secondary" data-action="switch-local">
                    ${i18n['quotaSource.switchToLocal'] || 'Switch to Local'}
                </button>
            </div>
        `;
        dashboard.appendChild(card);
        const switchBtn = card.querySelector('[data-action="switch-local"]');
        switchBtn?.addEventListener('click', () => {
            requestQuotaSourceChange('local', { force: true });
        });
    }

    function getRecommendedRank(model) {
        const label = model?.label || '';
        const modelId = model?.modelId || '';
        if (AUTH_RECOMMENDED_ID_RANK.has(modelId)) {
            return AUTH_RECOMMENDED_ID_RANK.get(modelId);
        }
        if (AUTH_RECOMMENDED_LABEL_RANK.has(label)) {
            return AUTH_RECOMMENDED_LABEL_RANK.get(label);
        }
        const normalizedId = normalizeRecommendedKey(modelId);
        const normalizedLabel = normalizeRecommendedKey(label);
        return Math.min(
            AUTH_RECOMMENDED_ID_KEY_RANK.get(normalizedId) ?? Number.MAX_SAFE_INTEGER,
            AUTH_RECOMMENDED_LABEL_KEY_RANK.get(normalizedLabel) ?? Number.MAX_SAFE_INTEGER
        );
    }

    function getRecommendedIds(models) {
        return models
            .filter(model => getRecommendedRank(model) < Number.MAX_SAFE_INTEGER)
            .sort((a, b) => getRecommendedRank(a) - getRecommendedRank(b))
            .map(model => model.modelId);
    }

    function openModelManagerModal() {
        if (!modelManagerModal) {
            return;
        }

        modelManagerModels = getModelManagerModels();
        modelManagerSelection = new Set(getDefaultVisibleModelIds(modelManagerModels));
        renderModelManagerList();
        modelManagerModal.classList.remove('hidden');
    }

    function closeModelManagerModal() {
        modelManagerModal?.classList.add('hidden');
    }

    function getModelManagerModels() {
        const models = lastSnapshot?.allModels || lastSnapshot?.models || [];
        // Only include recommended models
        const recommendedModels = models.filter(model => getRecommendedRank(model) < Number.MAX_SAFE_INTEGER);
        // Use recommended rank for sorting
        return recommendedModels.sort((a, b) => {
            const aRank = getRecommendedRank(a);
            const bRank = getRecommendedRank(b);
            if (aRank !== bRank) {
                return aRank - bRank;
            }
            return (a.label || '').localeCompare(b.label || '');
        });
    }

    function getDefaultVisibleModelIds(models) {
        const allIds = models.map(model => model.modelId);
        if (Array.isArray(visibleModelIds) && visibleModelIds.length > 0) {
            return visibleModelIds.filter(id => allIds.includes(id));
        }
        // Use recommended IDs for default selection for both local and authorized
        const recommendedIds = getRecommendedIds(models).filter(id => allIds.includes(id));
        if (recommendedIds.length > 0) {
            return recommendedIds;
        }
        return allIds;
    }

    function renderModelManagerList() {
        if (!modelManagerList) {
            return;
        }

        if (modelManagerModels.length === 0) {
            modelManagerList.innerHTML = `<div class="model-manager-empty">${i18n['models.empty'] || 'No models available.'}</div>`;
            updateModelManagerCount();
            return;
        }

        modelManagerList.innerHTML = modelManagerModels.map(model => {
            const displayName = currentConfig.modelCustomNames?.[model.modelId] || model.label || model.modelId;
            const checked = modelManagerSelection.has(model.modelId) ? 'checked' : '';
            return `
                <label class="model-manager-item">
                    <input type="checkbox" data-model-id="${model.modelId}" ${checked}>
                    <span>${displayName}</span>
                </label>
            `;
        }).join('');

        modelManagerList.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.addEventListener('change', () => {
                const modelId = input.getAttribute('data-model-id');
                if (!modelId) return;
                if (input.checked) {
                    modelManagerSelection.add(modelId);
                } else {
                    modelManagerSelection.delete(modelId);
                }
                updateModelManagerCount();
            });
        });

        updateModelManagerCount();
    }

    function updateModelManagerSelection(mode) {
        if (mode === 'all') {
            modelManagerSelection = new Set(modelManagerModels.map(model => model.modelId));
        } else if (mode === 'recommended') {
            modelManagerSelection = new Set(getRecommendedIds(modelManagerModels));
        } else {
            modelManagerSelection = new Set();
        }

        modelManagerList?.querySelectorAll('input[type="checkbox"]').forEach(input => {
            const modelId = input.getAttribute('data-model-id');
            input.checked = modelId ? modelManagerSelection.has(modelId) : false;
        });
        updateModelManagerCount();
    }

    function updateModelManagerCount() {
        if (!modelManagerCount) {
            return;
        }
        const total = modelManagerModels.length;
        const selected = modelManagerSelection.size;
        modelManagerCount.textContent = total > 0 ? `${selected}/${total}` : '';
    }

    function saveModelManagerSelection() {
        const allIds = modelManagerModels.map(model => model.modelId);
        const selectedIds = Array.from(modelManagerSelection);
        const normalized = selectedIds.length === 0 || selectedIds.length === allIds.length
            ? []
            : selectedIds;
        visibleModelIds = normalized;
        currentConfig.visibleModels = normalized;
        vscode.postMessage({ command: 'updateVisibleModels', visibleModels: normalized });
        showToast(i18n['models.saved'] || 'Model visibility updated.', 'success');
        closeModelManagerModal();
    }

    /**
     * 切换到指定标签页
     * @param {string} tabId 标签页 ID (如 'auto-trigger')
     */
    function switchToTab(tabId) {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        // 查找目标按钮
        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (!targetBtn) return;

        // 更新按钮状态
        tabButtons.forEach(b => b.classList.remove('active'));
        targetBtn.classList.add('active');

        // 更新内容显示
        tabContents.forEach(content => {
            if (content.id === `tab-${tabId}`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        if (tabId === 'history') {
            activateHistoryTab();
        }
    }

    // ============ 刷新按钮逻辑 ============

    function updateRefreshButton() {
        if (isRefreshing) {
            refreshBtn.innerHTML = `<span class="spinner"></span>${i18n['dashboard.refreshing'] || 'Refreshing...'}`;
        }
    }

    function startCooldown(seconds) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = seconds + 's';

        let remaining = seconds;
        const timer = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(timer);
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = i18n['dashboard.refresh'] || 'REFRESH';
            } else {
                refreshBtn.innerHTML = remaining + 's';
            }
        }, 1000);
    }

    // ============ Toast 通知 ============

    function showToast(message, type = 'info') {
        if (!toast) return;

        toast.textContent = message;
        toast.className = `toast ${type}`;

        // 3秒后隐藏
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    // ============ 工具函数 ============

    function getHealthColor(percentage) {
        // 使用配置的阈值
        const warningThreshold = currentConfig.warningThreshold || 30;
        const criticalThreshold = currentConfig.criticalThreshold || 10;

        if (percentage > warningThreshold) return 'var(--success)';  // 绿色
        if (percentage > criticalThreshold) return 'var(--warning)';  // 黄色
        return 'var(--danger)';                                       // 红色
    }

    function getStatusText(percentage) {
        // 使用配置的阈值
        const warningThreshold = currentConfig.warningThreshold || 30;
        const criticalThreshold = currentConfig.criticalThreshold || 10;

        if (percentage > warningThreshold) return i18n['dashboard.active'] || 'Healthy';   // 健康
        if (percentage > criticalThreshold) return i18n['dashboard.warning'] || 'Warning';  // 警告
        return i18n['dashboard.danger'] || 'Danger';                                        // 危险
    }

    /**
     * 解析模型能力，返回图标数组
     * @param {Object} model 模型对象
     * @returns {string[]} 能力图标 HTML 数组
     */


    function togglePin(modelId) {
        vscode.postMessage({ command: 'togglePin', modelId: modelId });
    }

    function retryConnection() {
        vscode.postMessage({ command: 'retry' });
    }

    function openLogs() {
        vscode.postMessage({ command: 'openLogs' });
    }

    window.retryConnection = retryConnection;
    window.openLogs = openLogs;
    window.showLocalAuthImportLoading = showLocalAuthImportLoading;
    window.openAccountManageModal = () => {
        if (authUi) {
            authUi.openAccountManageModal();
        } else {
            openAccountManageModal();
        }
    };

    // ============ 拖拽排序 ============

    function handleDragStart(e) {
        this.style.opacity = '0.4';
        dragSrcEl = this;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
        this.classList.add('dragging');
    }

    function handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    function handleDragEnter() {
        this.classList.add('over');
    }

    function handleDragLeave() {
        this.classList.remove('over');
    }

    function handleDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }

        if (dragSrcEl !== this) {
            // Get siblings of the same group (cards in dashboard or rows in tbody)
            const selector = dragSrcEl.classList.contains('card') ? '.card' : 'tr';
            const dashboardOrTbody = dragSrcEl.parentElement;
            const items = Array.from(dashboardOrTbody.querySelectorAll(selector));

            const srcIndex = items.indexOf(dragSrcEl);
            const targetIndex = items.indexOf(this);

            if (srcIndex < targetIndex) {
                this.after(dragSrcEl);
            } else {
                this.before(dragSrcEl);
            }

            // Get updated list of all items in this container
            const updatedItems = Array.from(dashboardOrTbody.querySelectorAll(selector));

            // 检查是否是分组
            const isGroup = dragSrcEl.classList.contains('group-card') || dragSrcEl.classList.contains('list-group-row');

            if (isGroup) {
                const groupOrder = updatedItems
                    .map(item => item.getAttribute('data-group-id'))
                    .filter(id => id !== null);

                vscode.postMessage({ command: 'updateGroupOrder', order: groupOrder });
            } else {
                const modelOrder = updatedItems
                    .map(item => item.getAttribute('data-id'))
                    .filter(id => id !== null);

                vscode.postMessage({ command: 'updateOrder', order: modelOrder });
            }
        }

        return false;
    }

    function handleDragEnd() {
        this.style.opacity = '1';
        this.classList.remove('dragging');

        document.querySelectorAll('.card, tr').forEach(item => {
            item.classList.remove('over');
        });
    }

    // ============ 渲染 ============

    function render(snapshot, config) {
        statusDiv.style.display = 'none';
        dashboard.innerHTML = '';

        // 检查离线状态
        if (!snapshot.isConnected) {
            const source = config?.quotaSource || currentQuotaSource;
            if (source === 'authorized') {
                renderAuthorizedOfflineCard(snapshot.errorMessage);
            } else {
                renderLocalOfflineCard(snapshot.errorMessage);
            }
            return;
        }

        // Render User Profile (if available) - New Section
        // Check isProfileHidden state before rendering
        if (snapshot.userInfo && !isProfileHidden) {
            renderUserProfile(snapshot.userInfo);
        }

        // 更新分组按钮状态
        updateToggleGroupingButton(config?.groupingEnabled);

        // 如果启用了分组显示，渲染分组卡片
        if (config?.groupingEnabled && snapshot.groups && snapshot.groups.length > 0) {
            // 渲染自动分组按钮区域
            renderAutoGroupBar();

            // 分组排序：支持自定义顺序
            let groups = [...snapshot.groups];
            if (config?.groupOrder?.length > 0) {
                const orderMap = new Map();
                config.groupOrder.forEach((id, index) => orderMap.set(id, index));

                groups.sort((a, b) => {
                    const idxA = orderMap.has(a.groupId) ? orderMap.get(a.groupId) : 99999;
                    const idxB = orderMap.has(b.groupId) ? orderMap.get(b.groupId) : 99999;
                    if (idxA !== idxB) return idxA - idxB;
                    // 如果没有自定义顺序，按配额百分比升序（低的在前）
                    return a.remainingPercentage - b.remainingPercentage;
                });
            }

            groups.forEach(group => {
                renderGroupCard(group, config?.pinnedGroups || []);
            });
            return;
        }

        // 模型排序
        let models = [...snapshot.models];
        if (config?.modelOrder?.length > 0) {
            const orderMap = new Map();
            config.modelOrder.forEach((id, index) => orderMap.set(id, index));

            models.sort((a, b) => {
                const idxA = orderMap.has(a.modelId) ? orderMap.get(a.modelId) : 99999;
                const idxB = orderMap.has(b.modelId) ? orderMap.get(b.modelId) : 99999;
                return idxA - idxB;
            });
        }

        // 渲染模型卡片
        models.forEach(model => {
            renderModelCard(model, config?.pinnedModels || [], config?.modelCustomNames || {});
        });
    }

    function renderLocalOfflineCard(errorMessage) {
        const message = errorMessage || i18n['dashboard.offlineDesc'] || 'Could not detect Antigravity process. Please ensure Antigravity is running.';
        const card = document.createElement('div');
        card.className = 'offline-card local-card';
        card.innerHTML = `
            <div class="icon">🛰️</div>
            <h2>${i18n['quotaSource.localOfflineTitle'] || 'Local monitoring unavailable'}</h2>
            <p>${message}</p>
            <div class="offline-actions">
                <button class="btn-secondary" data-action="retry-local">
                    ${i18n['quotaSource.retryLocal'] || (i18n['help.retry'] || 'Retry')}
                </button>
                <button class="btn-primary" data-action="switch-authorized">
                    ${i18n['quotaSource.switchToAuthorized'] || 'Switch to Authorized'}
                </button>
            </div>
        `;
        dashboard.appendChild(card);
        const retryBtn = card.querySelector('[data-action="retry-local"]');
        const switchBtn = card.querySelector('[data-action="switch-authorized"]');
        retryBtn?.addEventListener('click', retryConnection);
        switchBtn?.addEventListener('click', () => {
            requestQuotaSourceChange('authorized', { force: true });
        });
    }

    function renderAuthorizedOfflineCard(errorMessage) {
        const isAuthorized = Boolean(authorizationStatus?.isAuthorized);
        const title = isAuthorized
            ? (i18n['quotaSource.authorizedOfflineTitle'] || 'Authorized monitoring unavailable')
            : (i18n['quotaSource.authorizedMissingTitle'] || 'Authorization required');
        const description = isAuthorized
            ? (i18n['quotaSource.authorizedOfflineDesc'] || 'Failed to fetch quota from the remote API. Please check your network and try again.')
            : (i18n['quotaSource.authorizedMissingDesc'] || 'Complete authorization to use authorized monitoring.');
        const detail = errorMessage ? `<p class="offline-detail">${errorMessage}</p>` : '';
        const card = document.createElement('div');
        card.className = 'offline-card authorized-card';
        card.innerHTML = `
            <div class="icon">🔐</div>
            <h2>${title}</h2>
            <p>${description}</p>
            ${detail}
            <div class="offline-actions">
                <button class="btn-secondary" data-action="switch-local">
                    ${i18n['quotaSource.switchToLocal'] || 'Switch to Local'}
                </button>
                <button class="btn-primary" data-action="authorized-primary">
                    ${isAuthorized ? (i18n['dashboard.refresh'] || 'Refresh') : (i18n['autoTrigger.authorizeBtn'] || 'Authorize')}
                </button>
            </div>
        `;
        dashboard.appendChild(card);
        const switchBtn = card.querySelector('[data-action="switch-local"]');
        const primaryBtn = card.querySelector('[data-action="authorized-primary"]');
        switchBtn?.addEventListener('click', () => {
            requestQuotaSourceChange('local', { force: true });
        });
        if (isAuthorized) {
            primaryBtn?.addEventListener('click', handleRefresh);
        } else {
            primaryBtn?.addEventListener('click', () => {
                openAuthChoiceModal();
            });
        }
    }

    function openAuthChoiceModal() {
        let modal = document.getElementById('auth-choice-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'auth-choice-modal';
            modal.className = 'modal hidden';
            modal.innerHTML = `
                <div class="modal-content auth-choice-content">
                    <div class="modal-header">
                        <h3>${i18n['authChoice.title'] || '选择登录方式'}</h3>
                        <button class="close-btn" id="close-auth-choice-modal">×</button>
                    </div>
                    <div class="modal-body auth-choice-body">
                        <div class="auth-choice-info">
                            <div class="auth-choice-desc">${i18n['authChoice.desc'] || '请选择读取本地已授权账号或授权登录。'}</div>
                            <div class="auth-choice-tip">${i18n['authChoice.tip'] || '授权登录适用于无客户端；本地读取仅对当前机器生效。'}</div>
                        </div>
                        <div class="auth-choice-grid">
                            <div class="auth-choice-card">
                                <div class="auth-choice-header">
                                    <span class="auth-choice-icon">🖥️</span>
                                    <div>
                                        <div class="auth-choice-title">${i18n['authChoice.localTitle'] || '读取本地已授权账号'}</div>
                                        <div class="auth-choice-text">${i18n['authChoice.localDesc'] || '读取本机 Antigravity 客户端已授权账号，不重新授权，仅复用现有授权。'}</div>
                                    </div>
                                </div>
                                <button id="auth-choice-local-btn" class="at-btn at-btn-primary auth-choice-btn">
                                    ${i18n['authChoice.localBtn'] || '读取本地授权'}
                                </button>
                            </div>
                            <div class="auth-choice-card">
                                <div class="auth-choice-header">
                                    <span class="auth-choice-icon">🔐</span>
                                    <div>
                                        <div class="auth-choice-title">${i18n['authChoice.oauthTitle'] || '授权登录（云端授权）'}</div>
                                        <div class="auth-choice-text">${i18n['authChoice.oauthDesc'] || '通过 Google OAuth 新授权，适用于无客户端场景，可撤销。'}</div>
                                    </div>
                                </div>
                                <button id="auth-choice-oauth-btn" class="at-btn at-btn-primary auth-choice-btn">
                                    ${i18n['authChoice.oauthBtn'] || '去授权登录'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            document.getElementById('close-auth-choice-modal')?.addEventListener('click', closeAuthChoiceModal);
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAuthChoiceModal();
            });
        }

        const oauthBtn = modal.querySelector('#auth-choice-oauth-btn');
        const localBtn = modal.querySelector('#auth-choice-local-btn');
        const oauthBtnClone = oauthBtn.cloneNode(true);
        oauthBtn.parentNode.replaceChild(oauthBtnClone, oauthBtn);
        const localBtnClone = localBtn.cloneNode(true);
        localBtn.parentNode.replaceChild(localBtnClone, localBtn);

        modal.querySelector('#auth-choice-oauth-btn')?.addEventListener('click', () => {
            vscode.postMessage({ command: 'autoTrigger.authorize' });
            closeAuthChoiceModal();
        });
        modal.querySelector('#auth-choice-local-btn')?.addEventListener('click', () => {
            showLocalAuthImportLoading();
            vscode.postMessage({ command: 'autoTrigger.importLocal' });
            closeAuthChoiceModal();
        });

        modal.classList.remove('hidden');
    }

    function closeAuthChoiceModal() {
        const modal = document.getElementById('auth-choice-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    function renderAutoGroupBar() {
        const bar = document.createElement('div');
        bar.className = 'auto-group-toolbar';
        bar.innerHTML = `
            <span class="grouping-hint">
                ${i18n['grouping.description'] || 'This mode aggregates models sharing the same quota. Supports renaming, sorting, and status bar sync. Click "Manage Groups" to customize, or toggle "Quota Groups" above to switch back.'}
            </span>
            <button id="manage-group-btn" class="auto-group-link" title="${i18n['customGrouping.title'] || 'Manage Groups'}">
                <span class="icon">⚙️</span>
                ${i18n['customGrouping.title'] || 'Manage Groups'}
            </button>
        `;
        dashboard.appendChild(bar);

        // 绑定点击事件 - 打开自定义分组弹框
        const btn = bar.querySelector('#manage-group-btn');
        if (btn) {
            btn.addEventListener('click', openCustomGroupingModal);
        }
    }

    // ============ 自定义分组弹框 ============

    function openCustomGroupingModal() {
        if (!customGroupingModal || !lastSnapshot) return;

        // 初始化状态
        const models = lastSnapshot.models || [];
        customGroupingState.allModels = models;
        customGroupingState.groupMappings = { ...(currentConfig.groupMappings || {}) };

        // 从现有映射构建分组
        const groupMap = new Map(); // groupId -> { id, name, modelIds }
        const groupNames = currentConfig.groupCustomNames || {};

        for (const model of models) {
            const groupId = customGroupingState.groupMappings[model.modelId];
            if (groupId) {
                if (!groupMap.has(groupId)) {
                    // 尝试从 groupNames 获取名称，否则使用默认名称
                    let groupName = '';
                    for (const modelId of Object.keys(groupNames)) {
                        if (customGroupingState.groupMappings[modelId] === groupId) {
                            groupName = groupNames[modelId];
                            break;
                        }
                    }
                    groupMap.set(groupId, {
                        id: groupId,
                        name: groupName || `Group ${groupMap.size + 1}`,
                        modelIds: []
                    });
                }
                groupMap.get(groupId).modelIds.push(model.modelId);
            }
        }

        customGroupingState.groups = Array.from(groupMap.values());

        // 渲染弹框内容
        renderCustomGroupingContent();

        customGroupingModal.classList.remove('hidden');
    }

    function closeCustomGroupingModal() {
        if (customGroupingModal) {
            customGroupingModal.classList.add('hidden');
        }
    }

    function renderCustomGroupingContent() {
        const groupsList = document.getElementById('custom-groups-list');
        const ungroupedList = document.getElementById('ungrouped-models-list');

        if (!groupsList || !ungroupedList) return;

        // 获取已分组的模型 ID
        const groupedModelIds = new Set();
        customGroupingState.groups.forEach(g => g.modelIds.forEach(id => groupedModelIds.add(id)));

        // 渲染分组列表
        if (customGroupingState.groups.length === 0) {
            groupsList.innerHTML = `<div class="empty-groups-hint">${i18n['customGrouping.noModels'] || 'No groups yet. Click "Add Group" to create one.'}</div>`;
        } else {
            groupsList.innerHTML = customGroupingState.groups.map((group, index) => {
                const modelsHtml = group.modelIds.map(modelId => {
                    const model = customGroupingState.allModels.find(m => m.modelId === modelId);
                    const name = model ? (currentConfig.modelCustomNames?.[modelId] || model.label) : modelId;
                    return `
                        <span class="custom-model-tag" data-model-id="${modelId}">
                            ${name}
                            <button class="remove-model-btn" data-group-index="${index}" data-model-id="${modelId}" title="${i18n['customGrouping.removeModel'] || 'Remove'}">×</button>
                        </span>
                    `;
                }).join('');

                return `
                    <div class="custom-group-item" data-group-index="${index}">
                        <div class="custom-group-header">
                            <div class="custom-group-name">
                                <span>📦</span>
                                <input type="text" value="${group.name}" data-group-index="${index}" placeholder="Group name...">
                            </div>
                            <div class="custom-group-actions">
                                <button class="delete-group-btn" data-group-index="${index}" title="${i18n['customGrouping.deleteGroup'] || 'Delete Group'}">🗑️</button>
                            </div>
                        </div>
                        <div class="custom-group-models">
                            ${modelsHtml}
                            <button class="add-model-btn" data-group-index="${index}">
                                ➕ ${i18n['customGrouping.addModel'] || 'Add Model'}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            // 绑定事件
            groupsList.querySelectorAll('.remove-model-btn').forEach(btn => {
                btn.addEventListener('click', handleRemoveModel);
            });
            groupsList.querySelectorAll('.delete-group-btn').forEach(btn => {
                btn.addEventListener('click', handleDeleteGroup);
            });
            groupsList.querySelectorAll('.add-model-btn').forEach(btn => {
                btn.addEventListener('click', handleAddModelToGroup);
            });
            groupsList.querySelectorAll('.custom-group-name input').forEach(input => {
                input.addEventListener('change', handleGroupNameChange);
            });
        }

        // 渲染未分组模型
        const ungroupedModels = customGroupingState.allModels.filter(m => !groupedModelIds.has(m.modelId));

        if (ungroupedModels.length === 0) {
            ungroupedList.innerHTML = `<div style="color: var(--text-secondary); font-size: 12px;">${i18n['customGrouping.noModels'] || 'All models are grouped'}</div>`;
        } else {
            ungroupedList.innerHTML = ungroupedModels.map(model => {
                const name = currentConfig.modelCustomNames?.[model.modelId] || model.label;
                const quotaPct = (model.remainingPercentage || 0).toFixed(0);
                return `
                    <div class="ungrouped-model-item" data-model-id="${model.modelId}" title="${model.modelId}">
                        ${name}
                        <span class="quota-badge">${quotaPct}%</span>
                    </div>
                `;
            }).join('');
        }
    }

    function handleAddGroup() {
        const newGroupId = 'custom_group_' + Date.now();
        customGroupingState.groups.push({
            id: newGroupId,
            name: `Group ${customGroupingState.groups.length + 1}`,
            modelIds: []
        });
        renderCustomGroupingContent();
    }

    function handleDeleteGroup(e) {
        const index = parseInt(e.target.dataset.groupIndex, 10);
        if (!isNaN(index) && index >= 0 && index < customGroupingState.groups.length) {
            customGroupingState.groups.splice(index, 1);
            renderCustomGroupingContent();
        }
    }

    function handleRemoveModel(e) {
        e.stopPropagation();
        const groupIndex = parseInt(e.target.dataset.groupIndex, 10);
        const modelId = e.target.dataset.modelId;

        if (!isNaN(groupIndex) && modelId) {
            const group = customGroupingState.groups[groupIndex];
            if (group) {
                group.modelIds = group.modelIds.filter(id => id !== modelId);
                renderCustomGroupingContent();
            }
        }
    }

    function handleGroupNameChange(e) {
        const index = parseInt(e.target.dataset.groupIndex, 10);
        if (!isNaN(index) && customGroupingState.groups[index]) {
            customGroupingState.groups[index].name = e.target.value.trim() || `Group ${index + 1}`;
        }
    }

    function handleAddModelToGroup(e) {
        const groupIndex = parseInt(e.target.dataset.groupIndex, 10);
        if (isNaN(groupIndex)) return;

        const group = customGroupingState.groups[groupIndex];
        if (!group) return;

        // 获取已分组的模型
        const groupedModelIds = new Set();
        customGroupingState.groups.forEach(g => g.modelIds.forEach(id => groupedModelIds.add(id)));

        // 获取可用模型（未分组的）
        const availableModels = customGroupingState.allModels.filter(m => !groupedModelIds.has(m.modelId));

        if (availableModels.length === 0) {
            showToast(i18n['customGrouping.noModels'] || 'No available models', 'info');
            return;
        }

        // 获取组的配额签名（如果组已有模型）
        let groupSignature = null;
        if (group.modelIds.length > 0) {
            const firstModelId = group.modelIds[0];
            const firstModel = customGroupingState.allModels.find(m => m.modelId === firstModelId);
            if (firstModel) {
                groupSignature = {
                    remainingPercentage: firstModel.remainingPercentage,
                    resetTimeDisplay: firstModel.resetTimeDisplay
                };
            }
        }

        // 创建下拉选择菜单
        showModelSelectDropdown(e.target, availableModels, groupSignature, (selectedModelId) => {
            group.modelIds.push(selectedModelId);
            renderCustomGroupingContent();
        });
    }

    function showModelSelectDropdown(anchor, models, groupSignature, onSelect) {
        // 移除已存在的下拉框
        const existingDropdown = document.querySelector('.model-select-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        const dropdown = document.createElement('div');
        dropdown.className = 'model-select-dropdown';

        // 计算位置
        const rect = anchor.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 4) + 'px';

        // 计算每个模型的兼容性
        const modelsWithCompatibility = models.map(model => {
            let isCompatible = true;
            let incompatibleReason = '';

            if (groupSignature) {
                if (model.remainingPercentage !== groupSignature.remainingPercentage) {
                    isCompatible = false;
                    incompatibleReason = i18n['customGrouping.quotaMismatch'] || 'Quota mismatch';
                } else if (model.resetTimeDisplay !== groupSignature.resetTimeDisplay) {
                    isCompatible = false;
                    incompatibleReason = i18n['customGrouping.resetMismatch'] || 'Reset time mismatch';
                }
            }

            return { model, isCompatible, incompatibleReason };
        });

        // 排序：兼容的排在前面
        modelsWithCompatibility.sort((a, b) => {
            if (a.isCompatible && !b.isCompatible) return -1;
            if (!a.isCompatible && b.isCompatible) return 1;
            return 0;
        });

        // 检查是否有兼容的模型
        const hasCompatibleModels = modelsWithCompatibility.some(m => m.isCompatible);

        dropdown.innerHTML = `
            <div class="model-select-list">
                ${modelsWithCompatibility.map(({ model, isCompatible, incompatibleReason }) => {
            const name = currentConfig.modelCustomNames?.[model.modelId] || model.label;
            const quotaPct = (model.remainingPercentage || 0).toFixed(1);

            return `
                        <label class="model-select-item ${isCompatible ? '' : 'disabled'}" 
                             data-model-id="${model.modelId}" 
                             data-compatible="${isCompatible}">
                            <input type="checkbox" class="model-checkbox" 
                                   value="${model.modelId}" 
                                   ${isCompatible ? '' : 'disabled'}>
                            <span class="model-name">${name}</span>
                            <span class="model-quota">${quotaPct}%</span>
                            ${!isCompatible ? `<span class="incompatible-reason">${incompatibleReason}</span>` : ''}
                        </label>
                    `;
        }).join('')}
            </div>
            ${hasCompatibleModels ? `
                <div class="model-select-footer">
                    <button class="btn-confirm-add" disabled>
                        ${i18n['customGrouping.addModel'] || 'Add'} (<span class="selected-count">0</span>)
                    </button>
                </div>
            ` : ''}
        `;

        document.body.appendChild(dropdown);

        // 选中计数和确认按钮逻辑
        const confirmBtn = dropdown.querySelector('.btn-confirm-add');
        const countSpan = dropdown.querySelector('.selected-count');
        const allCheckboxes = dropdown.querySelectorAll('.model-checkbox');

        const updateSelectionState = () => {
            const checkedBoxes = dropdown.querySelectorAll('.model-checkbox:checked');
            const selectedCount = checkedBoxes.length;

            // 更新计数和按钮状态
            if (countSpan) countSpan.textContent = selectedCount;
            if (confirmBtn) confirmBtn.disabled = selectedCount === 0;

            // 获取当前选中模型的签名（用于动态兼容性检查）
            let currentSignature = groupSignature; // 使用分组已有的签名

            if (!currentSignature && selectedCount > 0) {
                // 如果分组为空，使用第一个选中模型的签名
                const firstCheckedId = checkedBoxes[0].value;
                const firstModel = modelsWithCompatibility.find(m => m.model.modelId === firstCheckedId);
                if (firstModel) {
                    currentSignature = {
                        remainingPercentage: firstModel.model.remainingPercentage,
                        resetTimeDisplay: firstModel.model.resetTimeDisplay
                    };
                }
            }

            // 更新所有 checkbox 的禁用状态
            allCheckboxes.forEach(cb => {
                if (cb.checked) return; // 已勾选的不处理

                const modelId = cb.value;
                const modelData = modelsWithCompatibility.find(m => m.model.modelId === modelId);
                if (!modelData) return;

                const item = cb.closest('.model-select-item');
                if (!item) return;

                // 检查兼容性
                let isCompatible = true;
                let reason = '';

                if (currentSignature) {
                    if (modelData.model.remainingPercentage !== currentSignature.remainingPercentage) {
                        isCompatible = false;
                        reason = i18n['customGrouping.quotaMismatch'] || 'Quota mismatch';
                    } else if (modelData.model.resetTimeDisplay !== currentSignature.resetTimeDisplay) {
                        isCompatible = false;
                        reason = i18n['customGrouping.resetMismatch'] || 'Reset time mismatch';
                    }
                }

                cb.disabled = !isCompatible;
                item.classList.toggle('disabled', !isCompatible);

                // 更新或移除不兼容原因显示
                let reasonSpan = item.querySelector('.incompatible-reason');
                if (!isCompatible) {
                    if (!reasonSpan) {
                        reasonSpan = document.createElement('span');
                        reasonSpan.className = 'incompatible-reason';
                        item.appendChild(reasonSpan);
                    }
                    reasonSpan.textContent = reason;
                } else {
                    if (reasonSpan) reasonSpan.remove();
                }
            });
        };

        allCheckboxes.forEach(cb => {
            if (!cb.disabled) {
                cb.addEventListener('change', updateSelectionState);
            }
        });

        // 确认按钮点击
        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const selectedIds = Array.from(dropdown.querySelectorAll('.model-checkbox:checked'))
                    .map(cb => cb.value);
                if (selectedIds.length > 0) {
                    // 批量添加
                    selectedIds.forEach(modelId => onSelect(modelId));
                    dropdown.remove();
                }
            });
        }

        // 点击外部关闭
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target) && e.target !== anchor) {
                dropdown.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 10);
    }

    function handleSmartGroup() {
        // 使用固定分组配置（与桌面端一致）
        const models = customGroupingState.allModels;
        if (!models || models.length === 0) {
            showToast(i18n['customGrouping.noModels'] || 'No models available', 'info');
            return;
        }

        // 固定分组配置（使用精确模型 ID）
        const defaultGroups = [
            {
                id: 'claude_45',
                name: 'Claude 4.5',
                modelIds: [
                    'MODEL_PLACEHOLDER_M12',           // Claude Opus 4.5 (Thinking)
                    'MODEL_CLAUDE_4_5_SONNET',         // Claude Sonnet 4.5
                    'MODEL_CLAUDE_4_5_SONNET_THINKING', // Claude Sonnet 4.5 (Thinking)
                    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', // GPT-OSS 120B (Medium)
                ]
            },
            {
                id: 'g3_pro',
                name: 'G3-Pro',
                modelIds: [
                    'MODEL_PLACEHOLDER_M7',  // Gemini 3 Pro (High)
                    'MODEL_PLACEHOLDER_M8',  // Gemini 3 Pro (Low)
                ]
            },
            {
                id: 'g3_flash',
                name: 'G3-Flash',
                modelIds: [
                    'MODEL_PLACEHOLDER_M18', // Gemini 3 Flash
                ]
            },
            {
                id: 'g3_image',
                name: 'G3-Image',
                modelIds: [
                    'MODEL_PLACEHOLDER_M9',  // Gemini 3 Pro Image
                ]
            }
        ];

        // 保存现有分组名称映射（modelId -> groupName）
        const existingGroupNames = {};
        for (const group of customGroupingState.groups) {
            for (const modelId of group.modelIds) {
                existingGroupNames[modelId] = group.name;
            }
        }

        // 按固定分组分配模型
        const groupMap = new Map(); // groupId -> { id, name, modelIds }
        const matchedModels = new Set();

        for (const defaultGroup of defaultGroups) {
            const groupModels = [];
            
            for (const model of models) {
                // 精确匹配模型 ID
                if (defaultGroup.modelIds.includes(model.modelId)) {
                    groupModels.push(model.modelId);
                    matchedModels.add(model.modelId);
                }
            }

            if (groupModels.length > 0) {
                // 尝试继承现有分组名称
                let inheritedName = '';
                for (const modelId of groupModels) {
                    if (existingGroupNames[modelId]) {
                        inheritedName = existingGroupNames[modelId];
                        break;
                    }
                }
                
                groupMap.set(defaultGroup.id, {
                    id: defaultGroup.id,
                    name: inheritedName || defaultGroup.name,
                    modelIds: groupModels
                });
            }
        }

        // 未匹配的模型放入 "Other" 分组
        const ungroupedModels = models.filter(m => !matchedModels.has(m.modelId));
        if (ungroupedModels.length > 0) {
            groupMap.set('other', {
                id: 'other',
                name: i18n['customGrouping.other'] || '其他',
                modelIds: ungroupedModels.map(m => m.modelId)
            });
        }

        // 转换为数组
        customGroupingState.groups = Array.from(groupMap.values());

        renderCustomGroupingContent();
        const smartGroupMsg = (i18n['customGrouping.smartGroupCount'] || 'Auto Group: {count} groups').replace('{count}', customGroupingState.groups.length);
        showToast(smartGroupMsg, 'success');
    }

    function saveCustomGrouping() {
        // 检查是否有空分组
        const emptyGroups = customGroupingState.groups.filter(g => g.modelIds.length === 0);
        if (emptyGroups.length > 0) {
            // 移除空分组
            customGroupingState.groups = customGroupingState.groups.filter(g => g.modelIds.length > 0);
        }

        // 构建新的 groupMappings
        const newMappings = {};
        const newGroupNames = {};

        for (const group of customGroupingState.groups) {
            // 生成稳定的 groupId
            const stableGroupId = group.modelIds.sort().join('_');
            for (const modelId of group.modelIds) {
                newMappings[modelId] = stableGroupId;
                // 使用锚点共识机制保存分组名称
                newGroupNames[modelId] = group.name;
            }
        }

        // 发送到扩展保存
        vscode.postMessage({
            command: 'saveCustomGrouping',
            customGroupMappings: newMappings,
            customGroupNames: newGroupNames
        });

        showToast(i18n['customGrouping.saved'] || 'Groups saved', 'success');
        closeCustomGroupingModal();
    }

    // State for profile toggle
    let isProfileExpanded = false;

    function renderUserProfile(userInfo) {
        // 如果用户选择隐藏计划详情，直接返回不渲染
        if (isProfileHidden) {
            return;
        }

        const card = document.createElement('div');
        card.className = 'card full-width profile-card';

        // Helper for features (with masking support)
        const getFeatureStatus = (enabled) => {
            if (isDataMasked) return `<span class="tag masked">***</span>`;
            return enabled
                ? `<span class="tag success">${i18n['feature.enabled'] || 'Enabled'}</span>`
                : `<span class="tag disabled">${i18n['feature.disabled'] || 'Disabled'}</span>`;
        };

        // Helper for masking values
        const maskValue = (value) => isDataMasked ? '***' : value;

        // Build Upgrade Info HTML if available
        let upgradeHtml = '';
        if (userInfo.upgradeText && userInfo.upgradeUri && !isDataMasked) {
            upgradeHtml = `
            <div class="upgrade-info">
                <div class="upgrade-text">${userInfo.upgradeText}</div>
                <a href="${userInfo.upgradeUri}" class="upgrade-link" target="_blank">Upgrade Now</a>
            </div>`;
        }

        // Toggle visibility style based on state
        const detailsClass = isProfileExpanded ? 'profile-details' : 'profile-details hidden';
        const toggleText = isProfileExpanded ? (i18n['profile.less'] || 'Show Less') : (i18n['profile.more'] || 'Show More Details');
        const iconTransform = isProfileExpanded ? 'rotate(180deg)' : 'rotate(0deg)';

        // Mask button text
        const maskBtnText = isDataMasked ? (i18n['profile.showData'] || 'Show') : (i18n['profile.hideData'] || 'Hide');


        card.innerHTML = `
            <div class="card-title">
                <span class="label">${i18n['profile.details'] || 'Plan Details'}</span>
                <div class="profile-controls">
                    <button class="text-btn" id="profile-mask-btn">${maskBtnText}</button>
                    <div class="tier-badge">${userInfo.tier}</div>
                </div>
            </div>
            
            <div class="profile-grid">
                ${createDetailItem(i18n['profile.email'] || 'Email', maskValue(userInfo.email))}
                ${createDetailItem(i18n['profile.description'] || 'Description', maskValue(userInfo.tierDescription))}
                ${createDetailItem(i18n['feature.webSearch'] || 'Web Search', getFeatureStatus(userInfo.cascadeWebSearchEnabled))}
                ${createDetailItem(i18n['feature.browser'] || 'Browser Access', getFeatureStatus(userInfo.browserEnabled))}
                ${createDetailItem(i18n['feature.knowledgeBase'] || 'Knowledge Base', getFeatureStatus(userInfo.knowledgeBaseEnabled))}
                ${createDetailItem(i18n['feature.mcp'] || 'MCP Servers', getFeatureStatus(userInfo.allowMcpServers))}
                ${createDetailItem(i18n['feature.gitCommit'] || 'Git Commit', getFeatureStatus(userInfo.canGenerateCommitMessages))}
                ${createDetailItem(i18n['feature.context'] || 'Context Window', maskValue(userInfo.maxNumChatInputTokens))}
            </div>

            <div class="${detailsClass}" id="profile-more">
                <div class="profile-grid">
                    ${createDetailItem(i18n['feature.fastMode'] || 'Fast Mode', getFeatureStatus(userInfo.hasAutocompleteFastMode))}
                    ${createDetailItem(i18n['feature.moreCredits'] || 'Can Buy Credits', getFeatureStatus(userInfo.canBuyMoreCredits))}
                    
                    ${createDetailItem(i18n['profile.teamsTier'] || 'Teams Tier', maskValue(userInfo.teamsTier))}
                    ${createDetailItem(i18n['profile.userId'] || 'Tier ID', maskValue(userInfo.userTierId || 'N/A'))}
                    ${createDetailItem(i18n['profile.tabToJump'] || 'Tab To Jump', getFeatureStatus(userInfo.hasTabToJump))}
                    ${createDetailItem(i18n['profile.stickyModels'] || 'Sticky Models', getFeatureStatus(userInfo.allowStickyPremiumModels))}
                    ${createDetailItem(i18n['profile.commandModels'] || 'Command Models', getFeatureStatus(userInfo.allowPremiumCommandModels))}
                    ${createDetailItem(i18n['profile.maxPremiumMsgs'] || 'Max Premium Msgs', maskValue(userInfo.maxNumPremiumChatMessages))}
                    ${createDetailItem(i18n['profile.chatInstructionsCharLimit'] || 'Chat Instructions Char Limit', maskValue(userInfo.maxCustomChatInstructionCharacters))}
                    ${createDetailItem(i18n['profile.pinnedContextItems'] || 'Pinned Context Items', maskValue(userInfo.maxNumPinnedContextItems))}
                    ${createDetailItem(i18n['profile.localIndexSize'] || 'Local Index Size', maskValue(userInfo.maxLocalIndexSize))}
                    ${createDetailItem(i18n['profile.acceptedTos'] || 'Accepted TOS', getFeatureStatus(userInfo.acceptedLatestTermsOfService))}
                    ${createDetailItem(i18n['profile.customizeIcon'] || 'Customize Icon', getFeatureStatus(userInfo.canCustomizeAppIcon))}
                    ${createDetailItem(i18n['profile.cascadeAutoRun'] || 'Cascade Auto Run', getFeatureStatus(userInfo.cascadeCanAutoRunCommands))}
                    ${createDetailItem(i18n['profile.cascadeBackground'] || 'Cascade Background', getFeatureStatus(userInfo.canAllowCascadeInBackground))}
                    ${createDetailItem(i18n['profile.autoRunCommands'] || 'Auto Run Commands', getFeatureStatus(userInfo.allowAutoRunCommands))}
                    ${createDetailItem(i18n['profile.expBrowserFeatures'] || 'Exp. Browser Features', getFeatureStatus(userInfo.allowBrowserExperimentalFeatures))}
                </div>
                ${upgradeHtml}
            </div>

            <div class="profile-toggle">
                <button class="btn-text" id="profile-toggle-btn">
                    <span id="profile-toggle-text">${toggleText}</span> 
                    <span id="profile-toggle-icon" style="transform: ${iconTransform}">▼</span>
                </button>
            </div>
        `;
        dashboard.appendChild(card);

        // Bind event listeners after element creation
        const toggleBtn = card.querySelector('#profile-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleProfileDetails);
        }

        const maskBtn = card.querySelector('#profile-mask-btn');
        if (maskBtn) {
            maskBtn.addEventListener('click', () => {
                isDataMasked = !isDataMasked;
                // 发送消息到扩展，持久化存储到配置
                vscode.postMessage({ command: 'updateDataMasked', dataMasked: isDataMasked });
            });
        }
    }

    // Toggle detailed profile info
    function toggleProfileDetails() {
        const details = document.getElementById('profile-more');
        const text = document.getElementById('profile-toggle-text');
        const icon = document.getElementById('profile-toggle-icon');

        if (details.classList.contains('hidden')) {
            details.classList.remove('hidden');
            text.textContent = i18n['profile.less'] || 'Show Less';
            icon.style.transform = 'rotate(180deg)';
            isProfileExpanded = true;
        } else {
            details.classList.add('hidden');
            text.textContent = i18n['profile.more'] || 'Show More Details';
            icon.style.transform = 'rotate(0deg)';
            isProfileExpanded = false;
        }
    };

    function createDetailItem(label, value) {
        return `
            <div class="detail-item">
                <span class="detail-label">${label}</span>
                <span class="detail-value">${value}</span>
            </div>
        `;
    }

    // ============ 富文本工具提示 ============

    function initRichTooltip() {
        const tooltip = document.createElement('div');
        tooltip.className = 'rich-tooltip hidden';
        document.body.appendChild(tooltip);

        let activeTarget = null;

        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tooltip-html]');
            if (target && target !== activeTarget) {
                activeTarget = target;
                const html = target.getAttribute('data-tooltip-html');

                // 解码 HTML
                const decodedHtml = decodeURIComponent(html);

                tooltip.innerHTML = decodedHtml;
                tooltip.classList.remove('hidden');

                const rect = target.getBoundingClientRect();
                const tooltipRect = tooltip.getBoundingClientRect();

                // 计算位置：默认在下方，如果下方空间不足则在上方
                let top = rect.bottom + 8;
                let left = rect.left + (rect.width - tooltipRect.width) / 2;

                // 边界检查
                if (top + tooltipRect.height > window.innerHeight) {
                    top = rect.top - tooltipRect.height - 8;
                }
                if (left < 10) left = 10;
                if (left + tooltipRect.width > window.innerWidth - 10) {
                    left = window.innerWidth - tooltipRect.width - 10;
                }

                tooltip.style.top = top + 'px';
                tooltip.style.left = left + 'px';
            }
        });

        document.addEventListener('mouseout', (e) => {
            const target = e.target.closest('[data-tooltip-html]');
            if (target && target === activeTarget) {
                activeTarget = null;
                tooltip.classList.add('hidden');
            }
        });

        // 滚动时隐藏
        window.addEventListener('scroll', () => {
            if (activeTarget) {
                activeTarget = null;
                tooltip.classList.add('hidden');
            }
        }, true);
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * 解析模型能力，返回能力列表
     */
    function getModelCapabilityList(model) {
        const caps = [];
        const mime = model.supportedMimeTypes || {};

        // 1. 图片能力
        if (model.supportsImages || Object.keys(mime).some(k => k.startsWith('image/'))) {
            caps.push({
                icon: '🖼️',
                text: i18n['capability.vision'] || 'Vision'
            });
        }

        // 2. 文档能力
        if (mime['application/pdf'] || mime['text/plain'] || mime['application/rtf']) {
            caps.push({
                icon: '📄',
                text: i18n['capability.docs'] || 'Documents'
            });
        }

        // 3. 音视频能力
        if (Object.keys(mime).some(k => k.startsWith('video/') || k.startsWith('audio/'))) {
            caps.push({
                icon: '🎬',
                text: i18n['capability.media'] || 'Media'
            });
        }

        return caps;
    }

    /**
     * 生成能力 Tooltip HTML
     */
    function generateCapabilityTooltip(caps) {
        return caps.map(cap =>
            `<div class="rich-tooltip-item ${cap.className || ''}"><span class="icon">${cap.icon}</span><span class="text">${cap.text}</span></div>`
        ).join('');
    }

    function renderGroupCard(group, pinnedGroups) {
        const pct = group.remainingPercentage || 0;
        const color = getHealthColor(pct);
        const isPinned = pinnedGroups && pinnedGroups.includes(group.groupId);

        const card = document.createElement('div');
        card.className = 'card group-card draggable';
        card.setAttribute('data-id', group.groupId);
        card.setAttribute('data-group-id', group.groupId);
        card.setAttribute('draggable', 'true');

        // 绑定拖拽事件
        card.addEventListener('dragstart', handleDragStart, false);
        card.addEventListener('dragenter', handleDragEnter, false);
        card.addEventListener('dragover', handleDragOver, false);
        card.addEventListener('dragleave', handleDragLeave, false);
        card.addEventListener('drop', handleDrop, false);
        card.addEventListener('dragend', handleDragEnd, false);

        // 生成组内模型列表（带能力图标）
        const modelList = group.models.map(m => {
            const caps = getModelCapabilityList(m);
            const tagHtml = m.tagTitle ? `<span class="tag-new">${m.tagTitle}</span>` : '';
            const recClass = m.isRecommended ? ' recommended' : '';

            // 如果有能力，添加悬浮属性
            let tooltipAttr = '';
            let capsIndicator = '';
            if (caps.length > 0) {
                const tooltipHtml = encodeURIComponent(generateCapabilityTooltip(caps));
                tooltipAttr = ` data-tooltip-html="${tooltipHtml}"`;
                capsIndicator = `<span class="caps-dot">✨</span>`;
            }

            return `<span class="group-model-tag${recClass}" title="${m.modelId}"${tooltipAttr}>${m.label}${tagHtml}${capsIndicator}</span>`;
        }).join('');

        card.innerHTML = `
            <div class="card-title">
                <span class="drag-handle" data-tooltip="${i18n['dashboard.dragHint'] || 'Drag to reorder'}">⋮⋮</span>
                <span class="group-icon">📦</span>
                <span class="label group-name">${group.groupName}</span>
                <div class="actions">
                    <button class="rename-group-btn icon-btn" data-group-id="${group.groupId}" data-tooltip-html="${encodeURIComponent('<div class="rich-tooltip-item"><span class="text">' + (i18n['grouping.rename'] || 'Rename') + '</span></div>')}">✏️</button>
                    <label class="switch" data-tooltip-html="${encodeURIComponent('<div class="rich-tooltip-item"><span class="text">' + (i18n['dashboard.pinHint'] || 'Pin to Status Bar') + '</span></div>')}">
                        <input type="checkbox" class="group-pin-toggle" data-group-id="${group.groupId}" ${isPinned ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span class="status-dot" style="background-color: ${color}"></span>
                </div>
            </div>
            <div class="progress-circle" style="background: conic-gradient(${color} ${pct}%, var(--border-color) ${pct}%);">
                <div class="percentage">${pct.toFixed(2)}%</div>
            </div>
            <div class="info-row">
                <span>${i18n['dashboard.resetIn'] || 'Reset In'}</span>
                <span class="info-value">${group.timeUntilResetFormatted}</span>
            </div>
            <div class="info-row">
                <span>${i18n['dashboard.resetTime'] || 'Reset Time'}</span>
                <span class="info-value small">${group.resetTimeDisplay || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span>${i18n['dashboard.status'] || 'Status'}</span>
                <span class="info-value" style="color: ${color}">
                    ${getStatusText(pct)}
                </span>
            </div>
            <div class="group-models">
                <div class="group-models-label">${i18n['grouping.models'] || 'Models'} (${group.models.length}):</div>
                <div class="group-models-list">${modelList}</div>
            </div>
        `;

        // 绑定重命名按钮事件 - 打开模态框
        const renameBtn = card.querySelector('.rename-group-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openRenameModal(
                    group.groupId,
                    group.groupName,
                    group.models.map(m => m.modelId)
                );
            });
        }

        // 绑定 pin 开关事件
        const pinToggle = card.querySelector('.group-pin-toggle');
        if (pinToggle) {
            pinToggle.addEventListener('change', (_e) => {
                vscode.postMessage({
                    command: 'toggleGroupPin',
                    groupId: group.groupId
                });
            });
        }

        dashboard.appendChild(card);
    }

    function renderModelCard(model, pinnedModels, modelCustomNames) {
        const pct = model.remainingPercentage || 0;
        const color = getHealthColor(pct);
        const isPinned = pinnedModels.includes(model.modelId);

        // 获取自定义名称，如果没有则使用原始 label
        const displayName = (modelCustomNames && modelCustomNames[model.modelId]) || model.label;
        const originalLabel = model.label;

        // 生成能力数据
        const caps = getModelCapabilityList(model);
        let capsIconHtml = '';
        let tooltipAttr = '';

        // 如果有能力，生成标题栏图标，并设置 tooltip
        if (caps.length > 0) {
            const tooltipHtml = encodeURIComponent(generateCapabilityTooltip(caps));
            tooltipAttr = ` data-tooltip-html="${tooltipHtml}"`;
            capsIconHtml = `<span class="title-caps-trigger">✨</span>`;
        }

        // 生成 New 标签
        const tagHtml = model.tagTitle ? `<span class="tag-new">${model.tagTitle}</span>` : '';

        // 推荐模型高亮样式
        const recommendedClass = model.isRecommended ? ' card-recommended' : '';

        const card = document.createElement('div');
        card.className = `card draggable${recommendedClass}`;
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-id', model.modelId);

        // 绑定拖拽事件
        card.addEventListener('dragstart', handleDragStart, false);
        card.addEventListener('dragenter', handleDragEnter, false);
        card.addEventListener('dragover', handleDragOver, false);
        card.addEventListener('dragleave', handleDragLeave, false);
        card.addEventListener('drop', handleDrop, false);
        card.addEventListener('dragend', handleDragEnd, false);

        card.innerHTML = `
            <div class="card-title">
                <span class="drag-handle" data-tooltip="${i18n['dashboard.dragHint'] || 'Drag to reorder'}">⋮⋮</span>
                <div class="title-wrapper"${tooltipAttr}>
                    <span class="label model-name" title="${model.modelId} (${originalLabel})">${displayName}</span>
                    ${tagHtml}
                    ${capsIconHtml}
                </div>
                <div class="actions">
                    <button class="rename-model-btn icon-btn" data-model-id="${model.modelId}" data-tooltip-html="${encodeURIComponent('<div class="rich-tooltip-item"><span class="text">' + (i18n['model.rename'] || 'Rename') + '</span></div>')}">✏️</button>
                    <label class="switch" data-tooltip-html="${encodeURIComponent('<div class="rich-tooltip-item"><span class="text">' + (i18n['dashboard.pinHint'] || 'Pin to Status Bar') + '</span></div>')}">
                        <input type="checkbox" class="pin-toggle" data-model-id="${model.modelId}" ${isPinned ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                    <span class="status-dot" style="background-color: ${color}"></span>
                </div>
            </div>
            <div class="progress-circle" style="background: conic-gradient(${color} ${pct}%, var(--border-color) ${pct}%);">
                <div class="percentage">${pct.toFixed(2)}%</div>
            </div>
            <div class="info-row">
                <span>${i18n['dashboard.resetIn'] || 'Reset In'}</span>
                <span class="info-value">${model.timeUntilResetFormatted}</span>
            </div>
            <div class="info-row">
                <span>${i18n['dashboard.resetTime'] || 'Reset Time'}</span>
                <span class="info-value small">${model.resetTimeDisplay || 'N/A'}</span>
            </div>
            <div class="info-row">
                <span>${i18n['dashboard.status'] || 'Status'}</span>
                <span class="info-value" style="color: ${color}">
                    ${getStatusText(pct)}
                </span>
            </div>
        `;

        // 绑定重命名按钮事件
        const renameBtn = card.querySelector('.rename-model-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModelRenameModal(model.modelId, displayName, originalLabel);
            });
        }

        dashboard.appendChild(card);
    }

    // ============ 公告系统 ============

    // 公告状态
    let announcementState = {
        announcements: [],
        unreadIds: [],
        popupAnnouncement: null,
    };
    let currentPopupAnnouncement = null;
    let shownPopupIds = new Set();  // 记录已弹过的公告 ID，避免重复弹框

    function updateAnnouncementBadge() {
        const badge = document.getElementById('announcement-badge');
        if (badge) {
            const count = announcementState.unreadIds.length;
            if (count > 0) {
                badge.textContent = count > 9 ? '9+' : count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }

    function openAnnouncementList() {
        vscode.postMessage({ command: 'announcement.getState' });
        const modal = document.getElementById('announcement-list-modal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeAnnouncementList() {
        const modal = document.getElementById('announcement-list-modal');
        if (modal) modal.classList.add('hidden');
    }

    function renderAnnouncementList() {
        const container = document.getElementById('announcement-list');
        if (!container) return;

        const announcements = announcementState.announcements || [];
        if (announcements.length === 0) {
            container.innerHTML = `<div class="announcement-empty">${i18n['announcement.empty'] || 'No notifications'}</div>`;
            return;
        }

        const typeIcons = {
            feature: '✨',
            warning: '⚠️',
            info: 'ℹ️',
            urgent: '🚨',
        };

        container.innerHTML = announcements.map(ann => {
            const isUnread = announcementState.unreadIds.includes(ann.id);
            const icon = typeIcons[ann.type] || 'ℹ️';
            const timeAgo = formatTimeAgo(ann.createdAt);

            return `
                <div class="announcement-item ${isUnread ? 'unread' : ''}" data-id="${ann.id}">
                    <span class="announcement-icon">${icon}</span>
                    <div class="announcement-info">
                        <div class="announcement-title">
                            ${isUnread ? '<span class="announcement-unread-dot"></span>' : ''}
                            <span>${ann.title}</span>
                        </div>
                        <div class="announcement-summary">${ann.summary}</div>
                        <div class="announcement-time">${timeAgo}</div>
                    </div>
                </div>
            `;
        }).join('');

        // 绑定点击事件
        container.querySelectorAll('.announcement-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.id;
                const ann = announcements.find(a => a.id === id);
                if (ann) {
                    // 若未读，点击即标记已读
                    if (announcementState.unreadIds.includes(id)) {
                        vscode.postMessage({
                            command: 'announcement.markAsRead',
                            id: id
                        });
                        // 乐观更新本地状态
                        announcementState.unreadIds = announcementState.unreadIds.filter(uid => uid !== id);
                        updateAnnouncementBadge();
                        item.classList.remove('unread');
                        const dot = item.querySelector('.announcement-unread-dot');
                        if (dot) dot.remove();
                    }
                    showAnnouncementPopup(ann, true);
                    closeAnnouncementList();
                }
            });
        });
    }

    function formatTimeAgo(dateStr) {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return i18n['announcement.timeAgo.justNow'] || 'Just now';
        if (diffMins < 60) return (i18n['announcement.timeAgo.minutesAgo'] || '{count}m ago').replace('{count}', diffMins);
        if (diffHours < 24) return (i18n['announcement.timeAgo.hoursAgo'] || '{count}h ago').replace('{count}', diffHours);
        return (i18n['announcement.timeAgo.daysAgo'] || '{count}d ago').replace('{count}', diffDays);
    }

    function showAnnouncementPopup(ann, fromList = false) {
        currentPopupAnnouncement = ann;

        const typeLabels = {
            feature: i18n['announcement.type.feature'] || '✨ New Feature',
            warning: i18n['announcement.type.warning'] || '⚠️ Warning',
            info: i18n['announcement.type.info'] || 'ℹ️ Info',
            urgent: i18n['announcement.type.urgent'] || '🚨 Urgent',
        };

        const popupType = document.getElementById('announcement-popup-type');
        const popupTitle = document.getElementById('announcement-popup-title');
        const popupContent = document.getElementById('announcement-popup-content');
        const popupAction = document.getElementById('announcement-popup-action');
        const popupGotIt = document.getElementById('announcement-popup-got-it');

        // Header buttons
        const backBtn = document.getElementById('announcement-popup-back');
        const closeBtn = document.getElementById('announcement-popup-close');

        if (popupType) {
            popupType.textContent = typeLabels[ann.type] || typeLabels.info;
            popupType.className = `announcement-type-badge ${ann.type}`;
        }
        if (popupTitle) popupTitle.textContent = ann.title;

        // 渲染内容和图片
        if (popupContent) {
            let contentHtml = `<div class="announcement-text">${escapeHtml(ann.content).replace(/\n/g, '<br>')}</div>`;
            
            // 如果有图片，渲染图片区域（带骨架屏占位符）
            if (ann.images && ann.images.length > 0) {
                contentHtml += '<div class="announcement-images">';
                for (const img of ann.images) {
                    contentHtml += `
                        <div class="announcement-image-item">
                            <img src="${escapeHtml(img.url)}" 
                                 alt="${escapeHtml(img.alt || img.label || '')}" 
                                 class="announcement-image"
                                 data-preview-url="${escapeHtml(img.url)}"
                                 title="${i18n['announcement.clickToEnlarge'] || 'Click to enlarge'}" />
                            <div class="image-skeleton"></div>
                            ${img.label ? `<div class="announcement-image-label">${escapeHtml(img.label)}</div>` : ''}
                        </div>
                    `;
                }
                contentHtml += '</div>';
            }

            popupContent.innerHTML = contentHtml;
            
            // 绑定图片加载事件
            popupContent.querySelectorAll('.announcement-image').forEach(imgEl => {
                // 图片加载完成
                imgEl.addEventListener('load', () => {
                    imgEl.classList.add('loaded');
                });
                
                // 图片加载失败
                imgEl.addEventListener('error', () => {
                    const item = imgEl.closest('.announcement-image-item');
                    if (item) {
                        const skeleton = item.querySelector('.image-skeleton');
                        if (skeleton) skeleton.remove();
                        imgEl.style.display = 'none';
                        const errorDiv = document.createElement('div');
                        errorDiv.className = 'image-load-error';
                        errorDiv.innerHTML = `
                            <span class="icon">🖼️</span>
                            <span>${i18n['announcement.imageLoadFailed'] || 'Image failed to load'}</span>
                        `;
                        item.insertBefore(errorDiv, item.firstChild);
                    }
                });
                
                // 点击放大
                imgEl.addEventListener('click', () => {
                    const url = imgEl.getAttribute('data-preview-url');
                    if (url) showImagePreview(url);
                });
            });
        }

        // 处理操作按钮
        if (ann.action && ann.action.label) {
            if (popupAction) {
                popupAction.textContent = ann.action.label;
                popupAction.classList.remove('hidden');
            }
            if (popupGotIt) popupGotIt.classList.add('hidden');
        } else {
            if (popupAction) popupAction.classList.add('hidden');
            if (popupGotIt) popupGotIt.classList.remove('hidden');
        }

        // 处理返回/关闭按钮显示
        if (fromList) {
            if (backBtn) {
                backBtn.classList.remove('hidden');
                backBtn.onclick = () => {
                    closeAnnouncementPopup(true); // 跳过动画
                    openAnnouncementList(); // 返回列表
                };
            }
            // 从列表进入时，关闭也跳过动画
            if (closeBtn) {
                closeBtn.onclick = () => {
                    closeAnnouncementPopup(true);
                };
            }
        } else {
            if (backBtn) backBtn.classList.add('hidden');
            // 自动弹窗时，关闭使用动画
            if (closeBtn) {
                closeBtn.onclick = () => {
                    closeAnnouncementPopup();
                };
            }
        }

        const modal = document.getElementById('announcement-popup-modal');
        if (modal) modal.classList.remove('hidden');
    }

    function closeAnnouncementPopup(skipAnimation = false) {
        const modal = document.getElementById('announcement-popup-modal');
        const modalContent = modal?.querySelector('.announcement-popup-content');
        const bellBtn = document.getElementById('announcement-btn');

        if (modal && modalContent && bellBtn && !skipAnimation) {
            // 获取铃铛按钮的位置
            const bellRect = bellBtn.getBoundingClientRect();
            const contentRect = modalContent.getBoundingClientRect();

            // 计算目标位移
            const targetX = bellRect.left + bellRect.width / 2 - (contentRect.left + contentRect.width / 2);
            const targetY = bellRect.top + bellRect.height / 2 - (contentRect.top + contentRect.height / 2);

            // 添加飞向铃铛的动画
            modalContent.style.transition = 'transform 0.4s ease-in, opacity 0.4s ease-in';
            modalContent.style.transform = `translate(${targetX}px, ${targetY}px) scale(0.1)`;
            modalContent.style.opacity = '0';

            // 铃铛抖动效果
            bellBtn.classList.add('bell-shake');

            // 动画结束后隐藏模态框并重置样式
            setTimeout(() => {
                modal.classList.add('hidden');
                modalContent.style.transition = '';
                modalContent.style.transform = '';
                modalContent.style.opacity = '';
                bellBtn.classList.remove('bell-shake');
            }, 400);
        } else if (modal) {
            modal.classList.add('hidden');
        }

        currentPopupAnnouncement = null;
    }

    function handleAnnouncementGotIt() {
        if (currentPopupAnnouncement) {
            vscode.postMessage({
                command: 'announcement.markAsRead',
                id: currentPopupAnnouncement.id
            });
        }
        closeAnnouncementPopup();
    }

    function handleAnnouncementAction() {
        if (currentPopupAnnouncement && currentPopupAnnouncement.action) {
            const action = currentPopupAnnouncement.action;

            // 先标记已读
            vscode.postMessage({
                command: 'announcement.markAsRead',
                id: currentPopupAnnouncement.id
            });

            // 执行操作
            if (action.type === 'tab') {
                switchToTab(action.target);
            } else if (action.type === 'url') {
                vscode.postMessage({ command: 'openUrl', url: action.target });
            } else if (action.type === 'command') {
                vscode.postMessage({
                    command: 'executeCommand',
                    commandId: action.target,
                    commandArgs: action.arguments || []
                });
            }
        }
        closeAnnouncementPopup();
    }

    function markAllAnnouncementsRead() {
        vscode.postMessage({ command: 'announcement.markAllAsRead' });
        showToast(i18n['announcement.markAllRead'] || 'All marked as read', 'success');
    }

    function handleAnnouncementState(state) {
        announcementState = state;
        updateAnnouncementBadge();
        renderAnnouncementList();

        // 检查是否需要弹出公告（只弹未弹过的）
        if (state.popupAnnouncement && !shownPopupIds.has(state.popupAnnouncement.id)) {
            shownPopupIds.add(state.popupAnnouncement.id);
            // 延迟弹出，等待页面渲染完成
            setTimeout(() => {
                showAnnouncementPopup(state.popupAnnouncement);
            }, 600);
        }
    }

    // ============ 图片预览 ============

    function showImagePreview(imageUrl) {
        // 创建预览遮罩
        const overlay = document.createElement('div');
        overlay.className = 'image-preview-overlay';
        overlay.innerHTML = `
            <div class="image-preview-container">
                <img src="${imageUrl}" class="image-preview-img" />
                <div class="image-preview-hint">${i18n['announcement.clickToClose'] || 'Click to close'}</div>
            </div>
        `;

        // 点击关闭
        overlay.addEventListener('click', () => {
            overlay.classList.add('closing');
            setTimeout(() => overlay.remove(), 200);
        });

        document.body.appendChild(overlay);

        // 触发动画
        requestAnimationFrame(() => overlay.classList.add('visible'));
    }

    // 暴露到 window 供 onclick 调用
    window.showImagePreview = showImagePreview;

    // ============ 启动 ============

    init();

})();
