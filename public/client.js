const socket = io();

const principles = [
    { id: "1", name: "科学性原则", relatedTo: ["4"], color: "#3b82f6" },
    { id: "2", name: "创新性原则", relatedTo: ["7", "3"], color: "#8b5cf6", conflict: true },
    { id: "3", name: "安全性原则", relatedTo: ["8", "2"], color: "#ef4444" },
    { id: "4", name: "实用性原则", relatedTo: ["6", "1", "9"], color: "#3b82f6" },
    { id: "5", name: "经济性原则", relatedTo: ["12", "7", "6"], color: "#10b981" },
    { id: "6", name: "可靠性和耐用性原则", relatedTo: ["4", "5"], color: "#3b82f6" },
    { id: "7", name: "标准化原则", relatedTo: ["5", "2"], color: "#10b981", conflict: true },
    { id: "8", name: "工程心理学和生理学原则", relatedTo: ["3"], color: "#ef4444" },
    { id: "9", name: "时效性原则", relatedTo: ["4"], color: "#f59e0b" },
    { id: "10", name: "最优化原则", relatedTo: [], color: "#6366f1" },
    { id: "11", name: "法律、道德规范原则", relatedTo: [], color: "#ec4899" },
    { id: "12", name: "可持续发展原则", relatedTo: ["5"], color: "#10b981" }
];

// Principle Relations (same as server-side)
const principleRelations = {
    strongGroups: [
        { ids: ['3', '8'], name: '安全与人体工学', emoji: '🛡️' },
        { ids: ['4', '6'], name: '实用与可靠', emoji: '⚙️' },
        { ids: ['5', '12'], name: '经济与可持续', emoji: '♻️' },
        { ids: ['1', '4'], name: '科学与实用', emoji: '🔬' },
        { ids: ['9', '4'], name: '时效与实用', emoji: '⏱️' },
        { ids: ['7', '5'], name: '标准化与经济', emoji: '📏' },
    ],
    conflictPairs: [
        { ids: ['2', '7'], name: '创新vs标准化', emoji: '⚡' },
        { ids: ['5', '6'], name: '经济vs可靠', emoji: '⚡' },
        { ids: ['2', '3'], name: '创新vs安全', emoji: '⚡' },
    ],
    // 新增：因果链定义
    causalChains: [
        { 
            ids: ['1', '4'], 
            name: '科学性→实用性', 
            emoji: '🔗',
            description: '不科学的设计必然导致不实用',
            example: '方形轮子违背力学原理，导致无法正常使用'
        },
        { 
            ids: ['3', '8'], 
            name: '安全性→工程心理学', 
            emoji: '🔗',
            description: '不安全的设计往往也不符合人体工学',
            example: '带刺饭盒既危险又难以使用'
        },
        { 
            ids: ['5', '12'], 
            name: '经济性→可持续性', 
            emoji: '🔗',
            description: '不经济的设计往往也不可持续',
            example: '一次性黄金手机壳既浪费金钱又浪费资源'
        },
        { 
            ids: ['4', '6'], 
            name: '实用性→可靠性', 
            emoji: '🔗',
            description: '不实用的产品通常也不可靠',
            example: '纸质雨衣既不实用又容易损坏'
        },
        { 
            ids: ['7', '5'], 
            name: '标准化→经济性', 
            emoji: '🔗',
            description: '不标准化会增加成本',
            example: '三角形充电线需要定制，成本高昂'
        },
        { 
            ids: ['9', '4'], 
            name: '时效性→实用性', 
            emoji: '🔗',
            description: '时效性差会影响实用性',
            example: '充电5分钟就没电的手电筒无法满足实际需求'
        }
    ]
};

// State
let myName = "";
let mySocketId = null;
let myPersonalStage = 'learning'; // Personal stage: learning, qualification, battle, failed
let myQualificationPassed = false; // Whether user has passed qualification
let allInventions = []; // All submitted inventions from server
let reviewedInventions = {}; // Track which inventions this user has already reviewed
let myReviewHistory = []; // Store user's review history with results

// DOM Elements
const screens = {
    login: document.getElementById('login-screen'),
    lobby: document.getElementById('lobby-screen'),
    learning: document.getElementById('learning-screen'),
    qualification: document.getElementById('qualification-screen'),
    failed: document.getElementById('failed-screen'),
    battle: document.getElementById('battle-screen'),
    result: document.getElementById('result-screen')
};

// --- Utilities ---
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">
            <h4 class="toast-title">${title}</h4>
            <p class="toast-message">${message.replace(/\n/g, '<br>')}</p>
        </div>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Remove toast after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out forwards';
        setTimeout(() => {
            if (container.contains(toast)) container.removeChild(toast);
        }, 300);
    }, 4000);
}

function showFloatingScore(elementId, scoreChange) {
    const targetEl = document.getElementById(elementId);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    const floatEl = document.createElement('div');
    
    const isPositive = scoreChange > 0;
    floatEl.className = `score-float ${isPositive ? 'positive' : 'negative'}`;
    floatEl.textContent = isPositive ? `+${scoreChange}` : scoreChange;
    
    // Position near the target element
    floatEl.style.left = `${rect.left + (rect.width / 2)}px`;
    floatEl.style.top = `${rect.top}px`;
    
    document.body.appendChild(floatEl);
    
    setTimeout(() => {
        if (document.body.contains(floatEl)) {
            document.body.removeChild(floatEl);
        }
    }, 1500);
}

// --- Login & Lobby ---
// Add Enter key support for login
document.getElementById('username')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        joinGame();
    }
});

function joinGame() {
    const name = document.getElementById('username').value.trim();
    if (!name) return showToast("错误", "请输入名字！", "error");
    myName = name;
    socket.emit('join', name);
    // Don't show lobby here - let server control the stage via updatePersonalStage event
}

// Complete learning phase
function completeLearning() {
    socket.emit('completeLearning');
    showToast("✅ 学习完成", "正在进入资格考试阶段...", "success");
}

// Restart learning after failure
function restartLearning() {
    myPersonalStage = 'learning';
    showScreen('learning');
    showToast("🔄 重新开始", "加油！这次一定能通过！", "info");
}

// Student request stage switch
function requestStageSwitch(targetStage) {
    const stageNames = {
        'learning': '学习阶段',
        'qualification': '考试阶段',
        'battle': '大乱斗'
    };
    
    if (confirm(`确定要切换到${stageNames[targetStage]}吗？\n\n需要满足前置条件才能切换。`)) {
        socket.emit('requestStageSwitch', { targetStage });
    }
}

// Go to battle directly if qualification passed
function goToBattle() {
    if (myQualificationPassed) {
        socket.emit('requestStageSwitch', { targetStage: 'battle' });
    } else {
        alert("⚠️ 需要先通过资格考试才能进入大乱斗！\n\n请先完成学习，然后参加考试。");
    }
}

