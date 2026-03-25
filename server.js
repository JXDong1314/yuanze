const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Admin Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Game State
let users = {}; // socket.id -> { id, name, examinerScore, inventorScore, personalStage, status, currentTasks: [], reviewedInventions: [], hasCompletedLearning: false }
// personalStage: 'learning', 'qualification', 'battle', 'failed' (need to relearn)
let gameState = 'active'; // 'lobby' (waiting for students), 'active' (students in personal stages), 'finished' (game ended)
const SCORE_THRESHOLD = -10; // If score drops below this, student must relearn

// Pre-populate wacky inventions for students to practice with
let inventions = [
    {
        id: "sys_1",
        inventorId: "system",
        inventorName: "野生发明家·阿伟",
        title: "太阳能手电筒",
        desc: "这款手电筒不需要电池！只要有阳光直射，它就能发出耀眼的光芒。再也不怕白天停电了！",
        trueAnswers: ["4", "9"] // 实用性原则, 时效性原则
    },
    {
        id: "sys_2",
        inventorId: "system",
        inventorName: "王大锤",
        title: "倒立洗头机",
        desc: "为了解决洗头时水流进眼睛的痛点，本机采用倒立式结构，使用者需倒立将头浸入洗发槽，同时锻炼身体。",
        trueAnswers: ["3", "8"] // 安全性原则, 工程心理学和生理学原则
    },
    {
        id: "sys_3",
        inventorId: "system",
        inventorName: "手工耿",
        title: "带刺的防盗饭盒",
        desc: "饭盒表面布满长达3厘米的锋利铁刺，有效防止室友偷吃你的外卖！(备注：自己吃的时候需要戴防爆手套)",
        trueAnswers: ["3"] // 安全性原则
    },
    {
        id: "sys_4",
        inventorId: "system",
        inventorName: "李建刚",
        title: "正三角形充电线",
        desc: "为了彰显个性，特制了插头为正三角形的充电线，且不附带充电头。只能硬插。",
        trueAnswers: ["7"] // 标准化原则
    }
]; 

let pendingReviews = {}; // reviewId -> { inventorId, invention, assignedTo, timestamp }
let appeals = {}; // appealId -> { reviewId, appellantId, invention, examinerAnswers, trueAnswers, timestamp }
let juryVotings = {}; // votingId -> { appealId, votes: {userId: 'support_examiner'|'support_inventor'}, startTime, endTime, status }
let completedReviews = {}; // reviewId -> { ...context }
let autoBattleEnabled = true; // Auto-start battle after qualification, teacher can override
let qualifiedCount = 0; // Track qualified users for auto-battle trigger

// Principle Relations System - for bonus scoring
const principleRelations = {
    // 强关联组（经常一起出现的原则）
    strongGroups: [
        { ids: ['3', '8'], name: '安全与人体工学', bonus: 3, description: '不安全的设计往往也不符合人体工学' },
        { ids: ['4', '6'], name: '实用与可靠', bonus: 3, description: '不实用的产品通常也不可靠' },
        { ids: ['5', '12'], name: '经济与可持续', bonus: 3, description: '不经济的设计往往也不可持续' },
        { ids: ['1', '4'], name: '科学与实用', bonus: 3, description: '不科学的设计必然不实用' },
        { ids: ['9', '4'], name: '时效与实用', bonus: 2, description: '时效性差会影响实用性' },
        { ids: ['7', '5'], name: '标准化与经济', bonus: 2, description: '不标准化会增加成本' },
    ],
    
    // 矛盾关联（需要权衡的原则对）
    conflictPairs: [
        { ids: ['2', '7'], name: '创新vs标准化', bonus: 2, description: '过度创新可能破坏标准' },
        { ids: ['5', '6'], name: '经济vs可靠', bonus: 2, description: '降低成本可能影响质量' },
        { ids: ['2', '3'], name: '创新vs安全', bonus: 2, description: '新技术可能带来未知风险' },
    ]
};

// Calculate relation bonus when examiner correctly identifies related principles
function calculateRelationBonus(selectedAnswers, trueAnswers) {
    let bonus = 0;
    let bonusReasons = [];
    
    // 只有完全匹配时才计算关联奖励
    const isExactMatch = selectedAnswers.length === trueAnswers.length && 
        selectedAnswers.every(val => trueAnswers.includes(val));
    
    if (!isExactMatch) {
        return { bonus: 0, reasons: [] };
    }
    
    // 检测原则链（因果关系）- 最高优先级
    const chainBonus = detectPrincipleChain(selectedAnswers, trueAnswers);
    if (chainBonus.detected) {
        bonus += chainBonus.bonus;
        bonusReasons.push(`🔗 ${chainBonus.description} +${chainBonus.bonus}分`);
    }
    
    // 检查强关联组（如果没有检测到链，才检查普通关联）
    if (!chainBonus.detected) {
        principleRelations.strongGroups.forEach(group => {
            const allInTrue = group.ids.every(id => trueAnswers.includes(id));
            const allInSelected = group.ids.every(id => selectedAnswers.includes(id));
            
            if (allInTrue && allInSelected) {
                bonus += group.bonus;
                bonusReasons.push(`🔗 ${group.name} +${group.bonus}分`);
            }
        });
    }
    
    // 检查矛盾关联（理解深度奖励）
    principleRelations.conflictPairs.forEach(pair => {
        const allInTrue = pair.ids.every(id => trueAnswers.includes(id));
        const allInSelected = pair.ids.every(id => selectedAnswers.includes(id));
        
        if (allInTrue && allInSelected) {
            bonus += pair.bonus;
            bonusReasons.push(`⚖️ 理解${pair.name}矛盾 +${pair.bonus}分`);
        }
    });
    
    return { bonus, reasons: bonusReasons };
}

// Detect principle chains (causal relationships)
function detectPrincipleChain(selectedAnswers, trueAnswers) {
    const chains = [
        {
            pattern: ['1', '4'],
            description: '科学性→实用性因果链',
            explanation: '不科学的设计必然导致不实用',
            bonus: 5
        },
        {
            pattern: ['3', '8'],
            description: '安全性→工程心理学因果链',
            explanation: '不安全的设计往往也不符合人体工学',
            bonus: 5
        },
        {
            pattern: ['5', '12'],
            description: '经济性→可持续性因果链',
            explanation: '不经济的设计往往也不可持续',
            bonus: 5
        },
        {
            pattern: ['4', '6'],
            description: '实用性→可靠性因果链',
            explanation: '不实用的产品通常也不可靠',
            bonus: 5
        },
        {
            pattern: ['7', '5'],
            description: '标准化→经济性因果链',
            explanation: '不标准化会增加生产和使用成本',
            bonus: 4
        },
        {
            pattern: ['9', '4'],
            description: '时效性→实用性因果链',
            explanation: '时效性差会严重影响实用性',
            bonus: 4
        }
    ];
    
    // 检测是否匹配任何链
    for (let chain of chains) {
        const allInTrue = chain.pattern.every(id => trueAnswers.includes(id));
        const allInSelected = chain.pattern.every(id => selectedAnswers.includes(id));
        
        if (allInTrue && allInSelected) {
            return {
                detected: true,
                ...chain
            };
        }
    }
    
    return { detected: false };
}

