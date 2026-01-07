/**
 * Antigravity Cockpit - Dashboard 脚本
 * 处理 Webview 交互逻辑
 */

(function() {
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

    // 国际化文本
    const i18n = window.__i18n || {};

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
    let visibleModelIds = [];
    let renameOriginalName = ''; // 原始名称（用于重置）
    let isProfileHidden = false;  // 控制整个计划详情卡片的显示/隐藏
    let isDataMasked = false;     // 控制数据是否显示为 ***
    let modelManagerSelection = new Set();
    let modelManagerModels = [];

    // 刷新冷却时间（秒）
    let refreshCooldown = 10;

    const AUTH_RECOMMENDED_LABELS = [
        'Claude Opus 4.5 (Thinking)',
        'Claude Sonnet 4.5',
        'Claude Sonnet 4.5 (Thinking)',
        'Gemini 3 Flash',
        'Gemini 3 Pro (High)',
        'Gemini 3 Pro (Low)',
        'Gemini 3 Pro Image',
        'GPT-OSS 120B (Medium)'
    ];
    const AUTH_RECOMMENDED_MODEL_IDS = [
        'MODEL_PLACEHOLDER_M12',
        'MODEL_CLAUDE_4_5_SONNET',
        'MODEL_CLAUDE_4_5_SONNET_THINKING',
        'MODEL_PLACEHOLDER_M18',
        'MODEL_PLACEHOLDER_M7',
        'MODEL_PLACEHOLDER_M8',
        'MODEL_PLACEHOLDER_M9',
        'MODEL_OPENAI_GPT_OSS_120B_MEDIUM'
    ];
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
        document.getElementById('model-manager-select-recommended')?.addEventListener('click', () => {
            updateModelManagerSelection('recommended');
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
            });
        });
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

    function handleAutoGroup() {
        vscode.postMessage({ command: 'autoGroup' });
        showToast(i18n['grouping.autoGroup'] || 'Auto grouping...', 'info');
    }



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
        }

        if (message.type === 'autoTriggerState') {
            if (message.data?.authorization !== undefined) {
                authorizationStatus = message.data.authorization;
                authorizedAvailable = Boolean(message.data.authorization?.isAuthorized);
                updateQuotaAuthUI();
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
        updateModelManagerToolbar();
    }

    function updateQuotaAuthUI() {
        const card = document.getElementById('quota-auth-card');
        const row = document.getElementById('quota-auth-row');
        if (!card || !row) {
            return;
        }

        if (currentQuotaSource !== 'authorized') {
            card.classList.add('hidden');
            return;
        }

        card.classList.remove('hidden');
        const auth = authorizationStatus;
        if (auth?.isAuthorized) {
            row.innerHTML = `
                <div class="quota-auth-info">
                    <span class="quota-auth-icon">✅</span>
                    <span class="quota-auth-text">${i18n['autoTrigger.authorized'] || 'Authorized'}</span>
                    <span class="quota-auth-email">${auth.email || ''}</span>
                </div>
                <div class="quota-auth-actions">
                    <button id="quota-reauth-btn" class="at-btn at-btn-secondary">${i18n['autoTrigger.reauthorizeBtn'] || 'Reauthorize'}</button>
                    <button id="quota-revoke-btn" class="at-btn at-btn-danger">${i18n['autoTrigger.revokeBtn'] || 'Revoke'}</button>
                </div>
            `;
            document.getElementById('quota-reauth-btn')?.addEventListener('click', () => {
                vscode.postMessage({ command: 'autoTrigger.authorize' });
            });
            document.getElementById('quota-revoke-btn')?.addEventListener('click', () => {
                document.getElementById('at-revoke-modal')?.classList.remove('hidden');
            });
        } else {
            row.innerHTML = `
                <div class="quota-auth-info">
                    <span class="quota-auth-icon">⚠️</span>
                    <span class="quota-auth-text">${i18n['autoTrigger.unauthorized'] || 'Unauthorized'}</span>
                </div>
                <div class="quota-auth-actions">
                    <button id="quota-auth-btn" class="at-btn at-btn-primary">${i18n['autoTrigger.authorizeBtn'] || 'Authorize'}</button>
                </div>
            `;
            document.getElementById('quota-auth-btn')?.addEventListener('click', () => {
                vscode.postMessage({ command: 'autoTrigger.authorize' });
            });
        }
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

    function updateModelManagerToolbar() {
        const recommendedBtn = document.getElementById('model-manager-select-recommended');
        if (!recommendedBtn) {
            return;
        }
        const isAuthorized = currentQuotaSource === 'authorized';
        recommendedBtn.classList.toggle('hidden', !isAuthorized);
    }

    function getAuthorizedRecommendedRank(model) {
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

    function getAuthorizedRecommendedIds(models) {
        return models
            .filter(model => getAuthorizedRecommendedRank(model) < Number.MAX_SAFE_INTEGER)
            .sort((a, b) => getAuthorizedRecommendedRank(a) - getAuthorizedRecommendedRank(b))
            .map(model => model.modelId);
    }

    function openModelManagerModal() {
        if (!modelManagerModal) {
            return;
        }

        modelManagerModels = getModelManagerModels();
        modelManagerSelection = new Set(getDefaultVisibleModelIds(modelManagerModels));
        renderModelManagerList();
        updateModelManagerToolbar();
        modelManagerModal.classList.remove('hidden');
    }

    function closeModelManagerModal() {
        modelManagerModal?.classList.add('hidden');
    }

    function getModelManagerModels() {
        const models = lastSnapshot?.allModels || lastSnapshot?.models || [];
        const sorted = [...models];
        if (currentQuotaSource === 'authorized') {
            return sorted.sort((a, b) => {
                const aRank = getAuthorizedRecommendedRank(a);
                const bRank = getAuthorizedRecommendedRank(b);
                if (aRank !== bRank) {
                    return aRank - bRank;
                }
                return (a.label || '').localeCompare(b.label || '');
            });
        }
        return sorted.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    }

    function getDefaultVisibleModelIds(models) {
        const allIds = models.map(model => model.modelId);
        if (Array.isArray(visibleModelIds) && visibleModelIds.length > 0) {
            return visibleModelIds.filter(id => allIds.includes(id));
        }
        if (currentQuotaSource === 'authorized') {
            const recommendedIds = getAuthorizedRecommendedIds(models).filter(id => allIds.includes(id));
            if (recommendedIds.length > 0) {
                return recommendedIds;
            }
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
            if (currentQuotaSource !== 'authorized') {
                return;
            }
            modelManagerSelection = new Set(getAuthorizedRecommendedIds(modelManagerModels));
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
                vscode.postMessage({ command: 'autoTrigger.authorize' });
            });
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
        // 使用现有的自动分组逻辑预填数据
        const models = customGroupingState.allModels;
        if (!models || models.length === 0) {
            showToast(i18n['customGrouping.noModels'] || 'No models available', 'info');
            return;
        }
        
        // 保存现有分组名称映射（modelId -> groupName）
        const existingGroupNames = {};
        for (const group of customGroupingState.groups) {
            for (const modelId of group.modelIds) {
                existingGroupNames[modelId] = group.name;
            }
        }
        
        // 按配额签名分组
        const signatureMap = new Map(); // signature -> modelIds
        for (const model of models) {
            const signature = `${(model.remainingPercentage || 0).toFixed(6)}_${model.resetTimeDisplay || ''}`;
            if (!signatureMap.has(signature)) {
                signatureMap.set(signature, []);
            }
            signatureMap.get(signature).push(model.modelId);
        }
        
        // 转换为分组结构
        customGroupingState.groups = [];
        let groupIndex = 1;
        for (const [signature, modelIds] of signatureMap) {
            // 使用排序后的副本生成稳定的 groupId，保持 modelIds 原始顺序
            const groupId = [...modelIds].sort().join('_');
            
            // 尝试继承现有分组名称
            // 优先使用组内模型之前的分组名称（按出现次数投票）
            const nameVotes = {};
            for (const modelId of modelIds) {
                const existingName = existingGroupNames[modelId];
                if (existingName) {
                    nameVotes[existingName] = (nameVotes[existingName] || 0) + 1;
                }
            }
            
            // 找出投票最多的名称
            let inheritedName = '';
            let maxVotes = 0;
            for (const [name, votes] of Object.entries(nameVotes)) {
                if (votes > maxVotes) {
                    maxVotes = votes;
                    inheritedName = name;
                }
            }
            
            // 如果没有继承名称，使用备选方案
            let groupName = inheritedName;
            if (!groupName) {
                // 也尝试从 config 中读取
                const configGroupNames = currentConfig.groupCustomNames || {};
                for (const modelId of modelIds) {
                    if (configGroupNames[modelId]) {
                        groupName = configGroupNames[modelId];
                        break;
                    }
                }
            }
            
            // 最终备选：单模型用模型名，多模型用 Group N
            if (!groupName) {
                const firstModel = models.find(m => m.modelId === modelIds[0]);
                groupName = modelIds.length === 1 
                    ? (currentConfig.modelCustomNames?.[modelIds[0]] || firstModel?.label || `Group ${groupIndex}`)
                    : `Group ${groupIndex}`;
            }
            
            customGroupingState.groups.push({
                id: groupId,
                name: groupName,
                modelIds: modelIds
            });
            groupIndex++;
        }
        
        renderCustomGroupingContent();
        showToast(i18n['customGrouping.smartGroup'] + ': ' + customGroupingState.groups.length + ' groups', 'success');
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
            pinToggle.addEventListener('change', (e) => {
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