socket.on('updateUserList', (users) => {
    const list = document.getElementById('user-list');
    document.getElementById('online-count').textContent = users.length;
    list.innerHTML = users.map(u => `<span class="user-tag">${u.name} ${u.qualificationPassed ? '✅' : ''}</span>`).join(' ');

    // Update my scores if I exist in the list
    if (myName) {
        const me = users.find(u => u.name === myName);
        if (me) {
            // Update qualification status
            myQualificationPassed = me.qualificationPassed;
            
            const exEl = document.getElementById('my-examiner-score');
            const invEl = document.getElementById('my-inventor-score');
            
            // Check if score changed and show animation
            if (exEl && parseInt(exEl.textContent) !== me.examinerScore) {
                const diff = me.examinerScore - parseInt(exEl.textContent);
                if (diff !== 0 && !isNaN(parseInt(exEl.textContent))) showFloatingScore('my-examiner-score', diff);
                exEl.textContent = me.examinerScore;
            }
            
            if (invEl && parseInt(invEl.textContent) !== me.inventorScore) {
                const diff = me.inventorScore - parseInt(invEl.textContent);
                if (diff !== 0 && !isNaN(parseInt(invEl.textContent))) showFloatingScore('my-inventor-score', diff);
                invEl.textContent = me.inventorScore;
            }
            
            // Update failed screen scores if on that screen
            const failedExEl = document.getElementById('failed-examiner-score');
            const failedInvEl = document.getElementById('failed-inventor-score');
            const failedTotalEl = document.getElementById('failed-total-score');
            
            if (failedExEl) failedExEl.textContent = me.examinerScore;
            if (failedInvEl) failedInvEl.textContent = me.inventorScore;
            if (failedTotalEl) failedTotalEl.textContent = me.examinerScore + me.inventorScore;
        }
    }
});

// --- Game State Management ---
socket.on('updatePersonalStage', (stage) => {
    console.log("Personal Stage Changed:", stage);
    myPersonalStage = stage;
    
    if (stage === 'learning') {
        showScreen('learning');
    } else if (stage === 'qualification') {
        showScreen('qualification');
    } else if (stage === 'battle') {
        console.log("Entering battle stage - forcing screen switch");
        showScreen('battle');
        // Force render inventions after a short delay to ensure DOM is ready
        setTimeout(() => {
            renderAllInventions();
        }, 100);
    } else if (stage === 'failed') {
        showScreen('failed');
    }
});

// Old gameState event (kept for compatibility)
socket.on('gameState', (state) => {
    console.log("Game State Changed:", state);
    if (state === 'lobby') showScreen('lobby');
    else if (state === 'learning') showScreen('learning');
    else if (state === 'qualification') showScreen('qualification');
    else if (state === 'battle') {
        showScreen('battle');
        // Re-render inventions when entering battle
        renderAllInventions();
    }
    else if (state === 'finished') showScreen('result');
});

socket.on('forcedToRelearn', (data) => {
    const { reason, currentScore, threshold } = data;
    showToast("⚠️ 积分过低", `你的积分（${currentScore}分）低于阈值（${threshold}分），需要重新学习！`, "error");
    myPersonalStage = 'failed';
    showScreen('failed');
});

socket.on('forceEnterBattle', () => {
    // Close any open modals when teacher forces battle start
    document.getElementById('review-modal').style.display = 'none';
    document.getElementById('appeal-reason-modal').style.display = 'none';
    document.getElementById('defense-modal').style.display = 'none';
    myPersonalStage = 'battle';
    showScreen('battle');
    renderAllInventions();
    showToast("⚠️ 强制进入大乱斗", "教师已开启大乱斗模式，立即进入战斗！", "warning");
});

socket.on('reset', () => {
    location.reload();
});

socket.on('systemMessage', (msg) => {
    showToast("📢 系统通知", msg, "info");
});

// Judgment Announcement - Show detailed verdict to all users
socket.on('judgmentAnnouncement', (result) => {
    showJudgmentModal(result);
});

// --- Qualification Phase ---
let currentTestType = 'basic'; // 'basic' or 'advanced'
let currentQuestions = [];