// Preset Qualification Questions - Basic Level (单选题，简单)
const basicQualificationQuestions = [
    {
        id: 1,
        type: 'single',
        title: "太阳能手电筒",
        desc: "这款手电筒只能在白天有阳光时使用，晚上无法工作。",
        options: [
            { id: "1", text: "科学性原则" },
            { id: "4", text: "实用性原则" },
            { id: "5", text: "经济性原则" },
            { id: "11", text: "法律道德原则" }
        ],
        correctAnswer: "4" // 实用性
    },
    {
        id: 2,
        type: 'single',
        title: "方形轮子自行车",
        desc: "为了追求独特外观，将自行车轮子设计成方形，骑起来非常颠簸。",
        options: [
            { id: "1", text: "科学性原则" },
            { id: "2", text: "创新性原则" },
            { id: "7", text: "标准化原则" },
            { id: "10", text: "最优化原则" }
        ],
        correctAnswer: "1" // 科学性
    },
    {
        id: 3,
        type: 'single',
        title: "一次性黄金手机壳",
        desc: "使用纯金打造的一次性手机壳，用完即扔，彰显尊贵。",
        options: [
            { id: "3", text: "安全性原则" },
            { id: "5", text: "经济性原则" },
            { id: "6", text: "可靠性原则" },
            { id: "8", text: "工程心理学原则" }
        ],
        correctAnswer: "5" // 经济性
    },
    {
        id: 4,
        type: 'single',
        title: "带刺的防盗饭盒",
        desc: "饭盒表面布满锋利铁刺，防止别人偷吃，但自己吃的时候也容易被扎伤。",
        options: [
            { id: "2", text: "创新性原则" },
            { id: "3", text: "安全性原则" },
            { id: "4", text: "实用性原则" },
            { id: "12", text: "可持续发展原则" }
        ],
        correctAnswer: "3" // 安全性
    },
    {
        id: 5,
        type: 'single',
        title: "三角形插头充电线",
        desc: "某品牌推出正三角形插头的充电线，与市面上所有充电器都不兼容。",
        options: [
            { id: "6", text: "可靠性原则" },
            { id: "7", text: "标准化原则" },
            { id: "9", text: "时效性原则" },
            { id: "12", text: "可持续发展原则" }
        ],
        correctAnswer: "7" // 标准化
    },
    {
        id: 6,
        type: 'single',
        title: "考试作弊眼镜",
        desc: "内置微型摄像头和显示屏，可以在考试时偷看答案。",
        options: [
            { id: "2", text: "创新性原则" },
            { id: "8", text: "工程心理学原则" },
            { id: "10", text: "最优化原则" },
            { id: "11", text: "法律道德原则" }
        ],
        correctAnswer: "11" // 法律道德
    },
    {
        id: 7,
        type: 'single',
        title: "纸质雨衣",
        desc: "用纸做的雨衣，遇水30分钟后就会溶解破损。",
        options: [
            { id: "1", text: "科学性原则" },
            { id: "4", text: "实用性原则" },
            { id: "5", text: "经济性原则" },
            { id: "7", text: "标准化原则" }
        ],
        correctAnswer: "4" // 实用性（也可以是可靠性，但这里选最明显的）
    },
    {
        id: 8,
        type: 'single',
        title: "倒立洗头机",
        desc: "需要使用者倒立才能洗头的机器，使用时头晕目眩。",
        options: [
            { id: "5", text: "经济性原则" },
            { id: "7", text: "标准化原则" },
            { id: "8", text: "工程心理学原则" },
            { id: "12", text: "可持续发展原则" }
        ],
        correctAnswer: "8" // 工程心理学
    },
    {
        id: 9,
        type: 'single',
        title: "一次性塑料餐具套装",
        desc: "大量使用不可降解塑料制作的一次性餐具，用完就扔。",
        options: [
            { id: "2", text: "创新性原则" },
            { id: "6", text: "可靠性原则" },
            { id: "9", text: "时效性原则" },
            { id: "12", text: "可持续发展原则" }
        ],
        correctAnswer: "12" // 可持续发展
    },
    {
        id: 10,
        type: 'single',
        title: "5分钟就没电的手电筒",
        desc: "充满电后只能使用5分钟的手电筒，需要频繁充电。",
        options: [
            { id: "3", text: "安全性原则" },
            { id: "6", text: "可靠性原则" },
            { id: "7", text: "标准化原则" },
            { id: "11", text: "法律道德原则" }
        ],
        correctAnswer: "6" // 可靠性
    }
];

// Advanced Qualification Questions (多选题，进阶)
const advancedQualificationQuestions = [
    {
        id: 11,
        type: 'multiple',
        title: "高压电击防盗饭盒",
        desc: "为了防止饭盒被偷，在饭盒上安装了高压电击装置，小偷一碰就会被电晕。",
        correctPrinciples: ["3", "11"], // Safety, Legal/Moral
        bonus: 3 // 降低from 5
    },
    {
        id: 12,
        type: 'multiple',
        title: "倒刺型防抖圆珠笔",
        desc: "笔杆上布满细小的金属倒刺，握笔姿势一旦错误就会扎手，强迫学生保持标准握姿。",
        correctPrinciples: ["3", "8"], // Safety, Engineering Psychology
        bonus: 3 // 降低from 5
    },
    {
        id: 13,
        type: 'multiple',
        title: "三角形接口充电线（完整版）",
        desc: "某大厂为了垄断市场，推出全球首款正三角形插头的手机充电线，与其他所有设备都不兼容，且价格是普通充电线的10倍。",
        correctPrinciples: ["5", "7"], // Economic, Standardization
        bonus: 3 // 降低from 5
    },
    {
        id: 14,
        type: 'multiple',
        title: "全自动课堂代聊机器人",
        desc: "能够模仿你的声音，在老师提问时自动翻找题库并用你的声线回答问题，外观伪装成文具盒。",
        correctPrinciples: ["11"], // Legal/Moral
        bonus: 2 // 降低from 3
    },
    {
        id: 15,
        type: 'multiple',
        title: "太阳能夜光手电筒（完整版）",
        desc: "只能在白天太阳下充电，晚上才能使用的手电筒，但充满电只能用5分钟，而且经常充不满电。",
        correctPrinciples: ["4", "6", "9"], // Practicality, Reliability, Timeliness
        bonus: 5 // 降低from 8
    }
];

