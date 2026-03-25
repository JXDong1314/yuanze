const socket = io();

// Admin Connect - join to receive inventions list
socket.emit('join', 'ADMIN');

socket.on('updateUserList', (users) => {
    document.getElementById('online-count').textContent = users.length;
    const list = document.getElementById('user-list');
    
    const stageIcons = {
        'learning': '🎓 学习中',
        'qualification': '📝 考试中',
        'battle': '⚔️ 战斗中',
        'failed': '❌ 需重学'
    };
    
    const stageColors = {
        'learning': '#3b82f6',
        'qualification': '#f59e0b',
        'battle': '#10b981',
        'failed': '#ef4444'
    };
    
    list.innerHTML = users.map(u => {
        const totalScore = u.examinerScore + u.inventorScore;
        const stageText = stageIcons[u.personalStage] || u.personalStage;
        const stageColor = stageColors[u.personalStage] || '#64748b';
        
        return `
            <div style="padding: 15px; border-bottom: 1px solid #e2e8f0; background: ${totalScore < -10 ? '#fee2e2' : '#fff'};">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div>
                        <span style="font-weight: 600; color: var(--dark); font-size: 1.05rem;">${u.name}</span>
                        <span style="margin-left: 10px; background: ${stageColor}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.85rem;">${stageText}</span>
                    </div>
                    <div style="font-size: 0.95rem;">
                        <span style="color: var(--primary);">🕵️ ${u.examinerScore}</span>
                        <span style="color: #cbd5e1; margin: 0 5px;">|</span>
                        <span style="color: var(--danger);">🤡 ${u.inventorScore}</span>
                        <span style="color: #cbd5e1; margin: 0 5px;">|</span>
                        <span style="font-weight: 600; color: ${totalScore < 0 ? '#ef4444' : '#10b981'};">总: ${totalScore}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 5px; margin-bottom: 5px;">
                    <button onclick="forceStage('${u.id}', 'learning')" style="flex: 1; padding: 5px; font-size: 0.85rem; background: #e0f2fe; color: #0369a1; border: none; border-radius: 4px; cursor: pointer;">学习</button>
                    <button onclick="forceStage('${u.id}', 'qualification')" style="flex: 1; padding: 5px; font-size: 0.85rem; background: #fef3c7; color: #92400e; border: none; border-radius: 4px; cursor: pointer;">考试</button>
                    <button onclick="forceStage('${u.id}', 'battle')" style="flex: 1; padding: 5px; font-size: 0.85rem; background: #d1fae5; color: #065f46; border: none; border-radius: 4px; cursor: pointer;">大乱斗</button>
                </div>
                <div style="display: flex; gap: 5px;">
                    <button onclick="punishStudent('${u.id}', '${u.name}')" style="flex: 1; padding: 5px; font-size: 0.8rem; background: #fee2e2; color: #991b1b; border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">⚠️ 惩罚</button>
                    <button onclick="muteStudent('${u.id}', '${u.name}')" style="flex: 1; padding: 5px; font-size: 0.8rem; background: #fef3c7; color: #92400e; border: none; border-radius: 4px; cursor: pointer;">🔇 禁言</button>
                    <button onclick="clearScore('${u.id}', '${u.name}')" style="flex: 1; padding: 5px; font-size: 0.8rem; background: #ffe4e6; color: #be123c; border: none; border-radius: 4px; cursor: pointer;">🗑️ 清分</button>
                </div>
            </div>
        `;
    }).join('');
});

socket.on('gameState', (state) => {
    document.getElementById('game-state').textContent = state.toUpperCase();
});

socket.on('rankings', (data) => {
    document.getElementById('admin-examiner-rank').innerHTML = data.examinerRank.map((u, i) => `<li>${i+1}. <b>${u.name}</b>: ${u.examinerScore}分</li>`).join('');
    document.getElementById('admin-inventor-rank').innerHTML = data.inventorRank.map((u, i) => `<li>${i+1}. <b>${u.name}</b>: ${u.inventorScore}分</li>`).join('');
});

const principlesMap = {
    "1": "科学性", "2": "创新性", "3": "安全性", "4": "实用性", 
    "5": "经济性", "6": "可靠性", "7": "标准化", "8": "工程心理", 
    "9": "时效性", "10": "最优化", "11": "法律道德", "12": "可持续"
};

function formatPrinciples(ids) {
    return ids.map(id => `${id}.${principlesMap[id] || id}`).join(', ');
}

let currentJuryVotings = {};

socket.on('updateAppeals', (appeals) => {
    const list = document.getElementById('appeals-list');
    if (appeals.length === 0) {
        list.innerHTML = "<p>暂无申诉案件。</p>";
        return;
    }
    
    // Separate active and resolved appeals
    const activeAppeals = appeals.filter(a => a.status !== 'resolved');
    const resolvedAppeals = appeals.filter(a => a.status === 'resolved');
    
    let html = '';
    
    // Show active appeals first
    if (activeAppeals.length > 0) {
        html += '<h3 style="color: var(--primary); margin: 20px 0 15px 0; font-size: 1.2rem;">🔥 进行中的案件</h3>';
        html += activeAppeals.map(a => renderAppealCard(a, false)).join('');
    }
    
    // Show resolved appeals as history
    if (resolvedAppeals.length > 0) {
        html += '<h3 style="color: var(--gray); margin: 30px 0 15px 0; font-size: 1.2rem;">📜 历史裁决记录</h3>';
        html += resolvedAppeals.map(a => renderAppealCard(a, true)).join('');
    }
    
    list.innerHTML = html;
});