socket.on('qualificationQuestions', (data) => {
    console.log('Received qualificationQuestions:', data);
    const { type, questions } = data;
    currentTestType = type;
    currentQuestions = questions;
    
    // Make sure we're on the qualification screen
    if (myPersonalStage === 'qualification') {
        showScreen('qualification');
    }
    
    const container = document.getElementById('questions-container');
    const submitBtn = document.getElementById('submit-qualification-btn');
    
    console.log('Container:', container, 'Questions:', questions.length);
    
    if (type === 'basic') {
        // Basic test: single choice
        container.innerHTML = `
            <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3b82f6;">
                <h3 style="margin: 0 0 10px 0; color: #1e40af;">📝 基础资格考试（单选题）</h3>
                <p style="margin: 0; color: #475569;">答对 7 题或以上即可晋级！每题只能选择一个最主要违背的原则。</p>
            </div>
        ` + questions.map((q, idx) => `
            <div class="question-card" data-qid="${q.id}" data-type="single">
                <h3>第 ${idx+1} 题: ${q.title}</h3>
                <p style="font-size: 1.05rem; line-height: 1.6; color: #475569;">${q.desc}</p>
                <div style="margin-top: 15px;">
                    <p style="font-weight: 600; color: #1e293b; margin-bottom: 10px;">请选择最主要违背的原则：</p>
                    ${q.options.map(opt => `
                        <label style="display: block; padding: 12px; margin: 8px 0; background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#eff6ff'; this.style.borderColor='#3b82f6'" onmouseout="this.style.background='#f8fafc'; this.style.borderColor='#e2e8f0'">
                            <input type="radio" name="q${q.id}" value="${opt.id}" style="margin-right: 10px;">
                            <span style="font-size: 1rem;">${opt.id}. ${opt.text}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
        `).join('');
        
        submitBtn.textContent = '提交答卷';
        submitBtn.style.display = 'block';
        
    } else if (type === 'advanced') {
        // Advanced test: multiple choice
        container.innerHTML = `
            <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
                <h3 style="margin: 0 0 10px 0; color: #92400e;">🌟 进阶挑战（多选题）</h3>
                <p style="margin: 0; color: #78350f;">挑战更难的题目，答对可获得初始分数！每题可选择多个原则。</p>
            </div>
        ` + questions.map((q, idx) => `
            <div class="question-card" data-qid="${q.id}" data-type="multiple" style="border-left: 4px solid #f59e0b;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0;">第 ${idx+1} 题: ${q.title}</h3>
                    <span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: 600;">答对 +${q.bonus}分</span>
                </div>
                <p style="font-size: 1.05rem; line-height: 1.6; color: #475569;">${q.desc}</p>
                <div class="principles-grid" style="margin-top: 15px;">
                    ${principles.map(p => `
                        <label>
                            <input type="checkbox" name="q${q.id}" value="${p.id}">
                            ${p.id}.${p.name}
                        </label>
                    `).join('')}
                </div>
            </div>
        `).join('');
        
        submitBtn.textContent = '提交进阶测试';
        submitBtn.style.display = 'block';
    }
});

function submitQualification() {
    const cards = document.querySelectorAll('.question-card');
    const answers = {};
    
    cards.forEach(card => {
        const qid = card.dataset.qid;
        const type = card.dataset.type;
        
        if (type === 'single') {
            // Single choice: get selected radio button
            const selected = card.querySelector(`input[name="q${qid}"]:checked`);
            answers[qid] = selected ? selected.value : null;
        } else {
            // Multiple choice: get all checked checkboxes
            const checked = Array.from(card.querySelectorAll(`input[name="q${qid}"]:checked`)).map(cb => cb.value);
            answers[qid] = checked;
        }
    });

    socket.emit('submitQualification', { type: currentTestType, answers });
    
    // Disable submit button to prevent double submission
    const submitBtn = document.getElementById('submit-qualification-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
}

socket.on('qualificationResult', (res) => {
    if (res.success) {
        // Show success message with alert for better visibility
        alert(res.message);
        showToast("🎉 考试通过", "正在进入大乱斗...", "success");
        
        // Show advanced test option
        if (res.showAdvanced) {
            setTimeout(() => {
                const takeAdvanced = confirm("🌟 想要挑战进阶题目获得初始分数吗？\n\n进阶题目更难，但答对可以获得奖励分数！\n\n点击\"确定\"开始挑战，点击\"取消\"直接进入游戏。");
                
                if (takeAdvanced) {
                    // Request advanced questions
                    socket.emit('requestAdvancedTest');
                } else {
                    // User declined, make sure we're on battle screen
                    showScreen('battle');
                    renderAllInventions();
                }
            }, 500);
        }
    } else {
        // Show failure message with alert for better visibility
        alert(res.message);
        showToast("❌ 考试未通过", "请重新答题", "error");
        
        // Re-enable submit button
        const submitBtn = document.getElementById('submit-qualification-btn');
        submitBtn.disabled = false;
        submitBtn.textContent = '提交答卷';
    }
});

// Handle advanced test request
socket.on('requestAdvancedTest', () => {
    socket.emit('qualificationQuestions', { 
        type: 'advanced', 
        questions: advancedQualificationQuestions 
    });
});

// Handle advanced test result
socket.on('advancedTestResult', (res) => {
    showToast("🌟 进阶测试结果", res.message, "success");
    
    // Show final message
    setTimeout(() => {
        alert(`✨ 恭喜完成进阶测试！\n\n你已获得 ${res.bonusPoints} 分初始分数！\n\n准备好进入大乱斗了吗？`);
    }, 500);
});

// --- Battle Phase ---
// Initialize Principles Checkboxes for invention submission
function initBattlePrinciples() {
    const invGrid = document.getElementById('inv-principles');
    
    const html = principles.map(p => `
        <label>
            <input type="checkbox" value="${p.id}">
            ${p.id}.${p.name}
        </label>
    `).join('');

    if (invGrid) invGrid.innerHTML = html;
}
initBattlePrinciples();

// Inventor Logic
function submitInvention() {
    const title = document.getElementById('inv-title').value;
    const desc = document.getElementById('inv-desc').value;
    const trueAnswers = Array.from(document.querySelectorAll('#inv-principles input:checked')).map(cb => cb.value);

    if (!title || !desc || trueAnswers.length === 0) {
        return showToast("⚠️ 提示", "请填写完整信息并勾选至少一项违背原则！", "warning");
    }

    socket.emit('submitInvention', { title, desc, trueAnswers });
    
    // Clear inputs
    document.getElementById('inv-title').value = "";
    document.getElementById('inv-desc').value = "";
    document.querySelectorAll('#inv-principles input:checked').forEach(cb => cb.checked = false);
    
    document.getElementById('inv-status').textContent = "发明已提交！等待其他特工审查...";
    document.getElementById('inv-status').style.color = "blue";
}

socket.on('inventionResult', (res) => {
    const el = document.getElementById('inv-status');
    el.textContent = res.msg;
    el.style.color = res.success ? "green" : "red";
    if (res.success) {
        showToast("✅ 发明判定结果", res.msg, "success");
    } else {
        showToast("❌ 发明被识破", res.msg, "error");
    }
});

// Examiner Logic - Now shows ALL inventions for review
socket.on('updateAllInventions', (inventions) => {
    console.log('Received updateAllInventions:', inventions.length);
    allInventions = inventions;
    renderAllInventions();
});

// Also listen to updateInventions event
socket.on('updateInventions', (inventions) => {
    console.log('Received updateInventions:', inventions.length);
    allInventions = inventions;
    renderAllInventions();
});

// Also listen to old event for backward compatibility
socket.on('newReviewTask', (task) => {
    // Ignore old-style task assignments, we now show all inventions
    console.log('Received task (ignored, using all inventions view):', task);
});

function renderAllInventions() {
    const container = document.getElementById('all-inventions-container');
    const myContainer = document.getElementById('my-inventions-container');
    
    if (!container) {
        console.log('Container not found, skipping render');
        return;
    }
    
    console.log('renderAllInventions called, allInventions:', allInventions.length, 'myName:', myName);
    
    // 1. Render reviewable inventions (not mine, not reviewed yet)
    const reviewableInventions = allInventions.filter(inv => 
        inv.inventorName !== myName && !reviewedInventions[inv.id]
    );
    
    console.log('Reviewable inventions:', reviewableInventions.length);
    
    const countEl = document.getElementById('review-task-count');
    if (countEl) countEl.textContent = reviewableInventions.length;
    
    if (reviewableInventions.length === 0) {
        container.innerHTML = '<p id="no-inventions-msg" style="text-align: center; color: var(--gray); padding: 20px;">暂无可审查的发明，等待其他同学提交...</p>';
    } else {
        container.innerHTML = reviewableInventions.map(inv => `
            <div class="collapsed-patent-card" onclick="openReviewModal('${inv.id}')">
                <h4>🔧 ${inv.title}</h4>
                <span class="inventor-name">👤 ${inv.inventorName}</span>
            </div>
        `).join('');
    }
    
    // 2. Render my own inventions
    if (myContainer) {
        const myInventions = allInventions.filter(inv => inv.inventorName === myName);
        if (myInventions.length === 0) {
            myContainer.innerHTML = `
                <div style="text-align: center; padding: 20px 10px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
                    <span style="font-size: 2rem; display: block; margin-bottom: 10px; opacity: 0.5;">📭</span>
                    <p style="color: var(--gray); font-size: 0.9rem; margin: 0;">暂无提交，快去创造你的奇葩发明吧！</p>
                </div>
            `;
        } else {
            myContainer.innerHTML = myInventions.map(inv => `
                <div class="my-patent-card" style="background: linear-gradient(to right, #ffffff, #fef2f2); border-radius: 8px; padding: 12px 15px; margin-bottom: 10px; border-left: 4px solid var(--danger); box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: all 0.2s ease;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <h5 style="margin: 0; color: var(--dark); font-size: 1rem;">${inv.title}</h5>
                        <span style="font-size: 0.75rem; background: var(--danger); color: white; padding: 2px 6px; border-radius: 10px;">我的发明</span>
                    </div>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--gray); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${inv.desc}">${inv.desc}</p>
                </div>
            `).join('');
        }
    }
}

let currentReviewInventionId = null;

function openReviewModal(inventionId) {
    const inv = allInventions.find(i => i.id === inventionId);
    if (!inv) return;
    
    currentReviewInventionId = inventionId;
    
    // Populate modal data
    document.getElementById('review-modal-title').textContent = `🔧 ${inv.title}`;
    document.getElementById('review-modal-inventor').textContent = inv.inventorName;
    document.getElementById('review-modal-desc').textContent = inv.desc;
    
    // Generate principles checkboxes - use a common class instead of ID-specific
    const principlesContainer = document.getElementById('review-modal-principles');
    principlesContainer.innerHTML = principles.map(p => `
        <label class="principle-label" data-principle-id="${p.id}">
            <input type="checkbox" value="${p.id}" class="review-principle-cb" onchange="updateRelationHints()">
            ${p.id}. ${p.name}
        </label>
    `).join('');
    
    // Add relation hint container
    const hintContainer = document.createElement('div');
    hintContainer.id = 'relation-hints';
    hintContainer.style.cssText = 'margin-top: 15px; padding: 10px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid #3b82f6; display: none;';
    principlesContainer.parentNode.insertBefore(hintContainer, principlesContainer.nextSibling);
    
    // Show modal
    document.getElementById('review-modal').style.display = 'flex';
}

// Update relation hints when checkboxes change
function updateRelationHints() {
    const selectedIds = Array.from(document.querySelectorAll('#review-modal-principles .review-principle-cb:checked')).map(cb => cb.value);
    const hintContainer = document.getElementById('relation-hints');
    
    if (!hintContainer) return;
    
    let hints = [];
    let hasChain = false;
    
    // 优先检测因果链（最重要）
    principleRelations.causalChains.forEach(chain => {
        const selectedInChain = chain.ids.filter(id => selectedIds.includes(id));
        if (selectedInChain.length === chain.ids.length) {
            hints.unshift(`<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 12px; border-radius: 8px; margin-bottom: 10px;">
                <strong>${chain.emoji} 因果链识别！</strong><br>
                <span style="font-size: 0.95rem;">${chain.name}：${chain.description}</span><br>
                <span style="font-size: 0.85rem; opacity: 0.9;">💡 示例：${chain.example}</span><br>
                <span style="background: rgba(255,255,255,0.2); padding: 2px 8px; border-radius: 12px; font-size: 0.85rem; margin-top: 5px; display: inline-block;">答对可获得 +5分 额外奖励</span>
            </div>`);
            hasChain = true;
        } else if (selectedInChain.length > 0 && selectedInChain.length < chain.ids.length) {
            const missing = chain.ids.filter(id => !selectedIds.includes(id));
            hints.push(`<div style="background: #fef3c7; padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid #f59e0b;">
                <strong>${chain.emoji} 提示：</strong>你选了"${chain.name}"中的部分原则<br>
                <span style="font-size: 0.9rem; color: #92400e;">是否还违背了原则 ${missing.join(', ')}？</span>
            </div>`);
        }
    });
    
    // 检测强关联组（如果没有因果链）
    if (!hasChain) {
        principleRelations.strongGroups.forEach(group => {
            const selectedInGroup = group.ids.filter(id => selectedIds.includes(id));
            if (selectedInGroup.length > 0 && selectedInGroup.length < group.ids.length) {
                const missing = group.ids.filter(id => !selectedIds.includes(id));
                hints.push(`${group.emoji} 提示：你选了"${group.name}"中的部分原则，是否还违背了原则 ${missing.join(', ')}？`);
            } else if (selectedInGroup.length === group.ids.length) {
                hints.push(`<div style="background: #dbeafe; padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid #3b82f6;">
                    ${group.emoji} <strong>已识别"${group.name}"关联组！</strong>
                </div>`);
            }
        });
    }
    
    // 检测矛盾关联
    principleRelations.conflictPairs.forEach(pair => {
        const selectedInPair = pair.ids.filter(id => selectedIds.includes(id));
        if (selectedInPair.length === pair.ids.length) {
            hints.push(`<div style="background: #fef3c7; padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 4px solid #f59e0b;">
                ${pair.emoji} <strong>注意：</strong>你选择了矛盾关联"${pair.name}"<br>
                <span style="font-size: 0.9rem; color: #92400e;">这说明设计在权衡中做出了取舍</span>
            </div>`);
        }
    });
    
    if (hints.length > 0) {
        hintContainer.innerHTML = `
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #1e40af; font-size: 1.05rem;">💡 原则关联分析：</p>
            ${hints.join('')}
        `;
        hintContainer.style.display = 'block';
    } else if (selectedIds.length > 0) {
        hintContainer.innerHTML = `
            <p style="margin: 0; color: #64748b; font-size: 0.95rem;">
                已选择 ${selectedIds.length} 个原则。继续选择以发现原则之间的关联关系。
            </p>
        `;
        hintContainer.style.display = 'block';
    } else {
        hintContainer.style.display = 'none';
    }
}

// Close Review Modal
document.getElementById('close-review-modal').addEventListener('click', () => {
    document.getElementById('review-modal').style.display = 'none';
    currentReviewInventionId = null;
    document.getElementById('review-modal-comment').value = '';
    // Clear all checkboxes
    document.querySelectorAll('#review-modal-principles .review-principle-cb').forEach(cb => cb.checked = false);
});

document.getElementById('btn-submit-review').addEventListener('click', () => {
    console.log('提交审查按钮被点击');
    console.log('当前审查的发明ID:', currentReviewInventionId);
    if (!currentReviewInventionId) {
        console.error('错误：没有当前审查的发明ID');
        return;
    }
    submitInventionReview(currentReviewInventionId);
});

function submitInventionReview(inventionId) {
    console.log('submitInventionReview 被调用，inventionId:', inventionId);
    const inv = allInventions.find(i => i.id === inventionId);
    if (!inv) {
        console.error('错误：找不到发明', inventionId);
        return;
    }
    
    // Use the common class to select all checked checkboxes in the modal
    const selectedPrinciples = Array.from(document.querySelectorAll('#review-modal-principles .review-principle-cb:checked')).map(cb => cb.value);
    console.log('选中的原则:', selectedPrinciples);
    
    // In the new Modal logic, if selectedPrinciples is empty but we clicked submit, alert
    if (selectedPrinciples.length === 0) {
        showToast("⚠️ 提示", "请至少勾选一项违背的原则！", "warning");
        return;
    }
    
    const comment = document.getElementById('review-modal-comment').value.trim();
    console.log('评论:', comment);
    
    console.log('发送 submitInventionReview 事件到服务器');
    socket.emit('submitInventionReview', {
        inventionId: inventionId,
        selectedPrinciples: selectedPrinciples,
        comment: comment
    });

    // Mark as reviewed locally
    reviewedInventions[inventionId] = true;
    
    // Close modal and reset
    document.getElementById('review-modal').style.display = 'none';
    currentReviewInventionId = null;
    document.getElementById('review-modal-comment').value = '';
    // Clear all checkboxes
    document.querySelectorAll('#review-modal-principles .review-principle-cb').forEach(cb => cb.checked = false);
    
    renderAllInventions();
}

// Appeal Logic
let lastReviewFailId = null;

function submitAppeal() {
    if (!lastReviewFailId) return;
    document.getElementById('appeal-reason-modal').style.display = 'flex';
}

function closeAppealModal() {
    document.getElementById('appeal-reason-modal').style.display = 'none';
    document.getElementById('appeal-reason-text').value = '';
}

function confirmSubmitAppeal() {
    const reason = document.getElementById('appeal-reason-text').value.trim();
    if (!reason) {
        showToast("⚠️ 提示", "请输入申诉理由！这是你翻盘的关键。", "warning");
        return;
    }
    
    socket.emit('submitAppeal', { 
        reviewId: lastReviewFailId,
        reason: reason
    });
    
    document.getElementById('btn-appeal').style.display = 'none';
    closeAppealModal();
}

socket.on('appealSubmitted', (res) => {
    showToast("✅ 申诉已提交", res.msg, "success");
    const el = document.getElementById('review-status');
    el.textContent += " [申诉中...]";
});

socket.on('appealResult', (res) => {
    showToast(res.success ? "🎉 申诉结果" : "⚖️ 申诉结果", res.msg, res.success ? "success" : "error");
});

// Defense Logic
let currentDefenseAppealId = null;

socket.on('requestDefense', (data) => {
    currentDefenseAppealId = data.appealId;
    // Show modal
    document.getElementById('defense-modal').style.display = 'flex';
});

function closeDefenseModal() {
    document.getElementById('defense-modal').style.display = 'none';
    document.getElementById('defense-text').value = '';
    currentDefenseAppealId = null;
}

function confirmSubmitDefense() {
    const defense = document.getElementById('defense-text').value.trim();
    if (!defense) {
        showToast("⚠️ 提示", "请认真填写你的辩护词！否则很有可能会败诉。", "warning");
        return;
    }
    
    socket.emit('submitDefense', {
        appealId: currentDefenseAppealId,
        defense: defense
    });
    
    closeDefenseModal();
}

socket.on('reviewResult', (res) => {
    const el = document.getElementById('review-status');
    
    // Display result with relation bonus if present
    let displayMsg = res.msg;
    if (res.relationBonus && res.relationBonus.bonus > 0) {
        displayMsg += `\n${res.relationBonus.reasons.join('\n')}`;
    }
    if (res.correct) {
        displayMsg += `\n正确答案: ${res.correct.join(', ')}`;
    }
    
    el.textContent = displayMsg;
    el.style.color = res.success ? "green" : "red";
    
    // Show toast for relation bonus
    if (res.success && res.relationBonus && res.relationBonus.bonus > 0) {
        showToast("🎯 关联奖励", res.relationBonus.reasons.join('\n'), "success");
    }
    
    // Show Appeal Button if failed
    const appealBtn = document.getElementById('btn-appeal');
    if (!res.success && res.reviewId) {
        lastReviewFailId = res.reviewId;
        appealBtn.style.display = 'inline-block';
    } else {
        appealBtn.style.display = 'none';
        lastReviewFailId = null;
    }
    
    // Add to review history
    const reviewedInv = allInventions.find(inv => inv.id === res.inventionId);
    if (reviewedInv) {
        myReviewHistory.push({
            inventionId: res.inventionId,
            invention: reviewedInv,
            success: res.success,
            score: res.score,
            reviewId: res.reviewId,
            correct: res.correct || null,
            relationBonus: res.relationBonus || null,
            timestamp: Date.now()
        });
        renderReviewHistory();
    }
});

// Rankings & Scores
socket.on('rankings', (data) => {
    // Update my scores
    const myData = [...data.examinerRank, ...data.inventorRank].find(u => u.name === myName); // Heuristic search, better if by ID but client doesn't know ID easily without handshake.
    // Actually, server sends full list? No, server sends top 5.
    // Let's rely on server sending my specific score if needed, but for now we might miss it if not in top 5.
    // Ideally we should listen to a 'myScore' event or include it in heartbeat.
    // For simplicity, we just look at the ranks.
    
    const exList = document.getElementById('rank-examiner');
    exList.innerHTML = data.examinerRank.map(u => `<li>${u.name}: ${u.examinerScore}</li>`).join('');
    
    const invList = document.getElementById('rank-inventor');
    invList.innerHTML = data.inventorRank.map(u => `<li>${u.name}: ${u.inventorScore}</li>`).join('');

    // Update final screen
    document.getElementById('final-examiner-rank').innerHTML = data.examinerRank.map((u, i) => `<li>${i+1}. ${u.name} (${u.examinerScore}分)</li>`).join('');
    document.getElementById('final-inventor-rank').innerHTML = data.inventorRank.map((u, i) => `<li>${i+1}. ${u.name} (${u.inventorScore}分)</li>`).join('');
});

// --- Jury Voting System ---
let activeJuryVotings = [];

socket.on('updateJuryVotings', (votings) => {
    activeJuryVotings = votings;
    renderCourtCases();
});

socket.on('juryVotingUpdate', (data) => {
    // Update local state if needed, then re-render
    const v = activeJuryVotings.find(v => v.id === data.votingId || v.appealId === data.appealId);
    if (v) {
        v.voteCount = data.voteCount;
        v.totalVotes = data.totalVotes;
        v.status = data.status;
        renderCourtCases();
    }
});

function formatPrinciplesForCourt(ids) {
    const map = {
        "1": "科学性", "2": "创新性", "3": "安全性", "4": "实用性", 
        "5": "经济性", "6": "可靠性", "7": "标准化", "8": "工程心理", 
        "9": "时效性", "10": "最优化", "11": "法律道德", "12": "可持续"
    };
    return ids.map(id => `<span class="court-capsule">${map[id] || id}</span>`).join('');
}

function renderCourtCases() {
    const container = document.getElementById('active-court-cases');
    if (!container) return;

    if (activeJuryVotings.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--gray); padding: 20px;">天下太平，暂无冤假错案。</p>';
        return;
    }

    container.innerHTML = activeJuryVotings.map(v => {
        const appeal = v.appeal;
        if (!appeal) return '';
        
        const isResolved = v.status === 'resolved';
        const isClosed = v.status === 'closed' || isResolved;
        const hasVoted = v.votes && Object.keys(v.votes).some(voterId => voterId === socket.id);
        const canVote = !isClosed && !hasVoted && appeal.appellantId !== socket.id && appeal.invention.inventorId !== socket.id;
        
        // Check if current user has reviewed this invention
        const hasReviewed = reviewedInventions[appeal.invention.id] || false;
        
        const supportEx = v.voteCount?.supportExaminer || 0;
        const supportInv = v.voteCount?.supportInventor || 0;
        const totalVotes = supportEx + supportInv;
        
        const myRoleMsg = (appeal.appellantId === socket.id) ? '(你是原告, 无法投票)' : ((appeal.invention.inventorId === socket.id) ? '(你是被告, 无法投票)' : '');
        
        // Calculate remaining time
        let remainingTime = '';
        if (!isClosed && v.endTime) {
            const remaining = Math.max(0, v.endTime - Date.now());
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            remainingTime = `⏰ 剩余时间: ${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        let statusBadge = '';
        let statusColor = '';
        if (isResolved) {
            const winner = v.finalDecision === 'overturn' ? '审查官胜诉' : '发明家胜诉';
            statusBadge = `⚖️ 已裁决: ${winner}`;
            statusColor = v.finalDecision === 'overturn' ? '#3b82f6' : '#ef4444';
        } else if (isClosed) {
            statusBadge = '⏸️ 已结案';
            statusColor = '#64748b';
        } else {
            statusBadge = '🟢 投票中';
            statusColor = 'var(--purple)';
        }

        return `
            <div class="court-case-card" style="background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 15px; box-shadow: var(--shadow-sm); border-left: 4px solid ${isResolved ? statusColor : 'var(--purple)'};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <span style="font-weight: bold; color: var(--dark);">案号 #${v.id.substring(0, 8)}</span>
                    <span style="font-size: 0.85rem; padding: 4px 10px; border-radius: 20px; background: ${isResolved ? statusColor + '20' : (isClosed ? '#f1f5f9' : '#faf5ff')}; color: ${statusColor}; font-weight: 600;">${statusBadge}</span>
                </div>
                
                ${!isClosed && remainingTime ? `<div style="text-align: center; background: #fef3c7; padding: 8px; border-radius: 6px; margin-bottom: 10px; font-weight: 600; color: #92400e;">${remainingTime}</div>` : ''}
                
                <p style="margin: 5px 0; font-size: 0.95rem;"><b>🕵️ 原告(审查官):</b> ${appeal.appellantName}</p>
                ${appeal.reason ? `<div style="background: #fee2e2; padding: 8px 12px; border-radius: 6px; margin: 5px 0 15px; font-size: 0.85rem; color: #b91c1c; border-left: 3px solid #ef4444;"><b>控告理由:</b> ${appeal.reason}</div>` : ''}
                
                <p style="margin: 5px 0; font-size: 0.95rem;"><b>🤡 被告(发明家):</b> ${appeal.invention.inventorName}</p>
                ${appeal.defense ? 
                    `<div style="background: #e0f2fe; padding: 8px 12px; border-radius: 6px; margin: 5px 0 15px; font-size: 0.85rem; color: #0369a1; border-left: 3px solid #0ea5e9;"><b>辩护陈词:</b> ${appeal.defense}</div>` : 
                    `<div style="background: #f1f5f9; padding: 8px 12px; border-radius: 6px; margin: 5px 0 15px; font-size: 0.85rem; color: #64748b; border-left: 3px solid #cbd5e1; font-style: italic;">⏳ 被告正在紧急构思辩护词...</div>`
                }
                
                <h4 style="color: var(--primary); margin: 10px 0;">🔧 ${appeal.invention.title}</h4>
                <p style="font-size: 0.9rem; color: #475569; background: #f8fafc; padding: 10px; border-radius: 8px;">${appeal.invention.desc}</p>
                
                <div style="margin: 15px 0; font-size: 0.9rem;">
                    <p><b>❌ 审查官判决:</b> <br> ${formatPrinciplesForCourt(appeal.examinerAnswers) || '未选'}</p>
                    ${hasReviewed ? 
                        `<p style="margin-top: 8px;"><b>✅ 发明家标准:</b> <br> ${formatPrinciplesForCourt(appeal.trueAnswers) || '未选'}</p>` :
                        `<p style="margin-top: 8px; color: #94a3b8; font-style: italic;"><b>🔒 发明家标准:</b> 仅审查过此发明的人可见</p>`
                    }
                </div>
                
                <div style="background: ${isResolved ? statusColor + '10' : '#f8fafc'}; padding: 12px; border-radius: 8px; margin-top: 15px; ${isResolved ? 'border: 2px solid ' + statusColor : ''};">
                    <div style="text-align: center; margin-bottom: 12px;">
                        <p style="font-size: 0.9rem; color: #64748b; margin: 0 0 8px 0;">📊 实时投票结果（共${totalVotes}票）</p>
                        <div style="display: flex; gap: 15px; justify-content: center; align-items: center;">
                            <div style="text-align: center;">
                                <div style="font-size: 1.8rem; font-weight: bold; color: var(--primary);">${supportEx}</div>
                                <div style="font-size: 0.85rem; color: #64748b;">支持审查官</div>
                            </div>
                            <div style="font-size: 1.5rem; color: #cbd5e1;">VS</div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.8rem; font-weight: bold; color: var(--danger);">${supportInv}</div>
                                <div style="font-size: 0.85rem; color: #64748b;">支持发明家</div>
                            </div>
                        </div>
                        
                        <!-- Progress bar -->
                        ${totalVotes > 0 ? `
                            <div style="margin-top: 10px; background: #e2e8f0; height: 8px; border-radius: 4px; overflow: hidden;">
                                <div style="height: 100%; background: linear-gradient(90deg, var(--primary) 0%, var(--danger) 100%); width: ${(supportEx / totalVotes * 100)}%; transition: width 0.3s;"></div>
                            </div>
                        ` : ''}
                    </div>
                    
                    ${canVote ? `
                        <div style="display: flex; gap: 10px; margin-top: 10px;">
                            <button onclick="voteJuryInline('${v.id}', 'support_examiner')" style="flex: 1; padding: 10px; font-size: 0.95rem; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">投给审查官</button>
                            <button onclick="voteJuryInline('${v.id}', 'support_inventor')" style="flex: 1; padding: 10px; font-size: 0.95rem; background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">投给发明家</button>
                        </div>
                    ` : `
                        <p style="font-size: 0.9rem; color: ${isResolved ? statusColor : '#64748b'}; margin: 10px 0 0 0; text-align: center; font-weight: ${isResolved ? '600' : 'normal'};">
                            ${isResolved ? (v.finalDecision === 'overturn' ? '🎉 最终判决：审查官胜诉！' : '🎉 最终判决：发明家胜诉！') : (isClosed ? '⏸️ 投票已结束，等待教师裁决' : (hasVoted ? '✅ 你已完成投票，等待其他陪审员' : myRoleMsg))}
                        </p>
                    `}
                </div>
            </div>
        `;
    }).join('');
    
    // Update countdown every second for active votings
    if (activeJuryVotings.some(v => v.status === 'active')) {
        setTimeout(() => renderCourtCases(), 1000);
    }
}

function voteJuryInline(votingId, vote) {
    socket.emit('submitJuryVote', {
        votingId: votingId,
        vote: vote
    });
}

// Render Review History
function renderReviewHistory() {
    const container = document.getElementById('review-history-container');
    
    if (myReviewHistory.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--gray); padding: 10px; font-size: 0.9rem;">暂无审查记录</p>';
        return;
    }
    
    // Sort by timestamp descending (newest first)
    const sortedHistory = [...myReviewHistory].sort((a, b) => b.timestamp - a.timestamp);
    
    container.innerHTML = sortedHistory.map(record => {
        const statusIcon = record.success ? '✅' : '❌';
        const statusText = record.success ? '判定正确' : '判定失误';
        const statusColor = record.success ? 'green' : 'red';
        const scoreText = record.score >= 0 ? `+${record.score}` : `${record.score}`;
        
        let appealButton = '';
        if (!record.success && record.reviewId) {
            appealButton = `<button class="btn-history-appeal" onclick="appealFromHistory('${record.reviewId}')">📢 提交申诉</button>`;
        }
        
        // Show relation bonus if present
        let bonusInfo = '';
        if (record.relationBonus && record.relationBonus.bonus > 0) {
            bonusInfo = `<p style="margin: 5px 0; font-size: 0.85rem; color: #3b82f6; background: #eff6ff; padding: 5px 8px; border-radius: 4px;">
                <strong>🎯 关联奖励:</strong> ${record.relationBonus.reasons.join('、')}
            </p>`;
        }
        
        return `
            <div class="review-history-card" style="background: white; border-radius: 8px; padding: 12px; margin-bottom: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <h5 style="margin: 0; font-size: 0.95rem; color: var(--dark);">${statusIcon} ${record.invention.title}</h5>
                    <span style="font-weight: bold; color: ${statusColor};">${scoreText}分</span>
                </div>
                <p style="margin: 5px 0; font-size: 0.85rem; color: var(--gray);">
                    <strong>发明者:</strong> ${record.invention.inventorName}
                </p>
                <p style="margin: 5px 0; font-size: 0.85rem; color: ${statusColor};">
                    <strong>结果:</strong> ${statusText}
                </p>
                ${record.correct ? `<p style="margin: 5px 0; font-size: 0.85rem; color: var(--gray);"><strong>正确答案:</strong> ${record.correct.join(', ')}</p>` : ''}
                ${bonusInfo}
                ${appealButton}
            </div>
        `;
    }).join('');
}