// Example Practice Cases (for students to practice reviewing)
const exampleCases = [
    {
        id: 'example_1',
        title: "倒刺型防抖圆珠笔",
        desc: "笔杆上布满细小的金属倒刺，握笔姿势一旦错误就会扎手，强迫学生保持标准握姿。",
        trueAnswers: ["3", "8"],
        inventorName: "系统示例"
    },
    {
        id: 'example_2',
        title: "三角形接口充电线",
        desc: "某大厂为了垄断市场，推出全球首款正三角形插头的手机充电线，与其他所有设备都不兼容。",
        trueAnswers: ["5", "7"],
        inventorName: "系统示例"
    },
    {
        id: 'example_3',
        title: "全自动课堂代聊机器人",
        desc: "能够模仿你的声音，在老师提问时自动翻找题库并用你的声线回答问题，外观伪装成文具盒。",
        trueAnswers: ["11"],
        inventorName: "系统示例"
    },
    {
        id: 'example_4',
        title: "一次性纸质雨衣",
        desc: "遇水 30 分钟后会自动溶解的环保纸质雨衣，号称绝对零污染。",
        trueAnswers: ["4", "6"],
        inventorName: "系统示例"
    }
];

// Check if score is too low and force relearn (global function)
function checkScoreThreshold(userId) {
    const user = users[userId];
    if (!user) return;
    
    const totalScore = user.examinerScore + user.inventorScore;
    
    if (totalScore < SCORE_THRESHOLD && user.personalStage === 'battle') {
        // Force back to learning
        user.personalStage = 'failed';
        user.hasCompletedLearning = false;
        user.qualificationPassed = false;
        
        io.to(userId).emit('updatePersonalStage', 'failed');
        io.to(userId).emit('forcedToRelearn', {
            reason: '积分过低',
            currentScore: totalScore,
            threshold: SCORE_THRESHOLD
        });
        
        io.emit('updateUserList', Object.values(users));
    }
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 1. Lobby & Registration
    socket.on('join', (name) => {
        users[socket.id] = {
            id: socket.id,
            name: name,
            examinerScore: 0,
            inventorScore: 0,
            personalStage: 'learning', // 个人阶段: learning, qualification, battle, failed
            hasCompletedLearning: false, // 是否完成学习
            qualificationPassed: false,  // 是否通过资格考
            currentTasks: [],
            reviewedInventions: []
        };
        io.emit('updateUserList', Object.values(users));
        
        // Send personal stage to the user
        socket.emit('updatePersonalStage', 'learning');
        
        // Send current inventions list to the newly joined user
        socket.emit('updateInventions', inventions);
        socket.emit('updateAllInventions', inventions);
        
        // Send user's reviewed inventions list
        socket.emit('syncReviewedInventions', users[socket.id].reviewedInventions);
    });

    // 2. Student Personal Stage Management
    
    // Student completes learning phase
    socket.on('completeLearning', () => {
        if (!users[socket.id]) return;
        
        users[socket.id].hasCompletedLearning = true;
        users[socket.id].personalStage = 'qualification';
        
        socket.emit('updatePersonalStage', 'qualification');
        socket.emit('systemMessage', '✅ 学习完成！现在可以参加资格考试了。');
        
        // Send basic questions
        socket.emit('qualificationQuestions', { 
            type: 'basic', 
            questions: basicQualificationQuestions 
        });
        
        io.emit('updateUserList', Object.values(users));
    });
    
    // Student request stage switch with validation
    socket.on('requestStageSwitch', (data) => {
        const { targetStage } = data;
        const user = users[socket.id];
        
        if (!user) return;
        
        let canSwitch = false;
        let errorMessage = '';
        
        if (targetStage === 'learning') {
            // Anyone can go back to learning
            canSwitch = true;
        } else if (targetStage === 'qualification') {
            // Must have completed learning
            if (user.hasCompletedLearning) {
                canSwitch = true;
            } else {
                errorMessage = '❌ 需要先完成学习阶段才能进入考试！';
            }
        } else if (targetStage === 'battle') {
            // Must have passed qualification
            if (user.qualificationPassed) {
                canSwitch = true;
            } else {
                errorMessage = '❌ 需要先通过资格考试才能进入大乱斗！';
            }
        }
        
        if (canSwitch) {
            user.personalStage = targetStage;
            
            // Update flags based on target stage
            if (targetStage === 'learning') {
                user.hasCompletedLearning = false;
                user.qualificationPassed = false;
            }
            
            io.to(socket.id).emit('updatePersonalStage', targetStage);
            io.to(socket.id).emit('systemMessage', `✅ 已切换到${getStageDisplayName(targetStage)}`);
            
            // Send questions if switching to qualification
            if (targetStage === 'qualification') {
                io.to(socket.id).emit('qualificationQuestions', { 
                    type: 'basic', 
                    questions: basicQualificationQuestions 
                });
            }
            
            io.emit('updateUserList', Object.values(users));
        } else {
            io.to(socket.id).emit('systemMessage', errorMessage);
        }
    });
    
    // 3. Teacher Controls - Individual Student
    socket.on('adminForceStage', (data) => {
        const { userId, stage } = data;
        if (!users[userId]) return;
        
        users[userId].personalStage = stage;
        
        // Reset flags based on stage
        if (stage === 'learning' || stage === 'failed') {
            users[userId].hasCompletedLearning = false;
            users[userId].qualificationPassed = false;
        } else if (stage === 'qualification') {
            users[userId].hasCompletedLearning = true;
            users[userId].qualificationPassed = false;
            // Send qualification questions when forced to qualification stage
            io.to(userId).emit('qualificationQuestions', { 
                type: 'basic', 
                questions: basicQualificationQuestions 
            });
        } else if (stage === 'battle') {
            users[userId].hasCompletedLearning = true;
            users[userId].qualificationPassed = true;
        }
        
        io.to(userId).emit('updatePersonalStage', stage);
        io.to(userId).emit('systemMessage', `教师已将你的阶段调整为：${getStageDisplayName(stage)}`);
        io.emit('updateUserList', Object.values(users));
    });
    
    // Teacher batch operations
    socket.on('adminBatchStage', (data) => {
        const { stage, condition } = data; // condition: 'all', 'qualified', 'inBattle'
        
        Object.values(users).forEach(user => {
            let shouldChange = false;
            
            if (condition === 'all') {
                shouldChange = true;
            } else if (condition === 'qualified' && user.qualificationPassed) {
                shouldChange = true;
            } else if (condition === 'inBattle' && user.personalStage === 'battle') {
                shouldChange = true;
            }
            
            if (shouldChange) {
                user.personalStage = stage;
                
                if (stage === 'learning' || stage === 'failed') {
                    user.hasCompletedLearning = false;
                    user.qualificationPassed = false;
                } else if (stage === 'qualification') {
                    user.hasCompletedLearning = true;
                    user.qualificationPassed = false;
                    // Send qualification questions when batch moving to qualification
                    io.to(user.id).emit('qualificationQuestions', { 
                        type: 'basic', 
                        questions: basicQualificationQuestions 
                    });
                } else if (stage === 'battle') {
                    user.hasCompletedLearning = true;
                    user.qualificationPassed = true;
                }
                
                io.to(user.id).emit('updatePersonalStage', stage);
                io.to(user.id).emit('systemMessage', `教师已批量调整阶段为：${getStageDisplayName(stage)}`);
            }
        });
        
        io.emit('updateUserList', Object.values(users));
        io.emit('systemMessage', `教师执行了批量操作：${getStageDisplayName(stage)}`);
    });
    
    function getStageDisplayName(stage) {
        const names = {
            'learning': '学习阶段',
            'qualification': '资格考试',
            'battle': '大乱斗',
            'failed': '重新学习'
        };
        return names[stage] || stage;
    }
    
    // 4. Old Teacher Controls (kept for compatibility, but modified)
    socket.on('adminStartLearning', () => {
        // Batch move all to learning
        Object.values(users).forEach(user => {
            user.personalStage = 'learning';
            user.hasCompletedLearning = false;
            user.qualificationPassed = false;
            
            io.to(user.id).emit('updatePersonalStage', 'learning');
            io.to(user.id).emit('systemMessage', '教师已将你的阶段调整为：学习阶段');
        });
        
        io.emit('updateUserList', Object.values(users));
        io.emit('systemMessage', '教师执行了批量操作：学习阶段');
    });
    
    socket.on('adminStartQualification', () => {
        // Batch move all to qualification (teacher override)
        Object.values(users).forEach(user => {
            user.personalStage = 'qualification';
            user.hasCompletedLearning = true; // Mark as completed when teacher forces
            
            io.to(user.id).emit('updatePersonalStage', 'qualification');
            io.to(user.id).emit('qualificationQuestions', { 
                type: 'basic', 
                questions: basicQualificationQuestions 
            });
            io.to(user.id).emit('systemMessage', '教师已将你的阶段调整为：资格考试');
        });
        io.emit('updateUserList', Object.values(users));
        io.emit('systemMessage', '教师开启了资格考试阶段！');
    });

    socket.on('adminStartBattle', () => {
        // Batch move all qualified to battle
        Object.values(users).forEach(user => {
            if (user.qualificationPassed) {
                user.personalStage = 'battle';
                user.hasCompletedLearning = true;
                
                io.to(user.id).emit('updatePersonalStage', 'battle');
                io.to(user.id).emit('systemMessage', '教师已批量调整阶段为：大乱斗');
            }
        });
        
        io.emit('updateUserList', Object.values(users));
        io.emit('systemMessage', '教师执行了批量操作：大乱斗');
        distributeExampleCases();
    });
    
    socket.on('adminForceStartBattle', () => {
        // Force ALL students into battle (regardless of qualification status)
        Object.values(users).forEach(user => {
            // Skip admin users
            if (user.name === 'ADMIN') return;
            
            user.personalStage = 'battle';
            user.hasCompletedLearning = true;
            user.qualificationPassed = true; // Mark as qualified so they can participate
            
            io.to(user.id).emit('updatePersonalStage', 'battle');
            io.to(user.id).emit('systemMessage', '教师强制所有人进入大乱斗！');
        });
        
        io.emit('updateUserList', Object.values(users));
        io.emit('systemMessage', '教师执行了批量操作：大乱斗');
        io.emit('forceEnterBattle');
        distributeExampleCases();
    });

    // Teacher Punishment Controls
    socket.on('punishStudent', (data) => {
        const { userId, userName } = data;
        const user = users[userId];
        
        if (!user) return;
        
        // Reset to learning stage
        user.personalStage = 'learning';
        user.hasCompletedLearning = false;
        user.qualificationPassed = false;
        
        // Clear all scores
        user.examinerScore = 0;
        user.inventorScore = 0;
        
        // Clear reviewed inventions
        user.reviewedInventions = [];
        
        // Notify the student
        io.to(userId).emit('updatePersonalStage', 'learning');
        io.to(userId).emit('systemMessage', '⚠️ 你因违规被教师惩罚！已退回学习阶段，积分已清空！');
        
        // Public broadcast
        io.emit('systemMessage', `⚠️ 【公告】${userName} 因乱发明被教师惩罚，退回学习阶段，积分清空！`);
        io.emit('updateUserList', Object.values(users));
    });
    
    socket.on('muteStudent', (data) => {
        const { userId, userName, duration } = data;
        const user = users[userId];
        
        if (!user) return;
        
        // Set mute flag
        user.isMuted = true;
        user.muteUntil = Date.now() + (duration * 60 * 1000);
        
        // Notify the student
        io.to(userId).emit('systemMessage', `🔇 你已被教师禁言 ${duration} 分钟！`);
        io.to(userId).emit('muted', { duration, until: user.muteUntil });
        
        // Public broadcast
        io.emit('systemMessage', `🔇 【公告】${userName} 已被禁言 ${duration} 分钟！`);
        
        // Auto unmute after duration
        setTimeout(() => {
            if (users[userId]) {
                users[userId].isMuted = false;
                users[userId].muteUntil = null;
                io.to(userId).emit('systemMessage', '✅ 禁言已解除！');
                io.to(userId).emit('unmuted');
            }
        }, duration * 60 * 1000);
    });
    
    socket.on('clearScore', (data) => {
        const { userId, userName } = data;
        const user = users[userId];
        
        if (!user) return;
        
        // Clear all scores
        user.examinerScore = 0;
        user.inventorScore = 0;
        
        // Notify the student
        io.to(userId).emit('systemMessage', '🗑️ 你的积分已被教师清空！');
        
        // Public broadcast
        io.emit('systemMessage', `🗑️ 【公告】${userName} 的积分已被教师清空！`);
        io.emit('updateUserList', Object.values(users));
    });

    socket.on('adminEndGame', () => {
        gameState = 'finished';
        io.emit('gameState', gameState);
        broadcastRankings();
    });
    
    socket.on('adminToggleAutoBattle', () => {
        autoBattleEnabled = !autoBattleEnabled;
        socket.emit('autoBattleStatus', autoBattleEnabled);
        io.emit('systemMessage', `自动开启大乱斗已${autoBattleEnabled ? '启用' : '禁用'}`);
    });
    
    socket.on('adminReset', () => {
        users = {};
        gameState = 'lobby';
        inventions = [];
        pendingReviews = {};
        appeals = {};
        juryVotings = {};
        completedReviews = {};
        qualifiedCount = 0;
        io.emit('reset');
    });

    // 5. Qualification Logic - Basic Test
    socket.on('submitQualification', (data) => {
        const { type, answers } = data; // type: 'basic' or 'advanced'
        
        if (type === 'basic') {
            // Basic test: single choice questions
            let correctCount = 0;
            
            basicQualificationQuestions.forEach(q => {
                const userAns = answers[q.id];
                const correctAns = q.correctAnswer;
                
                if (userAns === correctAns) correctCount++;
            });

            // Require 6 out of 10 to pass (60% pass rate)
            const passThreshold = 6;
            if (correctCount >= passThreshold) {
                if (users[socket.id]) {
                    users[socket.id].qualificationPassed = true;
                    users[socket.id].personalStage = 'battle';
                    
                    // Offer advanced test for bonus points
                    socket.emit('qualificationResult', { 
                        success: true, 
                        message: `🎉 恭喜晋级！答对 ${correctCount}/${basicQualificationQuestions.length} 题！\n\n你已获得发明家与审查官资格！`,
                        showAdvanced: true // Show option to take advanced test
                    });
                    
                    // Update personal stage to battle
                    socket.emit('updatePersonalStage', 'battle');
                    io.emit('updateUserList', Object.values(users));
                }
            } else {
                socket.emit('qualificationResult', { 
                    success: false, 
                    message: `❌ 考核未通过！答对 ${correctCount}/${basicQualificationQuestions.length} 题，需要至少 ${passThreshold} 题正确。\n\n请重新尝试！`,
                    showAdvanced: false
                });
            }
        } else if (type === 'advanced') {
            // Advanced test: multiple choice questions for bonus points
            let totalBonus = 0;
            let correctCount = 0;
            
            advancedQualificationQuestions.forEach(q => {
                const userAns = answers[q.id] || [];
                const correctAns = q.correctPrinciples;
                
                // Check if arrays have same elements (ignoring order)
                const isCorrect = userAns.length === correctAns.length && 
                    userAns.every(val => correctAns.includes(val));
                
                if (isCorrect) {
                    correctCount++;
                    totalBonus += q.bonus;
                }
            });
            
            // Award bonus points
            if (users[socket.id]) {
                users[socket.id].examinerScore += totalBonus;
                
                socket.emit('advancedTestResult', {
                    correctCount: correctCount,
                    totalQuestions: advancedQualificationQuestions.length,
                    bonusPoints: totalBonus,
                    message: `🌟 进阶测试完成！\n\n答对 ${correctCount}/${advancedQualificationQuestions.length} 题\n获得初始分数：${totalBonus} 分！`
                });
                
                broadcastRankings();
            }
        }
    });
    
    // Handle request for advanced test
    socket.on('requestAdvancedTest', () => {
        socket.emit('qualificationQuestions', { 
            type: 'advanced', 
            questions: advancedQualificationQuestions 
        });
    });

    // 4. Battle Logic - Inventor
    socket.on('submitInvention', (data) => {
        // data: { title, desc, trueAnswers: [] }
        if (!users[socket.id]) return;
        
        // Check if user is muted
        if (users[socket.id].isMuted) {
            const remainingTime = Math.ceil((users[socket.id].muteUntil - Date.now()) / 60000);
            io.to(socket.id).emit('systemMessage', `🔇 你已被禁言，无法提交发明！剩余时间：${remainingTime} 分钟`);
            return;
        }

        const invention = {
            id: Date.now() + Math.random().toString(),
            inventorId: socket.id,
            inventorName: users[socket.id].name,
            title: data.title,
            desc: data.desc,
            trueAnswers: data.trueAnswers
        };
        inventions.push(invention);
        
        // Broadcast updated inventions list to ALL clients (admin and students)
        io.emit('updateInventions', inventions);
        io.emit('updateAllInventions', inventions);
    });

    // 4. Battle Logic - Examiner (New: Open review system - anyone can review any invention)
    socket.on('submitInventionReview', (data) => {
        // data: { inventionId, selectedPrinciples: [], comment: string }
        const invention = inventions.find(inv => inv.id === data.inventionId);
        if (!invention) return;
        if (!users[socket.id]) return;
        
        const inventorId = invention.inventorId;
        const examinerId = socket.id;
        
        // Check if user already reviewed this invention
        if (users[examinerId].reviewedInventions.includes(data.inventionId)) {
            io.to(examinerId).emit('reviewResult', { 
                success: false, 
                score: 0, 
                msg: "你已经审查过这个发明了！不能重复审查。", 
                inventionId: data.inventionId 
            });
            return;
        }
        
        // Check if user is trying to review their own invention
        if (inventorId === examinerId) {
            io.to(examinerId).emit('reviewResult', { 
                success: false, 
                score: 0, 
                msg: "不能审查自己的发明！", 
                inventionId: data.inventionId 
            });
            return;
        }
        
        const trueAnswers = invention.trueAnswers;
        const selectedAnswers = data.selectedPrinciples;
        const comment = data.comment || "";
        
        // Mark as reviewed
        users[examinerId].reviewedInventions.push(data.inventionId);
        
        // Compare answers
        const isExactMatch = selectedAnswers.length === trueAnswers.length && 
            selectedAnswers.every(val => trueAnswers.includes(val));
        
        const reviewId = `review_${Date.now()}_${examinerId}`;
        
        // Archive for potential appeal
        completedReviews[reviewId] = {
            inventionId: data.inventionId,
            invention: invention,
            inventorId,
            examinerId,
            selectedAnswers,
            comment,
            isExactMatch,
            timestamp: Date.now()
        };
        
        if (isExactMatch) {
            // Calculate relation bonus
            const relationBonus = calculateRelationBonus(selectedAnswers, trueAnswers);
            const totalScore = 12 + relationBonus.bonus;
            
            // Examiner gets base score + relation bonus
            if (users[examinerId]) {
                users[examinerId].examinerScore += totalScore;
                checkScoreThreshold(examinerId);
            }
            
            let msg = `慧眼识珠！判定完全正确！+${totalScore}分`;
            if (relationBonus.bonus > 0) {
                msg += `\n✨ 关联奖励：${relationBonus.reasons.join('、')}`;
            }
            
            io.to(examinerId).emit('reviewResult', { 
                success: true, 
                score: totalScore, 
                msg: msg,
                relationBonus: relationBonus,
                reviewId: reviewId, 
                inventionId: data.inventionId 
            });
            
            if (users[inventorId]) {
                const noticeMsg = comment ? `你的发明「${invention.title}」被 ${users[examinerId].name} 识破了！\n对方嘲讽: "${comment}"` : `你的发明「${invention.title}」被 ${users[examinerId].name} 识破了！`;
                io.to(inventorId).emit('inventionResult', { success: false, msg: noticeMsg });
            }
        } else {
            // Inventor +12 (reduced from 15), Examiner -3 (reduced from -5)
            if (users[inventorId]) users[inventorId].inventorScore += 12;
            if (users[examinerId]) {
                users[examinerId].examinerScore -= 3;
                checkScoreThreshold(examinerId);
            }
            
            io.to(examinerId).emit('reviewResult', { 
                success: false, 
                score: -3, 
                msg: "判定失误！被发明家骗过了！", 
                correct: trueAnswers,
                reviewId: reviewId,
                inventionId: data.inventionId
            });
            if (users[inventorId]) {
                const noticeMsg = comment ? `恭喜！你的发明「${invention.title}」成功骗过了 ${users[examinerId].name}！\n对方无能狂怒: "${comment}"` : `恭喜！你的发明「${invention.title}」成功骗过了 ${users[examinerId].name}！`;
                io.to(inventorId).emit('inventionResult', { success: true, score: 12, msg: noticeMsg });
            }
        }
        
        // Broadcast rankings
        broadcastRankings();
    });

    // 4. Battle Logic - Examiner (Old system - keep for backward compatibility)
    socket.on('submitReview', (data) => {
        // data: { reviewId, selectedPrinciples: [] }
        const reviewTask = pendingReviews[data.reviewId];
        if (!reviewTask) return;

        const inventorId = reviewTask.inventorId;
        const examinerId = socket.id;
        const trueAnswers = reviewTask.invention.trueAnswers;
        const selectedAnswers = data.selectedPrinciples;

        // Compare answers
        const isExactMatch = selectedAnswers.length === trueAnswers.length && 
            selectedAnswers.every(val => trueAnswers.includes(val));

        // Archive for potential appeal
        completedReviews[data.reviewId] = {
            ...reviewTask,
            examinerId,
            selectedAnswers,
            isExactMatch,
            timestamp: Date.now()
        };

        if (isExactMatch) {
            // Examiner +10
            if (users[examinerId]) users[examinerId].examinerScore += 10;
            io.to(examinerId).emit('reviewResult', { success: true, score: 10, msg: "慧眼识珠！判定完全正确！" });
            if (users[inventorId]) io.to(inventorId).emit('inventionResult', { success: false, msg: `你的发明被 ${users[examinerId].name} 识破了！` });
        } else {
            // Inventor +15, Examiner -5
            if (users[inventorId]) users[inventorId].inventorScore += 15;
            if (users[examinerId]) users[examinerId].examinerScore -= 5;
            
            io.to(examinerId).emit('reviewResult', { 
                success: false, 
                score: -5, 
                msg: "判定失误！被发明家骗过了！", 
                correct: trueAnswers,
                reviewId: data.reviewId // Send ID for appeal
            });
            if (users[inventorId]) io.to(inventorId).emit('inventionResult', { success: true, score: 15, msg: `恭喜！你的发明成功骗过了 ${users[examinerId].name}！` });
        }

        // Clear task for examiner
        delete pendingReviews[data.reviewId];
        if (users[examinerId]) {
            users[examinerId].currentTasks = users[examinerId].currentTasks.filter(t => t !== data.reviewId);
        }

        // Broadcast rankings
        broadcastRankings();
    });

    socket.on('submitAppeal', (data) => {
        // data: { reviewId, reason }
        const review = completedReviews[data.reviewId];
        if (!review) return;
        if (review.examinerId !== socket.id) return;
        if (appeals[data.reviewId]) return; // Already appealed
        if (juryVotings[data.reviewId]) return; // Already in jury voting

        // Deduct Deposit (8 points - increased from 5 for higher threshold)
        if (users[socket.id]) {
            users[socket.id].examinerScore -= 8;
            checkScoreThreshold(socket.id);
        }

        const appeal = {
            id: data.reviewId,
            reviewId: data.reviewId,
            appellantId: socket.id,
            appellantName: users[socket.id].name,
            reason: data.reason || "我觉得我就是对的，你不懂！",
            defense: null, // Will be filled by inventor
            invention: review.invention,
            examinerAnswers: review.selectedAnswers,
            trueAnswers: review.invention.trueAnswers,
            timestamp: Date.now()
        };

        appeals[data.reviewId] = appeal;

        // Broadcast to admin immediately
        io.emit('updateAppeals', Object.values(appeals));

        // Start Jury Voting immediately, but also request defense from inventor
        startJuryVoting(appeal);
        
        // Notify the inventor to defend themselves
        if (users[appeal.invention.inventorId]) {
            io.to(appeal.invention.inventorId).emit('requestDefense', { appealId: appeal.id });
        }

        broadcastRankings();
        socket.emit('appealSubmitted', { msg: "申诉已提交！已扣除 8 分保证金。\n正在召集群众陪审团..." });
    });
    
    socket.on('submitDefense', (data) => {
        // data: { appealId, defense }
        const appeal = appeals[data.appealId];
        if (!appeal) return;
        if (appeal.invention.inventorId !== socket.id) return;
        
        appeal.defense = data.defense;
        
        // Broadcast the updated appeal/jury data
        io.emit('updateAppeals', Object.values(appeals));
        
        // Need to update active jury voting objects
        const voting = juryVotings[data.appealId];
        if (voting) {
            voting.appeal.defense = data.defense;
            broadcastJuryVotingStatus(voting);
        }
    });

    socket.on('submitJuryVote', (data) => {
        // data: { votingId, vote: 'support_examiner' | 'support_inventor' }
        const voting = juryVotings[data.votingId];
        if (!voting) return;
        if (voting.status !== 'active') return;
        
        const appeal = appeals[voting.appealId];
        if (!appeal) return;
        
        // Can't vote if you're the appellant or inventor
        if (socket.id === appeal.appellantId || socket.id === appeal.invention.inventorId) return;
        
        // Record vote
        voting.votes[socket.id] = {
            vote: data.vote,
            voterName: users[socket.id]?.name || 'Unknown',
            timestamp: Date.now()
        };
        
        // Broadcast updated voting status
        broadcastJuryVotingStatus(voting);
    });

    socket.on('requestAppealsUpdate', () => {
        // Admin or client requesting fresh appeals data
        io.emit('updateAppeals', Object.values(appeals));
    });

    socket.on('adminResolveAppeal', (data) => {
        // data: { appealId, decision } // decision: 'uphold' (reject appeal) or 'overturn' (accept appeal) or 'execute_vote' (follow jury)
        const appeal = appeals[data.appealId];
        if (!appeal) return;
        
        const voting = juryVotings[data.appealId];
        let finalDecision = data.decision;
        
        // If execute_vote, calculate from jury votes
        if (data.decision === 'execute_vote' && voting) {
            const voteCount = calculateVoteResult(voting);
            finalDecision = voteCount.supportExaminer > voteCount.supportInventor ? 'overturn' : 'uphold';
        }
        
        executeAppealDecision(appeal, voting, finalDecision);
        
        // Mark as resolved and keep as historical record
        appeal.status = 'resolved';
        appeal.finalDecision = finalDecision;
        appeal.resolvedAt = Date.now();
        
        if (voting) {
            voting.status = 'resolved';
            voting.finalDecision = finalDecision;
        }
        
        // Broadcast the resolved status (keep in appeals list as history)
        io.emit('updateAppeals', Object.values(appeals));
        io.emit('updateJuryVotings', Object.values(juryVotings));
        broadcastRankings();
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        // Handle pending reviews if this user was a reviewer
        if (users[socket.id] && users[socket.id].currentTasks && users[socket.id].currentTasks.length > 0) {
            users[socket.id].currentTasks.forEach(reviewId => {
                const review = pendingReviews[reviewId];
                if (review) {
                    console.log(`Reviewer ${socket.id} disconnected, reassigning review ${reviewId}`);
                    delete pendingReviews[reviewId]; // Remove old task
                    // Re-assign invention
                    assignInventionToReviewer(review.invention, review.inventorId);
                }
            });
        }

        delete users[socket.id];
        io.emit('updateUserList', Object.values(users));
    });
});