function renderAppealCard(a, isResolved) {
    const voting = currentJuryVotings[a.id];
    let votingInfo = '';
    
    if (voting) {
        const supportEx = voting.voteCount?.supportExaminer || 0;
        const supportInv = voting.voteCount?.supportInventor || 0;
        const total = voting.totalVotes || 0;
        const status = isResolved ? '✅ 已裁决' : (voting.status === 'active' ? '🟢 进行中' : '🔴 已结束');
        
        let resultText = '';
        if (isResolved) {
            const winner = (a.finalDecision || voting.finalDecision) === 'overturn' ? '审查官胜诉' : '发明家胜诉';
            const winColor = (a.finalDecision || voting.finalDecision) === 'overturn' ? '#3b82f6' : '#ef4444';
            resultText = `<p style="font-weight: bold; color: ${winColor}; font-size: 1.1em; margin-top: 10px;">⚖️ 最终判决: ${winner}</p>`;
        }
        
        votingInfo = `
            <div style="background: ${isResolved ? '#f0fdf4' : '#f0f8ff'}; padding: 10px; margin: 10px 0; border-radius: 5px; ${isResolved ? 'border: 2px solid #22c55e' : ''};">
                <p><b>📊 陪审团投票 ${status}</b></p>
                <p>支持审查官: <b>${supportEx}</b> 票 | 支持发明人: <b>${supportInv}</b> 票 | 总票数: ${total}</p>
                ${resultText}
            </div>
        `;
    }
    
    const reasonText = a.reason ? `<p style="background: #fef3c7; padding: 10px; border-radius: 6px; margin: 10px 0;"><b>📢 申诉理由:</b> "${a.reason}"</p>` : '';
    const defenseText = a.defense ? `<p style="background: #dbeafe; padding: 10px; border-radius: 6px; margin: 10px 0;"><b>🛡️ 发明人辩护:</b> "${a.defense}"</p>` : '<p style="color: #94a3b8; font-size: 0.9em; margin: 10px 0;">⏳ 等待发明人提交辩护词...</p>';
    
    return `
        <div class="appeal-card" style="${isResolved ? 'opacity: 0.75; background: #f9fafb; border-left: 4px solid #22c55e;' : ''}">
            <p><b>🕵️ 原告 (审查官):</b> ${a.appellantName}</p>
            <p><b>🤡 被告 (发明人):</b> ${a.invention.inventorName}</p>
            <p><b>🔨 案件发明:</b> ${a.invention.title}</p>
            <p style="font-size: 0.9em; color: #666;">${a.invention.desc}</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 10px 0;">
            <p><b>❌ 审查官判定:</b> ${formatPrinciples(a.examinerAnswers)}</p>
            <p><b>✅ 发明家标准:</b> ${formatPrinciples(a.trueAnswers)}</p>
            ${reasonText}
            ${defenseText}
            ${votingInfo}
            ${isResolved ? '<p style="color: #22c55e; font-weight: 600; text-align: center; margin: 10px 0;">✅ 案件已结案</p>' : `
            <div class="appeal-actions">
                <button data-appeal-id="${a.id}" data-decision="execute_vote" class="btn-execute btn-resolve" ${voting ? '' : 'disabled'}>⚖️ 执行民意</button>
                <button data-appeal-id="${a.id}" data-decision="uphold" class="btn-uphold btn-resolve">🅰️ 强制驳回</button>
                <button data-appeal-id="${a.id}" data-decision="overturn" class="btn-overturn btn-resolve">🅱️ 强制改判</button>
            </div>
            `}
        </div>
    `;
}

socket.on('updateJuryVotings', (votings) => {
    votings.forEach(v => {
        currentJuryVotings[v.appealId] = v;
    });
    // Request fresh appeals data to re-render with voting stats
    socket.emit('requestAppealsUpdate');
});

socket.on('juryVotingUpdate', (data) => {
    if (currentJuryVotings[data.votingId]) {
        currentJuryVotings[data.votingId].voteCount = data.voteCount;
        currentJuryVotings[data.votingId].totalVotes = data.totalVotes;
        currentJuryVotings[data.votingId].status = data.status;
    }
    // Request fresh appeals data to re-render with updated vote counts
    socket.emit('requestAppealsUpdate');
});