function appealFromHistory(reviewId) {
    lastReviewFailId = reviewId;
    document.getElementById('appeal-reason-modal').style.display = 'flex';
}

// Ensure mySocketId is captured when connected
socket.on('connect', () => {
    mySocketId = socket.id;
});

// Sync reviewed inventions from server
socket.on('syncReviewedInventions', (reviewedList) => {
    reviewedList.forEach(invId => {
        reviewedInventions[invId] = true;
    });
    renderAllInventions();
});

// Deprecate the old Jury Modal logic since we now have inline voting in the panel
// Kept empty intentionally or can remove old jury modal code
socket.on('juryInvitation', (data) => {
    // Optionally trigger a subtle notification that a new court case has opened
    const btn = document.querySelector('.court-panel h3');
    if(btn) {
        btn.innerHTML = '⚖️ 最高法庭陪审团 <span style="color:red; font-size:0.8em;">(新案件!)</span>';
        setTimeout(() => { btn.innerHTML = '⚖️ 最高法庭陪审团'; }, 5000);
    }
});

// Helper
function showScreen(id) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[id].classList.add('active');
}

// Show judgment announcement modal
function showJudgmentModal(result) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px; animation: fadeIn 0.3s;';
    
    const winnerColor = result.winner === 'examiner' ? '#3b82f6' : '#ef4444';
    const winnerIcon = result.winner === 'examiner' ? '🕵️' : '🤡';
    const winnerText = result.winner === 'examiner' ? '审查官胜诉' : '发明家胜诉';
    
    // Format principles
    const formatPrinciples = (ids) => {
        const map = {
            "1": "科学性", "2": "创新性", "3": "安全性", "4": "实用性", 
            "5": "经济性", "6": "可靠性", "7": "标准化", "8": "工程心理", 
            "9": "时效性", "10": "最优化", "11": "法律道德", "12": "可持续"
        };
        return ids.map(id => `${id}.${map[id] || id}`).join(', ');
    };
    
    // Jury rewards section
    let jurySection = '';
    if (result.juryRewards && result.juryRewards.length > 0) {
        jurySection = `
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-top: 20px;">
                <h3 style="margin: 0 0 10px 0; color: #475569;">👥 陪审团奖惩</h3>
                <div style="max-height: 150px; overflow-y: auto;">
                    ${result.juryRewards.map(jr => `
                        <div style="padding: 8px; margin: 5px 0; background: ${jr.isCorrect ? '#d1fae5' : '#fee2e2'}; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #1e293b;">${jr.jurorName}</span>
                            <span style="font-weight: 600; color: ${jr.isCorrect ? '#059669' : '#dc2626'};">
                                ${jr.isCorrect ? '✅ 正确' : '❌ 错误'} ${jr.reward > 0 ? '+' : ''}${jr.reward}分
                            </span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    // Vote count section
    let voteSection = '';
    if (result.voteCount) {
        const total = result.voteCount.supportExaminer + result.voteCount.supportInventor;
        voteSection = `
            <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin-top: 20px; border-left: 4px solid #3b82f6;">
                <h3 style="margin: 0 0 10px 0; color: #1e40af;">📊 陪审团投票结果</h3>
                <div style="display: flex; justify-content: space-around; text-align: center;">
                    <div>
                        <div style="font-size: 2rem; font-weight: bold; color: var(--primary);">${result.voteCount.supportExaminer}</div>
                        <div style="font-size: 0.9rem; color: #64748b;">支持审查官</div>
                    </div>
                    <div style="font-size: 1.5rem; color: #cbd5e1;">VS</div>
                    <div>
                        <div style="font-size: 2rem; font-weight: bold; color: var(--danger);">${result.voteCount.supportInventor}</div>
                        <div style="font-size: 0.9rem; color: #64748b;">支持发明家</div>
                    </div>
                </div>
                <div style="margin-top: 10px; background: #e2e8f0; height: 10px; border-radius: 5px; overflow: hidden;">
                    <div style="height: 100%; background: linear-gradient(90deg, var(--primary) 0%, var(--danger) 100%); width: ${total > 0 ? (result.voteCount.supportExaminer / total * 100) : 50}%; transition: width 0.3s;"></div>
                </div>
            </div>
        `;
    }
    
    modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 700px; max-height: 90vh; overflow-y: auto; padding: 0; position: relative; box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: slideUp 0.3s;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, ${winnerColor} 0%, ${winnerColor}dd 100%); padding: 25px; border-radius: 16px 16px 0 0; color: white; text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 10px;">${winnerIcon}</div>
                <h2 style="margin: 0 0 10px 0; font-size: 1.8rem;">⚖️ 审判结果公告</h2>
                <div style="font-size: 1.3rem; font-weight: 600; background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 20px; display: inline-block;">
                    ${winnerText}
                </div>
            </div>
            
            <!-- Content -->
            <div style="padding: 25px;">
                <!-- Case Info -->
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <p style="margin: 0 0 5px 0; color: #64748b; font-size: 0.9rem;">案号 #${result.caseNumber}</p>
                    <h3 style="margin: 0; color: #1e293b;">🔧 ${result.invention.title}</h3>
                    <p style="margin: 10px 0 0 0; color: #475569; font-size: 0.95rem;">${result.invention.desc}</p>
                </div>
                
                <!-- Parties -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                    <div style="background: #eff6ff; padding: 15px; border-radius: 8px; border-left: 4px solid #3b82f6;">
                        <h4 style="margin: 0 0 10px 0; color: #1e40af;">🕵️ 原告（审查官）</h4>
                        <p style="margin: 0 0 5px 0; font-weight: 600; color: #1e293b;">${result.appellant.name}</p>
                        <p style="margin: 0; font-size: 0.85rem; color: #64748b;"><strong>判决：</strong>${formatPrinciples(result.appellant.answers)}</p>
                        ${result.reason ? `<p style="margin: 10px 0 0 0; font-size: 0.85rem; color: #475569; background: white; padding: 8px; border-radius: 4px;"><strong>理由：</strong>${result.reason}</p>` : ''}
                    </div>
                    
                    <div style="background: #fef2f2; padding: 15px; border-radius: 8px; border-left: 4px solid #ef4444;">
                        <h4 style="margin: 0 0 10px 0; color: #991b1b;">🤡 被告（发明家）</h4>
                        <p style="margin: 0 0 5px 0; font-weight: 600; color: #1e293b;">${result.inventor.name}</p>
                        <p style="margin: 0; font-size: 0.85rem; color: #64748b;"><strong>标准：</strong>${formatPrinciples(result.inventor.answers)}</p>
                        ${result.defense ? `<p style="margin: 10px 0 0 0; font-size: 0.85rem; color: #475569; background: white; padding: 8px; border-radius: 4px;"><strong>辩护：</strong>${result.defense}</p>` : ''}
                    </div>
                </div>
                
                <!-- Verdict -->
                <div style="background: ${winnerColor}15; padding: 20px; border-radius: 8px; border: 2px solid ${winnerColor}; margin-bottom: 20px; text-align: center;">
                    <h3 style="margin: 0 0 10px 0; color: ${winnerColor};">📜 ${result.judge}判决</h3>
                    <p style="margin: 0; font-size: 1.1rem; color: #1e293b; line-height: 1.6;">${result.verdict}</p>
                </div>
                
                <!-- Rewards/Penalties -->
                <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                    <h3 style="margin: 0 0 10px 0; color: #92400e;">💰 奖惩结果</h3>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span style="color: #78350f;">原告（审查官）：</span>
                        <span style="font-weight: 600; color: ${result.appellantReward > 0 ? '#059669' : '#dc2626'};">
                            ${result.appellantReward > 0 ? '+' : ''}${result.appellantReward}分
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: #78350f;">被告（发明家）：</span>
                        <span style="font-weight: 600; color: ${result.inventorPenalty > 0 ? '#059669' : '#dc2626'};">
                            ${result.inventorPenalty > 0 ? '+' : ''}${result.inventorPenalty}分
                        </span>
                    </div>
                </div>
                
                ${voteSection}
                ${jurySection}
                
                <!-- Close Button -->
                <div style="text-align: center; margin-top: 25px;">
                    <button onclick="this.closest('div[style*=fixed]').remove()" style="padding: 12px 40px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);">
                    知道了
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Auto remove after 30 seconds
    setTimeout(() => {
        if (document.body.contains(modal)) {
            modal.style.animation = 'fadeOut 0.3s';
            setTimeout(() => {
                if (document.body.contains(modal)) {
                    document.body.removeChild(modal);
                }
            }, 300);
        }
    }, 30000);
}