function distributeExampleCases() {
    // Distribute example cases to all qualified students for practice
    const qualifiedUsers = Object.values(users).filter(u => u.status === 'qualified');
    
    if (qualifiedUsers.length === 0) return;
    
    // Each qualified student gets one random example case
    qualifiedUsers.forEach(user => {
        const randomExample = exampleCases[Math.floor(Math.random() * exampleCases.length)];
        const reviewId = 'example_' + Date.now() + "_" + user.id;
        
        const exampleInvention = {
            id: randomExample.id,
            inventorId: 'system',
            inventorName: randomExample.inventorName,
            title: randomExample.title,
            desc: randomExample.desc,
            trueAnswers: randomExample.trueAnswers
        };
        
        pendingReviews[reviewId] = {
            id: reviewId,
            inventorId: 'system',
            invention: exampleInvention,
            assignedTo: user.id,
            timestamp: Date.now()
        };
        
        users[user.id].currentTasks.push(reviewId);
        
        io.to(user.id).emit('newReviewTask', {
            reviewId: reviewId,
            title: exampleInvention.title,
            desc: exampleInvention.desc,
            isExample: true
        });
    });
    
    io.emit('systemMessage', '已为所有学生分配练手案例！');
}

function assignInventionToReviewer(invention, excludeId) {
    // Allow users with existing tasks (no !u.currentTask filter)
    const qualifiedUsers = Object.values(users).filter(u => u.status === 'qualified' && u.id !== excludeId);
    
    if (qualifiedUsers.length > 0) {
        // Pick user with fewest current tasks for load balancing
        const reviewer = qualifiedUsers.reduce((min, u) => 
            (u.currentTasks.length < min.currentTasks.length) ? u : min
        , qualifiedUsers[0]);
        const reviewId = Date.now() + "_" + reviewer.id;
        
        pendingReviews[reviewId] = {
            id: reviewId,
            inventorId: invention.inventorId,
            invention: invention,
            assignedTo: reviewer.id,
            timestamp: Date.now()
        };
        
        users[reviewer.id].currentTasks.push(reviewId);
        
        io.to(reviewer.id).emit('newReviewTask', {
            reviewId: reviewId,
            title: invention.title,
            desc: invention.desc
        });
    } else {
        // Retry later or queue? For simplicity, we just drop it or tell user to wait. 
        // Realistically, we should queue it.
        // Let's implement a simple retry timeout
        setTimeout(() => assignInventionToReviewer(invention, excludeId), 3000);
    }
}