function resolveAppeal(id, decision) {
    let confirmMsg = '';
    if (decision === 'execute_vote') {
        confirmMsg = "确定执行群众陪审团的民意判决？";
    } else if (decision === 'overturn') {
        confirmMsg = "确定强制改判申诉成功？发明家将被重罚！";
    } else {
        confirmMsg = "确定强制驳回申诉？";
    }
    
    if (!confirm(confirmMsg)) return;
    socket.emit('adminResolveAppeal', { appealId: id, decision });
}

// Add event delegation for dynamically created buttons
document.addEventListener('DOMContentLoaded', function() {
    const appealsList = document.getElementById('appeals-list');
    if (appealsList) {
        appealsList.addEventListener('click', function(e) {
            const target = e.target;
            
            // Check if clicked element is a resolve button
            if (target.classList.contains('btn-resolve')) {
                const appealId = target.getAttribute('data-appeal-id');
                const decision = target.getAttribute('data-decision');
                
                if (appealId && decision && !target.disabled) {
                    resolveAppeal(appealId, decision);
                }
            }
        });
    }
});

// Actions
window.forceStage = function(userId, stage) {
    const stageNames = {
        'learning': '学习阶段',
        'qualification': '考试阶段',
        'battle': '大乱斗'
    };
    if(confirm(`确定要强制该学生进入${stageNames[stage]}吗？`)) {
        socket.emit('adminForceStage', { userId, stage });
    }
}

function batchStage(stage, condition) {
    const messages = {
        'learning_all': '确定要让所有学生回到学习阶段吗？',
        'qualification_all': '确定要让所有完成学习的学生进入考试阶段吗？',
        'battle_qualified': '确定要让所有通过考试的学生进入大乱斗吗？'
    };
    const key = `${stage}_${condition}`;
    if(confirm(messages[key] || '确定要执行此操作吗？')) {
        socket.emit('adminBatchStage', { stage, condition });
    }
}

function adminStartLearning() { 
    if(confirm('确定要让所有学生回到学习阶段吗？')) {
        socket.emit('adminStartLearning'); 
    }
}

function adminStartQualification() { 
    if(confirm('确定要让所有完成学习的学生进入考试阶段吗？')) {
        socket.emit('adminStartQualification'); 
    }
}

function adminStartBattle() { 
    if(confirm('确定要让所有通过考试的学生进入大乱斗吗？')) {
        socket.emit('adminStartBattle'); 
    }
}

function adminForceStartBattle() { 
    if(confirm('确定要强制所有已通过考试的学生进入大乱斗吗？')) {
        socket.emit('adminForceStartBattle'); 
    }
}

function adminEndGame() { socket.emit('adminEndGame'); }
function adminToggleAutoBattle() { socket.emit('adminToggleAutoBattle'); }
function adminReset() { 
    if(confirm('确定要重置所有数据吗？学生会被踢出游戏逻辑。')) {
        socket.emit('adminReset'); 
    }
}

// Punishment functions
window.punishStudent = function(userId, userName) {
    if(confirm(`确定要惩罚 ${userName} 吗？\n\n将会：\n- 退回学习阶段\n- 清空所有积分\n- 公屏广播通知`)) {
        socket.emit('punishStudent', { userId, userName });
    }
}

window.muteStudent = function(userId, userName) {
    const duration = prompt(`禁言 ${userName} 多少分钟？\n\n输入数字（1-60）：`, '5');
    if (duration && !isNaN(duration) && duration > 0 && duration <= 60) {
        socket.emit('muteStudent', { userId, userName, duration: parseInt(duration) });
    } else if (duration !== null) {
        alert('请输入1-60之间的数字！');
    }
}

window.clearScore = function(userId, userName) {
    if(confirm(`确定要清空 ${userName} 的所有积分吗？\n\n此操作不可恢复！`)) {
        socket.emit('clearScore', { userId, userName });
    }
}

socket.on('autoBattleStatus', (enabled) => {
    document.getElementById('auto-battle-toggle').checked = enabled;
});

socket.on('updateInventions', (inventions) => {
    document.getElementById('invention-count').textContent = inventions.length;
    const list = document.getElementById('inventions-list');
    if (inventions.length === 0) {
        list.innerHTML = "<p>暂无发明提交。</p>";
        return;
    }
    
    list.innerHTML = inventions.map((inv, idx) => `
        <div style="padding: 15px; margin-bottom: 10px; border-radius: 8px; border: 1px solid #e2e8f0; background: ${idx % 2 === 0 ? '#f8fafc' : '#fff'}; box-shadow: var(--shadow-sm);">
            <p style="margin-top: 0; font-size: 1.1rem; color: var(--dark);"><b>🔨 ${inv.title}</b> <span style="color: var(--gray); font-size: 0.9em; margin-left: 10px;">by ${inv.inventorName}</span></p>
            <p style="font-size: 1rem; color: #475569; line-height: 1.5; margin: 10px 0;">${inv.desc}</p>
            <p style="font-size: 0.9rem; color: var(--success); margin-bottom: 0; background: #ecfdf5; display: inline-block; padding: 4px 10px; border-radius: 6px;"><b>设定违背原则:</b> ${formatPrinciples(inv.trueAnswers)}</p>
        </div>
    `).join('');
});