// Show game rules modal
function showGameRules() {
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px;';
    
    modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 800px; max-height: 90vh; overflow-y: auto; padding: 30px; position: relative;">
            <button onclick="this.closest('div[style*=fixed]').remove()" style="position: absolute; top: 15px; right: 15px; background: #e2e8f0; border: none; width: 35px; height: 35px; border-radius: 50%; cursor: pointer; font-size: 1.2rem; color: #475569;">×</button>
            
            <h2 style="margin: 0 0 20px 0; color: #1e293b;">📋 游戏规则速览</h2>
            
            <div style="background: #eff6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #3b82f6;">
                <h3 style="margin: 0 0 10px 0; color: #1e40af;">🎯 游戏目标</h3>
                <p style="margin: 0; color: #475569;">通过审查发明和创造发明，获得最高分数！</p>
            </div>
            
            <h3 style="color: #1e293b; margin: 20px 0 10px 0;">📊 计分规则</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr style="background: #f8fafc;">
                    <th style="padding: 10px; text-align: left; border: 1px solid #e2e8f0;">行为</th>
                    <th style="padding: 10px; text-align: center; border: 1px solid #e2e8f0;">得分</th>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">审查判定正确（基础）</td>
                    <td style="padding: 10px; text-align: center; border: 1px solid #e2e8f0; color: #10b981; font-weight: 600;">+12分</td>
                </tr>
                <tr style="background: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">识别因果链（额外）</td>
                    <td style="padding: 10px; text-align: center; border: 1px solid #e2e8f0; color: #10b981; font-weight: 600;">+5分</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">识别强关联（额外）</td>
                    <td style="padding: 10px; text-align: center; border: 1px solid #e2e8f0; color: #10b981; font-weight: 600;">+2-3分</td>
                </tr>
                <tr style="background: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">审查判定错误</td>
                    <td style="padding: 10px; text-align: center; border: 1px solid #e2e8f0; color: #ef4444; font-weight: 600;">-3分</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">发明骗过审查官</td>
                    <td style="padding: 10px; text-align: center; border: 1px solid #e2e8f0; color: #10b981; font-weight: 600;">+12分</td>
                </tr>
            </table>
            
            <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
                <h3 style="margin: 0 0 10px 0; color: #92400e;">🔗 关键：识别因果链</h3>
                <p style="margin: 0; color: #78350f; line-height: 1.6;">
                    当你正确识别出原则之间的因果关系时，可获得额外+5分！<br>
                    例如：科学性→实用性、安全性→工程心理学等
                </p>
            </div>
            
            <h3 style="color: #1e293b; margin: 20px 0 10px 0;">💡 策略建议</h3>
            <ul style="color: #475569; line-height: 1.8; padding-left: 20px;">
                <li><strong>新手推荐：</strong>主打审查，稳定得分</li>
                <li><strong>进阶玩家：</strong>审查+发明平衡，最大化收益</li>
                <li><strong>高手技巧：</strong>识别因果链，每次多得5分</li>
            </ul>
            
            <div style="text-align: center; margin-top: 25px;">
                <button onclick="this.closest('div[style*=fixed]').remove()" style="padding: 12px 30px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer;">
                    我知道了
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