function broadcastRankings() {
    const allUsers = Object.values(users);
    
    // Send full user list to update client-side state (including own scores)
    io.emit('updateUserList', allUsers);

    // Sort for Examiner (Strict Patent Officer)
    const examinerRank = [...allUsers].sort((a, b) => b.examinerScore - a.examinerScore).slice(0, 5);
    
    // Sort for Inventor (Outlaw)
    const inventorRank = [...allUsers].sort((a, b) => b.inventorScore - a.inventorScore).slice(0, 5);
    
    io.emit('rankings', { examinerRank, inventorRank });
}

// Jury Voting Helper Functions
function startJuryVoting(appeal) {
    const votingId = appeal.id;
    const VOTING_DURATION = 180000; // 3 minutes (180 seconds)
    
    juryVotings[votingId] = {
        id: votingId,
        appealId: appeal.id,
        appeal: appeal,
        votes: {},
        startTime: Date.now(),
        endTime: Date.now() + VOTING_DURATION,
        status: 'active',
        duration: VOTING_DURATION
    };
    
    // Broadcast to all qualified users (except appellant and inventor)
    const eligibleJurors = Object.values(users).filter(u => 
        u.personalStage === 'battle' && 
        u.id !== appeal.appellantId && 
        u.id !== appeal.invention.inventorId
    );
    
    eligibleJurors.forEach(juror => {
        // Check if this juror has reviewed this invention before
        const hasReviewed = juror.reviewedInventions.includes(appeal.invention.id);
        
        io.to(juror.id).emit('juryInvitation', {
            votingId: votingId,
            appeal: {
                appellantName: appeal.appellantName,
                inventorName: appeal.invention.inventorName,
                title: appeal.invention.title,
                desc: appeal.invention.desc,
                reason: appeal.reason,
                defense: appeal.defense,
                examinerAnswers: appeal.examinerAnswers,
                trueAnswers: hasReviewed ? appeal.trueAnswers : null // Only show if reviewed
            },
            duration: VOTING_DURATION,
            hasReviewed: hasReviewed
        });
    });
    
    // Notify admin
    io.emit('updateJuryVotings', Object.values(juryVotings));
    
    // Broadcast initial voting status to all
    broadcastJuryVotingStatus(juryVotings[votingId]);
    
    // Auto-close voting after duration
    setTimeout(() => {
        if (juryVotings[votingId] && juryVotings[votingId].status === 'active') {
            juryVotings[votingId].status = 'closed';
            broadcastJuryVotingStatus(juryVotings[votingId]);
            io.emit('systemMessage', `⏰ 陪审团投票时间结束！案件：${appeal.invention.title}`);
        }
    }, VOTING_DURATION);
    
    // Send countdown updates every 30 seconds
    const countdownInterval = setInterval(() => {
        if (juryVotings[votingId] && juryVotings[votingId].status === 'active') {
            const remaining = juryVotings[votingId].endTime - Date.now();
            if (remaining > 0) {
                io.emit('juryCountdown', {
                    votingId: votingId,
                    remaining: remaining
                });
            } else {
                clearInterval(countdownInterval);
            }
        } else {
            clearInterval(countdownInterval);
        }
    }, 30000); // Update every 30 seconds
}

