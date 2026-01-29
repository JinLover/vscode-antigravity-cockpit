/**
 * Antigravity Cockpit - Dashboard script
 * Handles Webview UI interactions.
 */

import { AUTH_RECOMMENDED_LABELS, AUTH_RECOMMENDED_MODEL_IDS } from '../../shared/recommended_models';

(function () {
    'use strict';

    // VS Code API (stored globally for reuse)
    const vscode = window.__vscodeApi || (window.__vscodeApi = acquireVsCodeApi());

    // DOM elements
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

    // i18n strings
    const i18n = window.__i18n || {};

    // State
    let isRefreshing = false;
    let dragSrcEl = null;
    let currentConfig = {};
    let lastSnapshot = null; // Store last snapshot for re-renders
    let renameGroupId = null; // Group currently being renamed
    let renameModelIds = [];  // Model IDs in the group being renamed
    let renameModelId = null; // Model being renamed (non-group mode)
    let isRenamingModel = false; // Renaming a single model (not a group)
    let visibleModelIds = [];
    let renameOriginalName = ''; // Original name for reset
    let isProfileHidden = false; // Toggle plan details panel
    let isDataMasked = false;    // Mask sensitive data
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

    // Refresh cooldown (seconds)
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

    // Custom grouping modal state
    const customGroupingModal = document.getElementById('custom-grouping-modal');
    let customGroupingState = {
        groups: [],       // { id: string, name: string, modelIds: string[] }
        allModels: [],    // All models from the snapshot
        groupMappings: {} // Original group mappings (for save)
    };



    // ============ Init ============

    function init() {
        // Restore UI state
        const state = vscode.getState() || {};
        if (state.lastRefresh && state.refreshCooldown) {
            const now = Date.now();
            const diff = Math.floor((now - state.lastRefresh) / 1000);
            if (diff < state.refreshCooldown) {
                startCooldown(state.refreshCooldown - diff);
            }
        }
        // isProfileHidden and isDataMasked are loaded from config in handleMessage

        refreshBtn.addEventListener('click', handleRefresh);

        initRichTooltip();
        if (resetOrderBtn) {
            resetOrderBtn.addEventListener('click', handleResetOrder);
        }

        const manageModelsBtn = document.getElementById('manage-models-btn');
        if (manageModelsBtn) {
            manageModelsBtn.addEventListener('click', openModelManagerModal);
        }

        const toggleProfileBtn = document.getElementById('toggle-profile-btn');
        if (toggleProfileBtn) {
            toggleProfileBtn.addEventListener('click', handleToggleProfile);
        }

        const toggleGroupingBtn = document.getElementById('toggle-grouping-btn');
        if (toggleGroupingBtn) {
            toggleGroupingBtn.addEventListener('click', handleToggleGrouping);
        }

        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', openSettingsModal);
        }

        const closeSettingsBtn = document.getElementById('close-settings-btn');
        if (closeSettingsBtn) {
            closeSettingsBtn.addEventListener('click', closeSettingsModal);
        }

        const closeRenameBtn = document.getElementById('close-rename-btn');
        if (closeRenameBtn) {
            closeRenameBtn.addEventListener('click', closeRenameModal);
        }

        const saveRenameBtn = document.getElementById('save-rename-btn');
        if (saveRenameBtn) {
            saveRenameBtn.addEventListener('click', saveRename);
        }

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

        const resetNameBtn = document.getElementById('reset-name-btn');
        if (resetNameBtn) {
            resetNameBtn.addEventListener('click', resetName);
        }

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



        // Event delegation: pin toggles
        dashboard.addEventListener('change', (e) => {
            if (e.target.classList.contains('pin-toggle')) {
                const modelId = e.target.getAttribute('data-model-id');
                if (modelId) {
                    togglePin(modelId);
                }
            }
        });

        // Listen for extension messages
        window.addEventListener('message', handleMessage);

        // Tab navigation
        initTabNavigation();
        initHistoryTab();
        window.addEventListener('resize', handleHistoryResize);

        renderLoadingCard();

        // Notify extension that UI is ready
        vscode.postMessage({ command: 'init' });
    }

    // ============ Tab navigation ============

    function initTabNavigation() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.getAttribute('data-tab');

                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                tabContents.forEach(content => {
                    if (content.id === `tab-${targetTab}`) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });

                if (targetTab === 'history') {
                    activateHistoryTab();
                }
            });
        });
    }


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


        const historyClearBtn = document.getElementById('history-clear-btn');
        const historyClearModal = document.getElementById('history-clear-modal');
        const historyClearThisBtn = document.getElementById('history-clear-this-btn');
        const historyClearAllBtn = document.getElementById('history-clear-all-btn');
        const historyClearCancelBtn = document.getElementById('history-clear-cancel');
        const historyClearCloseBtn = document.getElementById('history-clear-close');
        
        if (historyClearBtn && historyClearModal) {
            historyClearBtn.addEventListener('click', () => {
                if (historyState.selectedEmail) {
                    const msgEl = document.getElementById('history-clear-message');
                    if (msgEl) {
                        msgEl.textContent = (i18n['history.clearConfirm'] || 'Are you sure you want to clear quota history for {email}?').replace('{email}', historyState.selectedEmail);
                    }
                    if (historyClearThisBtn) {
                        historyClearThisBtn.textContent = `🗑️ ${i18n['history.clearThis'] || 'Clear This Account'}`;
                    }
                    historyClearModal.classList.remove('hidden');
                }
            });
        }
        
        const closeHistoryClearModal = () => {
            if (historyClearModal) {
                historyClearModal.classList.add('hidden');
            }
        };

        if (historyClearCloseBtn) historyClearCloseBtn.addEventListener('click', closeHistoryClearModal);
        if (historyClearCancelBtn) historyClearCancelBtn.addEventListener('click', closeHistoryClearModal);
        
        if (historyClearThisBtn) {
            historyClearThisBtn.addEventListener('click', () => {
                if (historyState.selectedEmail) {
                    vscode.postMessage({
                        command: 'quotaHistory.clear',
                        email: historyState.selectedEmail,
                    });
                    closeHistoryClearModal();
                }
            });
        }
        
        if (historyClearAllBtn) {
            historyClearAllBtn.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'quotaHistory.clearAll',
                });
                closeHistoryClearModal();
            });
        }

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

    function handleQuotaHistoryCleared() {
        requestQuotaHistory();
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

        if (historyState.selectedEmail && accounts.includes(historyState.selectedEmail)) {
            historyAccountSelect.value = historyState.selectedEmail;
        } else {
            historyState.selectedEmail = accounts[0];
            historyAccountSelect.value = accounts[0];
        }
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
            bottom: 42,
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

        // Draw Time Axis Labels (Data-Driven)
        ctx.save();
        ctx.fillStyle = textSecondary;
        ctx.font = `11px ${getCssVar('--font-family', 'sans-serif')}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'center';

        const labelY = padding.top + chartHeight + 12;
        const minLabelDist = 60; // minimum pixels between label centers
        let lastLabelX = -1;

        // Iterate backwards (from right to left) to prioritize latest data
        // We calculate coords for all points first to know where to draw text
        const pointCoords = points.map(point => {
            const ratio = (point.timestamp - startTime) / (endTime - startTime);
            return {
                x: padding.left + Math.min(1, Math.max(0, ratio)) * chartWidth,
                timestamp: point.timestamp
            };
        });

        // We process points from right (newest) to left (oldest)
        // strict logic: rightmost point always shows (if inside view),
        // then others show only if enough space.
        const reversedCoords = [...pointCoords].reverse();
        
        reversedCoords.forEach((coord, index) => {
            // Always try to show the latest point (index 0)
            // Or if distance is enough from the previously drawn label (which is to the right)
            
            // Note: Since we go Right -> Left, 'lastLabelX' represents the label *to the right*.
            // So we check if (lastLabelX - coord.x) >= minLabelDist
            
            const isLatest = (index === 0);
            const canDraw = (lastLabelX === -1) || ((lastLabelX - coord.x) >= minLabelDist);

            if (isLatest || canDraw) {
                const date = new Date(coord.timestamp);
                let labelParts = [];
                if (historyState.rangeDays <= 1) {
                    labelParts = [
                        String(date.getHours()).padStart(2, '0') + ':' + 
                        String(date.getMinutes()).padStart(2, '0')
                    ];
                } else {
                    labelParts = [
                        String(date.getMonth() + 1).padStart(2, '0') + '-' + 
                        String(date.getDate()).padStart(2, '0')
                    ];
                }
                const labelText = labelParts.join(' ');
                
                // Boundary check: ensure label doesn't go off-canvas too much
                // Simple logic: clamp text position or alignment
                
                // Draw tick mark (optional, but helps alignment)
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.moveTo(coord.x, padding.top + chartHeight);
                ctx.lineTo(coord.x, padding.top + chartHeight + 5);
                ctx.stroke();
                ctx.globalAlpha = 1.0;

                ctx.fillText(labelText, coord.x, labelY);
                lastLabelX = coord.x;
            }
        });
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
                    <td>${formatHistoryCountdownLabel(point.countdownSeconds, point.isStart, point.isReset)}</td>
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

    function formatHistoryCountdownLabel(seconds, isStart, isReset) {
        const text = formatHistoryCountdown(seconds);
        if (!isStart && !isReset) {
            return text;
        }
        
        let badges = '';
        if (isStart) {
            badges += `<span class="tag-start">START</span>`;
        }
        if (isReset) {
            badges += `<span class="tag-reset">RESET</span>`;
        }
        
        if (text === '--') {
            return badges;
        }
        return `${text} ${badges}`;
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


    function openSettingsModal() {
        if (settingsModal) {
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

            initLanguageSelector();

            initStatusBarFormatSelector();

            initSettingsAutoSave();

            settingsModal.classList.remove('hidden');
        }
    }

    /**
     */
    function initStatusBarFormatSelector() {
        const formatSelect = document.getElementById('statusbar-format');
        if (!formatSelect) return;

        const currentFormat = currentConfig.statusBarFormat || 'standard';
        formatSelect.value = currentFormat;

        formatSelect.onchange = null;
        formatSelect.addEventListener('change', () => {
            const format = formatSelect.value;

            vscode.postMessage({
                command: 'updateStatusBarFormat',
                statusBarFormat: format
            });
        });
    }

    /**
     */
    function initLanguageSelector() {
        const languageSelect = document.getElementById('language-select');
        if (!languageSelect) return;

        const currentLanguage = currentConfig.language || 'auto';
        languageSelect.value = currentLanguage;

        languageSelect.onchange = null;
        languageSelect.addEventListener('change', () => {
            const newLanguage = languageSelect.value;

            vscode.postMessage({
                command: 'updateLanguage',
                language: newLanguage
            });

            showToast(i18n['language.changed'] || 'Language changed. Reopen panel to apply.', 'info');
        });
    }

    /**
     */
    function initSettingsAutoSave() {
        const notificationCheckbox = document.getElementById('notification-enabled');
        const warningInput = document.getElementById('warning-threshold');
        const criticalInput = document.getElementById('critical-threshold');

        if (notificationCheckbox) {
            notificationCheckbox.onchange = null;
            notificationCheckbox.addEventListener('change', () => {
                vscode.postMessage({
                    command: 'updateNotificationEnabled',
                    notificationEnabled: notificationCheckbox.checked
                });
            });
        }

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
     */
    function clampAndSaveThresholds() {
        const warningInput = document.getElementById('warning-threshold');
        const criticalInput = document.getElementById('critical-threshold');

        let warningValue = parseInt(warningInput?.value, 10) || 30;
        let criticalValue = parseInt(criticalInput?.value, 10) || 10;

        if (warningValue < 5) warningValue = 5;
        if (warningValue > 80) warningValue = 80;
        if (criticalValue < 1) criticalValue = 1;
        if (criticalValue > 50) criticalValue = 50;

        if (criticalValue >= warningValue) {
            criticalValue = warningValue - 1;
            if (criticalValue < 1) criticalValue = 1;
        }

        if (warningInput) warningInput.value = warningValue;
        if (criticalInput) criticalInput.value = criticalValue;

        saveThresholds();
    }

    /**
     */
    function saveThresholds() {
        const notificationCheckbox = document.getElementById('notification-enabled');
        const warningInput = document.getElementById('warning-threshold');
        const criticalInput = document.getElementById('critical-threshold');

        const notificationEnabled = notificationCheckbox?.checked ?? true;
        const warningValue = parseInt(warningInput?.value, 10) || 30;
        const criticalValue = parseInt(criticalInput?.value, 10) || 10;

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


    function openRenameModal(groupId, currentName, modelIds) {
        if (renameModal) {
            renameGroupId = groupId;
            renameModelIds = modelIds || [];
            isRenamingModel = false;
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
     */
    function openModelRenameModal(modelId, currentName, originalName) {
        if (renameModal) {
            isRenamingModel = true;
            renameModelId = modelId;
            renameGroupId = null;
            renameModelIds = [];
            renameOriginalName = originalName || currentName || '';

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
            vscode.postMessage({
                command: 'renameModel',
                modelId: renameModelId,
                groupName: newName
            });

            showToast((i18n['model.renamed'] || 'Model renamed to {name}').replace('{name}', newName), 'success');
        } else if (renameGroupId && renameModelIds.length > 0) {
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
     */
    function updateGroupNameOptimistically(groupId, newName) {
        const card = document.querySelector(`.group-card[data-group-id="${groupId}"]`);
        if (card) {
            const nameSpan = card.querySelector('.group-name');
            if (nameSpan) {
                nameSpan.textContent = newName;
            }
        }
        
        if (lastSnapshot && lastSnapshot.groups) {
            const group = lastSnapshot.groups.find(g => g.groupId === groupId);
            if (group) {
                group.groupName = newName;
            }
        }
    }
    /**
     */
    function resetName() {
        const renameInput = document.getElementById('rename-input');
        if (!renameInput) return;

        if (isRenamingModel && renameModelId && renameOriginalName) {
            renameInput.value = renameOriginalName;
            renameInput.focus();
        }
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




    function handleMessage(event) {
        const message = event.data;

        if (message.type === 'switchTab' && message.tab) {
            switchToTab(message.tab);
            return;
        }

        if (message.type === 'telemetry_update') {
            isRefreshing = false;
            updateRefreshButton();

            // Save config
            if (message.config) {
                currentConfig = message.config;

                // Persisted UI flags
                if (message.config.profileHidden !== undefined) {
                    isProfileHidden = message.config.profileHidden;
                    updateToggleProfileButton();
                }
                if (Array.isArray(message.config.visibleModels)) {
                    visibleModelIds = message.config.visibleModels;
                }
                if (message.config.dataMasked !== undefined) {
                    isDataMasked = message.config.dataMasked;
                }
            }
            render(message.data, message.config);
            lastSnapshot = message.data; // Update global snapshot
            if (isHistoryTabActive()) {
                requestQuotaHistory();
            }

            // Auto sync is handled on the extension side.
        }

        if (message.type === 'quotaHistoryData') {
            handleQuotaHistoryData(message.data);
        }
        if (message.type === 'quotaHistoryCleared') {
            handleQuotaHistoryCleared();
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
    }

    function renderLoadingCard() {
        statusDiv.style.display = 'none';
        dashboard.innerHTML = '';
        renderLocalLoadingCard();
    }

    function renderLocalLoadingCard() {
        const card = document.createElement('div');
        card.className = 'offline-card local-card';
        card.innerHTML = `
            <div class="icon offline-spinner"><span class="spinner"></span></div>
            <h2>${i18n['quotaSource.localLoadingTitle'] || 'Detecting local Antigravity...'}</h2>
            <p>${i18n['quotaSource.localLoadingDesc'] || 'Keep the Antigravity client running.'}</p>
        `;
        dashboard.appendChild(card);
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
     */
    function switchToTab(tabId) {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        if (!targetBtn) return;

        tabButtons.forEach(b => b.classList.remove('active'));
        targetBtn.classList.add('active');

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


    function showToast(message, type = 'info') {
        if (!toast) return;

        toast.textContent = message;
        toast.className = `toast ${type}`;

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }


    function getHealthColor(percentage) {
        const warningThreshold = currentConfig.warningThreshold || 30;
        const criticalThreshold = currentConfig.criticalThreshold || 10;

        if (percentage > warningThreshold) return 'var(--success)';
        if (percentage > criticalThreshold) return 'var(--warning)';
        return 'var(--danger)';
    }

    function getStatusText(percentage) {
        const warningThreshold = currentConfig.warningThreshold || 30;
        const criticalThreshold = currentConfig.criticalThreshold || 10;

        if (percentage > warningThreshold) return i18n['dashboard.active'] || 'Healthy';
        if (percentage > criticalThreshold) return i18n['dashboard.warning'] || 'Warning';
        return i18n['dashboard.danger'] || 'Danger';
    }

    /**
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


    function render(snapshot, config) {
        statusDiv.style.display = 'none';
        dashboard.innerHTML = '';

        // Offline state
        if (!snapshot.isConnected) {
            renderLocalOfflineCard(snapshot.errorMessage);
            return;
        }

        // Render User Profile (if available) - New Section
        // Check isProfileHidden state before rendering
        if (snapshot.userInfo && !isProfileHidden) {
            renderUserProfile(snapshot.userInfo);
        }

        updateToggleGroupingButton(config?.groupingEnabled);

        if (config?.groupingEnabled && snapshot.groups && snapshot.groups.length > 0) {
            renderAutoGroupBar();

            let groups = [...snapshot.groups];
            if (config?.groupOrder?.length > 0) {
                const orderMap = new Map();
                config.groupOrder.forEach((id, index) => orderMap.set(id, index));

                groups.sort((a, b) => {
                    const idxA = orderMap.has(a.groupId) ? orderMap.get(a.groupId) : 99999;
                    const idxB = orderMap.has(b.groupId) ? orderMap.get(b.groupId) : 99999;
                    if (idxA !== idxB) return idxA - idxB;
                    return a.remainingPercentage - b.remainingPercentage;
                });
            }

            groups.forEach(group => {
                renderGroupCard(group, config?.pinnedGroups || []);
            });
            return;
        }

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
            </div>
        `;
        dashboard.appendChild(card);
        const retryBtn = card.querySelector('[data-action="retry-local"]');
        retryBtn?.addEventListener('click', retryConnection);
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

        const btn = bar.querySelector('#manage-group-btn');
        if (btn) {
            btn.addEventListener('click', openCustomGroupingModal);
        }
    }


    function openCustomGroupingModal() {
        if (!customGroupingModal || !lastSnapshot) return;

        const models = lastSnapshot.models || [];
        customGroupingState.allModels = models;
        customGroupingState.groupMappings = { ...(currentConfig.groupMappings || {}) };

        const groupMap = new Map(); // groupId -> { id, name, modelIds }
        const groupNames = currentConfig.groupCustomNames || {};

        for (const model of models) {
            const groupId = customGroupingState.groupMappings[model.modelId];
            if (groupId) {
                if (!groupMap.has(groupId)) {
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

        const groupedModelIds = new Set();
        customGroupingState.groups.forEach(g => g.modelIds.forEach(id => groupedModelIds.add(id)));

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

        const groupedModelIds = new Set();
        customGroupingState.groups.forEach(g => g.modelIds.forEach(id => groupedModelIds.add(id)));

        const availableModels = customGroupingState.allModels.filter(m => !groupedModelIds.has(m.modelId));

        if (availableModels.length === 0) {
            showToast(i18n['customGrouping.noModels'] || 'No available models', 'info');
            return;
        }

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

        showModelSelectDropdown(e.target, availableModels, groupSignature, (selectedModelId) => {
            group.modelIds.push(selectedModelId);
            renderCustomGroupingContent();
        });
    }

    function showModelSelectDropdown(anchor, models, groupSignature, onSelect) {
        const existingDropdown = document.querySelector('.model-select-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        const dropdown = document.createElement('div');
        dropdown.className = 'model-select-dropdown';

        const rect = anchor.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 4) + 'px';

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

        modelsWithCompatibility.sort((a, b) => {
            if (a.isCompatible && !b.isCompatible) return -1;
            if (!a.isCompatible && b.isCompatible) return 1;
            return 0;
        });

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

        const confirmBtn = dropdown.querySelector('.btn-confirm-add');
        const countSpan = dropdown.querySelector('.selected-count');
        const allCheckboxes = dropdown.querySelectorAll('.model-checkbox');

        const updateSelectionState = () => {
            const checkedBoxes = dropdown.querySelectorAll('.model-checkbox:checked');
            const selectedCount = checkedBoxes.length;

            if (countSpan) countSpan.textContent = selectedCount;
            if (confirmBtn) confirmBtn.disabled = selectedCount === 0;

            let currentSignature = groupSignature;

            if (!currentSignature && selectedCount > 0) {
                const firstCheckedId = checkedBoxes[0].value;
                const firstModel = modelsWithCompatibility.find(m => m.model.modelId === firstCheckedId);
                if (firstModel) {
                    currentSignature = {
                        remainingPercentage: firstModel.model.remainingPercentage,
                        resetTimeDisplay: firstModel.model.resetTimeDisplay
                    };
                }
            }

            allCheckboxes.forEach(cb => {
                if (cb.checked) return;

                const modelId = cb.value;
                const modelData = modelsWithCompatibility.find(m => m.model.modelId === modelId);
                if (!modelData) return;

                const item = cb.closest('.model-select-item');
                if (!item) return;

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

        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const selectedIds = Array.from(dropdown.querySelectorAll('.model-checkbox:checked'))
                    .map(cb => cb.value);
                if (selectedIds.length > 0) {
                    selectedIds.forEach(modelId => onSelect(modelId));
                    dropdown.remove();
                }
            });
        }

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
        const models = customGroupingState.allModels;
        if (!models || models.length === 0) {
            showToast(i18n['customGrouping.noModels'] || 'No models available', 'info');
            return;
        }

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

        const existingGroupNames = {};
        for (const group of customGroupingState.groups) {
            for (const modelId of group.modelIds) {
                existingGroupNames[modelId] = group.name;
            }
        }

        const groupMap = new Map(); // groupId -> { id, name, modelIds }
        const matchedModels = new Set();

        for (const defaultGroup of defaultGroups) {
            const groupModels = [];
            
            for (const model of models) {
                if (defaultGroup.modelIds.includes(model.modelId)) {
                    groupModels.push(model.modelId);
                    matchedModels.add(model.modelId);
                }
            }

            if (groupModels.length > 0) {
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

        const ungroupedModels = models.filter(m => !matchedModels.has(m.modelId));
        if (ungroupedModels.length > 0) {
            groupMap.set('other', {
                id: 'other',
                name: i18n['customGrouping.other'] || 'Other',
                modelIds: ungroupedModels.map(m => m.modelId)
            });
        }

        customGroupingState.groups = Array.from(groupMap.values());

        renderCustomGroupingContent();
        const smartGroupMsg = (i18n['customGrouping.smartGroupCount'] || 'Auto Group: {count} groups').replace('{count}', customGroupingState.groups.length);
        showToast(smartGroupMsg, 'success');
    }

    function saveCustomGrouping() {
        const emptyGroups = customGroupingState.groups.filter(g => g.modelIds.length === 0);
        if (emptyGroups.length > 0) {
            customGroupingState.groups = customGroupingState.groups.filter(g => g.modelIds.length > 0);
        }

        const newMappings = {};
        const newGroupNames = {};

        for (const group of customGroupingState.groups) {
            const stableGroupId = group.modelIds.sort().join('_');
            for (const modelId of group.modelIds) {
                newMappings[modelId] = stableGroupId;
                newGroupNames[modelId] = group.name;
            }
        }

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

                const decodedHtml = decodeURIComponent(html);

                tooltip.innerHTML = decodedHtml;
                tooltip.classList.remove('hidden');

                const rect = target.getBoundingClientRect();
                const tooltipRect = tooltip.getBoundingClientRect();

                let top = rect.bottom + 8;
                let left = rect.left + (rect.width - tooltipRect.width) / 2;

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

        window.addEventListener('scroll', () => {
            if (activeTarget) {
                activeTarget = null;
                tooltip.classList.add('hidden');
            }
        }, true);
    }

    /**
     */
    function getModelCapabilityList(model) {
        const caps = [];
        const mime = model.supportedMimeTypes || {};

        if (model.supportsImages || Object.keys(mime).some(k => k.startsWith('image/'))) {
            caps.push({
                icon: '🖼️',
                text: i18n['capability.vision'] || 'Vision'
            });
        }

        if (mime['application/pdf'] || mime['text/plain'] || mime['application/rtf']) {
            caps.push({
                icon: '📄',
                text: i18n['capability.docs'] || 'Documents'
            });
        }

        if (Object.keys(mime).some(k => k.startsWith('video/') || k.startsWith('audio/'))) {
            caps.push({
                icon: '🎬',
                text: i18n['capability.media'] || 'Media'
            });
        }

        return caps;
    }

    /**
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

        card.addEventListener('dragstart', handleDragStart, false);
        card.addEventListener('dragenter', handleDragEnter, false);
        card.addEventListener('dragover', handleDragOver, false);
        card.addEventListener('dragleave', handleDragLeave, false);
        card.addEventListener('drop', handleDrop, false);
        card.addEventListener('dragend', handleDragEnd, false);

        const modelList = group.models.map(m => {
            const caps = getModelCapabilityList(m);
            const tagHtml = m.tagTitle ? `<span class="tag-new">${m.tagTitle}</span>` : '';
            const recClass = m.isRecommended ? ' recommended' : '';

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

        const displayName = (modelCustomNames && modelCustomNames[model.modelId]) || model.label;
        const originalLabel = model.label;

        const caps = getModelCapabilityList(model);
        let capsIconHtml = '';
        let tooltipAttr = '';

        if (caps.length > 0) {
            const tooltipHtml = encodeURIComponent(generateCapabilityTooltip(caps));
            tooltipAttr = ` data-tooltip-html="${tooltipHtml}"`;
            capsIconHtml = `<span class="title-caps-trigger">✨</span>`;
        }

        const tagHtml = model.tagTitle ? `<span class="tag-new">${model.tagTitle}</span>` : '';

        const recommendedClass = model.isRecommended ? ' card-recommended' : '';

        const card = document.createElement('div');
        card.className = `card draggable${recommendedClass}`;
        card.setAttribute('draggable', 'true');
        card.setAttribute('data-id', model.modelId);

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

        const renameBtn = card.querySelector('.rename-model-btn');
        if (renameBtn) {
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openModelRenameModal(model.modelId, displayName, originalLabel);
            });
        }

        dashboard.appendChild(card);
    }


    init();

})();