function broadcastJuryVotingStatus(voting) {
    const voteCount = calculateVoteResult(voting);
    
    // Update voting object with latest counts
    voting.voteCount = voteCount;
    voting.totalVotes = Object.keys(voting.votes).length;
    
    // Calculate remaining time
    const remaining = voting.endTime - Date.now();
    
    // Broadcast to ALL users (real-time voting results)
    io.emit('juryVotingUpdate', {
        votingId: voting.id,
        appealId: voting.appealId,
        voteCount: voteCount,
        status: voting.status,
        totalVotes: Object.keys(voting.votes).length,
        remaining: Math.max(0, remaining),
        appeal: {
            title: voting.appeal.invention.title,
            appellantName: voting.appeal.appellantName,
            inventorName: voting.appeal.invention.inventorName
        }
    });
    
    io.emit('updateJuryVotings', Object.values(juryVotings));
}

function calculateVoteResult(voting) {
    let supportExaminer = 0;
    let supportInventor = 0;
    
    Object.values(voting.votes).forEach(v => {
        if (v.vote === 'support_examiner') supportExaminer++;
        else if (v.vote === 'support_inventor') supportInventor++;
    });
    
    return { supportExaminer, supportInventor };
}

function executeAppealDecision(appeal, voting, decision) {
    const appellantId = appeal.appellantId;
    const inventorId = appeal.invention.inventorId;
    
    const judge = voting ? "群众陪审团" : "最高法院";
    
    // Prepare detailed result for broadcast
    const judgmentResult = {
        appealId: appeal.id,
        caseNumber: appeal.id.substring(0, 8),
        invention: {
            title: appeal.invention.title,
            desc: appeal.invention.desc
        },
        appellant: {
            name: appeal.appellantName,
            answers: appeal.examinerAnswers
        },
        inventor: {
            name: appeal.invention.inventorName,
            answers: appeal.trueAnswers
        },
        reason: appeal.reason,
        defense: appeal.defense,
        judge: judge,
        decision: decision, // 'overturn' or 'uphold'
        voteCount: voting ? voting.voteCount : null,
        timestamp: Date.now()
    };
    
    if (decision === 'overturn') {
        // Appeal Successful - Examiner was right
        judgmentResult.winner = 'examiner';
        judgmentResult.verdict = `${judge}判定：审查官判决正确，发明家的专利存在问题`;
        judgmentResult.appellantReward = 20;
        judgmentResult.inventorPenalty = -20;
        
        if (users[appellantId]) {
            // Simplified: Refund 8 deposit + 3 lost earlier + 12 normal win + 5 compensation = 28 points → 20 points
            users[appellantId].examinerScore += 20;
            checkScoreThreshold(appellantId);
            io.to(appellantId).emit('appealResult', { 
                success: true, 
                msg: `🎉 申诉成功！${judge}判你无罪！返还扣分并给予补偿（+20分）！` 
            });
        }
        
        if (users[inventorId]) {
            // Simplified: Deduct the 12 they won earlier + 8 penalty = 20 points
            users[inventorId].inventorScore -= 20;
            checkScoreThreshold(inventorId);
            io.to(inventorId).emit('appealResult', { 
                success: false, 
                msg: `😱 你的专利被${judge}判定为"虚假专利"！原告申诉成功，你被重罚 20 分！` 
            });
        }
        
    } else {
        // Appeal Rejected - Inventor was right
        judgmentResult.winner = 'inventor';
        judgmentResult.verdict = `${judge}判定：发明家的专利设计合理，审查官判决错误`;
        judgmentResult.appellantReward = 0;
        judgmentResult.inventorPenalty = 8;
        
        if (users[appellantId]) {
            io.to(appellantId).emit('appealResult', { 
                success: false, 
                msg: `⚖️ 申诉驳回！${judge}认为你的理由（${appeal.reason}）不成立，维持原判，保证金不予退还。` 
            });
        }
        if (users[inventorId]) {
            // Inventor gets the 8 point deposit as reward (increased from 5)
            users[inventorId].inventorScore += 8;
            io.to(inventorId).emit('appealResult', { 
                success: true, 
                msg: `🎉 ${judge}驳回了原告的申诉！你的辩护（${appeal.defense || '无'}）非常成功，获得对方保证金 8 分！` 
            });
        }
    }
    
    // Reward/Penalize Jurors if voting exists
    if (voting) {
        const correctVote = decision === 'overturn' ? 'support_examiner' : 'support_inventor';
        judgmentResult.juryRewards = [];
        
        Object.entries(voting.votes).forEach(([jurorId, voteData]) => {
            if (users[jurorId]) {
                const isCorrect = voteData.vote === correctVote;
                const reward = isCorrect ? 2 : -2;
                
                judgmentResult.juryRewards.push({
                    jurorName: users[jurorId].name,
                    vote: voteData.vote,
                    isCorrect: isCorrect,
                    reward: reward
                });
                
                if (isCorrect) {
                    // Correct vote: +2 points (reduced from 3 for balance)
                    users[jurorId].examinerScore += 2;
                    checkScoreThreshold(jurorId);
                    io.to(jurorId).emit('juryReward', { 
                        msg: "👍 你的陪审判断正确！奖励 2 分！", 
                        score: 2 
                    });
                } else {
                    // Wrong vote: -2 points (symmetric penalty)
                    users[jurorId].examinerScore -= 2;
                    checkScoreThreshold(jurorId);
                    io.to(jurorId).emit('juryReward', { 
                        msg: "👎 你的陪审判断错误！扣除 2 分。", 
                        score: -2 
                    });
                }
            }
        });
    }
    
    // Broadcast judgment result to ALL users (students and admin)
    io.emit('judgmentAnnouncement', judgmentResult);
    
    // Also broadcast system message
    const winnerName = decision === 'overturn' ? appeal.appellantName : appeal.invention.inventorName;
    io.emit('systemMessage', `⚖️ 案件裁决：${appeal.invention.title} - ${judge}判定 ${winnerName} 胜诉！`);
}

// Broadcast rankings loop
setInterval(broadcastRankings, 3000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
